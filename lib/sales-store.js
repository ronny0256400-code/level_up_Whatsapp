"use strict";
const { phone } = require("./sales-flow");
function createSalesStore(sheets, spreadsheetId) {
  let queue = Promise.resolve();
  const rows = async () =>
    (
      await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "MEMORIA!A2:ZZ",
      })
    ).data.values || [];
  return {
    async get(number) {
      const found = (await rows()).filter((r) => phone(r[0]) === number);
      if (found.length > 1) throw Error("AMBIGUOUS_MEMORY_PHONE");
      if (!found.length) return null;
      const row = found[0],
        stored = JSON.parse(row[1]);
      const c = stored.__salesChunks
        ? JSON.parse(row.slice(3, 3 + stored.__salesChunks).join(""))
        : stored;
      if (!c.lastInteraction) c.lastInteraction = row[2];
      return c;
    },
    async keys() {
      return [
        ...new Set((await rows()).map((r) => phone(r[0])).filter(Boolean)),
      ];
    },
    set(number, value, { clearAliases = false } = {}) {
      const task = queue
        .catch(() => {})
        .then(async () => {
          const all = await rows(),
            matches = all
              .map((r, i) => (phone(r[0]) === number ? i : -1))
              .filter((i) => i >= 0);
          if (matches.length > 1 && !clearAliases)
            throw Error("AMBIGUOUS_MEMORY_PHONE");
          const row = (matches[0] ?? all.length) + 2;
          const json = JSON.stringify(value),
            chunks =
              json.length > 30000 ? json.match(/[\s\S]{1,30000}/g) || [] : [];
          const values = [
            number,
            chunks.length
              ? JSON.stringify({ __salesChunks: chunks.length })
              : json,
            value.lastInteraction,
            ...chunks,
          ];
          while (values.length < (all[matches[0]]?.length || 0))
            values.push("");
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `MEMORIA!A${row}`,
            valueInputOption: "RAW",
            requestBody: { values: [values] },
          });
          for (const index of matches.slice(1))
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `MEMORIA!A${index + 2}`,
              valueInputOption: "RAW",
              requestBody: { values: [all[index].map(() => "")] },
            });
        });
      queue = task;
      return task;
    },
  };
}
module.exports = { createSalesStore };
