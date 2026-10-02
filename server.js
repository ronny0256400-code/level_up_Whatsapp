"use strict";
const express = require("express"),
  OpenAI = require("openai"),
  { google } = require("googleapis");
const { createSalesFlow, phone, command } = require("./lib/sales-flow");
const { createSalesStore } = require("./lib/sales-store");
const { createSalesCatalog } = require("./lib/sales-catalog");
const { createAgencies } = require("./lib/v2-agencies");
const { deliveryMalls } = require("./lib/sales-malls");
const { discover } = require("./lib/sales-resources");
const { safeError } = require("./lib/v2-errors");
const { createInterpreter } = require("./lib/sales-interpreter");
const { createIngress, verifyMeta } = require("./lib/v2-ingress");
const { createInboxStore, memorySheets } = require("./lib/v2-storage");
const { createYCloud } = require("./lib/ycloud-client");
const { createModels } = require("./lib/v2-models");
const path = require("node:path"),
  fs = require("node:fs");
function createApp({
  env = process.env,
  sheets,
  openai,
  fetchImpl = globalThis.fetch,
  interpret,
  store: injectedStore,
  resources: injectedResources,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const testMode = env.TEST_MODE === "true";
  if (!sheets) {
    if (testMode) sheets = memorySheets();
    else {
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      sheets = google.sheets({ version: "v4", auth });
    }
  }
  if (!openai && !testMode && env.OPENAI_API_KEY)
    openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const app = express(),
    store =
      injectedStore || createSalesStore(sheets, env.MEMORIA_SPREADSHEET_ID),
    ycloud = createYCloud({ env, fetchImpl });
  const catalog = createSalesCatalog(sheets, env.STOCK_SPREADSHEET_ID, {
    log: (diagnostic) => console.warn("Catalog diagnostic", diagnostic),
  });
  const resourceRoot = env.RESOURCES_ROOT || path.join(__dirname, "resources");
  const agencies = createAgencies(
    env.AGENCIES_ROOT ||
      (fs.existsSync(path.join(resourceRoot, "Ecuador"))
        ? path.join(resourceRoot, "Ecuador")
        : path.join(resourceRoot, "agencias/Ecuador")),
  );
  const resources = injectedResources || discover(resourceRoot);
  const models = createModels({ client: openai, env, log: () => {} });
  let flow;
  const allowed = async (number) =>
    (await flow.load(phone(number))).pauseState === "ACTIVE";
  async function content(number, value, c) {
    if (!(await allowed(number))) return false;
    if (testMode) return { simulated: true };
    if (c.provider === "ycloud")
      return ycloud.send(number, value, { canSend: allowed });
    const res = await fetchImpl(
      `https://graph.facebook.com/v23.0/${env.PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: number,
          ...value,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!res.ok)
      throw Object.assign(Error("TRANSPORT_FAILED"), { status: res.status });
    return res.json();
  }
  async function sendMedia(number, bytes, mime, c) {
    if (!(await allowed(number))) return false;
    if (testMode) return { simulated: true };
    let id;
    if (c.provider === "ycloud") {
      const uploaded = await ycloud.uploadMedia(bytes, {
        mime,
        name: mime === "application/pdf" ? "agencias.pdf" : "media",
        canSend: () => allowed(number),
      });
      id = uploaded.id;
    } else {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append(
        "file",
        new Blob([bytes], { type: mime }),
        mime === "application/pdf" ? "agencias.pdf" : "media",
      );
      const response = await fetchImpl(
        `https://graph.facebook.com/v23.0/${env.PHONE_NUMBER_ID}/media`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
          body: form,
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw Error("UPLOAD_FAILED");
      id = (await response.json()).id;
    }
    const type =
      mime === "application/pdf"
        ? "document"
        : mime.startsWith("image/")
          ? "image"
          : mime.startsWith("video/")
            ? "video"
            : "audio";
    const result = await content(
      number,
      {
        type,
        [type]: {
          id,
          ...(type === "document" ? { filename: "agencias.pdf" } : {}),
        },
      },
      c,
    );
    if (!testMode) await wait(250);
    return result;
  }
  async function indicate(number, messageId, c) {
    if (testMode) return;
    if (c.provider === "ycloud" && messageId) {
      try {
        // typingIndicator also marks the inbound message as read.
        await ycloud.typing(messageId);
      } catch {
        console.warn("YCloud typing unavailable");
        try {
          await ycloud.markRead(messageId);
        } catch {
          console.warn("YCloud read unavailable");
        }
      }
    } else if (messageId) {
      try {
        await fetchImpl(
          `https://graph.facebook.com/v23.0/${env.PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              status: "read",
              message_id: messageId,
              typing_indicator: { type: "text" },
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch {
        console.warn("Read/typing unavailable");
      }
    }
  }
  async function prepare(number, messageId, c) {
    await indicate(number, messageId, c);
    if (!testMode) await wait(5000);
  }
  flow = createSalesFlow({
    store,
    catalog,
    agencies,
    resources,
    interpret: interpret || createInterpreter(openai, env),
    sendText: (n, t, c) => content(n, { type: "text", text: { body: t } }, c),
    sendMedia,
    prepare,
    businessName: env.BUSINESS_NAME,
    malls: deliveryMalls(env),
  });
  async function processMessage(message) {
    const number = phone(message.from);
    if (!number) return;
    if (command(message.text?.body)) {
      if (number === phone(env.ASESOR_WHATSAPP)) {
        await flow.admin(message.text.body);
        const cmd = command(message.text.body);
        if (cmd.action === "borrar" && cmd.phone !== number)
          await ingress.discardPending(cmd.phone);
      }
      return;
    }
    if (number === phone(env.ASESOR_WHATSAPP)) return;
    const c = await flow.load(number);
    if (c.pauseState !== "ACTIVE") return;
    let text = message.text?.body;
    if (message.type === "audio") {
      if (message.provider !== "ycloud") {
        await flow.pause(c, "PAUSED_ESCALATION", "META_AUDIO_REQUIRES_REVIEW");
        return;
      }
      const transcript =
        await require("./lib/ycloud-audio").transcribeYCloudAudio(
          message.audio,
          { env, models, conversation: c, fetchMedia: fetchImpl, testMode },
        );
      if (typeof transcript !== "string") {
        await flow.pause(
          c,
          "PAUSED_ESCALATION",
          "AUDIO_TRANSCRIPTION_UNAVAILABLE",
        );
        return;
      }
      text = transcript;
    }
    if (typeof text !== "string") return;
    try {
      await flow.process(number, text, {
        provider: message.provider,
        messageId: message.inboundId || message.id,
        replyPrepared: message.replyPrepared === true,
      });
    } catch (err) {
      console.warn("Flow processing failed", safeError(err, "flow.process"));
      const latest = await flow.load(number);
      await flow.pause(
        latest,
        "PAUSED_ESCALATION",
        "PROCESSING_OR_DELIVERY_UNCERTAIN",
      );
    }
  }
  const ingress = createIngress({
    store: createInboxStore(sheets, env.MEMORIA_SPREADSHEET_ID),
    admin: env.ASESOR_WHATSAPP,
    ownNumbers: [env.WHATSAPP_BUSINESS_NUMBER, env.YCLOUD_PHONE_NUMBER],
    processMessage,
    beforeWait: async (message) => {
      if (
        command(message.text?.body) ||
        phone(message.from) === phone(env.ASESOR_WHATSAPP)
      )
        return false;
      if (!["text", "audio"].includes(message.type)) return false;
      const c = await flow.load(phone(message.from));
      if (c.pauseState !== "ACTIVE") return false;
      c.provider = message.provider || "ycloud";
      await indicate(phone(message.from), message.inboundId || message.id, c);
      return true;
    },
    log: (diagnostic) =>
      console.warn("Ingress processing diagnostic", diagnostic),
  });
  app.post(
    "/ycloud/webhook",
    require("./lib/ycloud-webhook").createYCloudWebhook({
      getSecret: () => env.YCLOUD_WEBHOOK_SECRET,
      onMessage: async (m) => {
        if (!phone(m.from)) return;
        if (
          (await flow.load(phone(m.from))).pauseState !== "ACTIVE" &&
          !command(m.text?.body)
        )
          return;
        await ingress.accept(m);
      },
    }),
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buffer) => {
        req.rawBody = buffer;
      },
    }),
  );
  app.get("/health", (_req, res) => res.json({ ok: true, version: 3 }));
  app.get("/webhook", (req, res) =>
    env.VERIFY_TOKEN &&
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === env.VERIFY_TOKEN
      ? res.status(200).send(req.query["hub.challenge"])
      : res.sendStatus(403),
  );
  app.post("/webhook", async (req, res) => {
    if (!env.WHATSAPP_APP_SECRET) return res.sendStatus(503);
    if (
      !verifyMeta(
        req.rawBody,
        req.get("X-Hub-Signature-256"),
        env.WHATSAPP_APP_SECRET,
      )
    )
      return res.sendStatus(401);
    try {
      for (const e of req.body.entry || [])
        for (const change of e.changes || [])
          for (const m of change.value?.messages || []) {
            if (!phone(m.from)) continue;
            if (
              (await flow.load(phone(m.from))).pauseState !== "ACTIVE" &&
              !command(m.text?.body)
            )
              continue;
            await ingress.accept({
              ...m,
              provider: "meta",
              ownNumber: change.value.metadata?.display_phone_number,
            });
          }
      return res.sendStatus(200);
    } catch {
      return res.sendStatus(503);
    }
  });
  const purge = async () => {
    for (const number of await flow.purge())
      await ingress.discardPending(number);
  };
  return { app, flow, ingress, processMessage, store, resources, purge };
}
if (require.main === module) {
  try {
    const runtime = createApp();
    runtime.app.listen(process.env.PORT || 3000, () =>
      console.log("Sales bot ready"),
    );
    const recover = () =>
      runtime.ingress
        .recover()
        .catch((err) =>
          console.warn(
            "Inbox recovery failed",
            safeError(err, "ingress.recover"),
          ),
        );
    const purge = () =>
      runtime.purge().catch(() => console.warn("Memory purge failed"));
    purge().then(recover);
    setInterval(recover, 5000).unref();
    setInterval(purge, 3600000).unref();
  } catch {
    console.error("Bot configuration invalid");
    process.exitCode = 1;
  }
}
module.exports = { createApp };
