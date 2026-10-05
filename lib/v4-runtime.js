"use strict";
const path = require("node:path");
const { createFlow } = require("./v4-flow");
const { createInterpreter } = require("./v4-interpreter");
const { createSalesCatalog } = require("./sales-catalog");
const { discover } = require("./sales-resources");
const { createYCloud } = require("./ycloud-client");
const { safeError } = require("./v2-errors");
const { phone, command } = require("./sales-flow");
const { createModels } = require("./v2-models");
const { transcribeYCloudAudio } = require("./ycloud-audio");
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
  flowFactory = createFlow,
  transcribeAudio,
}) {
  const transport = ycloud || createYCloud({ env, fetchImpl });
  const transcriptionEnv = {
    ...env,
    MODEL_TRANSCRIPTION:
      env.MODEL_TRANSCRIPTION || "gpt-4o-mini-transcribe",
  };
  const transcriptionModels =
    openai && !transcribeAudio
      ? createModels({ client: openai, env: transcriptionEnv, log })
      : null;
  const flow = flowFactory({
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
        !["text", "audio"].includes(message.type)
      )
        return "ignored";
      if (
        [env.YCLOUD_PHONE_NUMBER, env.WHATSAPP_BUSINESS_NUMBER].some(
          (n) => phone(n) === number,
        )
      )
        return "ignored";

      const body = message.type === "text" ? message.text?.body : "";
      const adminCommand = command(body);
      if (adminCommand && number === phone(env.ASESOR_WHATSAPP)) {
        await flow.reset(adminCommand.phone, adminCommand.action === "liberar");
        return "admin_processed";
      }
      if (
        command(body) ||
        number === phone(env.ASESOR_WHATSAPP) ||
        /^\s*\//.test(body || "")
      )
        return "ignored";

      const key = `${number}:${message.id}`;
      if (ids.has(key)) return "duplicate";
      if (ids.size >= 1000) ids.delete(ids.keys().next().value);
      ids.set(key, true);

      let text = body;
      if (message.type === "audio") {
        log({ event: "V5_AUDIO_RECEIVED" });
        try {
          const transcript = transcribeAudio
            ? await transcribeAudio(message.audio, {
                number,
                messageId: message.inboundId || message.id,
              })
            : await transcribeYCloudAudio(message.audio, {
                env: transcriptionEnv,
                models: transcriptionModels,
                conversation: await flow.load(number),
                fetchMedia: fetchImpl || globalThis.fetch,
                testMode: env.TEST_MODE === "true",
                log: (event) => log({ ...event, source: "v5.audio" }),
              });
          if (typeof transcript === "string" && transcript.trim()) {
            text = transcript.trim();
            log({ event: "V5_AUDIO_TRANSCRIBED", length: text.length });
          } else {
            throw Error("V5_AUDIO_TRANSCRIPTION_EMPTY");
          }
        } catch (error) {
          log({
            event: "V5_AUDIO_TRANSCRIPTION_FAILED",
            ...safeError(error, "v5.audio"),
          });
          try {
            const id = message.inboundId || message.id;
            if (id) {
              await transport.markRead(id).catch(() => {});
              await transport.typing(id).catch(() => {});
            }
            await wait(5000);
            await transport.sendText(
              number,
              "Disculpe 😊 no alcancé a escuchar bien el audio. ¿Me lo podría enviar nuevamente?",
              {
                canSend: async () => true,
                testMode: env.TEST_MODE === "true",
              },
            );
          } catch (sendError) {
            log({
              event: "V5_AUDIO_FALLBACK_SEND_FAILED",
              ...safeError(sendError, "v5.audio.fallback"),
            });
          }
          return "audio_failed";
        }
      }

      await flow.process(number, text, {
        messageId: message.inboundId || message.id,
      });
      if (message.type === "audio") log({ event: "V5_AUDIO_ROUTED" });
      return "processed";
    },
  };
}
module.exports = { createRuntime };
