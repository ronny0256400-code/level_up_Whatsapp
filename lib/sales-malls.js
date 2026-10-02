"use strict";
const { norm } = require("./v2-agencies");
// Lista operacional aprobada. Nuevos puntos se aprueban editando esta lista.
const DELIVERY_MALLS = Object.freeze([
  "Mall del Sol",
  "San Marino Shopping",
  "Policentro",
  "CityMall",
  "Mall del Norte",
  "Riocentro Norte",
  "Riocentro Ceibos",
  "Albán Borja",
  "Riocentro El Dorado",
  "Village Plaza",
  "Riocentro Entre Ríos",
]);
function deliveryMalls(env = {}) {
  if (!env.DELIVERY_MALLS_JSON?.trim()) return [...DELIVERY_MALLS];
  const selected = JSON.parse(env.DELIVERY_MALLS_JSON);
  if (
    !Array.isArray(selected) ||
    selected.some(
      (value) =>
        typeof value !== "string" ||
        !DELIVERY_MALLS.some((mall) => norm(mall) === norm(value)),
    )
  )
    throw Error("DELIVERY_MALLS_NOT_APPROVED");
  return [
    ...new Set(
      selected.map((value) =>
        DELIVERY_MALLS.find((mall) => norm(mall) === norm(value)),
      ),
    ),
  ];
}
module.exports = { DELIVERY_MALLS, deliveryMalls };
