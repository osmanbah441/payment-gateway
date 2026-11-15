import { PaymentGatewayError, WebhookVerificationError, } from "../types.js";
import { computeHmacBase64, DEFAULT_MAX_RETRIES, DEFAULT_REQUEST_TIMEOUT_MS, fetchWithRetry, MonetaryConverter, parseSignatureHeader, safeCompare, validateRequiredConfig, verifyTimestamp, } from "../utils.js";
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
    const options = {
        method,
        headers,
        body,
    };
    const response = await fetchWithRetry(url, options, {
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
        parsedBody = {
            success: false,
            messages: ["Malformed response body"],
            result: null,
        };
    }
    if (!response.ok) {
        throw new MonimeApiError(`Monime API Error [${response.status}]`, response.status, parsedBody);
    }
    return parsedBody;
}
function validateRequired(requiredVars) {
    validateRequiredConfig(requiredVars, {
        prefix: "Missing required Monime personal access tokens",
        createError: (message) => new MonimeApiError(message),
    });
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
function normalizeCurrency(currency) {
    if (!currency || currency === "SLE") {
        return "NLe";
    }
    return currency;
}
function normalizeStatus(status) {
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
    validateWalletSecrets() {
        validateRequired([
            { key: "PAYMENT_API_KEY", value: this.config.apiKey },
            { key: "MONIME_SPACE_ID", value: this.config.spaceId },
            { key: "ESCROW_ACCOUNT", value: this.config.escrowAccountId },
            { key: "COMMISSION_ACCOUNT_ID", value: this.config.commissionAccountId },
        ]);
        return {
            paymentApiKey: this.config.apiKey,
            spaceId: this.config.spaceId,
            escrowAccountId: this.config.escrowAccountId,
            commissionAccountId: this.config.commissionAccountId,
        };
    }
    validateApiCredentials() {
        validateRequired([
            { key: "PAYMENT_API_KEY", value: this.config.apiKey },
            { key: "MONIME_SPACE_ID", value: this.config.spaceId },
        ]);
        return {
            paymentApiKey: this.config.apiKey,
            spaceId: this.config.spaceId,
        };
    }
    validateWebhookSecrets() {
        validateRequired([
            {
                key: "MONIME_PAYMENT_COMPLETED_WEBHOOK",
                value: this.config.webhookSecret,
            },
            {
                key: "SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK",
                value: this.config.customWebhookHeaderSecret,
            },
        ]);
        return {
            monimeWebhookSecret: this.config.webhookSecret,
            customWebhookHeaderSecret: this.config.customWebhookHeaderSecret,
        };
    }
    async charge(request) {
        const tokens = this.validateWalletSecrets();
        const requestCurrency = !request.currency || request.currency === "NLe" || request.currency === "NLE"
            ? "SLE"
            : request.currency;
        const payload = {
            name: request.description ?? "Checkout Payment",
            amount: {
                currency: requestCurrency,
                value: MonetaryConverter.toMinor(request.amount),
            },
            duration: request.duration ?? "10m",
            financialAccountId: request.destinationAccountId ?? tokens.escrowAccountId,
            reference: request.reference,
        };
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: "/payment-codes",
            personalAccessToken: tokens.paymentApiKey,
            spaceId: tokens.spaceId,
            idempotencyKey: request.idempotencyKey ?? request.reference,
            method: "POST",
            data: payload,
        });
        return {
            id: res.result.id,
            status: normalizeStatus(res.result.status),
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency),
            reference: res.result.reference ?? request.reference,
            expireTime: res.result.expireTime,
            ussdCode: res.result.ussdCode,
            raw: res,
        };
    }
    async payout(request) {
        const tokens = this.validateWalletSecrets();
        const requestCurrency = !request.currency || request.currency === "NLe" || request.currency === "NLE"
            ? "SLE"
            : request.currency;
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: "/payouts",
            personalAccessToken: tokens.paymentApiKey,
            spaceId: tokens.spaceId,
            method: "POST",
            idempotencyKey: request.idempotencyKey ?? request.reference,
            data: {
                amount: {
                    currency: requestCurrency,
                    value: MonetaryConverter.toMinor(request.amount),
                },
                source: {
                    financialAccountId: request.sourceAccountId ?? tokens.escrowAccountId,
                },
                destination: {
                    type: "momo",
                    providerId: normalizeProviderId(request.provider),
                    phoneNumber: request.recipientPhone,
                },
            },
        });
        return {
            id: res.result.id,
            status: res.result.status ? normalizeStatus(res.result.status) : "completed",
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency),
            reference: res.result.reference ?? request.reference,
            raw: res,
        };
    }
    async verify(transactionId, type = "charge") {
        const tokens = this.validateApiCredentials();
        if (type === "payout") {
            const res = await monimeClient({
                baseUrl: this.baseUrl,
                path: `/payouts/${transactionId}`,
                personalAccessToken: tokens.paymentApiKey,
                spaceId: tokens.spaceId,
                method: "GET",
            });
            return {
                id: res.result.id,
                status: normalizeStatus(res.result.status),
                amount: MonetaryConverter.toMajor(res.result.amount.value),
                currency: normalizeCurrency(res.result.amount.currency),
                reference: res.result.reference,
                raw: res,
            };
        }
        const res = await monimeClient({
            baseUrl: this.baseUrl,
            path: `/payment-codes/${transactionId}`,
            personalAccessToken: tokens.paymentApiKey,
            spaceId: tokens.spaceId,
            method: "GET",
        });
        return {
            id: res.result.id,
            status: normalizeStatus(res.result.status),
            amount: MonetaryConverter.toMajor(res.result.amount.value),
            currency: normalizeCurrency(res.result.amount.currency),
            reference: res.result.reference,
            expireTime: res.result.expireTime,
            ussdCode: res.result.ussdCode,
            raw: res,
        };
    }
    async parseWebhook(req) {
        const secrets = this.validateWebhookSecrets();
        // 1. Initial Authorization Header Check
        const headerSecret = req.headers.get(this.customWebhookHeaderName);
        if (!headerSecret ||
            !safeCompare(headerSecret, secrets.customWebhookHeaderSecret)) {
            throw new WebhookVerificationError("Unauthorized header", 401);
        }
        // 2. Signature Presence Check
        const signatureHeader = req.headers.get("monime-signature");
        if (!signatureHeader) {
            throw new WebhookVerificationError("Missing signature header", 401);
        }
        // 3. Signature Parsing
        let parsedSignature;
        try {
            parsedSignature = parseSignatureHeader(signatureHeader);
        }
        catch {
            throw new WebhookVerificationError("Invalid signature format", 401);
        }
        const { timestamp, signature } = parsedSignature;
        // 4. Replay Protection (Timestamp Check)
        if (!verifyTimestamp(timestamp)) {
            throw new WebhookVerificationError("Timestamp out of tolerance", 401);
        }
        // 5. Signature Verification
        const rawBody = await req.text();
        const signedPayload = `${timestamp}_${rawBody}`;
        const expectedSignature = await computeHmacBase64(secrets.monimeWebhookSecret, signedPayload);
        if (!safeCompare(signature, expectedSignature)) {
            throw new WebhookVerificationError("Invalid signature", 401);
        }
        // 6. JSON Parsing & Normalization
        const payload = JSON.parse(rawBody);
        const rawEventName = payload?.event?.name ?? "";
        const type = normalizeWebhookEventType(rawEventName);
        const data = payload?.data && typeof payload.data === "object"
            ? payload.data
            : null;
        const reference = typeof data?.reference === "string" ? data.reference : undefined;
        return {
            id: payload?.event?.id ?? payload?.object?.id ?? "",
            type,
            rawEventName,
            status: webhookStatusForEvent(type),
            reference,
            timestamp: payload?.event?.timestamp ?? "",
            data,
            raw: payload,
        };
    }
}
//# sourceMappingURL=monime.js.map