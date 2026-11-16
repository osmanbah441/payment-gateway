#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Load .env files from common locations without overwriting existing env vars
for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "supabase/.env"),
  path.resolve(process.cwd(), "supabase/functions/.env"),
]) {
  if (!fs.existsSync(candidate)) continue;
  for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

const PORT = Number(process.env.MOCK_PORT ?? 54999);
const HOST = process.env.MOCK_HOST ?? "0.0.0.0";
const WEBHOOK_TARGET_URL =
  process.env.WEBHOOK_TARGET_URL ??
  "http://127.0.0.1:54321/functions/v1/payment-webhook-ingest";
const WEBHOOK_SECRET = process.env.MONIME_PAYMENT_COMPLETED_WEBHOOK ?? "";
const CUSTOM_HEADER_NAME =
  process.env.CUSTOM_WEBHOOK_HEADER ?? "salone-bazaar-monime-webhook";
const CUSTOM_HEADER_SECRET =
  process.env.SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK ?? "";
const AUTO_WEBHOOK_DELAY_MS = Number(
  process.env.AUTO_WEBHOOK_DELAY_MS ?? 2000,
);

const charges = new Map();
const payouts = new Map();

function randomId(prefix) {
  return `${prefix}_local_${crypto.randomBytes(6).toString("hex")}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function sendSignedWebhook({
  eventName,
  objectId,
  objectType,
  data,
}) {
  if (!WEBHOOK_SECRET || !CUSTOM_HEADER_SECRET) {
    console.warn(
      "[mock] Skipping webhook dispatch: MONIME_PAYMENT_COMPLETED_WEBHOOK or SALONE_BAZAAR_PAYMENT_COMPLETED_WEBHOOK is not set.",
    );
    return { skipped: true };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = {
    apiVersion: "v1",
    event: {
      id: randomId("evt"),
      name: eventName,
      timestamp: new Date().toISOString(),
    },
    object: {
      id: objectId ?? randomId("obj"),
      type: objectType ?? "payment_code",
    },
    data,
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}_${rawBody}`)
    .digest("base64");

  const response = await fetch(WEBHOOK_TARGET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "monime-signature": `t=${timestamp},v1=${signature}`,
      [CUSTOM_HEADER_NAME]: CUSTOM_HEADER_SECRET,
    },
    body: rawBody,
  });

  const text = await response.text();
  console.log(
    `[mock] Webhook ${eventName} (ref=${data?.reference ?? "none"}) -> ${response.status} ${text}`,
  );
  return { status: response.status, body: text };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        webhookTargetUrl: WEBHOOK_TARGET_URL,
        autoWebhookDelayMs: AUTO_WEBHOOK_DELAY_MS,
      });
    }

    if (req.method === "POST" && pathname === "/v1/payment-codes") {
      const body = await readJsonBody(req);
      const id = randomId("pc");
      const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const record = {
        id,
        status: "pending",
        name: body.name ?? "Checkout Payment",
        amount: body.amount ?? { currency: "SLE", value: 0 },
        expireTime,
        ussdCode: "*715*1234#",
        reference: body.reference,
      };
      charges.set(id, record);
      console.log(
        `[mock] Created charge ${id} ref=${record.reference} amount=${record.amount.value} ${record.amount.currency}`,
      );

      if (AUTO_WEBHOOK_DELAY_MS > 0) {
        setTimeout(() => {
          record.status = "completed";
          sendSignedWebhook({
            eventName: "payment_code.completed",
            objectId: id,
            objectType: "payment_code",
            data: {
              id,
              reference: record.reference,
              amount: record.amount,
              status: "completed",
            },
          }).catch((err) => console.error("[mock] Webhook error:", err));
        }, AUTO_WEBHOOK_DELAY_MS);
      }

      return sendJson(res, 200, { success: true, messages: [], result: record });
    }

    if (req.method === "GET" && pathname.startsWith("/v1/payment-codes/")) {
      const id = pathname.split("/").pop();
      const record = charges.get(id);
      if (!record) {
        return sendJson(res, 404, {
          success: false,
          messages: ["Payment code not found"],
          result: null,
        });
      }
      return sendJson(res, 200, { success: true, messages: [], result: record });
    }

    if (req.method === "POST" && pathname === "/v1/payouts") {
      const body = await readJsonBody(req);
      const id = randomId("po");
      const record = {
        id,
        status: "completed",
        amount: body.amount ?? { currency: "SLE", value: 0 },
        source: body.source ?? { financialAccountId: "fac_local" },
        destination: body.destination ?? {
          type: "momo",
          providerId: "m17",
          phoneNumber: "+23276000000",
        },
        reference: body.reference ?? req.headers["idempotency-key"],
      };
      payouts.set(id, record);
      console.log(
        `[mock] Created payout ${id} ref=${record.reference} amount=${record.amount.value} ${record.amount.currency}`,
      );

      if (AUTO_WEBHOOK_DELAY_MS > 0) {
        setTimeout(() => {
          sendSignedWebhook({
            eventName: "payout.completed",
            objectId: id,
            objectType: "payout",
            data: {
              id,
              reference: record.reference,
              amount: record.amount,
              status: "completed",
            },
          }).catch((err) => console.error("[mock] Webhook error:", err));
        }, AUTO_WEBHOOK_DELAY_MS);
      }

      return sendJson(res, 200, { success: true, messages: [], result: record });
    }

    if (req.method === "GET" && pathname.startsWith("/v1/payouts/")) {
      const id = pathname.split("/").pop();
      const record = payouts.get(id);
      if (!record) {
        return sendJson(res, 404, {
          success: false,
          messages: ["Payout not found"],
          result: null,
        });
      }
      return sendJson(res, 200, { success: true, messages: [], result: record });
    }

    if (req.method === "POST" && pathname === "/_simulate/webhook") {
      const body = await readJsonBody(req);
      if (!body.reference) {
        return sendJson(res, 400, { error: "reference is required" });
      }
      const result = await sendSignedWebhook({
        eventName: body.eventName ?? "payment_code.completed",
        objectId: body.objectId,
        objectType: body.objectType ?? "payment_code",
        data: {
          ...(typeof body.data === "object" && body.data ? body.data : {}),
          reference: body.reference,
        },
      });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, {
      success: false,
      messages: [`Unknown route: ${req.method} ${pathname}`],
      result: null,
    });
  } catch (err) {
    console.error("[mock] Request error:", err);
    return sendJson(res, 500, {
      success: false,
      messages: [err instanceof Error ? err.message : "Internal error"],
      result: null,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mock] Local Monime simulator listening on http://${HOST}:${PORT}/v1`);
  console.log(`[mock] Webhook target: ${WEBHOOK_TARGET_URL}`);
  console.log(`[mock] Auto-webhook delay: ${AUTO_WEBHOOK_DELAY_MS}ms`);
});
