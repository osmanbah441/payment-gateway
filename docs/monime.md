# Monime Provider Guide

Use `PaymentGateway.monime(config)` to connect to the Monime REST API (`https://api.monime.io/v1`).

## Configuration

| Field | Required For | Env Variable |
| :--- | :--- | :--- |
| `apiKey` | `charge`, `payout`, `verify` | `PAYMENT_API_KEY` |
| `spaceId` | `charge`, `payout`, `verify` | `MONIME_SPACE_ID` |
| `escrowAccountId` | `charge`, `payout` | `ESCROW_ACCOUNT` |
| `commissionAccountId` | `charge`, `payout` | `COMMISSION_ACCOUNT_ID` |
| `webhookSecret` | `parseWebhook` | `MONIME_PAYMENT_COMPLETED_WEBHOOK` |
| `customWebhookHeaderSecret` | `parseWebhook` | `SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK` |
| `customWebhookHeaderName` | Optional (default `salone-bazaar-monime-webhook`) | — |
| `baseUrl` | Optional (default `https://api.monime.io/v1`) | — |

Secrets are validated lazily per method call and throw `PaymentGatewayError` if missing.

## Currency & Providers

- **Currency**: Pass major units (`125.5`). Outbound `"NLe"` / `"NLE"` converts to `"SLE"` minor units (`12550`); inbound `"SLE"` converts back to `"NLe"` major units (`125.5`).
- **Providers**: `"orange_money"` maps to `"m17"` and `"afrimoney"` maps to `"m18"`. Other strings pass through unchanged.

## Retries & Timeouts

- `15s` timeout per request, up to `3` attempts with exponential backoff (`500ms`, `1000ms`) on `5xx` or network errors.
- Retries after `5xx` append `-r<attempt>` to `Idempotency-Key`. `4xx` errors fail immediately.

## Webhooks

`parseWebhook(req)` checks:
1. Custom shared secret header
2. `monime-signature` (`t=<unix>,v1=<base64_hmac>`)
3. Replay window (`300s` max age, `60s` max future skew)
4. HMAC-SHA256 over `${timestamp}_${rawBody}`

Event mapping:
- `payment_code.completed` -> `charge.completed` (`paid`)
- `payout.completed` -> `payout.completed` (`completed`)
- `checkout_session.completed` -> `checkout.completed` (`completed`)
