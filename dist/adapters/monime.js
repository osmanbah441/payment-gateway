import { PaymentGatewayError, WebhookVerificationError, } from "../types.js";
import { DEFAULT_MAX_RETRIES, DEFAULT_REQUEST_TIMEOUT_MS, fetchWithRetry, MonetaryConverter, normalizeCurrency, normalizePaymentStatus, validateRequiredKeys, verifyHmacWebhook, } from "../utils.js";
const MONIME_API_BASE = "https://api.monime.io/v1";
const DEFAULT_CUSTOM_WEBHOOK_HEADER = "salone-bazaar-monime-webhook";
class MonimeApiError extends PaymentGatewayError {
    constructor(message, status, body) {
        super(message, status, body);
        this.name = "MonimeApiError";
    }
}
var MonimeEventName;
(function (MonimeEventName) {
    MonimeEventName["PAYMENT_CODE_COMPLETED"] = "payment_code.completed";
    MonimeEventName["PAYOUT_COMPLETED"] = "payout.completed";
    MonimeEventName["CHECKOUT_SESSION_COMPLETED"] = "checkout_session.completed";
})(MonimeEventName || (MonimeEventName = {}));
async function monimeClient(config) {
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
function assertValidResultAmount(res) {
    if (typeof res.result.id !== "string" ||
        typeof res.result.amount?.value !== "number") {
        throw new MonimeApiError("Monime API result is missing required id or amount", undefined, res);
    }
}
function normalizeProviderId(provider) {
    switch (provider) {
        case "orange_money":
            return "m17";
        case "afrimoney":
            return "m18";
        default:
            return provider;
    }
}
function normalizeWebhookEventType(eventName) {
    switch (eventName) {
        case MonimeEventName.PAYMENT_CODE_COMPLETED:
            return "charge.completed";
        case MonimeEventName.PAYOUT_COMPLETED:
            return "payout.completed";
        case MonimeEventName.CHECKOUT_SESSION_COMPLETED:
            return "checkout.completed";
        default:
            return "unknown";
    }
}
function webhookStatusForEvent(type) {
    switch (type) {
        case "charge.completed":
            return "paid";
        case "payout.completed":
        case "checkout.completed":
            return "completed";
        default:
            return "unknown";
    }
}
export class MonimeAdapter {
    config;
    baseUrl;
    customWebhookHeaderName;
    constructor(config) {
        this.config = config;
        this.baseUrl = config.baseUrl ?? MONIME_API_BASE;
        this.customWebhookHeaderName =
            config.customWebhookHeaderName ?? DEFAULT_CUSTOM_WEBHOOK_HEADER;
    }
    async charge(request) {
        const tokens = validateRequiredKeys({
            PAYMENT_API_KEY: this.config.apiKey,
            MONIME_SPACE_ID: this.config.spaceId,
            ESCROW_ACCOUNT: this.config.escrowAccountId,
            COMMISSION_ACCOUNT_ID: this.config.commissionAccountId,
        }, "Missing required Monime personal access tokens");
        const payload = {
            name: request.description ?? "Checkout Payment",
            amount: {
                currency: normalizeCurrency(request.currency, "iso"),
                value: MonetaryConverter.toMinor(request.amount),
            },
            duration: request.duration ?? "10m",
            financialAccountId: request.destinationAccountId ?? tokens.ESCROW_ACCOUNT,
            reference: request.reference,
        };
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: "/payment-codes",
            personalAccessToken: tokens.PAYMENT_API_KEY,
            spaceId: tokens.MONIME_SPACE_ID,
            idempotencyKey: request.idempotencyKey ?? request.reference,
            method: "POST",
            data: payload,
        });
        assertValidResultAmount(res);
        return {
            id: res.result.id,
            status: normalizePaymentStatus(res.result.status),
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency, "display"),
            reference: res.result.reference ?? request.reference,
            expireTime: res.result.expireTime,
            ussdCode: res.result.ussdCode,
            raw: res,
        };
    }
    async payout(request) {
        const tokens = validateRequiredKeys({
            PAYMENT_API_KEY: this.config.apiKey,
            MONIME_SPACE_ID: this.config.spaceId,
            ESCROW_ACCOUNT: this.config.escrowAccountId,
            COMMISSION_ACCOUNT_ID: this.config.commissionAccountId,
        }, "Missing required Monime personal access tokens");
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: "/payouts",
            personalAccessToken: tokens.PAYMENT_API_KEY,
            spaceId: tokens.MONIME_SPACE_ID,
            method: "POST",
            idempotencyKey: request.idempotencyKey ?? request.reference,
            data: {
                amount: {
                    currency: normalizeCurrency(request.currency, "iso"),
                    value: MonetaryConverter.toMinor(request.amount),
                },
                source: {
                    financialAccountId: request.sourceAccountId ?? tokens.ESCROW_ACCOUNT,
                },
                destination: {
                    type: "momo",
                    providerId: normalizeProviderId(request.provider),
                    phoneNumber: request.recipientPhone,
                },
            },
        });
        assertValidResultAmount(res);
        return {
            id: res.result.id,
            status: res.result.status
                ? normalizePaymentStatus(res.result.status)
                : "completed",
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency, "display"),
            reference: res.result.reference ?? request.reference,
            raw: res,
        };
    }
    async verify(transactionId, type = "charge") {
        const tokens = validateRequiredKeys({
            PAYMENT_API_KEY: this.config.apiKey,
            MONIME_SPACE_ID: this.config.spaceId,
        }, "Missing required Monime personal access tokens");
        if (type === "payout") {
            const res = await monimeClient({
                baseUrl: this.baseUrl,
                path: `/payouts/${transactionId}`,
                personalAccessToken: tokens.PAYMENT_API_KEY,
                spaceId: tokens.MONIME_SPACE_ID,
                method: "GET",
            });
            assertValidResultAmount(res);
            return {
                id: res.result.id,
                status: normalizePaymentStatus(res.result.status),
                amount: MonetaryConverter.toMajor(res.result.amount.value),
                currency: normalizeCurrency(res.result.amount.currency, "display"),
                reference: res.result.reference,
                raw: res,
            };
        }
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: `/payment-codes/${transactionId}`,
            personalAccessToken: tokens.PAYMENT_API_KEY,
            spaceId: tokens.MONIME_SPACE_ID,
            method: "GET",
        });
        assertValidResultAmount(res);
        return {
            id: res.result.id,
            status: normalizePaymentStatus(res.result.status),
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency, "display"),
            reference: res.result.reference,
            expireTime: res.result.expireTime,
            ussdCode: res.result.ussdCode,
            raw: res,
        };
    }
    async parseWebhook(req) {
        const secrets = validateRequiredKeys({
            MONIME_PAYMENT_COMPLETED_WEBHOOK: this.config.webhookSecret,
            SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK: this.config.customWebhookHeaderSecret,
        }, "Missing required Monime personal access tokens");
        const { rawBody } = await verifyHmacWebhook(req, {
            signatureHeaderName: "monime-signature",
            webhookSecret: secrets.MONIME_PAYMENT_COMPLETED_WEBHOOK,
            customHeaderName: this.customWebhookHeaderName,
            customHeaderSecret: secrets.SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK,
            encoding: "base64",
        });
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch {
            throw new WebhookVerificationError("Invalid webhook JSON payload", 400);
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new WebhookVerificationError("Invalid webhook payload structure", 400);
        }
        const payload = parsed;
        const rawEventName = typeof payload.event?.name === "string" ? payload.event.name : "";
        const type = normalizeWebhookEventType(rawEventName);
        const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
            ? payload.data
            : null;
        const reference = typeof data?.reference === "string" ? data.reference : undefined;
        const eventId = typeof payload.event?.id === "string"
            ? payload.event.id
            : typeof payload.object?.id === "string"
                ? payload.object.id
                : "";
        const timestamp = typeof payload.event?.timestamp === "string" ? payload.event.timestamp : "";
        return {
            id: eventId,
            type,
            rawEventName,
            status: webhookStatusForEvent(type),
            reference,
            timestamp,
            data,
            raw: payload,
        };
    }
}
//# sourceMappingURL=monime.js.map