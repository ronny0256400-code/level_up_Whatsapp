'use strict';
function createInboxStore(sheets, spreadsheetId) {
  const range = 'ENTRADAS_V2!A:ZZ';
  let ready;
  async function ensure() {
    if (!ready) ready = (async () => {
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      if (!(meta.data.sheets || []).some(s => s.properties.title === 'ENTRADAS_V2')) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'ENTRADAS_V2' } } }] } });
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function rows() { await ensure(); return (await sheets.spreadsheets.values.get({ spreadsheetId, range })).data.values || []; }
  return {
    async get(number) { const row = (await rows()).find(row => row[0] === number); return row ? JSON.parse(row.slice(1).join('')) : null; },
    async set(number, value) {
      const all = await rows(), index = all.findIndex(row => row[0] === number);
      const serialized = JSON.stringify(value);
      const parts = serialized.match(/[\s\S]{1,30000}/g) || ['{}'];
      // Sheets limits each cell. Clear any trailing chunks from the previous value.
      while (index >= 0 && parts.length < all[index].length - 1) parts.push('');
      const params = { spreadsheetId, valueInputOption: 'RAW', requestBody: { values: [[number, ...parts]] } };
      if (index < 0) await sheets.spreadsheets.values.append({ ...params, range, insertDataOption: 'INSERT_ROWS' });
      else await sheets.spreadsheets.values.update({ ...params, range: `ENTRADAS_V2!A${index + 1}` });
    },
    async keys() { return (await rows()).filter(row => JSON.parse(row.slice(1).join('')).pending?.length).map(row => row[0]); }
  };
}
function memorySheets() {
  const tables = new Map(), properties = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const column = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  function address(range) {
    const [name, cells = 'A1'] = range.split('!');
    const [start, end = ''] = cells.split(':');
    const first = start.match(/^([A-Z]+)(\d+)?$/), last = end.match(/^([A-Z]+)(\d+)?$/);
    if (!first) throw new Error('Rango de prueba inválido');
    return { name: name.replace(/'/g, ''), index: Number(first[2] || 1) - 1, column: column(first[1]),
      endRow: last?.[2] ? Number(last[2]) : undefined, endColumn: last ? column(last[1]) + 1 : undefined };
  }
  function ensure(name, props = {}) {
    if (!tables.has(name)) { tables.set(name, []); properties.set(name, { title: name, sheetId: properties.size, gridProperties: { rowCount: 1000 }, ...props }); }
  }
  function update({ range, requestBody }) {
    const p = address(range); ensure(p.name); const rows = tables.get(p.name);
    requestBody.values.forEach((row, i) => { rows[p.index + i] ||= []; row.forEach((value, j) => { rows[p.index + i][p.column + j] = clone(value); }); });
    return { data: {} };
  }
  return { spreadsheets: {
    get: async () => ({ data: { sheets: [...properties.values()].map(properties => ({ properties: clone(properties) })) } }),
    batchUpdate: async ({ requestBody }) => {
      // Validate the entire batch before mutating any table, mirroring Sheets semantics.
      for (const r of requestBody.requests || []) if (!r.addSheet && !r.updateCells) throw new Error('Operación de prueba no implementada');
      for (const r of requestBody.requests || []) if (r.updateCells && ![...properties.values()].some(p => p.sheetId === r.updateCells.start.sheetId)) throw new Error('Hoja de prueba inexistente');
      for (const r of requestBody.requests || []) {
        if (r.addSheet) ensure(r.addSheet.properties.title, r.addSheet.properties);
        if (r.updateCells) {
          const { start, rows } = r.updateCells;
          const name = [...properties.values()].find(p => p.sheetId === start.sheetId).title;
          const target = tables.get(name);
          rows.forEach((row, i) => { target[start.rowIndex + i] ||= []; row.values.forEach((cell, j) => {
            const value = cell.userEnteredValue;
            target[start.rowIndex + i][start.columnIndex + j] = value?.formulaValue ?? value?.numberValue ?? value?.stringValue ?? '';
          }); });
        }
      }
      return { data: {} };
    },
    values: {
      get: async ({ range }) => { const p = address(range); return { data: { values: clone((tables.get(p.name) || []).slice(p.index, p.endRow).map(row => row ? row.slice(p.column, p.endColumn) : [])) } }; },
      update: async args => update(args),
      append: async ({ range, requestBody }) => { const { name } = address(range); ensure(name); tables.get(name).push(...clone(requestBody.values)); return { data: {} }; }
    }
  } };
}
module.exports = { createInboxStore, memorySheets };
