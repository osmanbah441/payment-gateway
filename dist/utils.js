import { PaymentGatewayError } from "./types.js";
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_DELAY_MS = 500;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
/**
 * Resolves after the specified duration in milliseconds.
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Computes exponential backoff delay for a 1-based attempt number.
 */
export function calculateBackoffDelay(attempt, initialDelayMs = DEFAULT_INITIAL_DELAY_MS) {
    return Math.pow(2, attempt - 1) * initialDelayMs;
}
/**
 * Safely parses a Response body as JSON, falling back to plain text or null.
 */
export async function parseResponseBody(response) {
    try {
        const rawText = await response.text();
        if (!rawText)
            return null;
        try {
            return JSON.parse(rawText);
        }
        catch {
            return rawText;
        }
    }
    catch {
        return null;
    }
}
/**
 * Executes fetch with per-attempt timeout, exponential backoff retries on 5xx and
 * network/timeout errors, and idempotency key suffixed (`-r<attempt>`) after 5xx responses.
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    const maxRetries = retryOptions.maxRetries ?? DEFAULT_MAX_RETRIES;
    const initialDelayMs = retryOptions.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const timeoutMs = retryOptions.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const idempotencyKey = retryOptions.idempotencyKey;
    const idempotencyHeaderName = retryOptions.idempotencyHeaderName ?? "Idempotency-Key";
    const createError = retryOptions.createError ??
        ((message, status, body) => new PaymentGatewayError(message, status, body));
    let lastRetryableError;
    let lastRetryableStatus;
    let lastRetryableBody = null;
    let had5xxResponse = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let nonRetryableError;
        try {
            const attemptHeaders = new Headers(options.headers);
            if (idempotencyKey) {
                attemptHeaders.set(idempotencyHeaderName, had5xxResponse && attempt > 1
                    ? `${idempotencyKey}-r${attempt}`
                    : idempotencyKey);
            }
            const response = await fetch(url, {
                ...options,
                headers: attemptHeaders,
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok)
                return response;
            const parsedBody = await parseResponseBody(response);
            if (response.status >= 500) {
                had5xxResponse = true;
                lastRetryableStatus = response.status;
                lastRetryableBody = parsedBody;
                lastRetryableError = undefined;
            }
            else {
                nonRetryableError = createError(`API call failed with status ${response.status}`, response.status, parsedBody);
                throw nonRetryableError;
            }
        }
        catch (error) {
            if (nonRetryableError && error === nonRetryableError) {
                throw error;
            }
            lastRetryableError = error;
            lastRetryableStatus = undefined;
            lastRetryableBody = null;
        }
        if (attempt < maxRetries) {
            const delay = calculateBackoffDelay(attempt, initialDelayMs);
            await sleep(delay);
        }
    }
    if (lastRetryableStatus !== undefined) {
        throw createError(`API call failed after ${maxRetries} attempts with status ${lastRetryableStatus}`, lastRetryableStatus, lastRetryableBody);
    }
    if (lastRetryableError) {
        throw createError(`API call failed after ${maxRetries} attempts: ${lastRetryableError.message}`);
    }
    throw createError(`API call failed after ${maxRetries} attempts: unknown error`);
}
/**
 * Ensures all required configuration values are present, throwing a descriptive error if any are missing.
 */
export function validateRequiredConfig(requiredVars, options = {}) {
    const missingKeys = [];
    for (const { key, value } of requiredVars) {
        if (!value) {
            missingKeys.push(key);
        }
    }
    if (missingKeys.length > 0) {
        const prefix = options.prefix ?? "Missing required configuration keys";
        const message = `${prefix}: ${missingKeys.join(", ")}`;
        const createError = options.createError ?? ((msg) => new PaymentGatewayError(msg));
        throw createError(message);
    }
}
async function computeHmacBytes(secret, payload) {
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(secret);
    const messageBytes = encoder.encode(payload);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageBytes);
    return new Uint8Array(signatureBuffer);
}
/**
 * Computes a Base64-encoded HMAC-SHA256 digest using Web Crypto.
 */
export async function computeHmacBase64(secret, payload) {
    const hashArray = await computeHmacBytes(secret, payload);
    let binary = "";
    for (let i = 0; i < hashArray.byteLength; i++) {
        binary += String.fromCharCode(hashArray[i]);
    }
    return btoa(binary);
}
/**
 * Computes a lowercase hex-encoded HMAC-SHA256 digest using Web Crypto.
 */
export async function computeHmacHex(secret, payload) {
    const hashArray = await computeHmacBytes(secret, payload);
    let hex = "";
    for (let i = 0; i < hashArray.byteLength; i++) {
        hex += hashArray[i].toString(16).padStart(2, "0");
    }
    return hex;
}
/**
 * Timing-safe string comparison (normalizing optional trailing Base64 `=` padding).
 */
export function safeCompare(a, b) {
    const strA = a.replace(/=+$/, "");
    const strB = b.replace(/=+$/, "");
    if (strA.length !== strB.length)
        return false;
    let result = 0;
    for (let i = 0; i < strA.length; i++) {
        result |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
    }
    return result === 0;
}
/**
 * Verifies a Unix timestamp (seconds) falls within replay tolerance bounds.
 */
export function verifyTimestamp(timestamp, maxAgeSeconds = 300, maxFutureSeconds = 60) {
    const ts = typeof timestamp === "number" ? timestamp : parseInt(timestamp, 10);
    if (isNaN(ts))
        return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - ts > maxAgeSeconds || ts - now > maxFutureSeconds) {
        console.error(`❌ Timestamp out of tolerance: now=${now}, t=${ts}, diff=${ts - now}`);
        return false;
    }
    return true;
}
/**
 * Parses a `t=<timestamp>,v1=<signature>` webhook signature header.
 */
export function parseSignatureHeader(header) {
    const parts = Object.fromEntries(header.split(",").map((part) => {
        const [k, v] = part.split("=", 2);
        return [k?.trim() ?? "", v?.trim() ?? ""];
    }));
    if (!parts.t || !parts.v1) {
        throw new Error("Invalid signature format");
    }
    return {
        timestamp: parts.t,
        signature: parts.v1,
    };
}
export class MonetaryConverter {
    /**
     * Converts a decimal value in the major unit (e.g., 8.55) to an integer in the minor unit (e.g., 855).
     */
    static toMinor(majorValue) {
        return Math.round(majorValue * 100);
    }
    /**
     * Converts an integer value in the minor unit (e.g., 855) to a decimal in the major unit (e.g., 8.55).
     */
    static toMajor(minorValue) {
        return minorValue / 100;
    }
}
//# sourceMappingURL=utils.js.map