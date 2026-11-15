# payment-gateway

A standalone, provider-agnostic TypeScript payment gateway package for mobile money charges, vendor payouts, transaction verification, and authenticated webhook parsing. Designed to run in both **Deno / Supabase Edge Functions** (importing TypeScript directly from `./src/index.ts`) and **Node.js / TypeScript** (importing compiled ESM + declarations from `./dist/index.js`).

---

## Features & Public API Surface

Consumers only depend on the minimal `PaymentGateway` interface, its factory constructors, domain types, and error classes—provider internals and retry/crypto utilities remain encapsulated inside the package.

### Runtime Exports
- `PaymentGateway`: Factory object exposing provider constructors (currently `PaymentGateway.monime(config)`), typed via declaration merging to the `PaymentGateway` interface.
- `PaymentGatewayError`: Thrown on upstream API failures, timeouts, exhausted retries, or missing configuration (`status?: number`, `body?: unknown`).
- `WebhookVerificationError`: Thrown when webhook authentication, signature parsing, timestamp tolerance, or HMAC verification fails (`status: number`, default `401`).

### Type Exports
- `PaymentGateway`: Interface defining `charge`, `payout`, `verify`, and `parseWebhook`.
- `MonimeConfig`: Configuration object accepted by `PaymentGateway.monime(config)`.
- `ChargeRequest`, `PayoutRequest`, `TransactionResult`, `WebhookEvent`, `WebhookEventType`, `PaymentStatus`, `MobileMoneyProvider`, `CurrencyCode`.

---

## Installation

This package is hosted as a private GitHub repository (`osmanbah441/payment-gateway`).

### 1. Node.js / TypeScript

Install directly from the private GitHub repository over HTTPS or SSH (ensure your Git credentials or SSH keys have access to `osmanbah441/payment-gateway`). The `"prepare": "tsc"` script builds `./dist` automatically on install:

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git
```

Or via SSH:

```bash
npm install git+ssh://git@github.com/osmanbah441/payment-gateway.git
```

### 2. Deno / Supabase Edge Functions

#### Option A: Sibling Checkout (Recommended for local development & Supabase Edge Function deploys)
Clone `payment-gateway` alongside your project (`../payment-gateway`) and map `"payment-gateway"` in your Edge Function's `deno.json`:

```json
{
  "imports": {
    "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
    "payment-gateway": "../../../../payment-gateway/src/index.ts"
  }
}
```

#### Option B: Private GitHub Raw URL (with `DENO_AUTH_TOKENS`)
If referencing the private GitHub repository directly over HTTPS:

```json
{
  "imports": {
    "payment-gateway": "https://raw.githubusercontent.com/osmanbah441/payment-gateway/main/src/index.ts"
  }
}
```

Set `DENO_AUTH_TOKENS` in your environment so Deno can authenticate against private `raw.githubusercontent.com` URLs:

```bash
export DENO_AUTH_TOKENS="<github_pat>@raw.githubusercontent.com"
```

---

## Quick Start: Shared Initialization

Create a single initialization module (for example `supabase/functions/_shared/payment-gateway.ts`) and export the instance typed strictly as `PaymentGateway`:

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

### Required Environment Variables (Monime Adapter)

| Variable | Used By | Description |
| :--- | :--- | :--- |
| `PAYMENT_API_KEY` | `charge`, `payout`, `verify` | Monime personal access token (`Bearer` auth) |
| `MONIME_SPACE_ID` | `charge`, `payout`, `verify` | Monime Space ID (`Monime-Space-Id` header) |
| `ESCROW_ACCOUNT` | `charge`, `payout` | Default financial account ID for escrow funds |
| `COMMISSION_ACCOUNT_ID` | `charge`, `payout` | Platform commission financial account ID |
| `MONIME_PAYMENT_COMPLETED_WEBHOOK` | `parseWebhook` | HMAC-SHA256 signing secret for `monime-signature` |
| `SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK` | `parseWebhook` | Shared secret for the custom webhook verification header |

> Wallet secrets are validated lazily during `charge`/`payout`, API credentials during `verify`, and webhook secrets during `parseWebhook`, so Edge Functions that only initiate payments or only ingest webhooks do not require the other function's secrets.

---

## Usage Examples

### 1. Initiate a Customer USSD Charge (`charge`)

Amounts are passed in **major units** (`NLe` / `SLE`); the adapter automatically converts to minor units (`Math.round(amount * 100)`) for the provider API and normalizes responses back to major units with `"NLe"`.

```ts
import { PaymentGatewayError } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

try {
  const result = await paymentGateway.charge({
    amount: 250.5, // major units (NLe)
    currency: "SLE",
    reference: orderId, // stored as reference & default Idempotency-Key
    description: "Checkout Payment",
    duration: "10m",
    customerPhone: "+23276123456",
  });

  // Return USSD instructions to the client
  return {
    amount: result.amount, // 250.5
    currency: result.currency, // "NLe"
    expireTime: result.expireTime,
    ussdCode: result.ussdCode,
  };
} catch (err) {
  if (err instanceof PaymentGatewayError) {
    console.error("Gateway error:", err.status, err.body);
  }
  throw err;
}
```

### 2. Send a Mobile Money Vendor Payout (`payout`)

Supports `"orange_money"` (`"m17"`), `"afrimoney"` (`"m18"`), or raw provider IDs (`"m17"`, `"m18"`), with Sierra Leone `+232` phone numbers.

```ts
import { paymentGateway } from "../_shared/payment-gateway.ts";

const result = await paymentGateway.payout({
  amount: 492.5, // net payout in major units (NLe)
  currency: "SLE",
  reference: withdrawalId,
  idempotencyKey: withdrawalId,
  recipientPhone: "+23276123456",
  provider: "orange_money", // or "afrimoney", "m17", "m18"
});

console.log("Payout ID:", result.id, "Status:", result.status);
```

### 3. Verify a Transaction (`verify`)

Fetch and normalize the latest state of a charge (`"charge"`, default) or payout (`"payout"`):

```ts
import { paymentGateway } from "../_shared/payment-gateway.ts";

const chargeStatus = await paymentGateway.verify("pc_01abc...", "charge");
const payoutStatus = await paymentGateway.verify("po_01xyz...", "payout");

console.log(chargeStatus.status, chargeStatus.amount, chargeStatus.currency);
```

### 4. Verify & Handle Webhooks (`parseWebhook`)

`parseWebhook(req)` performs custom header verification, signature parsing (`t=...,v1=...`), replay tolerance (`maxAge = 300s`, `maxFuture = 60s`), HMAC-SHA256 verification, and event normalization:

```ts
import { WebhookVerificationError, type WebhookEvent } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

Deno.serve(async (req) => {
  let event: WebhookEvent;
  try {
    event = await paymentGateway.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response(JSON.stringify({ success: false, message: err.message }), {
        status: err.status, // 401
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Internal Server Error", { status: 500 });
  }

  switch (event.type) {
    case "charge.completed":
      if (!event.reference) {
        return new Response("Missing reference", { status: 400 });
      }
      // Mark order as paid using event.reference
      console.log("Order paid:", event.reference);
      break;

    case "payout.completed":
      console.log("Payout settled:", event.id);
      break;

    case "checkout.completed":
      console.log("Checkout session completed:", event.id);
      break;

    default:
      console.log("Ignored webhook event:", event.rawEventName);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
```

---

## Guide: Adding a New Payment Provider Adapter

Because Edge Functions import only `PaymentGateway` from `_shared/payment-gateway.ts`, adding or swapping a provider requires zero changes to your handlers:

1. **Create the adapter** at `src/adapters/<provider>.ts` implementing `PaymentGateway` (`charge`, `payout`, `verify`, `parseWebhook`):
   ```ts
   import type { PaymentGateway } from "../gateway.ts";
   import type { ChargeRequest, PayoutRequest, TransactionResult, WebhookEvent } from "../types.ts";
   import {
     computeHmacHex,
     fetchWithRetry,
     MonetaryConverter,
     safeCompare,
     validateRequiredConfig,
     verifyTimestamp,
   } from "../utils.ts";

   export interface MyProviderConfig {
     apiKey?: string;
     webhookSecret?: string;
   }

   export class MyProviderAdapter implements PaymentGateway {
     constructor(private readonly config: MyProviderConfig) {}

     public async charge(request: ChargeRequest): Promise<TransactionResult> {
       validateRequiredConfig([{ key: "MY_PROVIDER_API_KEY", value: this.config.apiKey }]);
       // Use fetchWithRetry(...) and MonetaryConverter.toMinor(request.amount)
       throw new Error("Implement charge");
     }

     public async payout(request: PayoutRequest): Promise<TransactionResult> {
       throw new Error("Implement payout");
     }

     public async verify(transactionId: string, type?: "charge" | "payout"): Promise<TransactionResult> {
       throw new Error("Implement verify");
     }

     public async parseWebhook(req: Request): Promise<WebhookEvent> {
       // Use computeHmacBase64 / computeHmacHex, safeCompare, verifyTimestamp
       throw new Error("Implement parseWebhook");
     }
   }
   ```
2. **Reuse internal helpers from `src/utils.ts`**:
   - `fetchWithRetry(url, options, retryOptions)` — timeout, exponential backoff on `5xx`/network errors, idempotency key support, and custom `createError`.
   - `validateRequiredConfig(vars, options)` — throws consistent missing-secret errors.
   - `MonetaryConverter.toMinor` / `MonetaryConverter.toMajor` — major/minor currency conversion.
   - `computeHmacBase64`, `computeHmacHex`, `safeCompare`, `verifyTimestamp`, `parseSignatureHeader` — Web Crypto webhook verification.
3. **Register a factory constructor** on `PaymentGateway` in `src/gateway.ts` (and export `type MyProviderConfig` from `src/index.ts`):
   ```ts
   export const PaymentGateway = {
     monime(config: MonimeConfig): PaymentGateway {
       return new MonimeAdapter(config);
     },
     myProvider(config: MyProviderConfig): PaymentGateway {
       return new MyProviderAdapter(config);
     },
   } as const;
   ```
4. **Build and swap in one line** inside your consumer's `_shared/payment-gateway.ts`:
   ```ts
   export const paymentGateway: PaymentGateway = PaymentGateway.myProvider({
     apiKey: Deno.env.get("MY_PROVIDER_API_KEY"),
     webhookSecret: Deno.env.get("MY_PROVIDER_WEBHOOK_SECRET"),
   });
   ```

---

## Development Scripts

```bash
npm install      # Install TypeScript & trigger prepare build
npm run build    # Compile ESM & .d.ts declarations into ./dist
npm run typecheck
```
