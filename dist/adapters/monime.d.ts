import type { PaymentGateway } from "../gateway.js";
import { type ChargeRequest, type PayoutRequest, type TransactionResult, type WebhookEvent } from "../types.js";
interface MonimeApiResponse<T> {
    success: boolean;
    messages: string[];
    result: T;
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
export declare class MonimeAdapter implements PaymentGateway {
    private readonly config;
    private readonly baseUrl;
    private readonly customWebhookHeaderName;
    constructor(config: MonimeConfig);
    charge(request: ChargeRequest): Promise<TransactionResult<MonimeApiResponse<UssdPaymentCodeResponse>>>;
    payout(request: PayoutRequest): Promise<TransactionResult<MonimeApiResponse<MonimePayoutResult>>>;
    verify(transactionId: string, type?: "charge" | "payout"): Promise<TransactionResult>;
    parseWebhook(req: Request): Promise<WebhookEvent>;
}
export {};
//# sourceMappingURL=monime.d.ts.map