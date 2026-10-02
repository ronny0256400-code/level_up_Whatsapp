"use strict";
const { parseCatalog, validateHeaders } = require("./v2-inventory");
function createSalesCatalog(
  sheets,
  spreadsheetId,
  { now = Date.now, ttlMs = 30000, log = () => {} } = {},
) {
  let cached, refreshing;
  const clone = (value) => structuredClone(value);
  async function readOfficial() {
    const read = async (range) =>
      (
        await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
          valueRenderOption: "UNFORMATTED_VALUE",
        })
      ).data.values || [];
    const [header, rows] = await Promise.all([
      read("'PAGINA DE STOCK'!A2:H2"),
      read("'PAGINA DE STOCK'!A3:H"),
    ]);
    try {
      validateHeaders(header[0]);
    } catch {
      throw Error("INVALID_STOCK_HEADERS");
    }
    const present = rows.filter((r) =>
      r.slice(0, 8).some((v) => String(v ?? "").trim()),
    );
    const master = parseCatalog(present);
    if (master.size !== present.length)
      throw Error("INVALID_OR_DUPLICATE_STOCK_ROW");
    if ([...master.values()].some((p) => !p.informacion.trim()))
      throw Error("MISSING_PRODUCT_INFORMATION");
    return {
      fetchedAt: now(),
      stale: false,
      master,
      available: new Map([...master].filter(([, p]) => p.stock > 0)),
    };
  }
  return async ({ fresh = false } = {}) => {
    if (!fresh && cached && now() - cached.fetchedAt < ttlMs)
      return clone({ ...cached, ageMs: now() - cached.fetchedAt });
    if (!refreshing)
      refreshing = readOfficial()
        .then((value) => {
          cached = value;
          return value;
        })
        .finally(() => {
          refreshing = null;
        });
    try {
      return clone({ ...(await refreshing), ageMs: 0 });
    } catch (error) {
      log({
        event: "catalog_read_failed",
        ...require("./v2-errors").safeError(error, "catalog.read"),
      });
      if (fresh || !cached) throw error;
      return clone({ ...cached, stale: true, ageMs: now() - cached.fetchedAt });
    }
  };
}
module.exports = { createSalesCatalog };
