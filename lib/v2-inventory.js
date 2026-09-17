'use strict';
const { orderLines } = require('./v2-policy');
const SALES = 'REGISTRO DE VENTAS';
const STATES = new Set(['enviado','en agencia','pagado','devuelto']);
const INPUT_COLUMNS = [...Array.from({ length: 14 }, (_, i) => i + 1), 18, 21]; // B:O, S, V (zero based)
class InventoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new InventoryError(code); };
const text = value => String(value ?? '').trim();
function parseCatalog(rows) {
  const catalog = new Map(), variants = new Set();
  for (const row of rows) {
    if (!row || row.every(value => value === '' || value == null)) continue;
    const [id, product, capacity, color, stock, price, info] = row;
    if (!text(id) || !text(product) || /[,;/]|\s+y\s+/i.test(text(color))) fail('CATALOGO_INVALIDO');
    const quantity = typeof stock === 'number' ? stock : /^\d+$/.test(text(stock)) ? Number(stock) : NaN;
    const amount = typeof price === 'number' ? price : /^\$?\d+(\.\d{1,2})?$/.test(text(price)) ? Number(text(price).replace('$','')) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) fail('CATALOGO_INVALIDO');
    const variant = JSON.stringify([text(product),text(capacity),text(color)].map(v => v.toLowerCase()));
    if (catalog.has(text(id)) || variants.has(variant)) fail('ID_PRODUCTO_DUPLICADO');
    variants.add(variant);
    catalog.set(text(id), { id_producto: text(id), codigo: text(id), producto: text(product), capacidad: text(capacity), color: text(color), stock: quantity, precio: amount, informacion: text(info), disponible: quantity > 0 });
  }
  return catalog;
}
function scarcity(stock) {
  return stock === 1 ? 'Nos queda la última unidad disponible' : stock > 1 && stock <= 5 ? 'Nos quedan muy pocas unidades disponibles' : '';
}
function catalogText(available) {
  return available.map(p => `ID-PRODUCTO: ${p.id_producto}\nPRODUCTO: ${p.producto}\nCAPACIDAD: ${p.capacidad}\nCOLOR: ${p.color}\nPRECIO: $${p.precio.toFixed(2)}\nINFORMACIÓN DEL PRODUCTO: ${p.informacion}\n${scarcity(p.stock)}`).join('\n\n');
}
function localDate(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dateSerial(date) { return Date.parse(`${date}T00:00:00Z`) / 86400000 + 25569; }
function inputs(order) {
  return Array.isArray(order?.lineas) ? order.lineas : order?.producto ? [{ id_producto: order.id_producto, cantidad: order.cantidad, precio_unitario: order.precio }] : [];
}
function resolveOrder(order, catalog, { checkPrice = false } = {}) {
  const source = inputs(order);
  if (!source.length) fail('LINEAS_INVALIDAS');
  const quantities = new Map();
  const lineas = source.map(line => {
    const id = text(line.id_producto);
    if (!id) fail('ID_PRODUCTO_REQUERIDO');
    if (!Number.isSafeInteger(line.cantidad) || line.cantidad <= 0) fail('CANTIDAD_INVALIDA');
    const item = catalog.available.get(id);
    if (!item || item.stock <= 0) fail('STOCK_INSUFICIENTE');
    quantities.set(id, (quantities.get(id) || 0) + line.cantidad);
    if (checkPrice && Math.round(Number(line.precio_unitario) * 100) !== Math.round(item.precio * 100)) fail('PRECIO_CAMBIADO');
    return { id_producto: id, producto: item.producto, capacidad: item.capacidad, color: item.color || null, cantidad: line.cantidad, precio_unitario: item.precio };
  });
  for (const [id, quantity] of quantities) if (!Number.isSafeInteger(quantity) || quantity > catalog.available.get(id).stock) fail('STOCK_INSUFICIENTE');
  return orderLines({ lineas });
}
function rowAvailable(row = []) { return INPUT_COLUMNS.every(column => row[column - 1] == null || row[column - 1] === ''); }
function consecutiveRows(rows, count, rowCount) {
  let start = 0, length = 0;
  for (let index = 0; index < rowCount - 4; index++) {
    if (rowAvailable(rows[index])) { if (!length) start = index; length++; } else length = 0;
    if (length === count) return start + 5;
  }
  fail('SIN_FILAS_DISPONIBLES');
}
function cellRequest(sheetId, row, column, value, date = false) {
  const cell = { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } };
  if (date) cell.userEnteredFormat = { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } };
  return { updateCells: { start: { sheetId, rowIndex: row - 1, columnIndex: column }, rows: [{ values: [cell] }], fields: date ? 'userEnteredValue,userEnteredFormat.numberFormat' : 'userEnteredValue' } };
}
function fingerprint(lines) { return lines.map(l => `${text(l.id_producto)}:${l.cantidad}`).sort().join('|'); }
function createInventory({ sheets, spreadsheetId, now = () => new Date() }) {
  // Shared inventory lock, rather than only per phone/order. One backend instance.
  let queue = Promise.resolve();
  function exclusive(fn) { const work = queue.catch(() => {}).then(fn); queue = work; return work; }
  async function read(range, mode = 'UNFORMATTED_VALUE') {
    return (await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: mode })).data.values || [];
  }
  async function catalog() {
    const [stockRows, masterRows] = await Promise.all([read("'PAGINA DE STOCK'!A2:G"), read('DATOS!L2:R')]);
    const master = parseCatalog(masterRows), visible = parseCatalog(stockRows);
    const available = new Map();
    for (const [id, row] of visible) {
      const source = master.get(id);
      if (!source || ['producto','capacidad','color','precio'].some(key => row[key] !== source[key])) fail('CATALOGO_INCONSISTENTE');
      if (row.stock > 0) available.set(id, row);
    }
    return { master, available };
  }
  async function sales() {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title,gridProperties.rowCount)' });
    const sheet = meta.data.sheets?.find(s => s.properties.title === SALES)?.properties;
    if (!sheet || !Number.isInteger(sheet.sheetId) || !Number.isInteger(sheet.gridProperties?.rowCount)) fail('HOJA_VENTAS_INVALIDA');
    return { sheet, rows: await read(`'${SALES}'!B5:W`, 'FORMULA') };
  }
  const matches = (rows, { orderId, guide }) => rows.flatMap((row, i) => row && ((orderId && text(row[1]) === orderId) || (!orderId && guide && text(row[3]) === guide)) ? [{ row, number: i + 5 }] : []);
  async function findSale(selector) {
    const { rows } = await sales();
    return matches(rows, selector).map(({row,number}) => ({ row: number, orderId: text(row[1]), guide: text(row[3]), state: text(row[4]) }));
  }
  async function register({ order, guide, customer, phone }) {
    return exclusive(async () => {
      if (!text(order?.id) || !text(guide)) fail('PEDIDO_INVALIDO');
      if (order.guia && order.guia !== guide) fail('GUIA_CONFLICTIVA');
      const source = inputs(order);
      if (!source.length || source.some(l => !text(l.id_producto) || !Number.isSafeInteger(l.cantidad) || l.cantidad <= 0)) fail('ID_PRODUCTO_REQUERIDO');
      const { sheet, rows } = await sales();
      const existing = matches(rows, { orderId: order.id });
      if (existing.length) {
        if (existing.some(({ row }) => text(row[3]) !== guide)) fail('GUIA_CONFLICTIVA');
        if (existing.some(({ row }) => !STATES.has(text(row[4]))) || fingerprint(existing.map(({ row }) => ({ id_producto: row[13], cantidad: Number(row[17]) }))) !== fingerprint(source)) fail('VENTA_INCONSISTENTE');
        return { repeated: true, rows: existing.map(r => r.number), date: existing[0].row[5], state: text(existing[0].row[4]) };
      }
      if (matches(rows, { guide }).length) fail('GUIA_CONFLICTIVA');
      const resolved = resolveOrder(order, await catalog(), { checkPrice: true });
      if (resolved.requires_human) fail('LIMITE_300');
      const start = consecutiveRows(rows, resolved.lineas.length, sheet.gridProperties.rowCount);
      const date = localDate(now()), serial = dateSerial(date), requests = [];
      resolved.lineas.forEach((line, index) => {
        const values = { 1: serial, 2: order.id, 3: 'CONTRAENTREGA', 4: guide, 5: 'enviado', 6: serial, 7: '', 8: customer?.nombre || '', 9: phone || customer?.telefono || '', 10: customer?.cedula || '', 11: customer?.provincia || '', 12: customer?.ciudad || '', 13: '', 14: line.id_producto, 18: line.cantidad, 21: '' };
        for (const [column, value] of Object.entries(values)) requests.push(cellRequest(sheet.sheetId, start + index, Number(column), value, ['1','6'].includes(column)));
      });
      // One atomic Sheets request. No stock/restock/formula column is ever in its field ranges.
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      return { repeated: false, rows: resolved.lineas.map((_, i) => start + i), date: serial, state: 'enviado' };
    });
  }
  async function updateState(selector, next, date = now()) {
    if (!STATES.has(next) || (!selector.orderId && !selector.guide)) fail('ESTADO_INVALIDO');
    return exclusive(async () => {
      const { sheet, rows } = await sales(), found = matches(rows, selector);
      if (!found.length) return { found: false, changed: false, rows: [] };
      if (new Set(found.map(({ row }) => text(row[1]))).size !== 1) fail('VENTA_INCONSISTENTE');
      const requests = [];
      for (const { row, number } of found) {
        if (!STATES.has(text(row[4]))) fail('ESTADO_INVALIDO');
        if (text(row[4]) !== next) requests.push(cellRequest(sheet.sheetId, number, 5, next));
        if (next === 'pagado' && (row[6] == null || row[6] === '')) requests.push(cellRequest(sheet.sheetId, number, 7, dateSerial(localDate(date)), true));
      }
      if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      return { found: true, changed: !!requests.length, rows: found.map(r => r.number) };
    });
  }
  return { catalog, register, updateState, findSale, resolve: async order => resolveOrder(order, await catalog()) };
}
module.exports = { createInventory, InventoryError, parseCatalog, resolveOrder, catalogText, scarcity, localDate, dateSerial, consecutiveRows };
