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
export interface RequiredConfigVar {
    key: string;
    value: string | undefined;
}
export interface ValidateConfigOptions {
    /** Message prefix before the comma-separated missing keys */
    prefix?: string;
    /** Custom error factory when keys are missing */
    createError?: (message: string) => Error;
}
/**
 * Resolves after the specified duration in milliseconds.
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Computes exponential backoff delay for a 1-based attempt number.
 */
export declare function calculateBackoffDelay(attempt: number, initialDelayMs?: number): number;
/**
 * Safely parses a Response body as JSON, falling back to plain text or null.
 */
export declare function parseResponseBody(response: Response): Promise<unknown>;
/**
 * Executes fetch with per-attempt timeout, exponential backoff retries on 5xx and
 * network/timeout errors, and idempotency key suffixed (`-r<attempt>`) after 5xx responses.
 */
export declare function fetchWithRetry(url: string, options?: RequestInit, retryOptions?: FetchRetryOptions): Promise<Response>;
/**
 * Ensures all required configuration values are present, throwing a descriptive error if any are missing.
 */
export declare function validateRequiredConfig(requiredVars: RequiredConfigVar[], options?: ValidateConfigOptions): void;
/**
 * Computes a Base64-encoded HMAC-SHA256 digest using Web Crypto.
 */
export declare function computeHmacBase64(secret: string, payload: string): Promise<string>;
/**
 * Computes a lowercase hex-encoded HMAC-SHA256 digest using Web Crypto.
 */
export declare function computeHmacHex(secret: string, payload: string): Promise<string>;
/**
 * Timing-safe string comparison (normalizing optional trailing Base64 `=` padding).
 */
export declare function safeCompare(a: string, b: string): boolean;
/**
 * Verifies a Unix timestamp (seconds) falls within replay tolerance bounds.
 */
export declare function verifyTimestamp(timestamp: string | number, maxAgeSeconds?: number, maxFutureSeconds?: number): boolean;
/**
 * Parses a `t=<timestamp>,v1=<signature>` webhook signature header.
 */
export declare function parseSignatureHeader(header: string): {
    timestamp: string;
    signature: string;
};
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