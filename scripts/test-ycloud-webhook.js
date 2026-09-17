'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createHmac } = require('node:crypto');
const express = require('express');
const { createYCloudWebhook } = require('../lib/ycloud-webhook');

test('YCloud y Meta conviven en el servidor real con dependencias simuladas', async t => {
  const secretFixture = 'local-test-signing-secret';
  let secret = secretFixture;
  const logs = [], queued = [];
  const clock = Date.now();
  const app = express();
  // Load real route registration and Meta handlers without starting production.
  app.listen = () => ({ on() {} });
  function mockExpress() { return app; }
  mockExpress.json = express.json;
  const env = Object.fromEntries(['OPENAI_API_KEY', 'VERIFY_TOKEN', 'PHONE_NUMBER_ID',
    'WHATSAPP_TOKEN', 'STOCK_SPREADSHEET_ID', 'MEMORIA_SPREADSHEET_ID', 'ASESOR_WHATSAPP']
    .map(name => [name, 'fixture']));
  env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}'; env.WHATSAPP_APP_SECRET='fixture'; env.MODEL_LOW='fixture';env.MODEL_NORMAL='fixture';env.MODEL_HIGH='fixture';
  const forbidden = () => assert.fail('El webhook no debe llamar a dependencias externas');
  const context = vm.createContext({ process: { env }, console: { log() {}, error() {} },
    fetch: forbidden, require(name) {
      if(name==='node:async_hooks') return require(name);
      if(name==='./lib/v2-ingress') return {...require('../lib/v2-ingress'),createIngress:()=>({accept:async m=>queued.push(m)})};
      if(name.startsWith('./lib/') && name!=='./lib/ycloud-webhook') return require('../'+name.slice(2));
      if (name === 'express') return mockExpress;
      if (name === './lib/ycloud-webhook') return {
        createYCloudWebhook: options => createYCloudWebhook({ ...options, getSecret: () => secret, log: entry => logs.push(entry), now: () => clock })
      };
      if (name === 'openai') return class { constructor() { this.responses = { create: forbidden }; } };
      if (name === 'googleapis') return { google: { auth: { GoogleAuth: class {} },
        sheets: () => ({ spreadsheets: { values: { get: forbidden, update: forbidden, append: forbidden } } }) } };
      throw new Error('Importación inesperada en test');
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const inbound = { type: 'whatsapp.inbound_message.received', createTime: new Date(clock).toISOString(),
    whatsappInboundMessage: { id: 'wim-test', from: '+593999123456', type: 'text', text: { body: 'CONTENIDO PRIVADO' } } };
  function signature(body, timestamp = Math.floor(clock / 1000)) {
    return `t=${timestamp},s=${createHmac('sha256', secretFixture).update(`${timestamp}.${body}`).digest('hex')}`;
  }
  const post = (body, header = signature(body), headers = {}) => fetch(base + '/ycloud/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(header ? { 'YCloud-Signature': header } : {}), ...headers }, body
  });

  await t.test('POST inbound válido: 200 y metadatos seguros', async () => {
    const response = await post(JSON.stringify(inbound, null, 2));
    assert.equal(response.status, 200);
    assert.equal(queued.at(-1).text.body, 'CONTENIDO PRIVADO');
    assert.equal(queued.at(-1).provider, 'ycloud');
    assert.deepEqual(await response.json(), { received: true, ignored: false });
    const entry = logs.at(-1);
    assert.equal(entry.eventType, inbound.type);
    assert.equal(entry.messageId, 'wim-test');
    assert.equal(entry.sender, '***3456');
    assert.equal(entry.eventTimestamp, inbound.createTime);
    assert.equal(entry.timestamp, new Date(clock).toISOString());
    assert.doesNotMatch(JSON.stringify(logs), /CONTENIDO PRIVADO|593999123456|local-test-signing-secret/);
  });
  await t.test('actualización de mensaje válida y campos opcionales ausentes', async () => {
    assert.equal((await post(JSON.stringify({ type: 'whatsapp.message.updated', whatsappMessage: { wamid: 'wamid.test', from: '+593999654321' } }))).status, 200);
    assert.equal(logs.at(-1).messageId, 'wamid.test');
    assert.equal((await post(JSON.stringify({ type: 'whatsapp.message.updated', whatsappMessage: {} }))).status, 200);
    assert.equal(logs.at(-1).messageId, null);
    assert.equal(logs.at(-1).sender, null);
  });
  await t.test('evento desconocido se confirma e ignora', async () => {
    const response = await post(JSON.stringify({ type: 'future.event', privateData: 'NO REGISTRAR' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, ignored: true });
    assert.equal(logs.at(-1).result, 'ignored');
    assert.ok(!JSON.stringify(logs).includes('NO REGISTRAR'));
  });
  await t.test('body vacío, objeto vacío y evento mal formado: 400', async () => {
    for (const body of ['', '{}', '[]', 'null', '{', JSON.stringify({ type: inbound.type })]) {
      assert.equal((await post(body)).status, 400);
    }
  });
  await t.test('secret ausente: 503 sin deshabilitar Meta', async () => {
    secret = undefined;
    try {
      assert.equal((await post(JSON.stringify(inbound))).status, 503);
      const meta = await fetch(base + '/webhook?hub.mode=subscribe&hub.verify_token=fixture&hub.challenge=123');
      assert.equal(meta.status, 200);
      assert.equal(await meta.text(), '123');
    } finally { secret = secretFixture; }
  });
  await t.test('firma ausente, inválida, body alterado y timestamp fuera de ventana: 401', async () => {
    const body = JSON.stringify(inbound);
    for (const header of [null, 't=1,s=invalid', signature(body + ' '),
      signature(body, Math.floor(clock / 1000) - 301), signature(body, Math.floor(clock / 1000) + 301)]) {
      assert.equal((await post(body, header)).status, 401);
    }
  });
  await t.test('múltiples firmas permiten rotación sin aceptar timestamp duplicado', async () => {
    const body = JSON.stringify(inbound);
    assert.equal((await post(body, signature(body) + ',s=' + '0'.repeat(64))).status, 200);
    assert.equal((await post(body, signature(body) + ',t=1')).status, 401);
  });
  await t.test('tipo de contenido incorrecto: 415; tamaño excesivo: 413', async () => {
    assert.equal((await post('{}', undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('x'.repeat(257 * 1024))).status, 413);
  });
  await t.test('logs no aceptan secretos como id ni caracteres de control', async () => {
    const event = { ...inbound, whatsappInboundMessage: { id: secretFixture, from: 'invalid\nphone' } };
    assert.equal((await post(JSON.stringify(event))).status, 200);
    assert.equal(logs.at(-1).messageId, null);
    assert.equal(logs.at(-1).sender, null);
  });
  await t.test('Meta GET inválido y POST requiere firma válida', async () => {
    assert.equal((await fetch(base + '/webhook?hub.mode=subscribe&hub.verify_token=wrong')).status, 403);
    assert.equal((await fetch(base + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: [] }) })).status, 401);
    const body=JSON.stringify({entry:[]});
    const signature='sha256='+createHmac('sha256','fixture').update(body).digest('hex');
    assert.equal((await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':signature},body})).status,200);
    assert.equal((await post(JSON.stringify(inbound))).status, 200);
  });
});
