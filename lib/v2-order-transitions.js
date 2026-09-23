"use strict";
const { official, cancel } = require("./v2-policy");
function createTransitions({
  save,
  updateSale,
  findSale = async () => [],
  notify,
  now = () => new Date(),
}) {
  async function apply(number, c, next) {
    const p = c.pedido;
    if (!p) return false;
    const prior = official(p.estado);
    if (prior === next) return true;
    if (
      ["pagado", "sin_respuesta", "no_retirado"].includes(p.estado) ||
      p.legacy_terminal
    )
      return false;
    if (
      next === "retirado" &&
      (!p.guia ||
        !["enviado", "disponible_retiro", "cancelado"].includes(prior))
    )
      return false;
    if (
      next === "cancelado" &&
      !["confirmado", "enviado", "disponible_retiro"].includes(prior)
    )
      return false;
    if (
      next === "cancelado" &&
      !p.guia &&
      (p.guiaOperacion || (await findSale(p)).length)
    )
      return false;
    const at = p.transition_pending?.at || now().toISOString();
    p.transition_pending = { next, at };
    await save(number, c);
    if (p.guia) await updateSale(p, next, new Date(at));
    cancel(c, at);
    p.estado = next;
    c.estado = next;
    p.events ||= [];
    p.events.push({ previous: prior, next, at });
    p[next === "retirado" ? "fechaRetiro" : "fechaCancelacion"] = at;
    delete p.transition_pending;
    if (p.cierreNotice) {
      p.closureNotices ||= {};
      p.closureNotices[prior] = p.cierreNotice;
    }
    p.cierreNotice = { estado: "pendiente", orderState: next };
    await save(number, c);
    await notify(number, c);
    return true;
  }
  return {
    transitionOrderToRetired: (number, c) => apply(number, c, "retirado"),
    transitionOrderToCanceled: (number, c) => apply(number, c, "cancelado"),
    recover: (number, c) =>
      c.pedido?.transition_pending
        ? apply(number, c, c.pedido.transition_pending.next)
        : false,
  };
}
module.exports = { createTransitions };
