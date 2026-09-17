'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function validateFile(file, content) {
  if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('\\') ||
      file.split('/').some(p => !p || p === '.' || p === '..' ||
        /^(?:\.env|\.git$|node_modules$)|credential|secret|gen-lang-client-|\.(?:pem|key|p12|pfx)$/i.test(p))) {
    throw new Error('Ruta no permitida para el sandbox.');
  }
  if (typeof content !== 'string' || content.includes('\0') ||
      /-----BEGIN .*PRIVATE KEY-----|"private_key"\s*:|\b(?:xai-|sk-)[A-Za-z0-9_-]{12,}|\bAIza[\w-]{20,}/.test(content)) {
    throw new Error('Contenido sensible o binario no permitido en el sandbox.');
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && value?.length >= 8 && content.includes(value)) {
      throw new Error('Se detectó un secreto del entorno en el contexto.');
    }
  }
}

async function createSandbox(content) {
  const payload = JSON.parse(content);
  const files = [payload.task, ...payload.context];
  // Validate the entire batch before creating or writing anything.
  for (const entry of files) validateFile(entry.file, entry.content);
  const name = path.basename(payload.task.file, '.md').replace(/[^a-zA-Z0-9_-]/g, '_');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `ai-${name}-${Date.now()}-`));
  const root = await fs.realpath(directory);
  try {
    for (const entry of files) {
      const target = path.resolve(root, entry.file);
      if (!target.startsWith(root + path.sep)) throw new Error('Ruta fuera del sandbox.');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.content, { flag: 'wx', mode: 0o600 });
    }
    return root;
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

// macOS Seatbelt constrains the entire worker process tree, not just its cwd.
// System/runtime resources are exceptions; project and credential files are not.
function profileFor({ root, sandbox, binary, home }) {
  const quote = value => JSON.stringify(value);
  const sub = value => `(subpath ${quote(value)})`;
  const literal = value => `(literal ${quote(value)})`;
  return `(version 1)
(allow default)
(deny file-write*)
(deny file-read* ${['/Users', '/Volumes', '/private/tmp', '/private/var/folders'].map(sub).join(' ')})
(allow file-read-metadata)
(allow file-read* ${literal(binary)})
(allow file-read* file-write* ${sub(sandbox)})
(allow file-read* file-write* ${literal('/dev/null')})
(allow file-read* ${sub(path.join(home, '.gemini/antigravity-cli/bin'))} ${sub(path.join(home, '.gemini/antigravity-cli/builtin'))})
(allow file-read* ${literal(path.join(home, '.gemini/installation_id'))})
(allow file-read* ${literal(path.join(home, '.gemini/antigravity-cli/installation_id'))})
(deny file-read* file-write* ${sub(root)})
`;
}

async function withSandbox(content, report, operation, keep = false) {
  const sandbox = await createSandbox(content);
  report.sandbox = sandbox;
  report.sandboxRetained = keep;
  try { return await operation(sandbox); }
  finally {
    if (!keep) await fs.rm(sandbox, { recursive: true, force: true });
    report.sandboxRemoved = !keep;
  }
}

module.exports = { createSandbox, validateFile, profileFor, withSandbox };
