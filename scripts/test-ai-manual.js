'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { run } = require('./ai-orchestrator');

test('fallback manual opcional e importación', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-worker-'));
  const taskPath = '.ai/tasks/TEST.md';
  const args = ['--worker', 'antigravity', taskPath];
  const logs = [];
  const options = { root, args, log: value => logs.push(value),
    fetchImpl: () => assert.fail('El fallback no debe llamar a ninguna API') };
  const readReport = async result => {
    const text = await fs.readFile(result.reportPath, 'utf8');
    return { text, metadata: JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)[1]) };
  };
  try {
    await fs.mkdir(path.join(root, '.ai/tasks'), { recursive: true });
    await fs.writeFile(path.join(root, taskPath), '```json\n' +
      JSON.stringify({ mode: 'analysis-only', contextFiles: ['map.md'] }) + '\n```\nAnaliza.');
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'Reglas');
    await fs.writeFile(path.join(root, '.ai/ARCHITECTURE.md'), 'Arquitectura');
    await fs.writeFile(path.join(root, 'map.md'), 'Mapa autorizado');
    await fs.writeFile(path.join(root, 'not-authorized.md'), 'NO INCLUIR');

    await t.test('prepara paquete explícito, ruta visible y estado no bloqueante', async () => {
      const result = await run(options);
      assert.equal(result.status, 'MANUAL_REQUIRED');
      const { metadata } = await readReport(result);
      assert.equal(metadata.nonBlocking, true);
      assert.equal(metadata.automaticAvailability, 'unavailable');
      assert.equal(metadata.taskSent, false);
      const bundle = await fs.readFile(metadata.manualTaskPath, 'utf8');
      assert.match(bundle, /Mapa autorizado/);
      assert.match(bundle, /Arquitectura/);
      assert.ok(!bundle.includes('NO INCLUIR'));
      assert.ok(logs.some(line => line.includes(metadata.manualTaskPath)));
      assert.equal(metadata.sandbox, undefined);
    });

    await t.test('importa texto a reporte nuevo con revisión pendiente de Codex', async () => {
      await fs.writeFile(path.join(root, '.ai/manual-result.md'), 'Tres recomendaciones de arquitectura.');
      const result = await run({ ...options, args: [...args, '--import-report', '.ai/manual-result.md'] });
      assert.equal(result.status, 'COMPLETE');
      const { text, metadata } = await readReport(result);
      assert.match(text, /Tres recomendaciones/);
      assert.equal(metadata.origin, 'manual-import');
      assert.equal(metadata.reviewRequired, true);
      assert.equal(await fs.readFile(path.join(root, 'map.md'), 'utf8'), 'Mapa autorizado');
    });

    await t.test('rechaza importaciones fuera del repo, enlaces, vacías y secretos', async () => {
      await fs.writeFile(path.join(root, '.ai/empty.md'), '');
      await fs.writeFile(path.join(root, '.ai/sensitive.md'), '-----BEGIN RSA PRIVATE KEY-----');
      await fs.symlink(path.join(root, 'map.md'), path.join(root, '.ai/link.md'));
      for (const file of ['../outside.md', '.env', '.git/config', '.ai/empty.md', '.ai/sensitive.md', '.ai/link.md']) {
        const result = await run({ ...options, args: [...args, '--import-report', file] });
        assert.equal(result.status, 'FAILED');
      }
    });

    await t.test('Grok continúa la misma tarea sin esperar a Antigravity', async () => {
      const old = process.env.XAI_API_KEY;
      process.env.XAI_API_KEY = 'test-only-placeholder';
      try {
        const result = await run({ root, args: [taskPath], log: () => {}, fetchImpl: async () => ({
          ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop',
            message: { content: 'Respuesta simulada de Grok' } }] })
        }) });
        assert.equal(result.status, 'COMPLETE');
        assert.equal((await readReport(result)).metadata.worker, 'grok');
      } finally {
        if (old === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = old;
      }
    });

    await t.test('rechaza contexto prohibido antes de crear el paquete', async () => {
      await fs.writeFile(path.join(root, taskPath), '```json\n' +
        JSON.stringify({ mode: 'analysis-only', contextFiles: ['.env'] }) + '\n```');
      const result = await run(options);
      assert.equal(result.status, 'FAILED');
      assert.equal((await readReport(result)).metadata.manualTaskPath, undefined);
    });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
