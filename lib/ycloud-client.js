"use strict";
function createYCloud({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  async function request(endpoint, body, headers = {}) {
    if (!env.YCLOUD_API_KEY || !env.YCLOUD_PHONE_NUMBER)
      throw Error("YCloud no configurado");
    const res = await fetchImpl(
      `https://api.ycloud.com/v2/whatsapp/${endpoint}`,
      {
        method: "POST",
        headers: { "X-API-Key": env.YCLOUD_API_KEY, ...headers },
        body,
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!res.ok)
      throw Object.assign(Error(`YCloud HTTP ${res.status}`), {
        status: res.status,
      });
    return res.json();
  }
  async function send(to, content, { canSend, testMode = false } = {}) {
    if (!canSend || !(await canSend(to))) return false;
    if (testMode) return { simulated: true };
    return request(
      "messages",
      JSON.stringify({ from: env.YCLOUD_PHONE_NUMBER, to, ...content }),
      { "Content-Type": "application/json" },
    );
  }
  async function uploadMedia(
    bytes,
    { mime, name = "media", testMode = false, canSend } = {},
  ) {
    if (!canSend || !(await canSend())) return false;
    const limit = mime?.startsWith("image/") ? 5 : 16;
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > limit * 1024 * 1024
    )
      throw Error("MEDIA_SIZE_INVALID");
    if (
      ![
        "image/jpeg",
        "image/png",
        "video/mp4",
        "audio/ogg",
        "audio/mpeg",
      ].includes(mime)
    )
      throw Error("MEDIA_TYPE_INVALID");
    if (testMode) return { id: "simulated-media" };
    const key = require("node:crypto")
        .createHash("sha256")
        .update(bytes)
        .update(mime)
        .digest("hex"),
      prior = cache.get(key);
    if (prior && prior.until > now()) return { id: prior.id };
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    const result = await request(
      `media/${encodeURIComponent(env.YCLOUD_PHONE_NUMBER)}/upload`,
      form,
    );
    if (!result.id) throw Error("MEDIA_ID_MISSING");
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { id: result.id, until: now() + 25 * 86400000 });
    return result;
  }
  return {
    send,
    uploadMedia,
    sendText: (to, text, opts) =>
      send(to, { type: "text", text: { body: text } }, opts),
    sendImage: (to, id, opts) =>
      send(to, { type: "image", image: { id } }, opts),
    sendVideo: (to, id, opts) =>
      send(to, { type: "video", video: { id } }, opts),
    sendAudio: (to, id, opts) =>
      send(to, { type: "audio", audio: { id } }, opts),
  };
}
const client = createYCloud();
module.exports = {
  createYCloud,
  ...client,
  enviarMensajeYCloud: client.sendText,
};
