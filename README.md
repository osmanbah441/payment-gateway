# payment-gateway

A standalone, provider-agnostic TypeScript payment gateway package for mobile money charges, vendor payouts, transaction verification, and authenticated webhook parsing. Designed for **Supabase Edge Functions (Deno)** and **Node.js / TypeScript** projects via standard package installation from GitHub.

---

## Key Design Principles

- **Single Public Entrypoint**: Consumers interact exclusively with `PaymentGateway`, domain request/result types, `PaymentGatewayError`, and `WebhookVerificationError`. Provider adapters and HTTP/crypto helpers stay encapsulated.
- **Zero Provider Coupling in Handlers**: Application and Edge Function code depends only on the `PaymentGateway` interface—swapping providers requires changing only a single constructor call in your shared initialization file.
- **Prebuilt ESM + Type Declarations**: Ships compiled `./dist/index.js` and `./dist/index.d.ts` alongside `"prepare": "tsc"`, supporting both standard TypeScript/Node and Deno (`"nodeModulesDir": "manual"`).

---

## Documentation

| Guide | Description |
| :--- | :--- |
| [Usage Guide](./docs/usage.md) | Installation (GitHub), Supabase Edge Functions & Node.js setup, `charge`/`payout`/`verify`/`parseWebhook` examples, error handling, and **updating the package after upstream changes**. |
| [Monime Provider Guide](./docs/monime.md) | Dedicated documentation for `PaymentGateway.monime(...)`: configuration, environment variables, `NLe`/`SLE` currency conversion, `+232` MoMo provider mapping, retry/idempotency rules, and webhook verification. |
| [Contributing & Adapter Guide](./docs/contributing.md) | Repository architecture, strict API boundary rules, creating a new provider adapter with internal `src/utils.ts` helpers, building `dist/`, and releasing updates. |

---

## Quick Start

### 1. Install from Private GitHub

Add `payment-gateway` to your project's `package.json`:

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git
```

Or pin a specific commit / release tag:

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git#v0.1.0
```

For **Supabase Edge Functions**, place `package.json` in `supabase/functions/` and set `"nodeModulesDir": "manual"` in each function's `deno.json` (see [Usage Guide](./docs/usage.md#supabase-edge-functions-setup)).

### 2. Initialize Once

```ts
import { PaymentGateway } from "payment-gateway";

export const paymentGateway: PaymentGateway = PaymentGateway.monime({
  apiKey: Deno.env.get("PAYMENT_API_KEY"),
  spaceId: Deno.env.get("MONIME_SPACE_ID"),
  escrowAccountId: Deno.env.get("ESCROW_ACCOUNT"),
  commissionAccountId: Deno.env.get("COMMISSION_ACCOUNT_ID"),
  webhookSecret: Deno.env.get("MONIME_PAYMENT_COMPLETED_WEBHOOK"),
  customWebhookHeaderSecret: Deno.env.get(
    "SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK",
  ),
});
```

### 3. Call Provider-Agnostic Methods

```ts
// Customer USSD charge (amount in major units, e.g. NLe)
const charge = await paymentGateway.charge({
  amount: 150.0,
  currency: "SLE",
  reference: orderId,
  description: "Checkout Payment",
});

// Vendor mobile money payout
const payout = await paymentGateway.payout({
  amount: 492.5,
  currency: "SLE",
  reference: withdrawalId,
  recipientPhone: "+23276123456",
  provider: "orange_money",
});

// Authenticated webhook parsing
const event = await paymentGateway.parseWebhook(req);
```

---

## Updating Consumer Projects When This Package Changes

Whenever a change is pushed to `osmanbah441/payment-gateway`:

1. Pull the latest commit in your consuming project (e.g., inside `supabase/functions/`):
   ```bash
   npm update payment-gateway
   ```
   *(Or re-run `npm install git+https://github.com/osmanbah441/payment-gateway.git` if pinned to a new branch/tag.)*
2. Verify Edge Function types:
   ```bash
   deno check --config supabase/functions/payment-handler/deno.json supabase/functions/payment-handler/index.ts
   ```
3. Commit the updated `package-lock.json` (and `package.json` if a tag changed) in your consuming repository.

See [Updating the Package](./docs/usage.md#updating-the-package) for version pinning and rollback details.
