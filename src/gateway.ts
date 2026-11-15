import { MonimeAdapter, type MonimeConfig } from "./adapters/monime.ts";
import type {
  ChargeRequest,
  PayoutRequest,
  TransactionResult,
  WebhookEvent,
} from "./types.ts";

export interface PaymentGateway {
  /**
   * Initiates a customer charge (e.g., generates a USSD payment code).
   */
  charge(request: ChargeRequest): Promise<TransactionResult>;

  /**
   * Initiates a mobile money payout / withdrawal to a vendor or farmer.
   */
  payout(request: PayoutRequest): Promise<TransactionResult>;

  /**
   * Verifies and fetches the current state of a transaction from the provider.
   */
  verify(
    transactionId: string,
    type?: "charge" | "payout",
  ): Promise<TransactionResult>;

  /**
   * Authenticates, verifies the signature/timestamp of an incoming webhook HTTP request,
   * and parses it into a normalized WebhookEvent.
   * Throws WebhookVerificationError on authentication/signature failure.
   */
  parseWebhook(req: Request): Promise<WebhookEvent>;
}

/**
 * Provider-agnostic factory constructors for {@link PaymentGateway} instances.
 */
export const PaymentGateway = {
  /**
   * Creates a {@link PaymentGateway} backed by the Monime REST API and webhook verifier.
   */
  monime(config: MonimeConfig): PaymentGateway {
    return new MonimeAdapter(config);
  },
} as const;
