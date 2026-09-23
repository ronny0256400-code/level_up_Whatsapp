"use strict";
const { norm } = require("./v2-agencies");
function dispatchMessage(now) {
  const d = new Date(new Date(now).getTime() - 5 * 3600000);
  const original = d.getUTCDate(),
    day = d.getUTCDay(),
    minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (day === 0 || minutes > (day === 6 ? 660 : 1020)) {
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  }
  const today = d.getUTCDate() === original;
  const label = [
    "el domingo",
    "el lunes",
    "el martes",
    "el miércoles",
    "el jueves",
    "el viernes",
    "el sábado",
  ][d.getUTCDay()];
  return today
    ? "Ya estamos preparando su pedido para que pueda salir el día de hoy y llegue aproximadamente entre 24 y 48 horas. Su información ya fue enviada al área de bodega y están gestionando la preparación de sus equipos y su video de empaque. Apenas me lo compartan, se lo envío por este mismo chat."
    : `Su pedido ya quedó registrado. Nuestro equipo de bodega estará preparando sus equipos para que puedan salir ${label}. También estarán gestionando su video de empaque y, apenas me lo compartan, se lo envío por este mismo chat. Una vez despachado, su pedido llegará aproximadamente entre 24 y 48 horas.`;
}
function criticalAnswer(text) {
  return (
    /\d|\$|\b(cedula|telefono|codigo|guia|precio|total|confirmado|confirmo|direccion|cuenta|contraseña)\b/.test(
      norm(text),
    ) || /https?:\/\//i.test(text)
  );
}
function manualOffer(answer, draft) {
  // Only an explicit aggregate offer for a single selected SKU is safe to bind.
  if (draft?.lineas?.length !== 1) return null;
  const n = norm(answer),
    qty = /(?:compra de|por) (\d+) equipos?/.exec(n);
  const amount = /\$\s*(\d+(?:[.,]\d{1,2})?)/.exec(answer);
  if (!qty || !amount || !/ambos|total|en total|los \d+/.test(n)) return null;
  const quantity = Number(qty[1]),
    total = Number(amount[1].replace(",", "."));
  if (
    quantity !== draft.lineas[0].cantidad ||
    total <= 0 ||
    !Number.isSafeInteger(Math.round(total * 100)) ||
    Math.round(total * 100) % quantity
  )
    return null;
  return {
    source: "admin",
    id_producto: draft.lineas[0].id_producto,
    cantidad: quantity,
    total,
    catalog_price:
      draft.lineas[0].precio_catalogo ?? draft.lineas[0].precio_unitario,
  };
}
function validOffer(order, line, item) {
  const o = order.manualOffer;
  return (
    o?.source === "admin" &&
    order.lineas?.length === 1 &&
    o.id_producto === line.id_producto &&
    o.cantidad === line.cantidad &&
    o.catalog_price === item.precio &&
    o.total > 0 &&
    Number.isSafeInteger(Math.round(o.total * 100)) &&
    Math.round(o.total * 100) % o.cantidad === 0
  );
}
const warehouse =
  "Qué tal, estimado. Nuestras bodegas se encuentran en la ciudad de Guayaquil. Actualmente no recibimos clientes directamente dentro de las bodegas por seguridad. Antes del envío se gestiona el video de empaque para que pueda revisar el estado del equipo y los accesorios incluidos. Los equipos cuentan con la garantía correspondiente y el video sirve como respaldo del estado en que el producto sale de bodega.";
module.exports = {
  dispatchMessage,
  criticalAnswer,
  manualOffer,
  validOffer,
  warehouse,
};
