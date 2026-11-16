import type { PaymentGateway } from "../gateway.js";
import {
  type ChargeRequest,
  type MobileMoneyProvider,
  PaymentGatewayError,
  type PaymentStatus,
  type PayoutRequest,
  type TransactionResult,
  type WebhookEvent,
  type WebhookEventType,
  WebhookVerificationError,
} from "../types.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithRetry,
  MonetaryConverter,
  normalizeCurrency,
  normalizePaymentStatus,
  validateRequiredKeys,
  verifyHmacWebhook,
} from "../utils.js";

const MONIME_API_BASE = "https://api.monime.io/v1";
const DEFAULT_CUSTOM_WEBHOOK_HEADER = "salone-bazaar-monime-webhook";

type MonimeApiResponse<T> = {
  success: boolean;
  messages: string[];
  result: T;
};

class MonimeApiError extends PaymentGatewayError {
  constructor(
    message: string,
    status?: number,
    body?: unknown,
  ) {
    super(message, status, body);
    this.name = "MonimeApiError";
  }
}

interface MonetaryAmount {
  currency: string;
  value: number;
}

interface UssdPaymentCodeResponse {
  id: string;
  status: string;
  name: string;
  amount: MonetaryAmount;
  expireTime: string;
  ussdCode: string;
  customer?: {
    name?: string;
  };
  reference?: string;
}

interface MonimePayoutResult {
  id: string;
  status?: string;
  amount: MonetaryAmount;
  source: {
    financialAccountId: string;
    transactionReference?: string;
  };
  destination: {
    type: string;
    providerId: string;
    accountNumber?: string;
    phoneNumber?: string;
    transactionReference?: string;
  };
  fees?: Array<{
    code: string;
    amount: MonetaryAmount;
  }>;
  reference?: string;
}

enum MonimeEventName {
  PAYMENT_CODE_COMPLETED = "payment_code.completed",
  PAYOUT_COMPLETED = "payout.completed",
  CHECKOUT_SESSION_COMPLETED = "checkout_session.completed",
}

interface MonimeWebhookPayload {
  apiVersion: string;
  event: {
    id: string;
    name: MonimeEventName | string;
    timestamp: string;
  };
  object: {
    id: string;
    type: string;
  };
  data: unknown;
}

/**
 * Configuration options for creating a Monime-backed {@link PaymentGateway}.
 *
 * Wallet secrets (`apiKey`, `spaceId`, `escrowAccountId`, `commissionAccountId`) are validated
 * when initiating charges or payouts; webhook secrets (`webhookSecret`, `customWebhookHeaderSecret`)
 * are validated when calling `parseWebhook`.
 */
export interface MonimeConfig {
  /** Monime personal access token (`PAYMENT_API_KEY`). */
  apiKey?: string;
  /** Monime Space ID sent in the `Monime-Space-Id` header (`MONIME_SPACE_ID`). */
  spaceId?: string;
  /** Default Monime financial account ID used for escrow charges and payout source (`ESCROW_ACCOUNT`). */
  escrowAccountId?: string;
  /** Monime commission financial account ID (`COMMISSION_ACCOUNT_ID`). */
  commissionAccountId?: string;
  /** HMAC-SHA256 webhook signing secret (`MONIME_PAYMENT_COMPLETED_WEBHOOK`). */
  webhookSecret?: string;
  /** Shared custom header secret expected on incoming webhook requests (`SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK`). */
  customWebhookHeaderSecret?: string;
  /** Custom header name checked before verifying signatures (defaults to `"salone-bazaar-monime-webhook"`). */
  customWebhookHeaderName?: string;
  /** Override for the Monime REST API base URL (defaults to `"https://api.monime.io/v1"`). */
  baseUrl?: string;
}

interface MonimeClientConfig {
  baseUrl: string;
  path: string;
  personalAccessToken: string;
  spaceId: string;
  method: string;
  idempotencyKey?: string;
  data?: unknown;
}

async function monimeClient<T>(
  config: MonimeClientConfig,
): Promise<MonimeApiResponse<T>> {
  const url = `${config.baseUrl}${config.path}`;
  const method = config.method;

  let body: string | undefined;
  if (["POST", "PUT", "PATCH"].includes(method) && config.data) {
    body = JSON.stringify(config.data);
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.personalAccessToken}`,
    "Content-Type": "application/json",
    "Monime-Space-Id": config.spaceId,
  };
  if (config.idempotencyKey) {
    headers["Idempotency-Key"] = config.idempotencyKey;
  }

  const response = await fetchWithRetry(
    url,
    { method, headers, body },
    {
      maxRetries: DEFAULT_MAX_RETRIES,
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      idempotencyKey: config.idempotencyKey,
      createError: (message, status, errBody) =>
        new MonimeApiError(message, status, errBody),
    },
  );

  if (response.status === 204) {
    return {
      success: true,
      messages: ["No Content"],
      result: {} as T,
    } as MonimeApiResponse<T>;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    throw new MonimeApiError(
      "Malformed Monime API response body",
      response.status,
      null,
    );
  }

  if (!response.ok) {
    throw new MonimeApiError(
      `Monime API Error [${response.status}]`,
      response.status,
      parsedBody,
    );
  }

  if (
    typeof parsedBody !== "object" ||
    parsedBody === null ||
    !("result" in parsedBody) ||
    typeof (parsedBody as { result?: unknown }).result !== "object" ||
    (parsedBody as { result?: unknown }).result === null
  ) {
    throw new MonimeApiError(
      "Unexpected Monime API response structure",
      response.status,
      parsedBody,
    );
  }

  const typedBody = parsedBody as MonimeApiResponse<T>;
  if (typedBody.success === false) {
    throw new MonimeApiError(
      typedBody.messages?.[0] ?? "Monime API request failed",
      response.status,
      parsedBody,
    );
  }

  return typedBody;
}

function assertValidResultAmount(
  res: MonimeApiResponse<{ id?: unknown; amount?: { value?: unknown; currency?: unknown } }>,
): void {
  if (
    typeof res.result.id !== "string" ||
    typeof res.result.amount?.value !== "number"
  ) {
    throw new MonimeApiError(
      "Monime API result is missing required id or amount",
      undefined,
      res,
    );
  }
}

function normalizeProviderId(provider: MobileMoneyProvider): string {
  switch (provider) {
    case "orange_money":
      return "m17";
    case "afrimoney":
      return "m18";
    default:
      return provider;
  }
}

function normalizeWebhookEventType(eventName?: string): WebhookEventType {
  switch (eventName) {
    case MonimeEventName.PAYMENT_CODE_COMPLETED:
      return "charge.completed";
    case MonimeEventName.PAYOUT_COMPLETED:
      return "payout.completed";
    case MonimeEventName.CHECKOUT_SESSION_COMPLETED:
      return "checkout.completed";
    default:
      return "unknown";
  }
}

function webhookStatusForEvent(type: WebhookEventType): PaymentStatus {
  switch (type) {
    case "charge.completed":
      return "paid";
    case "payout.completed":
    case "checkout.completed":
      return "completed";
    default:
      return "unknown";
  }
}

export class MonimeAdapter implements PaymentGateway {
  private readonly baseUrl: string;
  private readonly customWebhookHeaderName: string;

  constructor(private readonly config: MonimeConfig) {
    this.baseUrl = config.baseUrl ?? MONIME_API_BASE;
    this.customWebhookHeaderName =
      config.customWebhookHeaderName ?? DEFAULT_CUSTOM_WEBHOOK_HEADER;
  }

  public async charge(
    request: ChargeRequest,
  ): Promise<TransactionResult> {
    const tokens = validateRequiredKeys(
      {
        PAYMENT_API_KEY: this.config.apiKey,
        MONIME_SPACE_ID: this.config.spaceId,
        ESCROW_ACCOUNT: this.config.escrowAccountId,
        COMMISSION_ACCOUNT_ID: this.config.commissionAccountId,
      },
      "Missing required Monime personal access tokens",
    );

    const payload = {
      name: request.description ?? "Checkout Payment",
      amount: {
        currency: normalizeCurrency(request.currency, "iso"),
        value: MonetaryConverter.toMinor(request.amount),
      },
      duration: request.duration ?? "10m",
      financialAccountId: request.destinationAccountId ?? tokens.ESCROW_ACCOUNT,
      reference: request.reference,
    };

    const res = await monimeClient<UssdPaymentCodeResponse>({
      baseUrl: this.baseUrl,
      path: "/payment-codes",
      personalAccessToken: tokens.PAYMENT_API_KEY,
      spaceId: tokens.MONIME_SPACE_ID,
      idempotencyKey: request.idempotencyKey ?? request.reference,
      method: "POST",
      data: payload,
    });
    assertValidResultAmount(res);

    return {
      id: res.result.id,
      status: normalizePaymentStatus(res.result.status),
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency, "display"),
      reference: res.result.reference ?? request.reference,
      expireTime: res.result.expireTime,
      ussdCode: res.result.ussdCode,
      raw: res,
    };
  }

  public async payout(
    request: PayoutRequest,
  ): Promise<TransactionResult> {
    const tokens = validateRequiredKeys(
      {
        PAYMENT_API_KEY: this.config.apiKey,
        MONIME_SPACE_ID: this.config.spaceId,
        ESCROW_ACCOUNT: this.config.escrowAccountId,
        COMMISSION_ACCOUNT_ID: this.config.commissionAccountId,
      },
      "Missing required Monime personal access tokens",
    );

    const res = await monimeClient<MonimePayoutResult>({
      baseUrl: this.baseUrl,
      path: "/payouts",
      personalAccessToken: tokens.PAYMENT_API_KEY,
      spaceId: tokens.MONIME_SPACE_ID,
      method: "POST",
      idempotencyKey: request.idempotencyKey ?? request.reference,
      data: {
        amount: {
          currency: normalizeCurrency(request.currency, "iso"),
          value: MonetaryConverter.toMinor(request.amount),
        },
        source: {
          financialAccountId: request.sourceAccountId ?? tokens.ESCROW_ACCOUNT,
        },
        destination: {
          type: "momo",
          providerId: normalizeProviderId(request.provider),
          phoneNumber: request.recipientPhone,
        },
      },
    });
    assertValidResultAmount(res);

    return {
      id: res.result.id,
      status: res.result.status
        ? normalizePaymentStatus(res.result.status)
        : "completed",
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency, "display"),
      reference: res.result.reference ?? request.reference,
      raw: res,
    };
  }

  public async verify(
    transactionId: string,
    type: "charge" | "payout" = "charge",
  ): Promise<TransactionResult> {
    const tokens = validateRequiredKeys(
      {
        PAYMENT_API_KEY: this.config.apiKey,
        MONIME_SPACE_ID: this.config.spaceId,
      },
      "Missing required Monime personal access tokens",
    );

    if (type === "payout") {
      const res = await monimeClient<MonimePayoutResult>({
        baseUrl: this.baseUrl,
        path: `/payouts/${transactionId}`,
        personalAccessToken: tokens.PAYMENT_API_KEY,
        spaceId: tokens.MONIME_SPACE_ID,
        method: "GET",
      });
      assertValidResultAmount(res);

      return {
        id: res.result.id,
        status: normalizePaymentStatus(res.result.status),
        amount: MonetaryConverter.toMajor(res.result.amount.value),
        currency: normalizeCurrency(res.result.amount.currency, "display"),
        reference: res.result.reference,
        raw: res,
      };
    }

    const res = await monimeClient<UssdPaymentCodeResponse>({
      baseUrl: this.baseUrl,
      path: `/payment-codes/${transactionId}`,
      personalAccessToken: tokens.PAYMENT_API_KEY,
      spaceId: tokens.MONIME_SPACE_ID,
      method: "GET",
    });
    assertValidResultAmount(res);

    return {
      id: res.result.id,
      status: normalizePaymentStatus(res.result.status),
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency, "display"),
      reference: res.result.reference,
      expireTime: res.result.expireTime,
      ussdCode: res.result.ussdCode,
      raw: res,
    };
  }

  public async parseWebhook(req: Request): Promise<WebhookEvent> {
    const secrets = validateRequiredKeys(
      {
        MONIME_PAYMENT_COMPLETED_WEBHOOK: this.config.webhookSecret,
        SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK:
          this.config.customWebhookHeaderSecret,
      },
      "Missing required Monime personal access tokens",
    );

    const { rawBody } = await verifyHmacWebhook(req, {
      signatureHeaderName: "monime-signature",
      webhookSecret: secrets.MONIME_PAYMENT_COMPLETED_WEBHOOK,
      customHeaderName: this.customWebhookHeaderName,
      customHeaderSecret: secrets.SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK,
      encoding: "base64",
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Invalid webhook JSON payload", 400);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new WebhookVerificationError("Invalid webhook payload structure", 400);
    }

    const payload = parsed as Partial<MonimeWebhookPayload> &
      Record<string, unknown>;
    const rawEventName =
      typeof payload.event?.name === "string" ? payload.event.name : "";
    const type = normalizeWebhookEventType(rawEventName);
    const data =
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : null;
    const reference =
      typeof data?.reference === "string" ? data.reference : undefined;
    const eventId =
      typeof payload.event?.id === "string"
        ? payload.event.id
        : typeof payload.object?.id === "string"
          ? payload.object.id
          : "";
    const timestamp =
      typeof payload.event?.timestamp === "string" ? payload.event.timestamp : "";

    return {
      id: eventId,
      type,
      rawEventName,
      status: webhookStatusForEvent(type),
      reference,
      timestamp,
      data,
      raw: payload,
    };
  }
}
