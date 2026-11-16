# Contributing & Adding Adapters

## Structure

- `src/index.ts` — Public exports (`PaymentGateway`, errors, types, config types).
- `src/gateway.ts` — Abstract `PaymentGateway` class and static factory methods.
- `src/types.ts` — Provider-agnostic types (no vendor names or vendor codes).
- `src/utils.ts` — Shared helpers for all adapters (`fetchWithRetry`, `validateRequiredKeys`, `normalizeCurrency`, `normalizePaymentStatus`, `MonetaryConverter`, `verifyHmacWebhook`, `safeCompare`).
- `src/adapters/<provider>.ts` — Provider implementations.
- `dist/` — Prebuilt JS and `.d.ts` files (tracked in Git for GitHub installs).

## Adding a New Adapter

1. Create `src/adapters/<provider>.ts` implementing `PaymentGateway` using the shared helpers from `../utils.js`. Keep provider-specific codes and payloads inside the adapter.
2. Add a static factory on `PaymentGateway` in `src/gateway.ts`:
   ```ts
   static stripe(config: StripeConfig): PaymentGateway {
     return new StripeAdapter(config);
   }
   ```
3. Export `<Provider>Config` from `src/index.ts` (do not export `*Adapter` or `utils.ts`).
4. Add `docs/<provider>.md` and link it in `README.md`.

## Build & Release

```bash
npm run build
npm run typecheck
git add -A
git commit -m "feat: describe change"
git push origin main
```

In consuming projects, run `npm update payment-gateway` and commit the updated `package-lock.json`.
