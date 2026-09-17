'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSandbox, withSandbox, profileFor } = require('./ai-sandbox');
const payload = JSON.stringify({ task: { file: '.ai/tasks/TEST.md', content: 'Analiza' },
  context: [{ file: 'AGENTS.md', content: '' }, { file: 'map.md', content: 'Mapa original' }] });

for (const file of ['.env', 'config/.env.local', '.git/config', 'node_modules/a.js',
  '../escape.md', 'nested/../../escape.md', '/tmp/escape.md', '..\\escape.md', 'credentials.json']) {
  test(`sandbox rechaza ${file}`, async () => {
    const data = JSON.parse(payload);
    data.context.push({ file, content: 'fixture sin secretos' });
    await assert.rejects(createSandbox(JSON.stringify(data)), /Ruta no permitida/);
  });
}

test('solo copia archivos autorizados, no refleja cambios y limpia al terminar', async () => {
  const original = await fs.mkdtemp(path.join(os.tmpdir(), 'original-project-'));
  const report = {};
  try {
    await fs.writeFile(path.join(original, 'map.md'), 'Mapa original');
    await fs.writeFile(path.join(original, 'unauthorized.md'), 'No copiar');
    await withSandbox(payload, report, async cwd => {
      assert.deepEqual((await fs.readdir(cwd)).sort(), ['.ai', 'AGENTS.md', 'map.md']);
      await assert.rejects(fs.stat(path.join(cwd, 'unauthorized.md')), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(cwd, '.env')), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(cwd, '.git')), { code: 'ENOENT' });
      await fs.writeFile(path.join(cwd, 'map.md'), 'Modificado por worker');
      assert.equal(await fs.readFile(path.join(original, 'map.md'), 'utf8'), 'Mapa original');
    });
    assert.equal(report.sandboxRemoved, true);
    await assert.rejects(fs.stat(report.sandbox), { code: 'ENOENT' });
  } finally { await fs.rm(original, { recursive: true, force: true }); }
});

test('limpia también cuando falla el worker', async () => {
  const report = {};
  await assert.rejects(withSandbox(payload, report, async () => { throw new Error('fallo'); }), /fallo/);
  await assert.rejects(fs.stat(report.sandbox), { code: 'ENOENT' });
});

test('debug conserva el sandbox solo cuando se solicita', async () => {
  const report = {};
  await withSandbox(payload, report, async () => {}, true);
  try { assert.ok((await fs.stat(report.sandbox)).isDirectory()); }
  finally { await fs.rm(report.sandbox, { recursive: true, force: true }); }
});

test('no copia contenido de claves privadas', async () => {
  const data = JSON.parse(payload);
  data.context[1].content = '-----BEGIN RSA PRIVATE KEY-----';
  await assert.rejects(createSandbox(JSON.stringify(data)), /Contenido sensible/);
});

test('OS: cwd aislado, lectura/escritura fuera bloqueadas y escritura local permitida',
  { skip: process.env.AI_TEST_OS !== '1' || process.platform !== 'darwin' }, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'blocked-root-')));
    const sandbox = await createSandbox(payload);
    try {
      const source = path.join(root, 'sentinel.txt');
      await fs.writeFile(source, 'original');
      const profile = profileFor({ root, sandbox, binary: '/bin/sh', home: os.homedir() });
      const script = 'test "$PWD" = "$3" || exit 20; if /bin/cat "$1" >/dev/null 2>&1; then exit 21; fi; if (echo changed > "$1") 2>/dev/null; then exit 22; fi; echo local > "$2"';
      await promisify(execFile)('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', script,
        'sandbox-test', source, path.join(sandbox, 'changed.txt'), sandbox], { cwd: sandbox, timeout: 10000 });
      assert.equal(await fs.readFile(source, 'utf8'), 'original');
      assert.equal(await fs.readFile(path.join(sandbox, 'changed.txt'), 'utf8'), 'local\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(sandbox, { recursive: true, force: true });
    }
  });
