# Usage Guide

This guide covers installing, configuring, calling, and updating `payment-gateway` in **Supabase Edge Functions (Deno)** and **Node.js / TypeScript** projects without local filesystem imports.

---

## Table of Contents

1. [Public API Surface](#public-api-surface)
2. [Installation](#installation)
   - [Supabase Edge Functions Setup](#supabase-edge-functions-setup)
   - [Node.js / TypeScript Setup](#nodejs--typescript-setup)
   - [Private GitHub Authentication](#private-github-authentication)
3. [Initializing the Gateway](#initializing-the-gateway)
4. [Operations & Examples](#operations--examples)
   - [Customer Charge (`charge`)](#customer-charge-charge)
   - [Vendor Payout (`payout`)](#vendor-payout-payout)
   - [Transaction Verification (`verify`)](#transaction-verification-verify)
   - [Webhook Verification & Parsing (`parseWebhook`)](#webhook-verification--parsing-parsewebhook)
5. [Error Handling](#error-handling)
6. [Updating the Package](#updating-the-package)

---

## Public API Surface

### Runtime Exports
- `PaymentGateway` — Abstract base class and static provider factory namespace (e.g., `PaymentGateway.monime(config)`).
- `PaymentGatewayError` — Error thrown for configuration errors, `4xx`/`5xx` upstream responses, timeouts, or exhausted retries (`status?: number`, `body?: unknown`).
- `WebhookVerificationError` — Error thrown when webhook authentication headers, signatures, or timestamps fail validation (`status: number`, default `401`).

### Type Exports
- `MonimeConfig` (provider-specific config; see [Monime Guide](./monime.md))
- `ChargeRequest`, `PayoutRequest`, `TransactionResult`, `WebhookEvent`, `WebhookEventType`, `PaymentStatus`, `MobileMoneyProvider`, `CurrencyCode`

---

## Installation

Install `payment-gateway` directly from the private GitHub repository (`osmanbah441/payment-gateway`).

### Supabase Edge Functions Setup

Deno resolves npm-installed GitHub packages cleanly via `"nodeModulesDir": "manual"`:

1. **Add `supabase/functions/package.json`**:
   ```json
   {
     "name": "edge-functions",
     "private": true,
     "type": "module",
     "dependencies": {
       "@supabase/supabase-js": "^2.0.0",
       "payment-gateway": "git+https://github.com/osmanbah441/payment-gateway.git"
     }
   }
   ```

2. **Install dependencies inside `supabase/functions/`**:
   ```bash
   cd supabase/functions
   npm install
   ```

3. **Configure each function's `deno.json`** (for example `supabase/functions/payment-handler/deno.json` and `supabase/functions/payment-webhook-ingest/deno.json`):
   ```json
   {
     "nodeModulesDir": "manual",
     "imports": {
       "@supabase/functions-js": "jsr:@supabase/functions-js@^2"
     }
   }
   ```

4. **Type-check Edge Functions**:
   ```bash
   deno check --config supabase/functions/payment-handler/deno.json supabase/functions/payment-handler/index.ts
   deno check --config supabase/functions/payment-webhook-ingest/deno.json supabase/functions/payment-webhook-ingest/index.ts
   ```

### Node.js / TypeScript Setup

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git
```

Ensure your `tsconfig.json` uses ESM-compatible module resolution (`"moduleResolution": "NodeNext"` or `"Bundler"`).

### Private GitHub Authentication

Because `osmanbah441/payment-gateway` is a private repository:
- **Local machines**: Ensure your Git credential helper or SSH key has read access to `osmanbah441/payment-gateway` (`git+https://...` or `git+ssh://git@github.com/osmanbah441/payment-gateway.git`).
- **CI / Automated builds**: Configure a GitHub PAT with `repo` read access via `git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"` or SSH deploy key before running `npm ci` / `npm install`.

---

## Initializing the Gateway

Create a single shared file (for example `supabase/functions/_shared/payment-gateway.ts`) so Edge Functions only depend on the abstract `PaymentGateway` type:

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

---

## Operations & Examples

### Customer Charge (`charge`)

Use `charge()` to initiate a customer checkout payment (for example generating a USSD payment code). Pass amounts in **major currency units** (`NLe` / `SLE`); minor-unit conversion is handled internally by the adapter.

```ts
import { PaymentGatewayError } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

const result = await paymentGateway.charge({
  amount: 125.5,
  currency: "SLE",
  reference: orderId,
  idempotencyKey: orderId,
  description: "Checkout Payment",
  duration: "10m",
  customerPhone: "+23276123456",
});

console.log({
  id: result.id,
  status: result.status,
  amount: result.amount, // 125.5
  currency: result.currency, // "NLe"
  ussdCode: result.ussdCode,
  expireTime: result.expireTime,
});
```

### Vendor Payout (`payout`)

Use `payout()` to disburse funds to a vendor's mobile money wallet:

```ts
import { paymentGateway } from "../_shared/payment-gateway.ts";

const result = await paymentGateway.payout({
  amount: 492.5, // Net payout in major units (NLe)
  currency: "SLE",
  reference: withdrawalId,
  idempotencyKey: withdrawalId,
  recipientPhone: "+23276123456",
  provider: "orange_money", // "orange_money" | "afrimoney" | "m17" | "m18"
});

console.log("Payout reference:", result.id, "Status:", result.status);
```

### Transaction Verification (`verify`)

Query the upstream provider for the latest state of a charge or payout:

```ts
const chargeState = await paymentGateway.verify("pc_01abc...", "charge");
const payoutState = await paymentGateway.verify("po_01xyz...", "payout");
```

### Webhook Verification & Parsing (`parseWebhook`)

Pass the raw HTTP `Request` directly to `parseWebhook(req)`. Signature verification, replay window checks, and payload normalization happen inside the adapter before returning a normalized `WebhookEvent`:

```ts
import { WebhookVerificationError, type WebhookEvent } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

Deno.serve(async (req) => {
  let event: WebhookEvent;
  try {
    event = await paymentGateway.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response(
        JSON.stringify({ success: false, message: err.message }),
        { status: err.status, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("Internal Server Error", { status: 500 });
  }

  switch (event.type) {
    case "charge.completed":
      if (!event.reference) {
        return new Response("Missing reference", { status: 400 });
      }
      // Update order payment_status = "paid" for event.reference
      break;

    case "payout.completed":
      // Reconcile payout completion if tracked asynchronously
      break;

    case "checkout.completed":
      // Handle checkout session completion
      break;

    default:
      // Safely acknowledge unrecognized events
      break;
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
```

---

## Error Handling

| Error Class | When Thrown | Key Properties |
| :--- | :--- | :--- |
| `PaymentGatewayError` | Missing configuration secrets, `4xx` API errors, `5xx` after retries are exhausted, or network/timeout errors (`15s` per attempt). | `message`, `status?: number`, `body?: unknown` |
| `WebhookVerificationError` | Missing/invalid custom webhook header, missing/malformed signature header, expired or future timestamp, or HMAC mismatch. | `message`, `status: number` (default `401`) |

Always catch `WebhookVerificationError` separately in webhook handlers so invalid signatures return HTTP `401` rather than `500`.

---

## Updating the Package

When updates are pushed to `osmanbah441/payment-gateway`:

### 1. Update to the Latest Commit on `main`
From the directory containing your `package.json` (e.g., `supabase/functions/`):

```bash
npm update payment-gateway
```

If `package.json` is pinned to a specific tag or commit hash (recommended for production stability), update the ref and install:

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git#v0.2.0
```

### 2. Verify & Commit the Lockfile
1. Confirm your updated `package-lock.json` points to the new commit hash.
2. Run type checks before deploying:
   ```bash
   deno check --config supabase/functions/payment-handler/deno.json supabase/functions/payment-handler/index.ts
   deno check --config supabase/functions/payment-webhook-ingest/deno.json supabase/functions/payment-webhook-ingest/index.ts
   ```
3. Commit `package.json` and `package-lock.json` in your consuming repository and redeploy your Edge Functions.
