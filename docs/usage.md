# Usage Guide

## 1. Install

### Node.js / TypeScript

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git
```

### Supabase Edge Functions

1. Create `supabase/functions/package.json`:
   ```json
   {
     "name": "edge-functions",
     "private": true,
     "type": "module",
     "dependencies": {
       "@supabase/supabase-js": "^2.0.0",
       "openai": "^4.52.5",
       "payment-gateway": "git+https://github.com/osmanbah441/payment-gateway.git"
     }
   }
   ```
2. Install packages:
   ```bash
   cd supabase/functions
   npm install
   ```
3. Configure `supabase/functions/deno.json` as the workspace root:
   ```json
   {
     "nodeModulesDir": "manual",
     "workspace": ["./payment-handler", "./payment-webhook-ingest"],
     "imports": {
       "@supabase/functions-js": "jsr:@supabase/functions-js@^2"
     }
   }
   ```
   *(In your Edge Function code, import `"@supabase/supabase-js"` directly instead of `"npm:@supabase/supabase-js@2"` so Supabase Edge Runtime resolves it from `node_modules`.)*

> **Private GitHub access:** Make sure your local Git credentials or CI `GITHUB_TOKEN` have read access to `osmanbah441/payment-gateway`.

---

## 2. Initialize Once

Create one shared file (e.g., `supabase/functions/_shared/payment-gateway.ts`):

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

## 3. Examples

### Charge (`charge`)
```ts
const result = await paymentGateway.charge({
  amount: 125.5, // Major units (NLe / SLE)
  currency: "SLE",
  reference: orderId,
  description: "Checkout Payment",
  duration: "10m",
});
// result.ussdCode, result.expireTime, result.amount, result.status
```

### Payout (`payout`)
```ts
const result = await paymentGateway.payout({
  amount: 492.5,
  currency: "SLE",
  reference: withdrawalId,
  recipientPhone: "+23276123456",
  provider: "orange_money", // "orange_money" | "afrimoney"
});
```

### Verify (`verify`)
```ts
const chargeState = await paymentGateway.verify("pc_01abc...", "charge");
const payoutState = await paymentGateway.verify("po_01xyz...", "payout");
```

### Webhook (`parseWebhook`)
```ts
import { WebhookVerificationError, type WebhookEvent } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

Deno.serve(async (req) => {
  let event: WebhookEvent;
  try {
    event = await paymentGateway.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response(err.message, { status: err.status });
    }
    return new Response("Internal Server Error", { status: 500 });
  }

  if (event.type === "charge.completed" && event.reference) {
    // Mark order as paid
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
```

---

## 4. Errors

- `PaymentGatewayError`: Missing config keys, `4xx` responses, `5xx` after retries, or timeouts (`status`, `body`).
- `WebhookVerificationError`: Bad header, signature, or timestamp (`status: 401`).

---

## 5. Update the Package

In the folder with your `package.json` (e.g., `supabase/functions/`):

```bash
npm update payment-gateway
```

Then type-check your Edge Functions and commit the updated `package-lock.json`:

```bash
deno check --config supabase/functions/payment-handler/deno.json supabase/functions/payment-handler/index.ts
deno check --config supabase/functions/payment-webhook-ingest/deno.json supabase/functions/payment-webhook-ingest/index.ts
```
