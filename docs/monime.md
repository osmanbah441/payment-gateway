# Monime Provider Guide

This document describes the Monime implementation created via `PaymentGateway.monime(config)`, including configuration, currency and phone formatting, retry behavior, webhook security, and Edge Function integration.

---

## Overview

The Monime adapter integrates with the Monime REST API (`https://api.monime.io/v1` by default) to support:
- **Customer USSD Payment Codes** (`POST /payment-codes`) via `charge()`
- **Mobile Money Payouts** (`POST /payouts`) via `payout()`
- **Transaction Lookups** (`GET /payment-codes/:id` and `GET /payouts/:id`) via `verify()`
- **Authenticated Webhook Ingestion** via `parseWebhook()`

---

## Configuration (`MonimeConfig`)

```ts
import { PaymentGateway, type MonimeConfig } from "payment-gateway";

const config: MonimeConfig = {
  apiKey: Deno.env.get("PAYMENT_API_KEY"),
  spaceId: Deno.env.get("MONIME_SPACE_ID"),
  escrowAccountId: Deno.env.get("ESCROW_ACCOUNT"),
  commissionAccountId: Deno.env.get("COMMISSION_ACCOUNT_ID"),
  webhookSecret: Deno.env.get("MONIME_PAYMENT_COMPLETED_WEBHOOK"),
  customWebhookHeaderSecret: Deno.env.get(
    "SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK",
  ),
  // Optional overrides:
  // customWebhookHeaderName: "salone-bazaar-monime-webhook",
  // baseUrl: "https://api.monime.io/v1",
};

export const paymentGateway: PaymentGateway = PaymentGateway.monime(config);
```

### Environment Variables & Lazy Validation

Secrets are validated **at call time** according to the method invoked, allowing payment initiation functions and webhook ingestion functions to run with least-privilege secrets:

| Operation | Required `MonimeConfig` Fields | Typical Env Variables |
| :--- | :--- | :--- |
| `charge()`, `payout()` | `apiKey`, `spaceId`, `escrowAccountId`, `commissionAccountId` | `PAYMENT_API_KEY`, `MONIME_SPACE_ID`, `ESCROW_ACCOUNT`, `COMMISSION_ACCOUNT_ID` |
| `verify()` | `apiKey`, `spaceId` | `PAYMENT_API_KEY`, `MONIME_SPACE_ID` |
| `parseWebhook()` | `webhookSecret`, `customWebhookHeaderSecret` | `MONIME_PAYMENT_COMPLETED_WEBHOOK`, `SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK` |

If any required field is missing when an operation runs, a `PaymentGatewayError` is thrown listing the missing keys.

---

## Currency & Unit Conversion

- **Outbound Requests**: Amounts provided to `charge()` and `payout()` in major units (`NLe` / `SLE`) are converted to integer minor units (`Math.round(amount * 100)`). Both `"NLe"` and `"NLE"` normalize to `"SLE"` in Monime request payloads.
- **Inbound Responses**: Minor integer values from Monime are divided by `100` back into major decimal units, and `"SLE"` is normalized to `"NLe"` in `TransactionResult.currency`.

---

## Sierra Leone Mobile Money Providers & Phone Numbers

- **Supported Phone Format**: Sierra Leone numbers matching `^(\+?232|0)?[2-9]\d{7}$` (for example `+23276123456`).
- **Provider Mapping in `payout()`**:

| `PayoutRequest.provider` | Sent Monime `providerId` | Network |
| :--- | :--- | :--- |
| `"orange_money"` or `"m17"` | `"m17"` | Orange Money |
| `"afrimoney"` or `"m18"` | `"m18"` | Afri-money |
| Any other string | Passed through unchanged | Custom / future provider code |

---

## HTTP Client, Retries & Idempotency

Every Monime REST request automatically applies:
- **Headers**:
  - `Authorization: Bearer <apiKey>`
  - `Content-Type: application/json`
  - `Monime-Space-Id: <spaceId>`
  - `Idempotency-Key: <idempotencyKey>` (for `charge()` and `payout()`, defaulting to `request.reference`)
- **Timeouts**: `15000ms` per attempt via `AbortSignal.timeout(15000)`.
- **Retries**: Up to `3` total attempts with exponential backoff (`500ms` after attempt 1, `1000ms` after attempt 2) for:
  - HTTP `5xx` responses (on subsequent retry attempts after a `5xx`, the `Idempotency-Key` header is automatically suffixed with `-r<attempt>`, e.g. `<key>-r2`)
  - Network/timeout errors
- **Non-Retryable `4xx` Errors**: Immediately throws `PaymentGatewayError` with HTTP `status` and parsed response `body` without retrying.

---

## Webhook Verification & Event Normalization

`parseWebhook(req)` enforces five verification layers before returning a normalized `WebhookEvent`:

1. **Custom Shared Secret Header**: Timing-safe comparison of header `customWebhookHeaderName` (default `salone-bazaar-monime-webhook`) against `customWebhookHeaderSecret`.
2. **Signature Presence**: Requires `monime-signature` header.
3. **Signature Format**: Parses `t=<unix_seconds>,v1=<base64_hmac>`.
4. **Replay Protection**: Rejects timestamps older than `300` seconds or more than `60` seconds in the future.
5. **HMAC-SHA256 Check**: Computes Base64 HMAC-SHA256 over `${timestamp}_${rawBody}` using `webhookSecret` and compares in constant time (stripping trailing `=` padding).

Failure at any verification step throws `WebhookVerificationError` with `status: 401`.

### Event Mapping

| Raw Monime `event.name` | Normalized `event.type` | Normalized `event.status` |
| :--- | :--- | :--- |
| `"payment_code.completed"` | `"charge.completed"` | `"paid"` |
| `"payout.completed"` | `"payout.completed"` | `"completed"` |
| `"checkout_session.completed"` | `"checkout.completed"` | `"completed"` |
| Anything else | `"unknown"` | `"unknown"` |

`event.reference` is extracted automatically from `payload.data.reference` when present.

---

## End-to-End Edge Function Example (`payment-handler`)

```ts
import { PaymentGatewayError } from "payment-gateway";
import { paymentGateway } from "../_shared/payment-gateway.ts";

export async function handleCheckout(orderId: string, grandTotal: number) {
  try {
    const result = await paymentGateway.charge({
      amount: grandTotal,
      currency: "SLE",
      reference: orderId,
      idempotencyKey: orderId,
      description: "Checkout Payment",
      duration: "10m",
    });

    return {
      amount: result.amount,
      currency: result.currency,
      expireTime: result.expireTime,
      ussdCode: result.ussdCode,
    };
  } catch (err) {
    if (err instanceof PaymentGatewayError) {
      // Roll back pending DB order and return 500
    }
    throw err;
  }
}
```
