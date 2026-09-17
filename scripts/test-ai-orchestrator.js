'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run } = require('./ai-orchestrator');

test('orquestador: aislamiento, reportes y fallos seguros', async t => {
  const oldKey = process.env.XAI_API_KEY;
  const oldTimeout = process.env.GROK_TIMEOUT_MS;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-test-'));
  const fakeKey = 'fake-test-credential';
  try {
    process.env.XAI_API_KEY = fakeKey;
    process.env.GROK_TIMEOUT_MS = '1000';
    await fs.mkdir(path.join(root, '.ai/tasks'), { recursive: true });
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'Convenciones');
    await fs.writeFile(path.join(root, 'map.md'), 'Mapa permitido');
    const task = files => fs.writeFile(path.join(root, '.ai/tasks/TEST-GROK.md'),
      '```json\n' + JSON.stringify({ contextFiles: files }) + '\n```\nAnaliza el mapa.');
    await task(['map.md']);
    const execute = async fetchImpl => {
      const logs = [];
      const result = await run({ root, args: [], fetchImpl, log: value => logs.push(value) });
      const report = await fs.readFile(result.reportPath, 'utf8');
      assert.ok(!report.includes(fakeKey));
      assert.ok(!logs.join('\n').includes(fakeKey));
      return { ...result, report, logs };
    };
    await t.test('solo envía archivos explícitos, sin herramientas; guarda respuesta y tokens', async () => {
      const result = await execute(async (url, options) => {
        assert.equal(url, 'https://api.x.ai/v1/chat/completions');
        assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.tools, undefined);
        const payload = JSON.parse(body.messages[0].content);
        assert.deepEqual(payload.context.map(f => f.file), ['AGENTS.md', 'map.md']);
        return { ok: true, status: 200, json: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: `Análisis ${fakeKey}` } }],
          usage: { total_tokens: 30 }
        }) };
      });
      assert.equal(result.status, 'COMPLETE');
      assert.match(result.report, /"total_tokens": 30/);
      assert.deepEqual(result.logs, ['GROK: STARTED', 'GROK: COMPLETE']);
    });
    await t.test('sin clave no llama a la red y guarda FAILED', async () => {
      delete process.env.XAI_API_KEY;
      const result = await execute(() => assert.fail('No debe llamar a la API'));
      assert.equal(result.status, 'FAILED');
      assert.match(result.report, /Falta XAI_API_KEY/);
      process.env.XAI_API_KEY = fakeKey;
    });
    await t.test('rechaza .env, traversal y symlinks antes de leer/enviar', async () => {
      await fs.symlink(path.join(root, 'map.md'), path.join(root, 'alias.md'));
      for (const file of ['.env', '../outside.md', 'alias.md']) {
        await task([file]);
        const result = await execute(() => assert.fail('No debe llamar a la API'));
        assert.equal(result.status, 'FAILED');
      }
      await task(['map.md']);
    });
    await t.test('HTTP 401 no expone el cuerpo del proveedor', async () => {
      const result = await execute(async () => ({ ok: false, status: 401,
        json: () => assert.fail('No leer cuerpo de error') }));
      assert.equal(result.status, 'FAILED');
      assert.match(result.report, /HTTP 401/);
    });
    await t.test('timeout también cubre la lectura del cuerpo', async () => {
      process.env.GROK_TIMEOUT_MS = '10';
      let signal;
      const result = await execute(async (_, options) => {
        signal = options.signal;
        return { ok: true, status: 200, json: () => new Promise(() => {}) };
      });
      assert.equal(result.status, 'FAILED');
      assert.equal(signal.aborted, true);
      assert.match(result.report, /Timeout/);
      process.env.GROK_TIMEOUT_MS = '1000';
    });
    await t.test('respuesta truncada y error de red no se anuncian como éxito', async () => {
      const truncated = await execute(async () => ({ ok: true, status: 200,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'Parcial' } }] }) }));
      assert.equal(truncated.status, 'FAILED');
      const network = await execute(async () => { throw new Error(fakeKey); });
      assert.equal(network.status, 'FAILED');
    });
  } finally {
    if (oldKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = oldKey;
    if (oldTimeout === undefined) delete process.env.GROK_TIMEOUT_MS; else process.env.GROK_TIMEOUT_MS = oldTimeout;
    await fs.rm(root, { recursive: true, force: true });
  }
});
