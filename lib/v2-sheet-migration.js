"use strict";
// Read-only heuristic. A PASS does not prove arithmetic correctness; the owner
// must verify sample quantities after updating the workbook's actual formula.
function diagnoseStockFormula(rows) {
  const formulas = rows
    .flat()
    .filter((x) => typeof x === "string" && x.startsWith("="));
  const text = formulas.join("\n").toLowerCase();
  const missing = [
    "enviado",
    "en agencia",
    "retirado",
    "cancelado",
    "devuelto",
  ].filter((s) => !text.includes(s));
  return {
    compatible:
      formulas.length > 0 && !missing.length && !/"pagado"|'pagado'/.test(text),
    formulaCount: formulas.length,
    missing,
    legacyPaid: /"pagado"|'pagado'/.test(text),
    readOnly: true,
  };
}
async function diagnoseSheets(sheets, spreadsheetId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'DATOS'!P3:P",
    valueRenderOption: "FORMULA",
  });
  return diagnoseStockFormula(result.data.values || []);
}
module.exports = { diagnoseStockFormula, diagnoseSheets };
