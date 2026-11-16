import { type PaymentStatus } from "./types.js";
export declare const DEFAULT_MAX_RETRIES = 3;
export declare const DEFAULT_INITIAL_DELAY_MS = 500;
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
export interface FetchRetryOptions {
    /** Maximum number of attempts (defaults to 3) */
    maxRetries?: number;
    /** Initial exponential backoff delay in ms (defaults to 500) */
    initialDelayMs?: number;
    /** Per-attempt request timeout in ms (defaults to 15000) */
    timeoutMs?: number;
    /** Optional idempotency key to attach on each attempt */
    idempotencyKey?: string;
    /** Header name for the idempotency key (defaults to "Idempotency-Key") */
    idempotencyHeaderName?: string;
    /** Custom error factory for non-retryable or exhausted failures */
    createError?: (message: string, status?: number, body?: unknown) => Error;
}
export interface VerifyHmacWebhookOptions {
    /** Header containing the signature (e.g., "monime-signature") */
    signatureHeaderName: string;
    /** Secret used to compute the HMAC-SHA256 signature */
    webhookSecret: string;
    /** Optional shared secret header name to validate before signature checks */
    customHeaderName?: string;
    /** Expected shared secret value for `customHeaderName` */
    customHeaderSecret?: string;
    /** Signature digest encoding (defaults to "base64") */
    encoding?: "base64" | "hex";
    /** Builds the signed message from timestamp and raw body (defaults to `${timestamp}_${rawBody}`) */
    buildSignedPayload?: (timestamp: string, rawBody: string) => string;
    /** Maximum allowed webhook age in seconds (defaults to 300) */
    maxAgeSeconds?: number;
    /** Maximum allowed future clock skew in seconds (defaults to 60) */
    maxFutureSeconds?: number;
}
/**
 * Executes fetch with per-attempt timeout, exponential backoff retries on 5xx and
 * network/timeout errors, and idempotency key suffixed (`-r<attempt>`) after 5xx responses.
 */
export declare function fetchWithRetry(url: string, options?: RequestInit, retryOptions?: FetchRetryOptions): Promise<Response>;
/**
 * Validates that every key in `keys` has a non-empty string value, returning the
 * narrowed record or throwing a `PaymentGatewayError` listing all missing keys.
 */
export declare function validateRequiredKeys<T extends Record<string, string | undefined>>(keys: T, prefix?: string): {
    [K in keyof T]: string;
};
/**
 * Normalizes Sierra Leone currency codes between outbound ISO format (`"SLE"`)
 * and inbound display format (`"NLe"`).
 */
export declare function normalizeCurrency(currency?: string, format?: "iso" | "display"): string;
/**
 * Maps provider-specific transaction status strings into normalized `PaymentStatus` values.
 */
export declare function normalizePaymentStatus(status?: string): PaymentStatus;
/**
 * Timing-safe string comparison (normalizing optional trailing Base64 `=` padding).
 */
export declare function safeCompare(a: string, b: string): boolean;
/**
 * Verifies an incoming HMAC-SHA256 signed webhook request (optional shared header check,
 * `t=<unix>,v1=<sig>` header parsing, replay window check, and constant-time HMAC comparison).
 * Returns the raw request body and parsed timestamp/signature, or throws `WebhookVerificationError`.
 */
export declare function verifyHmacWebhook(req: Request, options: VerifyHmacWebhookOptions): Promise<{
    rawBody: string;
    timestamp: string;
    signature: string;
}>;
export declare class MonetaryConverter {
    /**
     * Converts a decimal value in the major unit (e.g., 8.55) to an integer in the minor unit (e.g., 855).
     */
    static toMinor(majorValue: number): number;
    /**
     * Converts an integer value in the minor unit (e.g., 855) to a decimal in the major unit (e.g., 8.55).
     */
    static toMajor(minorValue: number): number;
}
//# sourceMappingURL=utils.d.ts.map