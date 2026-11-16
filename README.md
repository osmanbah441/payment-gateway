# payment-gateway

Simple, provider-agnostic TypeScript payment gateway for mobile money charges,
payouts, transaction checks, and webhooks.

## Install

### 1. Create a GitHub PAT (classic)

GitHub Packages (`npm.pkg.github.com`) requires a **classic** Personal Access Token (fine-grained PATs are not supported for npm):

1. Open GitHub **Settings -> Developer settings -> Personal access tokens -> Tokens (classic)**.
2. Click **Generate new token -> Generate new token (classic)**.
3. Give it a name (e.g., `supabase-edge-functions`) and select:
   - `read:packages` (required to download `@osmanbah441/payment-gateway`)
   - `repo` (required because this repository is private)
4. Click **Generate token** and copy the `ghp_...` value.

### 2. Configure `.npmrc` & `.gitignore`

Create `.npmrc` in your project or Edge Function folder (e.g., `supabase/functions/payment-gateway/.npmrc`):

```ini
@osmanbah441:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

Add `.npmrc` to `.gitignore` so your token is never committed:

```gitignore
.npmrc
```

### 3. Install or Map in `deno.json`

```bash
npm install @osmanbah441/payment-gateway
```

```json
{
  "imports": {
    "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
    "@supabase/server": "npm:@supabase/server@^1",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2",
    "payment-gateway": "npm:@osmanbah441/payment-gateway@^0.1.0"
  }
}
```

Deploy to Supabase production:

```bash
npx supabase functions deploy payment-gateway
```

## Update

```bash
npm update @osmanbah441/payment-gateway
```

## Quick Start

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

// Charge (amount in major units, e.g. NLe)
const charge = await paymentGateway.charge({
  amount: 150,
  currency: "SLE",
  reference: orderId,
});

// Payout
const payout = await paymentGateway.payout({
  amount: 492.5,
  currency: "SLE",
  reference: withdrawalId,
  recipientPhone: "+23276123456",
  provider: "orange_money",
});

// Webhook
const event = await paymentGateway.parseWebhook(req);
```

## Docs

- [Monime Guide](./docs/monime.md) — Monime config, currency/provider mapping,
  and webhooks.
- [Contributing](./docs/contributing.md) — Adding a new provider adapter and
  releasing updates.
