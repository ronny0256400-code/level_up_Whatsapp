"use strict";
function canonicalPhone(value) {
  const s = String(value || "").replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(s)) return null;
  return /^09\d{8}$/.test(s) ? "593" + s.slice(1) : s;
}
function parse(text) {
  const s = String(text || "").trim();
  let m;
  if ((m = /^GUIA\s+\((CH\d{6,})\)\s+\(([A-Z0-9_-]{1,80})\)$/i.exec(s)))
    return { command: "GUIA", ref: m[1].toUpperCase(), guide: m[2] };
  if (
    (m =
      /^(LLEGO|RETIRADO|CANCELADO|LIBERAR|TOMAR|DERIVAR)\s+\(([A-Z0-9_-]{1,80})\)$/i.exec(
        s,
      ))
  ) {
    const command = m[1].toUpperCase(),
      ref = m[2];
    if (command === "LIBERAR" && !/^CH\d{6,}$/i.test(ref)) return null;
    if (command === "TOMAR" && !/^(CH\d{6,}|\d{7,15})$/i.test(ref)) return null;
    return {
      command,
      ref: /^(CH|LU)\d+$/i.test(ref) ? ref.toUpperCase() : ref,
    };
  }
  if ((m = /^RESPONDER\s+\((CH\d{6,}|\+?\d{7,15})\): ([\s\S]+)$/i.exec(s)))
    return {
      command: "RESPONDER",
      ref: /^CH/i.test(m[1]) ? m[1].toUpperCase() : canonicalPhone(m[1]),
      answer: m[2],
    };
  return null;
}
function candidates(rows, ref) {
  return rows.flatMap(({ numero, conversacion: c }) =>
    [c, ...(c.oportunidades || [])]
      .filter(
        (x) =>
          x.pedido &&
          (x.pedido.id_chat === ref ||
            x.pedido.guia === ref ||
            x.pedido.id === ref),
      )
      .map((context) => ({ numero, context })),
  );
}
module.exports = { parse, candidates, canonicalPhone };
