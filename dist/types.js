export class PaymentGatewayError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = "PaymentGatewayError";
    }
}
export class WebhookVerificationError extends Error {
    status;
    constructor(message, status = 401) {
        super(message);
        this.status = status;
        this.name = "WebhookVerificationError";
    }
}
//# sourceMappingURL=types.js.map