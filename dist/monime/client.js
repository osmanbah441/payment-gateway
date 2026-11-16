import { PaymentGatewayError } from "../types.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_REQUEST_TIMEOUT_MS, fetchWithRetry, } from "../utils.js";
export class MonimeApiError extends PaymentGatewayError {
    constructor(message, status, body) {
        super(message, status, body);
        this.name = "MonimeApiError";
    }
}
export async function monimeClient(config) {
    const url = `${config.baseUrl}${config.path}`;
    const method = config.method;
    let body;
    if (["POST", "PUT", "PATCH"].includes(method) && config.data) {
        body = JSON.stringify(config.data);
    }
    const headers = {
        "Authorization": `Bearer ${config.personalAccessToken}`,
        "Content-Type": "application/json",
        "Monime-Space-Id": config.spaceId,
    };
    if (config.idempotencyKey) {
        headers["Idempotency-Key"] = config.idempotencyKey;
    }
    const response = await fetchWithRetry(url, { method, headers, body }, {
        maxRetries: DEFAULT_MAX_RETRIES,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        idempotencyKey: config.idempotencyKey,
        createError: (message, status, errBody) => new MonimeApiError(message, status, errBody),
    });
    if (response.status === 204) {
        return {
            success: true,
            messages: ["No Content"],
            result: {},
        };
    }
    let parsedBody;
    try {
        parsedBody = await response.json();
    }
    catch {
        throw new MonimeApiError("Malformed Monime API response body", response.status, null);
    }
    if (!response.ok) {
        throw new MonimeApiError(`Monime API Error [${response.status}]`, response.status, parsedBody);
    }
    if (typeof parsedBody !== "object" ||
        parsedBody === null ||
        !("result" in parsedBody) ||
        typeof parsedBody.result !== "object" ||
        parsedBody.result === null) {
        throw new MonimeApiError("Unexpected Monime API response structure", response.status, parsedBody);
    }
    const typedBody = parsedBody;
    if (typedBody.success === false) {
        throw new MonimeApiError(typedBody.messages?.[0] ?? "Monime API request failed", response.status, parsedBody);
    }
    return typedBody;
}
export function assertValidResultAmount(res) {
    if (typeof res.result.id !== "string" ||
        typeof res.result.amount?.value !== "number") {
        throw new MonimeApiError("Monime API result is missing required id or amount", undefined, res);
    }
}
//# sourceMappingURL=client.js.map