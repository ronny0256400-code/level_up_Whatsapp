"use strict";
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const run = promisify(execFile);
const instructions =
  "Habla en español con acento paisa marcado de Medellín/Antioquia. Voz cálida, rápida pero clara, segura y enérgica; natural, sin caricatura ni gritos.";
async function convert(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lu-tts-"));
  try {
    await fs.chmod(dir, 0o700);
    const input = path.join(dir, "audio.wav"),
      output = path.join(dir, "audio.ogg");
    await fs.writeFile(input, bytes, { mode: 0o600 });
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input,
        "-c:a",
        "libopus",
        "-ac",
        "1",
        "-y",
        output,
      ],
      { timeout: 30000, maxBuffer: 4096 },
    );
    return await fs.readFile(output);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
function createTTS({
  env = process.env,
  openai,
  sendAudio,
  sendText,
  canSend,
  save,
  log = () => {},
  convertAudio = convert,
  testMode = false,
}) {
  const config = {
    enabled: env.OPENAI_TTS_ENABLED !== "false",
    model: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice: env.OPENAI_TTS_VOICE || "cedar",
    speed: Number(env.OPENAI_TTS_SPEED) || 1.15,
    format: env.OPENAI_TTS_FORMAT || "wav",
    delivery: env.OPENAI_TTS_DELIVERY_FORMAT || "opus",
    threshold: Number(env.OPENAI_TTS_MIN_CHARS) || 250,
  };
  return {
    config,
    async deliver(
      number,
      c,
      text,
      { critical = false, force = false, key, permission } = {},
    ) {
      if (!(await canSend(number, c, permission))) return false;
      if (
        critical ||
        !config.enabled ||
        (!force && text.length <= config.threshold)
      )
        return sendText(number, text, c, permission);
      c.tts ||= {};
      if (key && c.tts[key]) return false;
      if (key) {
        c.tts[key] = "reserved";
        await save(number, c);
      }
      if (testMode) {
        if (key) {
          c.tts[key] = "simulated";
          await save(number, c);
        }
        return { simulated: true };
      }
      let bytes;
      try {
        const generate = async (format) => {
          log({
            event: "model_call",
            level: "TTS",
            model: config.model,
            input_characters: text.length,
          });
          c.metrics ||= { calls: 0, by_model: {} };
          c.metrics.calls = (c.metrics.calls || 0) + 1;
          c.metrics.by_model ||= {};
          const metric = (c.metrics.by_model[config.model] ||= { calls: 0 });
          metric.calls++;
          const response = await openai.audio.speech.create({
            model: config.model,
            voice: config.voice,
            speed: config.speed,
            response_format: format,
            input: text,
            instructions,
          });
          return Buffer.from(await response.arrayBuffer());
        };
        bytes = await generate(config.format);
        if (config.delivery === "mp3") {
          if (config.format !== "mp3") bytes = await generate("mp3");
        } else if (config.format === "wav") {
          try {
            bytes = await convertAudio(bytes);
          } catch {
            bytes = await generate("opus");
          }
        } else if (config.format !== "opus") bytes = await generate("opus");
        if (bytes.length > 16 * 1024 * 1024) throw Error("TTS_SIZE");
      } catch {
        log({ event: "tts_fallback", stage: "tts.generate" });
        const result = await sendText(number, text, c, permission);
        if (key) {
          c.tts[key] = "text";
          await save(number, c);
        }
        return result;
      }
      // A transport timeout can hide acceptance. Never append text blindly after uncertain audio delivery.
      try {
        const result = await sendAudio(
          number,
          bytes,
          config.delivery === "mp3" ? "audio/mpeg" : "audio/ogg",
          c,
          permission,
        );
        if (result === false)
          throw Object.assign(Error("MEDIA_BLOCKED"), { blocked: true });
        if (key) {
          c.tts[key] = "sent";
          await save(number, c);
        }
        return result;
      } catch (error) {
        if (
          error.safeToFallback ||
          error.blocked ||
          (Number(error.status) >= 400 &&
            Number(error.status) < 500 &&
            Number(error.status) !== 408)
        ) {
          const result = await sendText(number, text, c, permission);
          if (key) {
            c.tts[key] = "text";
            await save(number, c);
          }
          return result;
        }
        log({ event: "tts_delivery_uncertain" });
        return false;
      }
    },
  };
}
module.exports = { createTTS, convert, instructions };
