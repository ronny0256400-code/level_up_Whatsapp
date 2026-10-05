"use strict";
const { norm } = require("./v2-agencies");
function normalizeFilters(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const match = /^(ram|storage|budget)_(exact|min|max)$/.exec(key);
    if (!match) {
      result[key] = value;
      continue;
    }
    const [, field, kind] = match;
    if (kind === "exact") result[field] = value;
    else {
      if (result[field] !== undefined && typeof result[field] !== "object")
        throw Error("V4_CONFLICTING_FILTERS");
      result[field] = { ...result[field], [kind]: value };
    }
  }
  return result;
}
function createDecisionEngine({ specs, family, matching }) {
  function label(p) {
    const s = specs(p);
    return `${p.producto} · ${p.capacidad}${p.ram ? " · RAM " + p.ram : ""}${s.screen ? " · " + s.screen + " pulgadas" : ""} · $${p.precio.toFixed(2)}`;
  }
  function remember(c, items) {
    c.lastOptions = items.map((p) => ({
      sku: p.id_producto,
      label: label(p),
      price: p.precio,
      ...Object.fromEntries(
        ["cpu", "ram", "storage", "screen"].map((k) => [
          k,
          specs(p)[k] ?? null,
        ]),
      ),
    }));
    c.alternatives = items.map((p) => p.id_producto);
  }
  function decision(text, c, x) {
    const n = norm(text),
      recent = c.lastOptions || [];
    if (/catalogo/.test(n) && /mac ?book/.test(n))
      return { action: "MACBOOK_ENTRY", params: {} };
    const media =
      /fotos?|video|muestramelo|muestreme|ver el equipo|caracteristicas|enseneme|quiero verlo/.test(
        n,
      );
    if (media && (c.selectedSku || recent.length === 1))
      return {
        action: "REQUEST_PRESENTATION",
        params: { sku: c.selectedSku || recent[0].sku },
      };
    const acceptance =
      /^(si(?: por favor| me interesa)?|me interesa|quiero comprarlo|me quedo con esa|esa me interesa|quiero esa)$/.test(
        n,
      ) && !/[¿?]/.test(text);
    if (acceptance && c.selectedSku && c.presentedSku === c.selectedSku)
      return { action: "CONTINUE", params: {} };
    if (acceptance && c.step === "PRODUCT_SELECTION" && recent.length === 1)
      return { action: "SELECT_SKU", params: { sku: recent[0].sku } };
    let refs;
    const ordinal =
      /\b(?:la|el) (primera|primero|segunda|segundo|tercera|tercero|ultima|ultimo)\b/.exec(
        n,
      );
    if (ordinal && /ultim/.test(ordinal[1])) refs = recent.slice(-1);
    else if (ordinal)
      refs = recent.slice(
        {
          primera: 0,
          primero: 0,
          segunda: 1,
          segundo: 1,
          tercera: 2,
          tercero: 2,
        }[ordinal[1]],
        {
          primera: 1,
          primero: 1,
          segunda: 2,
          segundo: 2,
          tercera: 3,
          tercero: 3,
        }[ordinal[1]],
      );
    else if (recent.some((o) => norm(o.label) === n))
      refs = recent.filter((o) => norm(o.label) === n);
    else if (
      /^(?:esa|ese|me quedo con esa|esa me interesa|quiero esa)$/.test(n)
    )
      refs = c.selectedSku
        ? recent.filter((o) => o.sku === c.selectedSku)
        : recent;
    else if (
      /\b(?:la|el) (?:de |i[57])/.test(n) ||
      (/mac ?book/.test(n) && /(?:gb|ram|["”]|\b(?:160|250|320|500|750|1000)\b)/i.test(String(text)))
    ) {
      const cpu = /\bi([57])\b/.exec(n),
        ram =
          /\b(4|6|8|16) (?:gb )?(?:de )?ram\b|ram (4|6|8|16)\b/.exec(n) ||
          /\by (4|6|8|16)$/.exec(n),
        tb = /\b(\d+) (?:tera|tb)\b/.exec(n),
        gb = /\b(\d+) gb\b/.exec(n),
        bareStorage = /mac ?book.*\b(160|250|320|500|750|1000)\b/.exec(n),
        price = /\b(?:la|el)(?: i[57])? de (\d+(?:[.,]\d+)?)(?: y|$)/.exec(n),
        dollars = /\$(\d+(?:\.\d+)?)/.exec(String(text)),
        screen =
          /\b(13|15)\s*["”]/.exec(String(text)) || /\b(13|15) pulgadas/.exec(n);
      refs = recent.filter(
        (o) =>
          (!cpu || norm(o.cpu) === `i${cpu[1]}`) &&
          (!ram || o.ram === Number(ram[1] || ram[2])) &&
          (!tb ||
            o.storage === Number(tb[1]) * 1024 ||
            o.storage === Number(tb[1]) * 1000) &&
          (!gb || o.storage === Number(gb[1])) &&
          (!bareStorage || o.storage === Number(bareStorage[1])) &&
          (!price ||
            o.price === Number(price[1].replace(",", ".")) ||
            o.storage === Number(price[1])) &&
          (!dollars || o.price === Number(dollars[1])) &&
          (!screen || o.screen === Number(screen[1])),
      );
    }
    if (refs && ordinal) {
      const storage = /\bde (160|250|320|500|750|1000)\b/.exec(n),
        ram = /\b(4|6|8|16) (?:de )?ram\b/.exec(n);
      refs = refs.filter(
        (o) =>
          (!storage || o.storage === Number(storage[1])) &&
          (!ram || o.ram === Number(ram[1])),
      );
    }
    if (refs?.length === 1)
      return {
        action: media ? "REQUEST_PRESENTATION" : "SELECT_SKU",
        params: { sku: refs[0].sku },
      };
    if (refs?.length > 1)
      return {
        action: "DISAMBIGUATE",
        params: { skus: refs.map((o) => o.sku) },
      };
    if (
      ["GREETING", "POSTSALE", "CORRECTION"].includes(x.action) ||
      x.action.startsWith("ANSWER_")
    )
      return x;
    if (c.family === "macbook" || /mac ?book/.test(n)) {
      const f = normalizeFilters(x.params.filters || {});
      const cpu = /\b(?:core )?i([57])\b/.exec(n);
      if (cpu) f.cpu = `i${cpu[1]}`;
      const ram = /\b(4|6|8|16) (?:gb )?(?:de )?ram\b|ram (4|6|8|16)\b/.exec(n);
      if (ram) {
        const value = Number(ram[1] || ram[2]);
        const scope = n.slice(
          Math.max(0, ram.index - 16),
          ram.index + ram[0].length,
        );
        f.ram = /al menos|minimo/.test(scope)
          ? { min: value }
          : /maximo|hasta/.test(scope)
            ? { max: value }
            : value;
      }
      for (const capacity of n.matchAll(
        /\b(160|250|320|500|750|1000|1) (gb|tb|tera)\b/g,
      )) {
        const before = n.slice(
            Math.max(0, capacity.index - 20),
            capacity.index,
          ),
          after = n.slice(
            capacity.index + capacity[0].length,
            capacity.index + capacity[0].length + 10,
          );
        if (/ram\s*$/.test(before) || /^(?: de)? ram/.test(after)) continue;
        const value = Number(capacity[1]) * (capacity[2] === "gb" ? 1 : 1024);
        f.storage = /(?:al menos|minimo)\s*$/.test(before)
          ? { min: value }
          : /(?:maximo|hasta)\s*$/.test(before)
            ? { max: value }
            : /(?:unos|aproximad[oa]s?|alrededor de)\s*$/.test(before)
              ? { target: value }
              : value;
      }
      const budget = /(?:hasta|maximo|presupuesto de) (\d+(?:[.,]\d+)?)/.exec(
        n,
      );
      if (
        budget &&
        (/\$|dolares|presupuesto/.test(String(text).toLowerCase()) ||
          !n.slice(budget.index + budget[0].length).trim())
      )
        f.budget = { max: Number(budget[1].replace(",", ".")) };
      const screen = /\b(13|15) (?:pulgadas|pulg)\b/.exec(n);
      if (screen) f.screen = Number(screen[1]);
      if (/no tan cara|economica|mas barata|barato|barata/.test(n))
        f.price_preference = "lowest";
      if (/bastante almacenamiento|mas capacidad/.test(n))
        f.storage_preference = "highest";
      if (
        Object.keys(f).length &&
        !/\b(no quiero|sin core|reclamo|devolucion)\b/.test(n)
      )
        return {
          action: "FILTER_PRODUCTS",
          params: { family: "macbook", filters: f },
        };
    }
    if (
      x.action === "UNKNOWN_QUESTION" &&
      (c.selectedSku ||
        Object.values(c.filters).some((v) => v !== null && v !== undefined))
    )
      return c.selectedSku
        ? { action: "CONTINUE", params: {} }
        : { action: "FILTER_PRODUCTS", params: { filters: c.filters } };
    return {
      ...x,
      params: {
        ...x.params,
        ...(x.params.filters
          ? { filters: normalizeFilters(x.params.filters) }
          : {}),
      },
    };
  }
  function rank(products, criteria) {
    const { price_preference, storage_preference, ...hard } = criteria;
    const rows = products
      .filter((p) => p.stock > 0)
      .map((p) => ({ p, score: matching(p, hard) }))
      .filter((v) => v.score !== null);
    const prices = rows.map((v) => v.p.precio).sort((a, b) => a - b),
      median = prices[Math.floor(prices.length / 2)];
    rows.sort(
      (a, b) =>
        (price_preference === "lowest"
          ? a.p.precio - b.p.precio
          : price_preference === "highest"
            ? b.p.precio - a.p.precio
            : price_preference === "balanced"
              ? Math.abs(a.p.precio - median) - Math.abs(b.p.precio - median)
              : 0) ||
        (storage_preference === "highest"
          ? (specs(b.p).storage || 0) - (specs(a.p).storage || 0)
          : 0) ||
        a.score - b.score ||
        b.p.stock - a.p.stock,
    );
    return rows.map((v) => v.p);
  }
  function nearest(products, criteria) {
    const relaxed = { ...criteria };
    let changed = false;
    for (const key of ["ram", "storage"])
      if (typeof relaxed[key] === "number") {
        relaxed[key] = { min: relaxed[key] };
        changed = true;
      }
    if (!changed) return [];
    return rank(products, {
      ...relaxed,
      price_preference: criteria.price_preference || "lowest",
    }).slice(0, 3);
  }
  return { label, remember, decision, rank, nearest };
}
module.exports = { normalizeFilters, createDecisionEngine };
