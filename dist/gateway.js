import { MonimeAdapter } from "./monime/monime.js";
/**
 * Provider-agnostic payment gateway contract and static factory constructors.
 */
export class PaymentGateway {
    /**
     * Creates a {@link PaymentGateway} backed by the Monime REST API and webhook verifier.
     */
    static monime(config) {
        return new MonimeAdapter(config);
    }
}
//# sourceMappingURL=gateway.js.map