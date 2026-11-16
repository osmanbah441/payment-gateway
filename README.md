# payment-gateway

Simple, provider-agnostic TypeScript payment gateway for mobile money charges,
payouts, transaction checks, and webhooks.

## Install

Configure `.npmrc` for GitHub Packages:

```ini
@osmanbah441:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Then install via npm or map in Supabase `deno.json`:

```bash
npm install @osmanbah441/payment-gateway
```

```json
{
  "imports": {
    "payment-gateway": "npm:@osmanbah441/payment-gateway@^0.1.0"
  }
}
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
