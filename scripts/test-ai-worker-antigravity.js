'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runStream, childEnvironment } = require('./ai-worker-antigravity');

function fakeCli({ tools = [], status = 'SUCCESS', code = 0, silent = false } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let input = '';
  child.stdin.on('data', chunk => { input += chunk; });
  child.kill = () => queueMicrotask(() => child.emit('close', null));
  child.stdin.on('finish', () => {
    child.stdout.write(JSON.stringify({ event: 'result', result: { status,
      response: 'Tres recomendaciones', usage: { total_tokens: 20 } } }) + '\n');
    queueMicrotask(() => child.emit('close', code));
  });
  const spawn = (binary, args, options) => {
    assert.equal(binary, '/usr/bin/sandbox-exec');
    assert.equal(options.cwd, '/tmp');
    assert.equal(options.shell, false);
    assert.ok(args.includes('--disable-slash-commands'));
    assert.equal(options.env.XAI_API_KEY, undefined);
    if (!silent) queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'init',
      init: { cwd: '/tmp', tools } }) + '\n'));
    return child;
  };
  return { spawn, input: () => input };
}

test('Antigravity entrega la tarea solo tras confirmar aislamiento y captura SUCCESS', async () => {
  const cli = fakeCli();
  const report = { osIsolationVerified: true };
  const result = await runStream('/fake/agy', '/tmp', 'contexto explícito', 1000, report, cli.spawn, 'test-profile');
  assert.equal(result.answer, 'Tres recomendaciones');
  assert.equal(JSON.parse(cli.input()).message.content, 'contexto explícito');
  assert.equal(report.isolationVerified, true);
});

test('Antigravity permite herramientas solo bajo aislamiento OS verificado', async () => {
  const cli = fakeCli({ tools: ['run_command', 'view_file'] });
  const report = { osIsolationVerified: true };
  await runStream('/fake/agy', '/tmp', 'privado', 1000, report, cli.spawn, 'test-profile');
  assert.equal(report.availableToolCount, 2);
  await assert.rejects(runStream('/fake/agy', '/tmp', 'privado', 1000, {}, cli.spawn), /aislamiento/);
});

test('Antigravity timeout sin handshake no transmite tarea', async () => {
  const cli = fakeCli({ silent: true });
  await assert.rejects(runStream('/fake/agy', '/tmp', 'privado', 10, { osIsolationVerified: true }, cli.spawn, 'test-profile'), /Timeout/);
  assert.equal(cli.input(), '');
});

test('Antigravity no acepta fallo del proveedor ni salida no cero', async () => {
  for (const config of [{ status: 'ERROR' }, { code: 1 }]) {
    const cli = fakeCli(config);
    await assert.rejects(runStream('/fake/agy', '/tmp', 'test', 1000, { osIsolationVerified: true }, cli.spawn, 'test-profile'));
  }
});

test('El entorno del worker excluye secretos y opciones inyectables', () => {
  const env = childEnvironment();
  assert.deepEqual(Object.keys(env).filter(k => !['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME'].includes(k)), []);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.GOOGLE_SERVICE_ACCOUNT_JSON, undefined);
});

