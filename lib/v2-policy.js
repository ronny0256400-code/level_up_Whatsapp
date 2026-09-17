'use strict';
const { randomUUID } = require('node:crypto');
const STATES = Object.freeze(['nuevo','interesado','recopilando_datos','esperando_confirmacion','confirmado','enviado','disponible_retiro','retirado','cerrado','abandono','no_interesado','postventa_humano','human_takeover','no_retirado','spam']);
const FLOW = Object.freeze({
  nuevo: ['interesado','recopilando_datos','esperando_confirmacion'],
  interesado: ['recopilando_datos','esperando_confirmacion'],
  recopilando_datos: ['interesado','esperando_confirmacion'],
  esperando_confirmacion: ['recopilando_datos','confirmado'],
  confirmado: ['enviado'], enviado: ['disponible_retiro'], disponible_retiro: ['retirado','no_retirado']
});
const CLOSED = new Set(['retirado','cerrado','abandono','no_interesado','no_retirado','spam']);
const ADMIN = /^(GUIA|LLEGO|TOMAR|LIBERAR|DERIVAR|PAGO|RETIRADO)\b/i;
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const phone = value => /^\+?\d{7,15}$/.test(String(value || '')) ? String(value).replace(/^\+/, '') : null;
const isAdmin = (from, configured) => !!phone(configured) && phone(from) === phone(configured);
const official = state => ({ pagado: 'retirado', sin_respuesta: 'no_retirado', inicio: 'nuevo' }[state] || state);
function state(c) { return official(c.estado || c.pedido?.estado) || (c.esperandoConfirmacionPedido ? 'esperando_confirmacion' : 'nuevo'); }
function prepare(c, now = new Date().toISOString()) {
  c.schema_version = 2;
  c.estado = state(c);
  if (!STATES.includes(c.estado)) { c.legacy_state = c.estado; c.estado = 'human_takeover'; c.human_takeover = true; }
  c.human_takeover = c.human_takeover === true || ['human_takeover','postventa_humano'].includes(c.estado);
  c.no_contactar = c.no_contactar === true;
  c.opportunity_id ||= randomUUID();
  c.created_at ||= now;
  c.oportunidades ||= [];
  return c;
}
function transition(c, next, reason, now = new Date().toISOString()) {
  if (!STATES.includes(next)) throw new Error('Estado V2 inválido');
  const previous = state(c);
  const control = ['human_takeover','postventa_humano','cerrado','no_interesado','spam','abandono'].includes(next);
  const release = reason === 'liberar' && ['human_takeover','postventa_humano'].includes(previous);
  if (previous !== next && !control && !release && !(FLOW[previous] || []).includes(next)) throw new Error('Transición V2 no permitida');
  c.estado = next;
  c.last_transition = { previous, next, rule: reason, at: now };
  return previous;
}
function cancel(c, now = new Date().toISOString()) {
  for (const target of [c, c.pedido].filter(Boolean)) {
    for (const key of ['next_followup_at','next_pickup_reminder_at','proximaVerificacionRetiro','next_action_at']) target[key] = null;
    target.followup_stage = 'closed'; target.seguimientoRetiro = false;
    target.jobs = []; target.next_actions = [];
    for (const field of ['avisoGuia','avisoLlegada','alertaPagado','alertaSinRespuesta']) if (target[field] && target[field].estado !== 'enviada') target[field].estado = 'cancelada';
  }
  c.esperandoConfirmacionPedido = false;
  c.closed_at = now;
}
function newPurchase(text) {
  const n = normalize(text);
  // A negative/conditional/quoted intention must never reopen an opportunity.
  if (/\b(no|nunca|jamas|tampoco|ni|quizas|tal vez|si quisiera|si quiero|si me interesa)\b/.test(n) || /[¿?"“”]/.test(n)) return false;
  return /\b(quiero (?:comprar|otra\b|otro\b|un nuevo|una nueva)|deseo comprar|me interesa(?:\s|$)|quiero hacer (?:un |el )?pedido|voy a comprar)\b/.test(n);
}
function postSale(text, c) {
  const n = normalize(text);
  if (/\b(garantia|devolucion|reembolso|reclamo|estafaron|estafa|danado|danada|no funciona|no enciende|configuracion|equipo anterior|compra anterior|pedido anterior|producto anterior)\b/.test(n)) return true;
  if (/\b(cargador|se dano|me llego roto|me llego mal)\b/.test(n)) return true;
  const prior = !!c.pedido?.id || c.oportunidades?.some(o => o.pedido?.id);
  return prior && (/\b(cambiar|cambia|modificar|corrige)\b/.test(n) && !!c.pedido?.guia || /\b(el que (?:compre|me vendieron)|mi compra|mi equipo|el equipo que|lo que compre)\b/.test(n));
}
function decision(c, text) {
  const n = normalize(text);
  if (ADMIN.test(n)) return { rule: 'admin_command' };
  if (c.human_takeover) return { rule: 'human_takeover' };
  if (postSale(text, c)) return { rule: 'postventa', escalate: true };
  if (/\b(no me escriban|no me escribas|no me contacten|dejen de escribirme|no quiero (?:mas )?mensajes)\b/.test(n)) return { rule: 'no_contactar', close: 'cerrado' };
  if (/\b(no (?:estoy|me encuentro) interesad[oa]|no me interesa|no quiero comprar|ya no quiero)\b/.test(n)) return { rule: 'no_interesado', close: 'no_interesado' };
  if (/\b(idiota|imbecil|mierda|puta|pendejo)\b/.test(n)) return c.pedido || /\b(compra|pedido|compre|vendieron)\b/.test(n) ? { rule: 'postventa', escalate: true } : { rule: 'spam', close: 'spam' };
  const fresh = newPurchase(text);
  if (c.no_contactar || CLOSED.has(state(c))) return fresh ? { rule: 'nueva_compra', fresh: true } : { rule: 'closed' };
  if (fresh && (c.pedido?.id || c.closed_at)) return { rule: 'nueva_compra', fresh: true };
  if (/\b(empleo|trabajo con ustedes|vacante|curriculum|proveedor|alianza|ofrezco mis servicios)\b/.test(n)) return { rule: 'unrelated' };
  if (/^(ok(?:ay)?|gracias|muchas gracias|hola|buenos dias|buenas tardes|buenas noches)[.!\s]*$/.test(n) || !/[a-z0-9]/.test(n)) return { rule: 'minimal' };
  if (c.pedido?.guia) return { rule: 'logistica', proceed: true };
  return { rule: 'comercial', proceed: true };
}
function openOpportunity(c, now = new Date().toISOString()) {
  const { oportunidades = [], ...previous } = c;
  const archived = JSON.parse(JSON.stringify(previous));
  cancel(archived, now);
  // Existing logistics belongs to the original order and keeps its schedule.
  if (previous.pedido?.guia && !previous.closed_at && !previous.no_contactar && !CLOSED.has(state(previous)) && !CLOSED.has(official(previous.pedido.estado))) {
    archived.pedido = JSON.parse(JSON.stringify(previous.pedido));
    archived.closed_at = previous.closed_at || null;
  }
  for (const key of Object.keys(c)) delete c[key];
  Object.assign(c, { oportunidades: [...oportunidades, archived], historial: [], datosCliente: {}, confirmado: false, estado: 'interesado' });
  return prepare(c, now);
}
function canSend(c) { return !!c && !c.human_takeover && !c.no_contactar && !CLOSED.has(state(c)) && !['human_takeover','postventa_humano'].includes(state(c)); }
function orderLines(data) {
  const source = Array.isArray(data?.lineas) ? data.lineas : data?.producto ? [{ id_producto: data.id_producto, producto: data.producto, capacidad: data.variante || '', color: data.color || null, cantidad: data.cantidad, precio_unitario: data.precio }] : [];
  if (!source.length) throw new Error('Pedido sin líneas');
  const lineas = source.map(row => {
    const precio = row.precio_unitario;
    if (!row.producto || typeof row.producto !== 'string' || !Number.isInteger(row.cantidad) || row.cantidad <= 0 || typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0 || Math.abs(precio * 100 - Math.round(precio * 100)) > 0.000001) throw new Error('Línea inválida');
    const cents = Math.round(precio * 100) * row.cantidad;
    if (!Number.isSafeInteger(cents)) throw new Error('Importe inválido');
    return { id_producto: row.id_producto || null, producto: row.producto, capacidad: row.capacidad || '', color: row.color || null, cantidad: row.cantidad, precio_unitario: precio, subtotal: cents / 100 };
  });
  const cents = lineas.reduce((sum, line) => sum + Math.round(line.subtotal * 100), 0);
  if (!Number.isSafeInteger(cents)) throw new Error('Total inválido');
  return { lineas, total: cents / 100, requires_human: cents > 30000 };
}
module.exports = { STATES, CLOSED, ADMIN, normalize, phone, isAdmin, official, state, prepare, transition, cancel, newPurchase, postSale, decision, openOpportunity, canSend, orderLines };
