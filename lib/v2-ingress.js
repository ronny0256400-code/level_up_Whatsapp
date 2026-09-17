'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');
const { phone, isAdmin, ADMIN } = require('./v2-policy');
function verifyMeta(raw, signature, secret) {
  if (!secret || !Buffer.isBuffer(raw) || !/^sha256=[a-f0-9]{64}$/i.test(signature || '')) return false;
  const digest = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(digest, Buffer.from(signature.slice(7), 'hex'));
}
// Store contains pending messages and recent IDs, not application/order state.
// Per-number exclusion is separate from the commerce lock, avoiding nested locks.
function createIngress({ store, processMessage, admin, ownNumbers = [], now = Date.now, delay = setTimeout, cancelDelay = clearTimeout, log = () => {} }) {
  const locks = new Map(), scheduled = new Map();
  const exclusive = (key, fn) => {
    const work = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, work);
    return work.finally(() => { if (locks.get(key) === work) locks.delete(key); });
  };
  function schedule(number, due) {
    const existing = scheduled.get(number);
    if (existing && existing.due <= due) return;
    if (existing) cancelDelay(existing.timer);
    const timer = delay(() => {
      scheduled.delete(number);
      flush(number).catch(() => log({ event: 'ingress_retry' }));
    }, Math.max(0, due - now()));
    timer?.unref?.(); scheduled.set(number, { timer, due });
  }
  async function accept(message) {
    const number = phone(message.from);
    if (!number || typeof message.id !== 'string' || !message.id || message.id.length > 256) return 'invalid';
    if (message.from_me === true || message.fromMe === true || message.is_echo === true || ownNumbers.some(n => phone(n) === number) || (message.ownNumber && phone(message.ownNumber) === number)) return 'echo';
    return exclusive(number, async () => {
      const data = await store.get(number) || { ids: {}, rate: [], pending: [] };
      const time = now();
      // Dedup precedes both rate accounting and the five-second buffer.
      if (Object.hasOwn(data.ids, message.id)) return 'duplicate';
      data.ids = Object.fromEntries(Object.entries(data.ids).filter(([, t]) => t > time - 86400000));
      data.rate = data.rate.filter(t => t > time - 60000);
      data.ids = { ...data.ids, [message.id]: time };
      if (data.rate.length >= 20) { await store.set(number, data); return 'rate_limited'; }
      data.rate.push(time);
      const command = message.type === 'text' && ADMIN.test(message.text?.body || '');
      const immediate = command; // Administrative control never waits behind commerce.
      data.pending.push({ message, due: time + (immediate ? 0 : 5000), immediate });
      await store.set(number, data);
      schedule(number, immediate ? time : data.pending[0].due);
      return isAdmin(number, admin) && command ? 'admin_queued' : 'queued';
    });
  }
  async function flush(number) {
    return exclusive(number, async () => {
      const data = await store.get(number);
      if (!data?.pending?.length) return;
      const time = now();
      const commands = data.pending.filter(p => p.immediate && p.due <= time);
      let ready = commands.length ? commands : data.pending.filter(p => !p.immediate && p.due <= time);
      if (!ready.length) { schedule(number, Math.min(...data.pending.map(p => p.due))); return; }
      // A fixed window begins with the first message. Include texts received inside it.
      if (!commands.length) {
        const firstDue = Math.min(...ready.map(p => p.due));
        ready = data.pending.filter(p => !p.immediate && p.due <= firstDue + 5000 && p.due - 5000 <= firstDue);
      }
      const groups = [];
      for (const item of ready) {
        const previous = groups.at(-1);
        if (!item.immediate && item.message.type === 'text' && previous?.type === 'text' && !previous.command && previous.provider === item.message.provider) {
          previous.text.body += '\n' + item.message.text.body;
          previous.ids.push(item.message.id);
        } else groups.push({ ...item.message, text: item.message.text ? { ...item.message.text } : undefined, command: item.immediate, ids: [item.message.id] });
      }
      for (const group of groups) {
        await processMessage(group);
        const done = new Set(group.ids);
        data.pending = data.pending.filter(p => !done.has(p.message.id));
        // Persist after each group; a failed downstream operation remains recoverable.
        await store.set(number, data);
      }
      if (data.pending.length) schedule(number, Math.min(...data.pending.map(p => p.due)));
    });
  }
  let recovering = false;
  async function recover() {
    if (recovering) return;
    recovering = true;
    try {
      await Promise.all((await store.keys()).map(number => flush(number).catch(() => log({ event: 'ingress_retry' }))));
    } finally { recovering = false; }
  }
  return { accept, flush, recover };
}
module.exports = { createIngress, verifyMeta };
