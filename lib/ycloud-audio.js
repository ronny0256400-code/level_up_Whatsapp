'use strict';
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { durationSeconds } = require('./v2-audio');
const { inStage, safeError } = require('./v2-errors');
const LIMIT = 16 * 1024 * 1024;
const TYPES = new Map([['audio/ogg','.ogg'],['application/ogg','.ogg'],['audio/opus','.ogg'],['audio/mpeg','.mp3'],['audio/mp3','.mp3'],['audio/mp4','.mp4'],['audio/x-m4a','.m4a'],['audio/wav','.wav'],['audio/x-wav','.wav'],['audio/webm','.webm'],['audio/flac','.flac']]);
function mediaURL(link) {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'api.ycloud.com' || url.port || url.username || url.password || url.hash || !/^\/v2\/whatsapp\/media\/download\/\d+$/.test(url.pathname)) throw new Error('Audio media URL rejected');
  return url.href;
}
async function transcribeYCloudAudio(audio, { env, models, conversation, fetchMedia = fetch, testMode = false, log = () => {} }) {
  if (testMode) return { unsupported: true };
  if (Number(audio?.duration ?? audio?.duration_seconds) > 180) return { tooLong: true };
  if (!env.MODEL_TRANSCRIPTION?.trim() || !env.YCLOUD_API_KEY) return { unsupported: true };
  let directory, stream;
  try {
    const downloaded = await inStage('audio.download', async () => {
      const url = mediaURL(audio?.link);
      const response = await fetchMedia(url, { headers: { 'X-API-Key': env.YCLOUD_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Object.assign(new Error('Audio download failed'), { status: response.status });
      try {
        if (Number(response.headers.get('content-length')) > LIMIT) throw new Error('Audio size limit');
        const headerType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const mime = (!headerType || headerType === 'application/octet-stream')
          ? String(audio?.mime_type || '').split(';')[0].trim().toLowerCase() : headerType;
        const extension = TYPES.get(mime);
        if (!extension) throw new Error('Audio type unsupported');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > LIMIT) throw new Error('Audio size limit');
          chunks.push(Buffer.from(chunk));
        }
        if (!size) throw new Error('Audio empty');
        return { buffer: Buffer.concat(chunks), extension };
      } finally { if (response.body && !response.body.locked) await response.body.cancel?.().catch(() => {}); }
    });
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ycloud-audio-'));
    const file = path.join(directory, `audio${downloaded.extension}`);
    await fs.promises.writeFile(file, downloaded.buffer, { flag: 'wx', mode: 0o600 });
    const seconds = await inStage('audio.duration', () => durationSeconds(downloaded.buffer, file));
    if (!Number.isFinite(seconds) || seconds <= 0) return { unsupported: true };
    if (seconds > 180) return { tooLong: true };
    stream = fs.createReadStream(file);
    await once(stream, 'open');
    const result = await models.transcribe({ file: stream, language: 'es' }, seconds, conversation, { timeout: 60000, maxRetries: 0 });
    return typeof result?.text === 'string' && result.text.trim() ? result.text.trim() : null;
  } catch (error) {
    log({ event: 'audio_failed', ...safeError(error, 'audio.transcription') });
    return null;
  } finally {
    stream?.destroy();
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => log({ event: 'audio_cleanup_failed' }));
  }
}
module.exports = { transcribeYCloudAudio, mediaURL };
