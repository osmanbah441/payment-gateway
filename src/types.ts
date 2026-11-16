export type PaymentStatus =
  | "pending"
  | "completed"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "unknown";

export type MobileMoneyProvider =
  | "orange_money"
  | "afrimoney"
  | (string & {});

export type CurrencyCode = "SLE" | "NLE" | "NLe" | (string & {});

export interface ChargeRequest {
  /** Amount in major currency units (e.g., NLe / SLE) */
  amount: number;
  /** Currency code (defaults to "SLE") */
  currency?: CurrencyCode;
  /** Unique order or escrow reference ID */
  reference: string;
  /** Optional idempotency key (defaults to reference) */
  idempotencyKey?: string;
  /** Display name / description for the charge (defaults to "Checkout Payment") */
  description?: string;
  /** Expiration duration for payment codes (defaults to "10m") */
  duration?: string;
  /** Optional customer phone number (+232...) */
  customerPhone?: string;
  /** Optional customer name */
  customerName?: string;
  /** Optional override for destination / escrow financial account ID */
  destinationAccountId?: string;
  /** Optional arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface PayoutRequest {
  /** Net payout amount in major currency units (e.g., NLe / SLE) */
  amount: number;
  /** Currency code (defaults to "SLE") */
  currency?: CurrencyCode;
  /** Unique withdrawal / ledger reference ID */
  reference: string;
  /** Optional idempotency key (defaults to reference) */
  idempotencyKey?: string;
  /** Recipient mobile money phone number (+232...) */
  recipientPhone: string;
  /** Mobile money provider identifier */
  provider: MobileMoneyProvider;
  /** Optional override for source / escrow financial account ID */
  sourceAccountId?: string;
  /** Optional payout description */
  description?: string;
  /** Optional arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface TransactionResult {
  /** Provider transaction or payment code ID */
  id: string;
  /** Normalized payment status */
  status: PaymentStatus;
  /** Amount in major currency units (e.g., NLe) */
  amount: number;
  /** Normalized display currency (e.g., "NLe") */
  currency: string;
  /** Associated order or withdrawal reference */
  reference?: string;
  /** USSD dial string for customer payment codes (when applicable) */
  ussdCode?: string;
  /** ISO-8601 expiration timestamp for payment codes (when applicable) */
  expireTime?: string;
  /** Raw provider response payload */
  raw: Record<string, unknown>;
}

export type WebhookEventType =
  | "charge.completed"
  | "payout.completed"
  | "checkout.completed"
  | "unknown";

export interface WebhookEvent {
  /** Unique webhook event ID */
  id: string;
  /** Normalized provider-agnostic webhook event type */
  type: WebhookEventType;
  /** Raw provider event name */
  rawEventName: string;
  /** Normalized payment status implied by the event */
  status: PaymentStatus;
  /** Associated order or payout reference (if present in payload) */
  reference?: string;
  /** ISO-8601 event timestamp */
  timestamp: string;
  /** Parsed event data object */
  data: Record<string, unknown> | null;
  /** Full raw webhook payload */
  raw: Record<string, unknown>;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "PaymentGatewayError";
  }
}

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    public readonly status: number = 401,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
