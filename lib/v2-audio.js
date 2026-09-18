'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
async function durationSeconds(buffer, file) {
  // WhatsApp voice notes are normally Ogg/Opus. Parse page boundaries, not byte matches in payload.
  if (buffer.subarray(0, 4).toString() === 'OggS') {
    let offset = 0, last = 0n, opus = false, preSkip = 0, serial = null;
    while (offset < buffer.length) {
      if (offset + 27 > buffer.length || buffer.toString('ascii', offset, offset + 4) !== 'OggS') return null;
      const streams = buffer.readUInt32LE(offset + 14);
      if (serial !== null && streams !== serial) return null;
      serial = streams;
      const segments = buffer[offset + 26];
      if (offset + 27 + segments > buffer.length) return null;
      const size = buffer.subarray(offset + 27, offset + 27 + segments).reduce((a,b) => a+b,0);
      const start = offset + 27 + segments, end = start + size;
      if (end > buffer.length) return null;
      if (buffer.toString('ascii',start,start+8) === 'OpusHead' && size >= 19) { opus = true; preSkip = buffer.readUInt16LE(start + 10); }
      const granule = buffer.readBigUInt64LE(offset + 6);
      if (granule !== 0xffffffffffffffffn) last = granule;
      offset = end;
    }
    if (opus && last > BigInt(preSkip)) return Number(last - BigInt(preSkip)) / 48000;
  }
  try {
    const { stdout } = await exec('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file], { timeout: 5000, maxBuffer: 1024 });
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}
module.exports = { durationSeconds };
