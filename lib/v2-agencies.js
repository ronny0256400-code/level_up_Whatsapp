"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const fields = [
  "regional",
  "provincia",
  "ciudad",
  "tipo",
  "nombre",
  "sector",
  "direccion",
  "telefono",
  "supervision",
  "entrega",
  "hora",
  "laborables",
  "finSemana",
  "email",
];
function clean(s) {
  return s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        Math.min(
          0x10ffff,
          n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
        ),
      ),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, k) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[k],
    )
    .replace(/\s+/g, " ")
    .trim();
}
function parse(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => clean(m[1]),
    );
    if (cells.length !== 14) continue;
    const a = Object.fromEntries(fields.map((f, i) => [f, cells[i]]));
    if (!a.nombre || !a.provincia || !a.ciudad || !a.direccion) continue;
    a.id = crypto
      .createHash("sha256")
      .update([a.provincia, a.ciudad, a.nombre, a.direccion].join("|"))
      .digest("hex")
      .slice(0, 20);
    rows.push(a);
  }
  return rows;
}
function distance(a, b) {
  const r = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = r[0];
    r[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = r[j];
      r[j] = Math.min(r[j] + 1, r[j - 1] + 1, prev + (a[i - 1] !== b[j - 1]));
      prev = old;
    }
  }
  return r[b.length];
}
function match(values, query) {
  const q = norm(query);
  if (!q) return [];
  const exact = values.filter((x) => norm(x) === q);
  if (exact.length) return exact;
  const contained = values.filter((x) => q.includes(norm(x)));
  if (contained.length) return contained;
  return values.filter((x) => q.length >= 5 && distance(norm(x), q) <= 1);
}
function createAgencies(root) {
  const agencies = [],
    errors = [];
  let htmlCount = 0;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.html$/i.test(entry.name)) {
        htmlCount++;
        const rows = parse(fs.readFileSync(p, "utf8"));
        if (!rows.length) errors.push("EMPTY_OR_INVALID_HTML");
        agencies.push(...rows);
      }
    }
  }
  walk(root);
  const unique = [...new Map(agencies.map((a) => [a.id, a])).values()];
  return {
    all: unique,
    stats: {
      html: htmlCount,
      provincias: new Set(unique.map((a) => norm(a.provincia))).size,
      ciudades: new Set(
        unique.map((a) => norm(a.provincia) + "/" + norm(a.ciudad)),
      ).size,
      agencias: unique.length,
      errors,
    },
    find(province, city) {
      if (!province) {
        const cs = match([...new Set(unique.map((a) => a.ciudad))], city);
        const found = unique.filter((a) => cs.includes(a.ciudad));
        return cs.length === 1 &&
          new Set(found.map((a) => norm(a.provincia))).size === 1
          ? found
          : [];
      }
      const ps = match([...new Set(unique.map((a) => a.provincia))], province);
      if (ps.length !== 1) return [];
      const subset = unique.filter((a) => a.provincia === ps[0]),
        cs = match([...new Set(subset.map((a) => a.ciudad))], city);
      return cs.length === 1 ? subset.filter((a) => a.ciudad === cs[0]) : [];
    },
    select(candidates, query) {
      let q = norm(query);
      const ordinal = {
        primera: 1,
        segunda: 2,
        tercera: 3,
        cuarta: 4,
        quinta: 5,
      };
      if (/^(?:la )?(primera|segunda|tercera|cuarta|quinta)$/.test(q))
        q = String(ordinal[q.replace(/^la /, "")]);
      if (["esa", "la anterior"].includes(q))
        return candidates.length === 1 ? candidates[0] : null;
      q = q.replace(/^la (?:de |del )/, "");
      if (/^\d+$/.test(q)) return candidates[Number(q) - 1] || null;
      const found = candidates.filter((a) =>
        [a.nombre, a.direccion, a.sector].some(
          (s) => norm(s) === q || (q.length >= 5 && norm(s).includes(q)),
        ),
      );
      return found.length === 1 ? found[0] : null;
    },
  };
}
const cards = new Map();
function description(a) {
  return `${a.nombre}\n${a.direccion}\nSector: ${a.sector}\nLunes a viernes: ${a.laborables}\nFin de semana: ${a.finSemana}`;
}
function card(a) {
  if (cards.has(a.id)) return cards.get(a.id);
  const escape = (s) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  const lines = description(a)
    .split("\n")
    .flatMap((s) => s.match(/.{1,48}(?:\s|$)|.{1,48}/g) || []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${120 + lines.length * 38}"><rect width="100%" height="100%" fill="#f0f8f3"/><text x="35" y="50" fill="#087c35" font-size="28" font-family="sans-serif">Servientrega · Retiro en oficina</text>${lines.map((s, i) => `<text x="35" y="${105 + i * 38}" fill="#15251b" font-size="24" font-family="sans-serif">${escape(s)}</text>`).join("")}</svg>`;
  const png = new (require("@resvg/resvg-js").Resvg)(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: [path.join(__dirname, "../resources/fonts/NotoSans.ttf")],
      defaultFontFamily: "Noto Sans",
      sansSerifFamily: "Noto Sans",
    },
  })
    .render()
    .asPng();
  if (cards.size >= 100) cards.delete(cards.keys().next().value);
  cards.set(a.id, png);
  return png;
}
module.exports = { createAgencies, parse, match, norm, card, description };
