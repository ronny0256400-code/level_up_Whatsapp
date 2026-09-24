"use strict";
const { norm } = require("./v2-agencies");
const greeting = (text) =>
  /^(hola(?: que tal| como esta[sn]?)?|buenas(?: tardes| noches)?|buenos dias|hey|saludos)$/.test(
    norm(text),
  );
const mediaKind = (text) =>
  /\b(video|videos|funcionamiento)\b/.test(norm(text))
    ? "video"
    : /\b(foto|fotos|imagenes|imagen|como se ve)\b/.test(norm(text))
      ? "image"
      : null;
const deliveryQuestion = (text) =>
  /\b(en que tiempo|cuanto (?:tiempo )?(?:demora|tarda)|cuando (?:me )?llega|tiempo de entrega)\b/.test(
    norm(text),
  );
const preciseDelivery = (text) =>
  /\b(exact[ao]|garantiza|garantizado|sin falta|urgente|extraordinari[ao])\b/.test(
    norm(text),
  );
function capture(text, draft) {
  const lines = String(text)
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    data = {};
  const numeric = lines.findIndex((s) =>
    /^(?:c[eé]dula\s*:?\s*)?\d{6,13}$/i.test(s),
  );
  if (numeric >= 0) data.cedula = lines[numeric].replace(/\D/g, "");
  const name = lines[numeric > 0 ? numeric - 1 : 0]?.replace(
    /^(?:mi nombre es|me llamo|nombre)\s*:?\s*/i,
    "",
  );
  if (
    name &&
    (numeric > 0 || (lines.length === 1 && !draft.nombre)) &&
    /^[\p{L}]+(?:[ '-][\p{L}]+){1,5}$/u.test(name) &&
    !/\b(quiero|tiene|cuanto|tiempo|llega|ciudad|provincia|hola|gracias|equipo|correcto|confirmo|cambiar|cambia|corregir|cedula|agencia|precio|soy de)\b/.test(
      norm(name),
    )
  )
    data.nombre = name;
  return data;
}
function question(text) {
  return (
    !!mediaKind(text) ||
    deliveryQuestion(text) ||
    /[¿?]/.test(text) ||
    /\b(caracteristicas|especificaciones|incluye|precio|promocion|mas almacenamiento|mayor capacidad)\b/.test(
      norm(text),
    )
  );
}
function safeInformation(item) {
  // A mismatching storage specification in G is data inconsistency, not a license to invent a replacement.
  const capacity = norm(item.capacidad).replace(/\s/g, "");
  const declared = [
    ...String(item.informacion || "").matchAll(
      /(?:almacenamiento|capacidad)\s*:?\s*(\d+\s*(?:GB|TB))/gi,
    ),
  ];
  return declared.some((m) => norm(m[1]).replace(/\s/g, "") !== capacity)
    ? null
    : item.informacion;
}
module.exports = {
  greeting,
  mediaKind,
  deliveryQuestion,
  preciseDelivery,
  capture,
  question,
  safeInformation,
};
