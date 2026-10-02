"use strict";
const path = require("node:path");
const { createFlow } = require("./v4-flow");
const { createInterpreter } = require("./v4-interpreter");
const { createSalesCatalog } = require("./sales-catalog");
const { discover } = require("./sales-resources");
const { createYCloud } = require("./ycloud-client");
const { safeError } = require("./v2-errors");
const { phone, command } = require("./sales-flow");
// No HTTP listener, webhook registration, queue recovery or Sheets writes.
function createRuntime({
  env,
  sheets,
  openai,
  interpret,
  resources,
  catalog,
  store,
  ycloud,
  fetchImpl,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  escalate,
  log = () => {},
}) {
  const transport = ycloud || createYCloud({ env, fetchImpl });
  const flow = createFlow({
    catalog:
      catalog || createSalesCatalog(sheets, env.STOCK_SPREADSHEET_ID, { log }),
    resources:
      resources ||
      discover(env.RESOURCES_ROOT || path.join(__dirname, "../resources")),
    interpret: interpret || createInterpreter(openai, env, { log }),
    store,
    escalate,
    log,
    prepare: async (_, id) => {
      if (id) {
        try {
          await transport.markRead(id);
        } catch (error) {
          log(safeError(error, "v4.read"));
        }
        try {
          await transport.typing(id);
        } catch (error) {
          log(safeError(error, "v4.typing"));
        }
      }
      await wait(5000);
    },
    sendText: async (number, text) => {
      const result = await transport.sendText(number, text, {
        canSend: async () => true,
        testMode: env.TEST_MODE === "true",
      });
      if (result === false) throw Error("V4_SEND_BLOCKED");
    },
    sendMedia: async (number, bytes, mime) => {
      const uploaded = await transport.uploadMedia(bytes, {
        mime,
        canSend: async () => true,
        testMode: env.TEST_MODE === "true",
      });
      if (!uploaded?.id) throw Error("V4_UPLOAD_FAILED");
      const method = mime.startsWith("image/")
        ? "sendImage"
        : mime.startsWith("video/")
          ? "sendVideo"
          : "sendAudio";
      if (
        (await transport[method](number, uploaded.id, {
          canSend: async () => true,
          testMode: env.TEST_MODE === "true",
        })) === false
      )
        throw Error("V4_SEND_BLOCKED");
    },
  });
  const ids = new Map();
  return {
    flow,
    async handleMessage(message) {
      const number = phone(message.from);
      if (
        !number ||
        message.from_me ||
        message.fromMe ||
        message.is_echo ||
        !message.id ||
        message.type !== "text"
      )
        return "ignored";
      if (
        [env.YCLOUD_PHONE_NUMBER, env.WHATSAPP_BUSINESS_NUMBER].some(
          (n) => phone(n) === number,
        )
      )
        return "ignored";
      const adminCommand = command(message.text?.body);
      if (adminCommand && number === phone(env.ASESOR_WHATSAPP)) {
        await flow.reset(adminCommand.phone, adminCommand.action === "liberar");
        return "admin_processed";
      }
      if (
        command(message.text?.body) ||
        number === phone(env.ASESOR_WHATSAPP) ||
        /^\s*\//.test(message.text?.body || "")
      )
        return "ignored";
      const key = `${number}:${message.id}`;
      if (ids.has(key)) return "duplicate";
      if (ids.size >= 1000) ids.delete(ids.keys().next().value);
      ids.set(key, true);
      await flow.process(number, message.text?.body, {
        messageId: message.inboundId || message.id,
      });
      return "processed";
    },
  };
}
module.exports = { createRuntime };
