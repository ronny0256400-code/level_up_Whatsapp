'use strict';
const { createHash } = require('node:crypto');
const stages = new WeakMap();
function atStage(error, stage) {
  if (error && (typeof error === 'object' || typeof error === 'function') && !stages.has(error)) stages.set(error, stage);
  return error;
}
async function inStage(stage, fn) {
  try { return await fn(); } catch (error) { throw atStage(error, stage); }
}
const publicCodes = new Set([
  'CATALOGO_INVALIDO','ID_PRODUCTO_DUPLICADO','CATALOGO_INCONSISTENTE','STOCK_INSUFICIENTE',
  'ID_PRODUCTO_REQUERIDO','CANTIDAD_INVALIDA','PRECIO_CAMBIADO','LINEAS_INVALIDAS','SIN_FILAS_DISPONIBLES',
  'HOJA_VENTAS_INVALIDA','PEDIDO_INVALIDO','GUIA_CONFLICTIVA','VENTA_INCONSISTENTE',
  'ESTADO_INVALIDO','VENTA_NO_ENCONTRADA','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN',
  'invalid_api_key','model_not_found','insufficient_quota','rate_limit_exceeded','invalid_request_error',
  'server_error','invalid_value','unsupported_parameter'
]);
function safeError(error, fallback = 'webhook', depth = 0) {
  const raw = typeof error?.message === 'string' ? error.message : '';
  const code = typeof error?.code === 'string' && publicCodes.has(error.code) ? error.code : Number.isInteger(error?.code) ? error.code : null;
  const status = Number(error?.status ?? error?.response?.status);
  // Exception messages can contain complete prompts, JSON or credentials. Only
  // known static messages are printable. Fingerprints correlate redacted messages.
  const allowed = /^(?:Falta MODEL_(?:LOW|NORMAL|HIGH|TRANSCRIPTION)|YCloud no configurado|YCloud HTTP \d{3}|Connection error\.|Request timed out\.|fetch failed|Response output_text inválido|Respuesta de modelo inválida)$/;
  const message = (allowed.test(raw) || publicCodes.has(raw)) ? raw : error?.name === 'SyntaxError' ? 'JSON inválido (contenido omitido)' : '[mensaje externo omitido por privacidad]';
  const name = /^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|InventoryError|APIError|APIConnectionError|APIConnectionTimeoutError|AuthenticationError|PermissionDeniedError|NotFoundError|BadRequestError|RateLimitError|InternalServerError|UnprocessableEntityError|AbortError)$/.test(error?.name) ? error.name : 'Error';
  // Preserve source positions, not the first stack line or arbitrary source text.
  const stack = String(error?.stack || '').split('\n').slice(1).flatMap(line => {
    const location = line.match(/(?:^|[/( ])([A-Za-z_][A-Za-z0-9_.-]{0,80}\.(?:js|ts|cjs|mjs):\d+:\d+)\)?$/);
    return location ? [`at ${location[1]}`] : [];
  });
  const type = ['InventoryError','APIError','APIConnectionError','APIConnectionTimeoutError','GaxiosError','TypeError','SyntaxError','ReferenceError','Error'].includes(error?.constructor?.name) ? error.constructor.name : name;
  return { name, type, message, message_redacted: message !== raw, message_fingerprint: createHash('sha256').update(raw).digest('hex').slice(0,16), code,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    stage: stages.get(error) || fallback, stack,
    ...(error?.cause && depth < 2 ? { cause: safeError(error.cause, stages.get(error) || fallback, depth + 1) } : {}) };
}
function permanent(error) {
  const status = Number(error?.status ?? error?.response?.status);
  if (error?.message === 'fetch failed' || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(error?.code)) return false;
  return (status >= 400 && status < 500 && ![408,409,425,429].includes(status)) ||
    ['SyntaxError','TypeError','ReferenceError','RangeError'].includes(error?.name) ||
    error?.constructor?.name === 'InventoryError' || error?.message === 'YCloud no configurado' ||
    /^Falta MODEL_/.test(error?.message || '');
}
module.exports = { atStage, inStage, safeError, permanent };
