'use strict';

const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const EVENTS = new Map([
  ['whatsapp.inbound_message.received', 'whatsappInboundMessage'],
  ['whatsapp.message.updated', 'whatsappMessage'],
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validSignature(raw, header, secret, now) {
  if (typeof header !== 'string' || header.length > 2048) return false;
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamps = parts.filter(([name]) => name === 't');
  const signatures = parts.filter(([name]) => name === 's').map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0][1])) return false;
  const timestamp = timestamps[0][1];
  // Local replay window: YCloud signs each delivery with a Unix timestamp.
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  return signatures.some(value => typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) &&
    timingSafeEqual(expected, Buffer.from(value, 'hex')));
}

function safeIdentifier(value, secret) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:+/=-]{1,200}$/.test(value) ||
      value.includes(secret) || /^(?:xai-|sk-|AIza)/.test(value)) return null;
  return value;
}

function maskedPhone(value) {
  if (typeof value !== 'string' || !/^\+?\d{7,15}$/.test(value)) return null;
  return '***' + value.slice(-4);
}

function createYCloudWebhook({ getSecret = () => process.env.YCLOUD_WEBHOOK_SECRET,
  log = metadata => console.log('YCloud webhook', metadata), now = Date.now } = {}) {
  const parse = express.raw({ type: 'application/json', limit: '256kb', inflate: false });
  const safeLog = data => { try { log(data); } catch { /* Logging must not cause retries. */ } };
  return (req, res) => {
    const secret = getSecret();
    if (typeof secret !== 'string' || !secret.trim()) {
      safeLog({ provider: 'ycloud', result: 'not_configured', timestamp: new Date(now()).toISOString() });
      return res.status(503).json({ error: 'Webhook no configurado' });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.get('Content-Type') || '')) {
      return res.status(415).json({ error: 'Se requiere application/json' });
    }
    parse(req, res, error => {
      if (error) {
        const code = error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
        return res.status(code).json({ error: 'Cuerpo no admitido' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Cuerpo vacío' });
      if (!validSignature(req.body, req.get('YCloud-Signature'), secret, now())) {
        safeLog({ provider: 'ycloud', result: 'invalid_signature', timestamp: new Date(now()).toISOString() });
        return res.status(401).json({ error: 'Firma inválida' });
      }
      let event;
      try { event = JSON.parse(req.body.toString('utf8')); }
      catch { return res.status(400).json({ error: 'JSON inválido' }); }
      if (!object(event) || typeof event.type !== 'string' || !/^[a-z][a-z0-9_.]{0,99}$/.test(event.type)) {
        return res.status(400).json({ error: 'Evento inválido' });
      }
      const field = EVENTS.get(event.type);
      if (field && !object(event[field])) return res.status(400).json({ error: 'Datos del evento inválidos' });
      const message = field ? event[field] : {};
      const eventTime = typeof event.createTime === 'string' && event.createTime.length <= 40
        ? Date.parse(event.createTime) : NaN;
      const metadata = {
        provider: 'ycloud',
        eventType: safeIdentifier(event.type, secret),
        messageId: safeIdentifier(message.id, secret) || safeIdentifier(message.wamid, secret),
        sender: maskedPhone(message.from),
        timestamp: new Date(now()).toISOString(),
        eventTimestamp: Number.isFinite(eventTime) ? new Date(eventTime).toISOString() : null,
        result: field ? 'received' : 'ignored',
      };
      // No API calls, persistence, chatbot dispatch or outbound messages here.
      res.status(200).json({ received: true, ignored: !field });
      safeLog(metadata);
    });
  };
}

module.exports = { createYCloudWebhook };
