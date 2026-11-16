import { PaymentGatewayError } from "../types.js";
import type { MonimeApiResponse, MonimeClientConfig } from "./types.js";
export declare class MonimeApiError extends PaymentGatewayError {
    constructor(message: string, status?: number, body?: unknown);
}
export declare function monimeClient<T>(config: MonimeClientConfig): Promise<MonimeApiResponse<T>>;
export declare function assertValidResultAmount(res: MonimeApiResponse<{
    id?: unknown;
    amount?: {
        value?: unknown;
        currency?: unknown;
    };
}>): void;
//# sourceMappingURL=client.d.ts.map