# payment-gateway

Simple, provider-agnostic TypeScript payment gateway for mobile money charges, payouts, transaction checks, and webhooks.

## Install

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git
```

Or pin a tag:

```bash
npm install git+https://github.com/osmanbah441/payment-gateway.git#v0.1.0
```

## Update

```bash
npm update payment-gateway
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

- [Usage Guide](./docs/usage.md) — Setup for Node & Supabase Edge Functions, examples, and updating.
- [Monime Guide](./docs/monime.md) — Monime config, currency/provider mapping, and webhooks.
- [Contributing](./docs/contributing.md) — Adding a new provider adapter and releasing updates.
