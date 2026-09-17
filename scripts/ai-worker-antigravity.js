'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { profileFor, withSandbox } = require('./ai-sandbox');
class AntigravityError extends Error {}

// Only runtime variables; never forward the application's API keys or NODE_OPTIONS.
function childEnvironment() {
  return Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
}

async function detectBinary() {
  const candidates = (process.env.PATH || '').split(path.delimiter)
    .filter(p => path.isAbsolute(p)).flatMap(p => ['agy', 'antigravity'].map(n => path.join(p, n)));
  candidates.push(path.join(os.homedir(), '.local/bin/agy'));
  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate, constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return fs.realpath(candidate);
    } catch { /* Continue searching known launcher names. */ }
  }
  throw new AntigravityError('No se encontró agy/antigravity ejecutable en PATH ni ~/.local/bin/agy.');
}

// Tool availability is acceptable only inside the verified OS sandbox.
function runStream(binary, cwd, content, timeout, report, spawnImpl = spawn, profile) {
  if (!profile || !report.osIsolationVerified) return Promise.reject(new AntigravityError('Falta aislamiento del sistema operativo.'));
  return new Promise((resolve, reject) => {
    const args = ['--mode', 'plan', '--log-file', path.join(cwd, 'worker.log'),
      '--disable-slash-commands', '--input-format', 'stream-json',
      '--output-format', 'stream-json', '--print-timeout', `${timeout}ms`];
    const child = spawnImpl('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], { cwd, env: childEnvironment(),
      shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '', size = 0, sent = false, result, failure;
    const kill = () => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { child.kill('SIGKILL'); }
    };
    const fail = message => { failure ||= new AntigravityError(message); kill(); };
    const timer = setTimeout(() => fail('Timeout de Antigravity; proceso detenido.'), timeout);
    child.stdout.setEncoding('utf8');
    child.on('error', () => { clearTimeout(timer); reject(new AntigravityError('No se pudo iniciar Antigravity.')); });
    child.stdin.on('error', () => fail('Antigravity cerró la entrada antes de recibir la tarea.'));
    child.stderr.on('data', chunk => {
      // Do not print or persist raw diagnostics, which may contain account details.
      const message = chunk.toString('utf8');
      report.diagnostics ||= {};
      for (const [name, pattern] of Object.entries({
        permissionDenied: /permission denied|operation not permitted/i,
        authenticationRequired: /authentication required|not authenticated|not logged in/i,
        runtimeDirectory: /antigravity-cli/,
        logFile: /cli\.log|worker\.log/,
        runtimeState: /jetski|state|installation_id/i,
        configuration: /settings|config/i,
        history: /history|conversation|brain/i,
        missingFile: /no such file|not found/i,
      })) if (pattern.test(message)) report.diagnostics[name] = true;
      size += chunk.length;
      if (size > 2 * 1024 * 1024) fail('Salida de Antigravity demasiado grande.');
    });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return fail('Salida de Antigravity demasiado grande.');
      pending += chunk.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line || failure) continue;
        let event;
        try { event = JSON.parse(line); } catch { fail('Antigravity devolvió una salida no compatible con NDJSON.'); continue; }
        if (event.event === 'init') {
          report.availableToolCount = Array.isArray(event.init?.tools) ? event.init.tools.length : null;
          report.availableSensitiveTools = ['view_file', 'read_file', 'run_command', 'write_to_file',
            'replace_file_content', 'multi_replace_file_content', 'invoke_subagent']
            .filter(name => Array.isArray(event.init?.tools) && event.init.tools.includes(name));
          if (sent || event.init?.cwd !== cwd || !Array.isArray(event.init?.tools)) {
            report.isolationVerified = false;
            fail('La CLI no confirmó el cwd aislado. Tarea no enviada.');
            continue;
          }
          report.isolationVerified = true;
          sent = true;
          report.taskSent = true;
          child.stdin.end(JSON.stringify({ event: 'user', message: { content } }) + '\n');
        } else if (event.event === 'result') result = event.result;
      }
    });
    child.on('close', code => {
      clearTimeout(timer);
      report.exitCode = code;
      if (failure) return reject(failure);
      if (code !== 0) return reject(new AntigravityError(report.diagnostics?.authenticationRequired
        ? 'Antigravity requiere autenticación dentro del entorno aislado. No se copiaron ni modificaron credenciales.'
        : 'Antigravity terminó con error; revisar permisos de la CLI. Diagnósticos crudos omitidos.'));
      if (!sent || result?.status !== 'SUCCESS' || typeof result.response !== 'string' || !result.response.trim()) {
        return reject(new AntigravityError('Antigravity no devolvió un resultado SUCCESS válido; no se considera una respuesta completa.'));
      }
      const usage = Object.fromEntries(['input_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens']
        .filter(k => Number.isFinite(result.usage?.[k])).map(k => [k, result.usage[k]]));
      resolve({ answer: result.response, usage });
    });
  });
}

async function runAntigravity({ content, report, root }) {
  const timeout = Number(process.env.ANTIGRAVITY_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) {
    throw new AntigravityError('ANTIGRAVITY_TIMEOUT_MS debe estar entre 1 y 600000.');
  }
  report.taskSent = false;
  if (process.platform !== 'darwin') throw new AntigravityError('V2.1 requiere sandbox-exec de macOS; no se ejecutará sin aislamiento OS.');
  const binary = await detectBinary();
  report.binary = binary;
  return withSandbox(content, report, async cwd => {
    const repoRoot = await fs.realpath(root);
    if (cwd === repoRoot || cwd.startsWith(repoRoot + path.sep)) throw new AntigravityError('El sandbox debe estar fuera del repositorio real.');
    await fs.access(path.join(repoRoot, 'package.json'), constants.R_OK);
    const profile = profileFor({ root: repoRoot, sandbox: cwd, binary, home: os.homedir() });
    const options = { cwd, env: childEnvironment(), timeout: 10000, maxBuffer: 65536 };
    try { await exec('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/true'], options); }
    catch { throw new AntigravityError('No se pudo activar sandbox-exec. No se ejecutará Antigravity sin aislamiento OS.'); }
    // Confirm the real repository is unreadable without logging its contents.
    let blocked = false;
    try { await exec('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', path.join(repoRoot, 'package.json')], options); }
    catch (error) { blocked = error.code === 1; }
    if (!blocked) throw new AntigravityError('No se pudo verificar el bloqueo de lectura del repositorio real.');
    report.osIsolationVerified = true;
    let help;
    try {
      const output = await exec('/usr/bin/sandbox-exec', ['-p', profile, binary, '--help'], { ...options, timeout: Math.min(timeout, 10000) });
      help = output.stdout + output.stderr;
    } catch { throw new AntigravityError('No se pudo verificar --help de Antigravity (error o timeout).'); }
    const required = ['--print', '--mode', '--input-format', '--output-format', '--disable-slash-commands', '--print-timeout'];
    report.capabilities = Object.fromEntries(required.map(flag => [flag, help.includes(flag)]));
    if (!required.every(flag => report.capabilities[flag])) {
      throw new AntigravityError('La CLI instalada no ofrece las opciones headless requeridas. No se abrió la GUI ni se envió la tarea.');
    }
    return runStream(binary, cwd, content, timeout, report, spawn, profile);
  }, process.env.AI_KEEP_SANDBOX === '1');
}

module.exports = { runAntigravity, AntigravityError, childEnvironment, runStream };
