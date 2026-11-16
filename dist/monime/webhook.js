import { WebhookVerificationError, } from "../types.js";
import { validateRequiredKeys, verifyHmacWebhook } from "../utils.js";
import { MonimeEventName } from "./types.js";
export const DEFAULT_CUSTOM_WEBHOOK_HEADER = "salone-bazaar-monime-webhook";
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
export async function parseMonimeWebhook(req, options) {
    const secrets = validateRequiredKeys({
        MONIME_PAYMENT_COMPLETED_WEBHOOK: options.webhookSecret,
        SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK: options.customWebhookHeaderSecret,
    }, "Missing required Monime personal access tokens");
    const { rawBody } = await verifyHmacWebhook(req, {
        signatureHeaderName: "monime-signature",
        webhookSecret: secrets.MONIME_PAYMENT_COMPLETED_WEBHOOK,
        customHeaderName: options.customWebhookHeaderName,
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
//# sourceMappingURL=webhook.js.map