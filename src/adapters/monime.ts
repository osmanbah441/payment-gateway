import type { PaymentGateway } from "../gateway.ts";
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
} from "../types.ts";
import {
  computeHmacBase64,
  DEFAULT_MAX_RETRIES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithRetry,
  MonetaryConverter,
  parseSignatureHeader,
  type RequiredConfigVar,
  safeCompare,
  validateRequiredConfig,
  verifyTimestamp,
} from "../utils.ts";

const MONIME_API_BASE = "https://api.monime.io/v1";
const DEFAULT_CUSTOM_WEBHOOK_HEADER = "salone-bazaar-monime-webhook";

interface MonimeApiResponse<T> {
  success: boolean;
  messages: string[];
  result: T;
}

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

  const options: RequestInit = {
    method,
    headers,
    body,
  };

  const response = await fetchWithRetry(url, options, {
    maxRetries: DEFAULT_MAX_RETRIES,
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    idempotencyKey: config.idempotencyKey,
    createError: (message, status, errBody) =>
      new MonimeApiError(message, status, errBody),
  });

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
    parsedBody = {
      success: false,
      messages: ["Malformed response body"],
      result: null,
    };
  }

  if (!response.ok) {
    throw new MonimeApiError(
      `Monime API Error [${response.status}]`,
      response.status,
      parsedBody,
    );
  }

  return parsedBody as MonimeApiResponse<T>;
}

function validateRequired(requiredVars: RequiredConfigVar[]): void {
  validateRequiredConfig(requiredVars, {
    prefix: "Missing required Monime personal access tokens",
    createError: (message) => new MonimeApiError(message),
  });
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

function normalizeCurrency(currency?: string): string {
  if (!currency || currency === "SLE") {
    return "NLe";
  }
  return currency;
}

function normalizeStatus(status?: string): PaymentStatus {
  switch (status?.toLowerCase()) {
    case "pending":
    case "processing":
      return "pending";
    case "completed":
    case "succeeded":
      return "completed";
    case "paid":
      return "paid";
    case "failed":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "unknown";
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

  private validateWalletSecrets(): {
    paymentApiKey: string;
    spaceId: string;
    escrowAccountId: string;
    commissionAccountId: string;
  } {
    validateRequired([
      { key: "PAYMENT_API_KEY", value: this.config.apiKey },
      { key: "MONIME_SPACE_ID", value: this.config.spaceId },
      { key: "ESCROW_ACCOUNT", value: this.config.escrowAccountId },
      { key: "COMMISSION_ACCOUNT_ID", value: this.config.commissionAccountId },
    ]);

    return {
      paymentApiKey: this.config.apiKey!,
      spaceId: this.config.spaceId!,
      escrowAccountId: this.config.escrowAccountId!,
      commissionAccountId: this.config.commissionAccountId!,
    };
  }

  private validateApiCredentials(): {
    paymentApiKey: string;
    spaceId: string;
  } {
    validateRequired([
      { key: "PAYMENT_API_KEY", value: this.config.apiKey },
      { key: "MONIME_SPACE_ID", value: this.config.spaceId },
    ]);

    return {
      paymentApiKey: this.config.apiKey!,
      spaceId: this.config.spaceId!,
    };
  }

  private validateWebhookSecrets(): {
    monimeWebhookSecret: string;
    customWebhookHeaderSecret: string;
  } {
    validateRequired([
      {
        key: "MONIME_PAYMENT_COMPLETED_WEBHOOK",
        value: this.config.webhookSecret,
      },
      {
        key: "SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK",
        value: this.config.customWebhookHeaderSecret,
      },
    ]);

    return {
      monimeWebhookSecret: this.config.webhookSecret!,
      customWebhookHeaderSecret: this.config.customWebhookHeaderSecret!,
    };
  }

  public async charge(
    request: ChargeRequest,
  ): Promise<TransactionResult<MonimeApiResponse<UssdPaymentCodeResponse>>> {
    const tokens = this.validateWalletSecrets();
    const requestCurrency =
      !request.currency || request.currency === "NLe" || request.currency === "NLE"
        ? "SLE"
        : request.currency;

    const payload = {
      name: request.description ?? "Checkout Payment",
      amount: {
        currency: requestCurrency,
        value: MonetaryConverter.toMinor(request.amount),
      },
      duration: request.duration ?? "10m",
      financialAccountId: request.destinationAccountId ?? tokens.escrowAccountId,
      reference: request.reference,
    };

    const res = await monimeClient<UssdPaymentCodeResponse>({
      baseUrl: this.baseUrl,
      path: "/payment-codes",
      personalAccessToken: tokens.paymentApiKey,
      spaceId: tokens.spaceId,
      idempotencyKey: request.idempotencyKey ?? request.reference,
      method: "POST",
      data: payload,
    });

    return {
      id: res.result.id,
      status: normalizeStatus(res.result.status),
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency),
      reference: res.result.reference ?? request.reference,
      expireTime: res.result.expireTime,
      ussdCode: res.result.ussdCode,
      raw: res,
    };
  }

  public async payout(
    request: PayoutRequest,
  ): Promise<TransactionResult<MonimeApiResponse<MonimePayoutResult>>> {
    const tokens = this.validateWalletSecrets();
    const requestCurrency =
      !request.currency || request.currency === "NLe" || request.currency === "NLE"
        ? "SLE"
        : request.currency;

    const res = await monimeClient<MonimePayoutResult>({
      baseUrl: this.baseUrl,
      path: "/payouts",
      personalAccessToken: tokens.paymentApiKey,
      spaceId: tokens.spaceId,
      method: "POST",
      idempotencyKey: request.idempotencyKey ?? request.reference,
      data: {
        amount: {
          currency: requestCurrency,
          value: MonetaryConverter.toMinor(request.amount),
        },
        source: {
          financialAccountId: request.sourceAccountId ?? tokens.escrowAccountId,
        },
        destination: {
          type: "momo",
          providerId: normalizeProviderId(request.provider),
          phoneNumber: request.recipientPhone,
        },
      },
    });

    return {
      id: res.result.id,
      status: res.result.status ? normalizeStatus(res.result.status) : "completed",
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency),
      reference: res.result.reference ?? request.reference,
      raw: res,
    };
  }

  public async verify(
    transactionId: string,
    type: "charge" | "payout" = "charge",
  ): Promise<TransactionResult> {
    const tokens = this.validateApiCredentials();

    if (type === "payout") {
      const res = await monimeClient<MonimePayoutResult>({
        baseUrl: this.baseUrl,
        path: `/payouts/${transactionId}`,
        personalAccessToken: tokens.paymentApiKey,
        spaceId: tokens.spaceId,
        method: "GET",
      });

      return {
        id: res.result.id,
        status: normalizeStatus(res.result.status),
        amount: MonetaryConverter.toMajor(res.result.amount.value),
        currency: normalizeCurrency(res.result.amount.currency),
        reference: res.result.reference,
        raw: res,
      };
    }

    const res = await monimeClient<UssdPaymentCodeResponse>({
      baseUrl: this.baseUrl,
      path: `/payment-codes/${transactionId}`,
      personalAccessToken: tokens.paymentApiKey,
      spaceId: tokens.spaceId,
      method: "GET",
    });

    return {
      id: res.result.id,
      status: normalizeStatus(res.result.status),
      amount: MonetaryConverter.toMajor(res.result.amount.value),
      currency: normalizeCurrency(res.result.amount.currency),
      reference: res.result.reference,
      expireTime: res.result.expireTime,
      ussdCode: res.result.ussdCode,
      raw: res,
    };
  }

  public async parseWebhook(req: Request): Promise<WebhookEvent> {
    const secrets = this.validateWebhookSecrets();

    // 1. Initial Authorization Header Check
    const headerSecret = req.headers.get(this.customWebhookHeaderName);
    if (
      !headerSecret ||
      !safeCompare(headerSecret, secrets.customWebhookHeaderSecret)
    ) {
      throw new WebhookVerificationError("Unauthorized header", 401);
    }

    // 2. Signature Presence Check
    const signatureHeader = req.headers.get("monime-signature");
    if (!signatureHeader) {
      throw new WebhookVerificationError("Missing signature header", 401);
    }

    // 3. Signature Parsing
    let parsedSignature: { timestamp: string; signature: string };
    try {
      parsedSignature = parseSignatureHeader(signatureHeader);
    } catch {
      throw new WebhookVerificationError("Invalid signature format", 401);
    }

    const { timestamp, signature } = parsedSignature;

    // 4. Replay Protection (Timestamp Check)
    if (!verifyTimestamp(timestamp)) {
      throw new WebhookVerificationError("Timestamp out of tolerance", 401);
    }

    // 5. Signature Verification
    const rawBody = await req.text();
    const signedPayload = `${timestamp}_${rawBody}`;
    const expectedSignature = await computeHmacBase64(
      secrets.monimeWebhookSecret,
      signedPayload,
    );

    if (!safeCompare(signature, expectedSignature)) {
      throw new WebhookVerificationError("Invalid signature", 401);
    }

    // 6. JSON Parsing & Normalization
    const payload = JSON.parse(rawBody) as MonimeWebhookPayload;
    const rawEventName = payload?.event?.name ?? "";
    const type = normalizeWebhookEventType(rawEventName);
    const data =
      payload?.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const reference =
      typeof data?.reference === "string" ? data.reference : undefined;

    return {
      id: payload?.event?.id ?? payload?.object?.id ?? "",
      type,
      rawEventName,
      status: webhookStatusForEvent(type),
      reference,
      timestamp: payload?.event?.timestamp ?? "",
      data,
      raw: payload,
    };
  }
}
