# Contributing & Adapter Guide

This guide explains the repository structure, architectural boundaries, how to add new payment provider adapters, and how to release updates to consuming projects.

---

## Repository Structure

```text
payment-gateway/
├── src/
│   ├── index.ts            # Restricted public barrel (PaymentGateway, errors, public types)
│   ├── gateway.ts          # Abstract PaymentGateway class + static provider factories
│   ├── types.ts            # Provider-agnostic domain types & error classes
│   ├── utils.ts            # Internal shared HTTP, retry, validation, currency & crypto helpers
│   └── adapters/
│       └── monime.ts       # MonimeAdapter + MonimeConfig
├── dist/                   # Compiled ESM JS, .d.ts declarations, and source maps (committed)
├── docs/
│   ├── usage.md
│   ├── monime.md
│   └── contributing.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## Architectural Rules

1. **Keep `src/types.ts` 100% provider-agnostic**: Never reference Monime or any other vendor name inside `src/types.ts`. All request, result, and webhook shapes must represent generic payment domain concepts.
2. **Keep the public API minimal in `src/index.ts`**:
   - Export only `PaymentGateway`, public domain types, error classes (`PaymentGatewayError`, `WebhookVerificationError`), and provider config types (e.g., `MonimeConfig`).
   - Do **not** export `src/utils.ts` or concrete `*Adapter` classes from `src/index.ts`.
3. **Avoid runtime circular imports**: Adapters import `import type { PaymentGateway } from "../gateway.js"` (type-only), while `src/gateway.ts` imports concrete adapters for its static factory methods.
4. **Use `.js` relative import specifiers in `src/`**: TypeScript (`moduleResolution: "NodeNext"`) requires `.js` extensions on relative imports in `src/` so compiled `./dist/*.js` and `./dist/*.d.ts` resolve cleanly in both Node.js and Deno.

---

## Reusing Internal Utilities (`src/utils.ts`)

When implementing a new adapter in `src/adapters/<provider>.ts`, reuse the helpers in `src/utils.ts` instead of duplicating retry, crypto, or validation logic:

| Helper | Purpose |
| :--- | :--- |
| `fetchWithRetry(url, init, options)` | Per-attempt `15s` timeout, exponential backoff retries on `5xx` and network/timeout errors, automatic `-r<attempt>` idempotency suffixing after `5xx`, immediate throw on `4xx`, and custom `createError` factory. |
| `validateRequiredConfig(vars, options)` | Validates config/secret fields at call time and throws a descriptive error if missing. |
| `MonetaryConverter.toMinor` / `.toMajor` | Converts between major decimals (`8.55`) and minor integer units (`855`). |
| `computeHmacBase64` / `computeHmacHex` | Computes SHA-256 HMAC digests using Web Crypto (`crypto.subtle`)—portable across Node 20+, Deno, and Edge Runtime. |
| `safeCompare(a, b)` | Constant-time string comparison (normalizes optional trailing `=` Base64 padding). |
| `verifyTimestamp(ts, maxAge, maxFuture)` | Replay-attack protection for webhook Unix timestamps. |
| `parseSignatureHeader(header)` | Parses `t=<timestamp>,v1=<signature>` style signature headers. |

---

## Adding a New Provider Adapter

1. **Create `src/adapters/<provider>.ts`**:
   - Define and export `<Provider>Config`.
   - Implement `<Provider>Adapter implements PaymentGateway` (`charge`, `payout`, `verify`, `parseWebhook`).
   - Keep provider-specific wire types, endpoints, status enums, and error subclasses private (unexported) inside the adapter file; map errors to `PaymentGatewayError` (or a subclass) and webhook auth failures to `WebhookVerificationError`.

   ```ts
   import type { PaymentGateway } from "../gateway.js";
   import {
     type ChargeRequest,
     PaymentGatewayError,
     type PayoutRequest,
     type TransactionResult,
     type WebhookEvent,
     WebhookVerificationError,
   } from "../types.js";
   import {
     computeHmacHex,
     fetchWithRetry,
     MonetaryConverter,
     safeCompare,
     validateRequiredConfig,
   } from "../utils.js";

   export interface ExampleProviderConfig {
     apiKey?: string;
     webhookSecret?: string;
   }

   export class ExampleProviderAdapter implements PaymentGateway {
     constructor(private readonly config: ExampleProviderConfig) {}

     async charge(request: ChargeRequest): Promise<TransactionResult> {
       validateRequiredConfig([
         { key: "EXAMPLE_API_KEY", value: this.config.apiKey },
       ]);
       // Call upstream using fetchWithRetry(...) and MonetaryConverter.toMinor(...)
       throw new PaymentGatewayError("Not implemented");
     }

     async payout(request: PayoutRequest): Promise<TransactionResult> {
       throw new PaymentGatewayError("Not implemented");
     }

     async verify(
       transactionId: string,
       type: "charge" | "payout" = "charge",
     ): Promise<TransactionResult> {
       throw new PaymentGatewayError("Not implemented");
     }

     async parseWebhook(req: Request): Promise<WebhookEvent> {
       // Verify HMAC and return normalized WebhookEvent, or throw WebhookVerificationError
       throw new WebhookVerificationError("Not implemented");
     }
   }
   ```

2. **Expose a static factory on `PaymentGateway` in `src/gateway.ts`**:
   ```ts
   import {
     ExampleProviderAdapter,
     type ExampleProviderConfig,
   } from "./adapters/example.js";

   export abstract class PaymentGateway {
     // ...
     static example(config: ExampleProviderConfig): PaymentGateway {
       return new ExampleProviderAdapter(config);
     }
   }
   ```

3. **Export the config type from `src/index.ts`**:
   ```ts
   export type { ExampleProviderConfig } from "./adapters/example.js";
   ```

4. **Document the new provider**:
   - Add `docs/<provider>.md` detailing environment variables, currency/phone behavior, and webhook headers.
   - Link it from `README.md`.

---

## Building, Testing & Releasing Updates

Before committing changes to `payment-gateway`:

1. **Build and type-check**:
   ```bash
   npm run build
   npm run typecheck
   ```
2. **Verify compiled `./dist/` is included in your commit**:
   Because consumers install directly from GitHub (`git+https://github.com/osmanbah441/payment-gateway.git`), `dist/` is tracked in Git so Deno and Node consumers receive prebuilt `.js` and `.d.ts` artifacts immediately.
3. **Commit, optionally tag, and push**:
   ```bash
   git add -A
   git commit -m "feat: describe your change"
   git tag v0.2.0   # optional version tag
   git push origin main --tags
   ```
4. **Update downstream consumers** (e.g., `supabase/functions/`):
   ```bash
   npm update payment-gateway
   ```
   Then run `deno check` on the consumer's Edge Functions and commit the updated `package-lock.json`.
