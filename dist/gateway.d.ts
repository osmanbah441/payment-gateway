import type { MonimeConfig } from "./monime/types.js";
import type { ChargeRequest, PayoutRequest, TransactionResult, WebhookEvent } from "./types.js";
/**
 * Provider-agnostic payment gateway contract and static factory constructors.
 */
export declare abstract class PaymentGateway {
    /**
     * Initiates a customer charge (e.g., generates a USSD payment code).
     */
    abstract charge(request: ChargeRequest): Promise<TransactionResult>;
    /**
     * Initiates a mobile money payout / withdrawal to a vendor or farmer.
     */
    abstract payout(request: PayoutRequest): Promise<TransactionResult>;
    /**
     * Verifies and fetches the current state of a transaction from the provider.
     */
    abstract verify(transactionId: string, type?: "charge" | "payout"): Promise<TransactionResult>;
    /**
     * Authenticates, verifies the signature/timestamp of an incoming webhook HTTP request,
     * and parses it into a normalized WebhookEvent.
     * Throws WebhookVerificationError on authentication/signature failure.
     */
    abstract parseWebhook(req: Request): Promise<WebhookEvent>;
    /**
     * Creates a {@link PaymentGateway} backed by the Monime REST API and webhook verifier.
     */
    static monime(config: MonimeConfig): PaymentGateway;
}
//# sourceMappingURL=gateway.d.ts.map