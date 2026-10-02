"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { files } = require("./v2-product-media");
const { norm, cityPages, description } = require("./v2-agencies");
function discover(root) {
  const products = {};
  const base = path.join(root, "productos");
  if (fs.existsSync(base))
    for (const sku of fs.readdirSync(base)) {
      if (
        sku.startsWith(".") ||
        sku === "__MACOSX" ||
        !fs.lstatSync(path.join(base, sku)).isDirectory()
      )
        continue;
      products[sku] = files(base, sku);
    }
  const audios = {},
    errors = [];
  const audioRoot = path.join(root, "Audios");
  const patterns = {
    commercial1: /comercial.*1/,
    commercial2: /comercial.*2|agencias/,
    location: /ubicacion/,
    trust: /contraentrega|confianza/,
    reserve: /reserva/,
    openbox: /open box/,
    shipping: /envio|servientrega/,
    warranty: /garantia/,
    delivery: /delivery|guayaquil/,
    ipad: /incluye.*ipad|ipad.*incluye/,
    macbook: /incluye.*macbook|macbook.*incluye/,
    windowsLow: /windows.*(128|menor|hasta)/,
    windowsHigh: /windows.*(256|mayor|superior)/,
    includes: /^audio que incluye(?: m4a| mp3| ogg)?$/,
  };
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__MACOSX" || e.isSymbolicLink())
        continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mp3|ogg|m4a)$/i.test(e.name)) {
        let intent = Object.keys(patterns).find((k) =>
          patterns[k].test(norm(e.name)),
        );
        if (/windows/i.test(e.name)) {
          const high = /256|mayor|superior|(?<!<)>|más de|mas de/i.test(e.name);
          const low =
            /128|menor|hasta|<=|≤/i.test(e.name) ||
            (!high && /windows 100(?: |$)/.test(norm(e.name)));
          intent = low === high ? null : low ? "windowsLow" : "windowsHigh";
        }
        if (!intent) {
          errors.push(`UNMAPPED_AUDIO:${e.name}`);
          continue;
        }
        if (audios[intent]) {
          errors.push(`AMBIGUOUS_AUDIO:${intent}`);
          audios[intent].ambiguous = true;
          continue;
        }
        const sidecar = p.replace(/\.[^.]+$/, ".txt");
        audios[intent] = {
          path: p,
          mime: /m4a$/i.test(p)
            ? "audio/mp4"
            : /ogg$/i.test(p)
              ? "audio/ogg"
              : "audio/mpeg",
          text: fs.existsSync(sidecar)
            ? fs.readFileSync(sidecar, "utf8").trim()
            : null,
        };
      } else if (/\.(wav|mp4|opus|aac)$/i.test(e.name))
        errors.push(`UNSUPPORTED_AUDIO_FORMAT:${e.name}`);
    }
  }
  walk(audioRoot);
  if (!fs.existsSync(audioRoot)) errors.push("MISSING_AUDIO_DIRECTORY");
  const { loadMediaFacts } = require("./sales-media-facts");
  return {
    products,
    audios,
    errors,
    mediaFacts: loadMediaFacts(root, products),
  };
}
// Minimal multi-page PDF built from every parsed HTML row; no network or cropping.
function agencyPDF(candidates) {
  const pages = [];
  let lines = [];
  for (let i = 0; i < candidates.length; i++) {
    const block = [
      `${i + 1}. ${candidates[i].nombre}`,
      ...description(candidates[i]).split("\n").slice(1),
    ].flatMap((s) => s.match(/.{1,85}(?:\s|$)|.{1,85}/g) || []);
    if (lines.length + block.length + 1 > 48) {
      pages.push(lines);
      lines = [];
    }
    lines.push(...block, "");
  }
  if (lines.length) pages.push(lines);
  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const ids = [];
  for (const [pageIndex, page] of pages.entries()) {
    const id = objects.length;
    ids.push(id);
    const escaped = page.map((s) =>
      String(s)
        .replace(/[^\x20-\xff]/g, " ")
        .replace(/([\\()])/g, "\\$1"),
    );
    const city = String(candidates[0]?.ciudad || "")
      .replace(/[^\x20-\xff]/g, " ")
      .replace(/([\\()])/g, "\\$1");
    const stream = `BT /F1 12 Tf 35 817 Td (Servientrega - ${city}) Tj ET BT /F1 10 Tf 35 790 Td 15 TL ${escaped.map((s) => `(${s}) Tj T*`).join("\n")} ET BT /F1 9 Tf 35 25 Td (Pagina ${pageIndex + 1}/${pages.length}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[2] = `<< /Type /Pages /Kids [${ids.map((i) => `${i} 0 R`).join(" ")}] /Count ${ids.length} >>`;
  let result = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(result, "latin1"));
    result += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(result, "latin1");
  result += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
    .join(
      "",
    )}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result, "latin1");
}
function agencyMedia(candidates) {
  if (candidates.length > 15)
    return [{ bytes: agencyPDF(candidates), mime: "application/pdf" }];
  return cityPages(candidates).map((p) => ({
    bytes: p.bytes,
    mime: "image/png",
  }));
}
module.exports = { discover, agencyPDF, agencyMedia };
