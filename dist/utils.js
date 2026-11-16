import { PaymentGatewayError, WebhookVerificationError, } from "./types.js";
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_DELAY_MS = 500;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
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
            let parsedBody = null;
            try {
                const rawText = await response.text();
                if (rawText) {
                    try {
                        parsedBody = JSON.parse(rawText);
                    }
                    catch {
                        parsedBody = rawText;
                    }
                }
            }
            catch {
                parsedBody = null;
            }
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
            const delay = Math.pow(2, attempt - 1) * initialDelayMs;
            await new Promise((resolve) => setTimeout(resolve, delay));
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
 * Validates that every key in `keys` has a non-empty string value, returning the
 * narrowed record or throwing a `PaymentGatewayError` listing all missing keys.
 */
export function validateRequiredKeys(keys, prefix = "Missing required configuration keys") {
    const missingKeys = [];
    for (const [key, value] of Object.entries(keys)) {
        if (!value) {
            missingKeys.push(key);
        }
    }
    if (missingKeys.length > 0) {
        throw new PaymentGatewayError(`${prefix}: ${missingKeys.join(", ")}`);
    }
    return keys;
}
/**
 * Normalizes Sierra Leone currency codes between outbound ISO format (`"SLE"`)
 * and inbound display format (`"NLe"`).
 */
export function normalizeCurrency(currency, format = "display") {
    if (format === "iso") {
        if (!currency || currency === "NLe" || currency === "NLE") {
            return "SLE";
        }
        return currency;
    }
    if (!currency || currency === "SLE") {
        return "NLe";
    }
    return currency;
}
/**
 * Maps provider-specific transaction status strings into normalized `PaymentStatus` values.
 */
export function normalizePaymentStatus(status) {
    switch (status?.toLowerCase()) {
        case "pending":
        case "processing":
            return "pending";
        case "completed":
        case "succeeded":
            return "completed";
        case "paid":
            return "paid";
        case "failed":
            return "failed";
        case "cancelled":
        case "canceled":
            return "cancelled";
        case "expired":
            return "expired";
        default:
            return "unknown";
    }
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
 * Verifies an incoming HMAC-SHA256 signed webhook request (optional shared header check,
 * `t=<unix>,v1=<sig>` header parsing, replay window check, and constant-time HMAC comparison).
 * Returns the raw request body and parsed timestamp/signature, or throws `WebhookVerificationError`.
 */
export async function verifyHmacWebhook(req, options) {
    if (options.customHeaderName && options.customHeaderSecret) {
        const headerSecret = req.headers.get(options.customHeaderName);
        if (!headerSecret || !safeCompare(headerSecret, options.customHeaderSecret)) {
            throw new WebhookVerificationError("Unauthorized header", 401);
        }
    }
    const signatureHeader = req.headers.get(options.signatureHeaderName);
    if (!signatureHeader) {
        throw new WebhookVerificationError("Missing signature header", 401);
    }
    const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
        const [k, v] = part.split("=", 2);
        return [k?.trim() ?? "", v?.trim() ?? ""];
    }));
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) {
        throw new WebhookVerificationError("Invalid signature format", 401);
    }
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const maxAge = options.maxAgeSeconds ?? 300;
    const maxFuture = options.maxFutureSeconds ?? 60;
    if (isNaN(ts) || now - ts > maxAge || ts - now > maxFuture) {
        throw new WebhookVerificationError("Timestamp out of tolerance", 401);
    }
    const rawBody = await req.text();
    const signedPayload = options.buildSignedPayload
        ? options.buildSignedPayload(timestamp, rawBody)
        : `${timestamp}_${rawBody}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(options.webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const hashArray = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload)));
    let expectedSignature = "";
    if (options.encoding === "hex") {
        for (let i = 0; i < hashArray.byteLength; i++) {
            expectedSignature += hashArray[i].toString(16).padStart(2, "0");
        }
    }
    else {
        let binary = "";
        for (let i = 0; i < hashArray.byteLength; i++) {
            binary += String.fromCharCode(hashArray[i]);
        }
        expectedSignature = btoa(binary);
    }
    if (!safeCompare(signature, expectedSignature)) {
        throw new WebhookVerificationError("Invalid signature", 401);
    }
    return { rawBody, timestamp, signature };
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