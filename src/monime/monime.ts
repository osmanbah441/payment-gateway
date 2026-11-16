import type { PaymentGateway } from "../gateway.js";
import type {
  ChargeRequest,
  MobileMoneyProvider,
  PayoutRequest,
  TransactionResult,
  WebhookEvent,
} from "../types.js";
import {
  MonetaryConverter,
  normalizeCurrency,
  normalizePaymentStatus,
  validateRequiredKeys,
} from "../utils.js";
import { assertValidResultAmount, monimeClient } from "./client.js";
import type {
  MonimeConfig,
  MonimePayoutResult,
  UssdPaymentCodeResponse,
} from "./types.js";
import {
  DEFAULT_CUSTOM_WEBHOOK_HEADER,
  parseMonimeWebhook,
} from "./webhook.js";

export type { MonimeConfig };

const MONIME_API_BASE = "https://api.monime.io/v1";

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
    return parseMonimeWebhook(req, {
      webhookSecret: this.config.webhookSecret,
      customWebhookHeaderSecret: this.config.customWebhookHeaderSecret,
      customWebhookHeaderName: this.customWebhookHeaderName,
    });
  }
}
