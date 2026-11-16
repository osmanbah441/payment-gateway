import { type WebhookEvent } from "../types.js";
export declare const DEFAULT_CUSTOM_WEBHOOK_HEADER = "salone-bazaar-monime-webhook";
export declare function parseMonimeWebhook(req: Request, options: {
    webhookSecret?: string;
    customWebhookHeaderSecret?: string;
    customWebhookHeaderName: string;
}): Promise<WebhookEvent>;
//# sourceMappingURL=webhook.d.ts.map