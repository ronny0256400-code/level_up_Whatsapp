"use strict";
// Reservation survives crashes. Only a definite rejection permits automatic retry.
async function deliver({
  box,
  save,
  send,
  now = () => new Date(),
  log = () => {},
}) {
  if (
    !box ||
    (box.attempts || 0) >= 3 ||
    ["enviada", "incierta", "cancelada"].includes(box.estado)
  )
    return false;
  if (box.estado === "enviando") {
    box.estado = "incierta";
    await save();
    return false;
  }
  if (box.next && Date.parse(box.next) > now().getTime()) return false;
  box.estado = "enviando";
  box.attempts = (box.attempts || 0) + 1;
  await save();
  try {
    const result = await send();
    if (result === false) {
      box.estado = "pendiente";
      await save();
      return false;
    }
  } catch (e) {
    box.estado =
      Number(e.status) >= 400 &&
      Number(e.status) < 500 &&
      Number(e.status) !== 408
        ? "pendiente"
        : "incierta";
    box.next = new Date(now().getTime() + 60000).toISOString();
    await save();
    log({ event: "outbox_delivery", state: box.estado });
    return false;
  }
  box.estado = "enviada";
  await save();
  return true;
}
module.exports = { deliver };
