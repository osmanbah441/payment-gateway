import type { PaymentGateway } from "../gateway.js";
import type { ChargeRequest, PayoutRequest, TransactionResult, WebhookEvent } from "../types.js";
import type { MonimeConfig } from "./types.js";
export type { MonimeConfig };
export declare class MonimeAdapter implements PaymentGateway {
    private readonly config;
    private readonly baseUrl;
    private readonly customWebhookHeaderName;
    constructor(config: MonimeConfig);
    charge(request: ChargeRequest): Promise<TransactionResult>;
    payout(request: PayoutRequest): Promise<TransactionResult>;
    verify(transactionId: string, type?: "charge" | "payout"): Promise<TransactionResult>;
    parseWebhook(req: Request): Promise<WebhookEvent>;
}
//# sourceMappingURL=monime.d.ts.map