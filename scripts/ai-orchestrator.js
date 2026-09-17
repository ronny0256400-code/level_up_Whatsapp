#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateFile } = require('./ai-sandbox');
const ROOT = path.resolve(__dirname, '..');
const ENDPOINT = 'https://api.x.ai/v1/chat/completions';
class WorkError extends Error {}

function redact(text, key) {
  return (key ? text.split(key).join('[REDACTED]') : text)
    .replace(/\b(?:xai-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]');
}

// No directories, glob expansion, symlinks, environment files or credential files.
async function safePath(root, relative, directory = false) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') ||
      relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.' ||
        /^(?:\.env|\.git$|node_modules$)|credential|secret|gen-lang-client-|\.(?:pem|key|p12|pfx)$/i.test(p))) {
    throw new WorkError('Ruta no permitida.');
  }
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) {
      throw new WorkError('Enlaces simbólicos o rutas no regulares no permitidos.');
    }
    if (i === parts.length - 1 && !(directory ? stat.isDirectory() : stat.isFile())) {
      throw new WorkError('Tipo de archivo no permitido.');
    }
    if (!directory && i === parts.length - 1 && stat.size > 128 * 1024) {
      throw new WorkError('Archivo demasiado grande (máximo 128 KiB).');
    }
  }
  return current;
}

async function run({ root = ROOT, args = process.argv.slice(2), fetchImpl = fetch,
  log = console.log } = {}) {
  args = [...args];
  const worker = args[0] === '--worker' ? args.splice(0, 2)[1] : 'grok';
  const label = worker === 'antigravity' ? 'ANTIGRAVITY' : 'GROK';
  const key = process.env.XAI_API_KEY;
  const report = { worker, status: 'FAILED', started: new Date().toISOString(), files: [], apiAccepted: false };
  let reportPath;
  log(`${label}: STARTED`);
  try {
    await safePath(root, '.ai', true);
    await fs.mkdir(path.join(root, '.ai/reports'), { recursive: true });
    await safePath(root, '.ai/reports', true);
    reportPath = path.join(root, '.ai/reports', `${label.toLowerCase()}-${Date.now()}-${randomUUID()}.md`);
    if (!['grok', 'antigravity'].includes(worker)) throw new WorkError('Worker no soportado.');
    let importPath;
    if (worker === 'antigravity' && args.length === 3 && args[1] === '--import-report') {
      importPath = args[2];
      args = [args[0]];
    }
    if (args.length > 1) throw new WorkError('Uso: npm run ai:work -- .ai/tasks/TAREA.md');
    const taskPath = args[0] || '.ai/tasks/TEST-GROK.md';
    if (!/^\.ai\/tasks\/.+\.md$/.test(taskPath)) throw new WorkError('La tarea debe ser un Markdown en .ai/tasks/.');
    const read = async file => {
      const content = await fs.readFile(await safePath(root, file), 'utf8');
      if (content.includes('\0') || /-----BEGIN .*PRIVATE KEY-----|"private_key"\s*:/.test(content)) {
        throw new WorkError('Contenido binario o credenciales detectadas; envío cancelado.');
      }
      report.files.push(file);
      return { file, content: redact(content, key) };
    };
    const task = await read(taskPath);
    // The first fenced JSON block is the explicit context manifest.
    const manifest = task.content.match(/^```json\s*\n([\s\S]*?)^```/m);
    let config;
    try { config = JSON.parse(manifest?.[1]); } catch { throw new WorkError('Falta un bloque JSON válido con contextFiles.'); }
    if (!Array.isArray(config.contextFiles) || config.contextFiles.length > 20 ||
        config.contextFiles.some(f => typeof f !== 'string')) throw new WorkError('contextFiles debe ser una lista de hasta 20 rutas.');
    const context = [await read('AGENTS.md')];
    try { context.push(await read('.ai/CURRENT_STATE.md')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (worker === 'antigravity') {
      try { context.push(await read('.ai/ARCHITECTURE.md')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const file of new Set(config.contextFiles)) {
      if (!report.files.includes(file)) context.push(await read(file));
    }
    const content = JSON.stringify({ task, context });
    if (Buffer.byteLength(content) > 256 * 1024) throw new WorkError('Contexto demasiado grande (máximo 256 KiB).');
    if (worker === 'antigravity') {
      if (config.mode !== 'analysis-only') throw new WorkError('Antigravity V2 requiere mode: analysis-only.');
      report.mode = config.mode;
      report.automaticAvailability = 'unavailable';
      report.reason = 'Autenticación automática temporalmente no disponible.';
      report.taskSent = false;
      if (importPath !== undefined) {
        if (!importPath.endsWith('.md')) throw new WorkError('El reporte manual debe ser un archivo .md dentro del repositorio.');
        const source = await safePath(root, importPath);
        const answer = await fs.readFile(source, 'utf8');
        validateFile(importPath, answer);
        if (!answer.trim()) throw new WorkError('El reporte manual está vacío.');
        report.answer = answer;
        report.source = importPath;
        report.origin = 'manual-import';
        report.reviewRequired = true;
        report.status = 'COMPLETE';
      } else {
        for (const entry of [task, ...context]) validateFile(entry.file, entry.content);
        report.manualTaskPath = reportPath.replace(/\.md$/, '-manual-task.md');
        const bundle = '# Antigravity — ejecución manual requerida\n\n' +
          'Automatización no disponible por autenticación. Este paquete es opcional.\n' +
          'Entrega únicamente el contexto adjunto a una sesión manual de Antigravity.\n' +
          'No abras el repositorio real ni copies credenciales o sesiones.\n' +
          'Devuelve solo texto; Codex revisará el resultado antes de integrar cambios.\n\n' +
          '## Tarea y contexto autorizados (JSON)\n\n' + JSON.stringify({ task, context }, null, 2) + '\n';
        await fs.writeFile(report.manualTaskPath, bundle, { flag: 'wx', mode: 0o600 });
        report.status = 'MANUAL_REQUIRED';
        report.nonBlocking = true;
        report.answer = 'Paquete manual preparado. Antigravity es opcional; continuar con Grok y Codex sin esperar este reporte.';
      }
    } else {
    const timeout = Number(process.env.GROK_TIMEOUT_MS || 120000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) throw new WorkError('GROK_TIMEOUT_MS debe estar entre 1 y 600000.');
    report.model = process.env.GROK_MODEL || 'grok-4.6';
    if (!/^grok-[a-zA-Z0-9.-]+$/.test(report.model)) throw new WorkError('GROK_MODEL inválido.');
    if (!key?.trim()) throw new WorkError('Falta XAI_API_KEY en process.env; no se realizó ninguna llamada a la API.');
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetchImpl(ENDPOINT, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: report.model, stream: false, max_tokens: 4096,
              messages: [{ role: 'user', content }] })
          });
          report.httpStatus = response.status;
          if (!response.ok) throw new WorkError(`API xAI: HTTP ${response.status}. No se registra el cuerpo del error.`);
          report.apiAccepted = true;
          return response.json();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new WorkError('Timeout al esperar la respuesta de Grok.'));
        }, timeout); })
      ]);
      const choice = result.choices?.[0];
      const answer = choice?.message?.content;
      if (typeof answer !== 'string' || !answer.trim() || choice.finish_reason !== 'stop') {
        throw new WorkError('Respuesta vacía, incompleta o inesperada de Grok.');
      }
      report.usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
        .filter(k => Number.isFinite(result.usage?.[k])).map(k => [k, result.usage[k]]));
      report.answer = answer;
      report.status = 'COMPLETE';
    } finally { clearTimeout(timer); }
    }
  } catch (error) {
    report.error = error instanceof WorkError ? error.message : 'Error de archivos, red, contenido sensible o respuesta JSON. Detalles omitidos para proteger credenciales.';
  }
  report.finished = new Date().toISOString();
  try {
    if (!reportPath) throw new Error();
    const { answer, ...metadata } = report;
    await fs.writeFile(reportPath, redact(`# Reporte ${label}\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n${answer || 'No se obtuvo una respuesta del worker.'}\n`, key), { flag: 'wx', mode: 0o600 });
  } catch {
    report.status = 'FAILED';
    report.error = 'No se pudo guardar el reporte.';
  }
  log(`${label}: ${report.status}`);
  if (report.status === 'MANUAL_REQUIRED') {
    log(redact(`Ejecución manual opcional. Tarea: ${report.manualTaskPath}`, key));
    log('Puedes continuar con Grok + Codex sin esperar a Antigravity.');
  }
  if (report.error) log(redact(report.error, key));
  return { status: report.status, reportPath };
}

if (require.main === module) run().then(result => { process.exitCode = result.status === 'FAILED' ? 1 : 0; });
module.exports = { run };
