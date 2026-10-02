"use strict";
const { family, includes } = require("./sales-flow");
function technicalAnswer(p, field) {
  const kind = family(p),
    info = p.informacion || "";
  const find = (regex) => {
    const m = regex.exec(info);
    return m ? m[0] : null;
  };
  const values = {
    battery: `La autonomía aproximada es de ${kind === "macbook" ? "6 a 8" : "4 a 6"} horas, según el uso.`,
    year: kind === "windows" ? "Según nuestra política comercial, 2024." : null,
    office: includes(p),
    storage: `Este SKU tiene ${p.capacidad} de almacenamiento interno. La microSD incluida en Windows es almacenamiento externo.`,
    ram: find(/(?:memoria\s+)?RAM\s*:?\s*\d+\s*GB|\d+\s*GB\s*(?:de\s*)?RAM/i),
    processor: find(
      /(?:Intel\s+)?(?:Core\s+i[3579][\w -]*|Celeron[^;\n,]*|M[1234][^;\n,]*)/i,
    ),
    size:
      find(/\d+(?:\.\d+)?\s*(?:pulgadas|["″])/i) ||
      /\d+(?:\.\d+)?\s*(?:pulgadas|["″])/i.exec(p.producto)?.[0] ||
      null,
    os: find(/(?:Windows|macOS|OS X|iPadOS|iOS|ChromeOS)[^;\n,]*/i),
    keyboard:
      kind === "macbook"
        ? "Sí, contamos con teclado iluminado según la política comercial."
        : null,
    color: `El color de este SKU es ${p.color}.`,
    software:
      "Para software exigente, la compatibilidad y el rendimiento dependen de los requisitos de la aplicación y de las características del SKU. Podemos comparar RAM, procesador y almacenamiento para elegir mayor capacidad; no garantizamos resultados absolutos.",
    usage:
      "Podemos orientar su elección para estudio, clases y trabajo comparando las características del SKU con los requisitos de sus aplicaciones, por ejemplo Zoom o herramientas de programación. ¿Qué aplicaciones necesita usar?",
  };
  if (
    [
      "hdmi",
      "bluetooth",
      "wifi",
      "camera",
      "usb",
      "headphones",
      "ports",
    ].includes(field)
  ) {
    if (kind === "ipad" && field === "hdmi")
      return "No afirmamos que los iPads tengan un puerto HDMI físico universal. La conexión depende del modelo y del adaptador compatible.";
    const labels = {
      hdmi: "un puerto HDMI",
      bluetooth: "Bluetooth",
      wifi: "Wi-Fi",
      camera: "cámara",
      usb: "USB",
      headphones: "entrada de audífonos",
      ports: "cámara, Bluetooth, Wi-Fi, HDMI, USB y entrada de audífonos",
    };
    if (kind !== "ipad")
      return field === "hdmi" && /HDMI/i.test(info)
        ? `La ficha de este SKU indica: ${find(/[^;\n.]*HDMI[^;\n.]*/i)}.`
        : `Este modelo cuenta con ${labels[field]}.`;
    const names = {
      bluetooth: /Bluetooth/i,
      wifi: /Wi[- ]?Fi/i,
      camera: /camara|cámara/i,
      usb: /USB/i,
      headphones: /audifonos|audífonos/i,
    };
    return names[field] && names[field].test(info)
      ? `La ficha de este SKU indica ${labels[field]}.`
      : null;
  }
  return field === "specifications" ? null : (values[field] ?? null);
}
module.exports = { technicalAnswer };
