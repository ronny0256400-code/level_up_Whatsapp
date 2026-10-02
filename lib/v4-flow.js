"use strict";
const fs = require("node:fs");
const { norm } = require("./v2-agencies");
const { phone } = require("./sales-flow"); // Reuse only telephone normalization.
const { safeError } = require("./v2-errors");
const { validate } = require("./v4-interpreter");
const { createDecisionEngine } = require("./v4-decision");
const STEPS = [
  "START",
  "PRODUCT_SELECTION",
  "PRESENTATION",
  "LOCATION",
  "AGENCY",
  "CUSTOMER_DATA",
  "CONFIRMATION",
  "CONFIRMED",
];
const MACBOOK_ENTRY =
  "Claro 😊 Contamos con varios modelos MacBook Pro Core i5 y Core i7, con diferentes capacidades de RAM y almacenamiento. ¿Qué características está buscando aproximadamente?";
function fresh(phone) {
  return {
    phone,
    family: null,
    selectedSku: null,
    filters: {
      brand: null,
      cpu: null,
      ram: null,
      storage: null,
      screen: null,
      touch: null,
      budget: null,
      price_preference: null,
      storage_preference: null,
    },
    location: { province: null, city: null, agency: null },
    customer: { name: null, cedula: null },
    step: "START",
    alternatives: [],
    lastOptions: [],
  };
}
function family(p) {
  return /ipad/i.test(p.producto)
    ? "ipad"
    : /macbook/i.test(p.producto)
      ? "macbook"
      : /\b(acer|asus|dell|hp|lenovo)\b/i.test(p.producto)
        ? "windows"
        : null;
}
function specs(p) {
  const info = p.informacion_producto ?? p.informacion ?? "";
  const text = `${p.producto} ${info}`;
  const storage = /([\d.]+)\s*(GB|TB)/i.exec(p.capacidad || "");
  return {
    brand: /\b(acer|asus|dell|hp|lenovo)\b/i
      .exec(p.producto)?.[1]
      ?.toUpperCase(),
    cpu: /\b(i[3579]|celeron|pentium|ryzen\s*[3579])\b/i.exec(text)?.[1],
    ram:
      Number(
        /([\d.]+)\s*(?:GB)?/i.exec(p.ram || "")?.[1] ||
          /RAM\s*[:=]?\s*([\d.]+)\s*GB/i.exec(info)?.[1],
      ) || undefined,
    storage: storage
      ? Number(storage[1]) * (storage[2].toUpperCase() === "TB" ? 1024 : 1)
      : undefined,
    screen: Number(/([\d.]+)\s*(?:"|pulgadas)/i.exec(text)?.[1]) || undefined,
    touch: /(?:touch|tactil|táctil)\s*:\s*(si|sí|no)/i.test(info)
      ? !/(?:touch|tactil|táctil)\s*:\s*no/i.test(info)
      : undefined,
    budget: p.precio,
  };
}
function filters(value = {}) {
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error("V4_INVALID_FILTERS");
  const clean = {};
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(fresh("").filters, key))
      throw Error("V4_INVALID_FILTER");
    if (v === null) {
      clean[key] = null;
      continue;
    }
    if (["price_preference", "storage_preference"].includes(key)) {
      if (
        !(
          key === "price_preference"
            ? ["lowest", "balanced", "highest"]
            : ["highest"]
        ).includes(v)
      )
        throw Error("V4_INVALID_FILTER");
    } else if (["brand", "cpu"].includes(key)) {
      if (typeof v !== "string" || !v.trim() || v.length > 40)
        throw Error("V4_INVALID_FILTER");
    } else if (key === "touch") {
      if (typeof v !== "boolean") throw Error("V4_INVALID_FILTER");
    } else if (typeof v === "number") {
      if (!Number.isFinite(v) || v < 0) throw Error("V4_INVALID_FILTER");
    } else {
      if (
        !v ||
        Array.isArray(v) ||
        typeof v !== "object" ||
        !Object.keys(v).length ||
        Object.entries(v).some(
          ([k, n]) =>
            !["min", "max", "target"].includes(k) ||
            typeof n !== "number" ||
            !Number.isFinite(n) ||
            n < 0,
        ) ||
        (v.min !== undefined && v.max !== undefined && v.min > v.max)
      )
        throw Error("V4_INVALID_FILTER");
    }
    clean[key] = v;
  }
  return clean;
}
function matching(p, criteria) {
  const s = specs(p);
  let score = 0;
  for (const [key, v] of Object.entries(criteria)) {
    if (v === null || v === undefined) continue;
    const actual = s[key];
    if (actual === undefined) return null;
    if (typeof v === "object") {
      if (
        (v.min !== undefined && actual < v.min) ||
        (v.max !== undefined && actual > v.max)
      )
        return null;
      if (v.target !== undefined)
        score += Math.abs(actual - v.target) / Math.max(v.target, 1);
    } else if (typeof v === "string") {
      if (norm(actual) !== norm(v)) return null;
    } else if (actual !== v) return null;
  }
  return score;
}
function createFlow({
  catalog,
  resources,
  interpret,
  store,
  sendText,
  sendMedia,
  prepare = async () => {},
  escalate,
  log = () => {},
}) {
  const engine = createDecisionEngine({ specs, family, matching });
  const memory = new Map(),
    locks = new Map();
  store ||= {
    get: async (n) => structuredClone(memory.get(n)),
    set: async (n, c) => memory.set(n, structuredClone(c)),
  };
  async function load(number) {
    return (await store.get(number)) || fresh(number);
  }
  async function process(number, text, options = {}) {
    number = phone(number);
    if (!number || typeof text !== "string") return;
    const task = (locks.get(number) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const c = await load(number);
        if (c.handoff) return;
        let prepared = false;
        const ready = async () => {
          if (!prepared) {
            await prepare(number, options.messageId);
            prepared = true;
          }
        };
        const say = async (t) => {
          await ready();
          await sendText(number, t);
        };
        const media = async (f) => {
          await ready();
          await sendMedia(number, fs.readFileSync(f.path), f.mime);
        };
        const human = async (reason) => {
          if (escalate) await escalate({ phone: number, reason });
          else log({ event: "v4_human_required", reason });
          c.handoff = { reason };
          await store.set(number, c);
          await say(
            "Voy a solicitar ayuda de un asesor para darle información correcta.",
          );
        };
        try {
          let snapshot;
          let x = engine.decision(
            text,
            c,
            validate(await interpret({ text, context: c })),
          );
          if (
            x.action === "SELECT_SKU" &&
            !x.params.sku &&
            !Number.isInteger(x.params.option)
          ) {
            snapshot = await catalog();
            if (!snapshot.stale)
              x = validate(
                await interpret({
                  text,
                  context: c,
                  products: [...snapshot.available.values()].filter(
                    (item) => !c.family || family(item) === c.family,
                  ),
                }),
              );
          }
          if (
            x.action === "UNKNOWN_QUESTION" &&
            !x.params.interpreterFallback
          ) {
            snapshot = await catalog();
            if (!snapshot.stale)
              x = validate(
                await interpret({
                  text,
                  context: c,
                  products: [...snapshot.available.values()].filter(
                    (item) => item.id_producto === c.selectedSku,
                  ),
                  officialPolicies: Object.fromEntries(
                    Object.entries(resources.audios)
                      .filter(([, audio]) => audio.text && !audio.ambiguous)
                      .map(([key, audio]) => [key, audio.text]),
                  ),
                }),
              );
          }
          x = engine.decision(text, c, x);
          log({
            event: "v4_action",
            action: x.action,
            family: ["windows", "ipad", "macbook"].includes(c.family)
              ? c.family
              : null,
            selectedSku:
              typeof c.selectedSku === "string" &&
              /^[A-Za-z0-9][A-Za-z0-9_ ."-]{0,99}$/.test(c.selectedSku)
                ? c.selectedSku
                : null,
            step: STEPS.includes(c.step) ? c.step : "START",
          });
          const p = x.params;
          if (["GREETING", "MACBOOK_ENTRY"].includes(x.action)) {
            if (x.action === "MACBOOK_ENTRY") {
              c.selectedSku = null;
              c.filters = fresh(number).filters;
              c.alternatives = [];
              c.lastOptions = [];
              c.family = "macbook";
              c.step = "PRODUCT_SELECTION";
            }
            await say(
              x.action === "GREETING"
                ? "¡Hola! 👋 Bienvenido a Level Up Store. ¿Qué equipo le gustaría conocer?"
                : MACBOOK_ENTRY,
            );
          } else if (
            [
              "SET_LOCATION",
              "SELECT_AGENCY",
              "SET_CUSTOMER_DATA",
              "CONFIRM",
            ].includes(x.action)
          )
            await say(
              "En esta prueba podemos ayudarle a elegir y conocer un equipo. La gestión del pedido todavía requiere un asesor.",
            );
          else if (x.action === "POSTSALE") await human("POSTSALE");
          else if (
            x.action.startsWith("ANSWER_") &&
            x.action !== "ANSWER_TECHNICAL"
          ) {
            const key = {
              ANSWER_LOCATION: "location",
              ANSWER_WARRANTY: "warranty",
              ANSWER_SHIPPING: "shipping",
              ANSWER_PAYMENT: "trust",
              ANSWER_INCLUDED: ["ipad", "macbook"].includes(c.family)
                ? c.family
                : "includes",
            }[x.action];
            // Do not treat confidence audio as an official payment policy.
            if (x.action === "ANSWER_PAYMENT")
              await human("MISSING_PAYMENT_POLICY");
            else if (x.action === "ANSWER_INCLUDED" && !c.family)
              await say("¿Qué equipo desea conocer: Windows, iPad o MacBook?");
            else if (
              resources.audios[key]?.text &&
              !resources.audios[key]?.ambiguous
            )
              await say(resources.audios[key].text);
            else await human("MISSING_OFFICIAL_INFORMATION");
          } else if (x.action === "CONTINUE") {
            c.step = "LOCATION";
            await say(
              "¿En qué ciudad y provincia se encuentra para continuar con la compra?",
            );
          } else if (x.action === "UNKNOWN_QUESTION")
            await say(
              "¿Podría indicarme con un poco más de detalle qué desea conocer del equipo?",
            );
          else {
            snapshot ||= await catalog();
            if (snapshot.stale) {
              await say(
                "No pude consultar el stock actualizado. Por favor, inténtelo nuevamente en unos instantes.",
              );
              return;
            }
            if (["WINDOWS_ENTRY", "IPAD_ENTRY"].includes(x.action)) {
              c.family = x.action === "WINDOWS_ENTRY" ? "windows" : "ipad";
              c.selectedSku = null;
              c.filters = fresh(number).filters;
              c.lastOptions = [];
              c.alternatives = [];
              c.step = "PRODUCT_SELECTION";
            }
            if (x.action === "CORRECTION") {
              if (
                p.family !== undefined &&
                !["windows", "ipad", "macbook"].includes(p.family)
              )
                throw Error("V4_FAMILY_MISMATCH");
              if (p.family && p.family !== c.family) {
                c.family = p.family;
                c.filters = fresh(number).filters;
              }
              c.filters = { ...c.filters, ...filters(p.filters) };
              c.selectedSku = null;
              c.alternatives = [];
              c.lastOptions = [];
              c.step = "PRODUCT_SELECTION";
            }
            if (p.family !== undefined) {
              if (
                !["windows", "ipad", "macbook"].includes(p.family) ||
                (c.family && p.family !== c.family)
              )
                throw Error("V4_FAMILY_MISMATCH");
              c.family = p.family;
            }
            if (x.action === "SELECT_BRAND" && !p.brand) {
              await say("¿Qué marca le gustaría conocer?");
              return;
            }
            if (
              x.action === "FILTER_PRODUCTS" &&
              (!p.filters || !Object.keys(p.filters).length)
            ) {
              await say(
                "¿Qué procesador, RAM, almacenamiento o presupuesto está buscando aproximadamente?",
              );
              return;
            }
            if (x.action === "SELECT_BRAND")
              c.filters = { ...c.filters, ...filters({ brand: p.brand }) };
            if (["FILTER_PRODUCTS", "RECOMMEND"].includes(x.action)) {
              c.filters = { ...c.filters, ...filters(p.filters) };
              c.selectedSku = null;
            }
            if (
              !c.family &&
              [
                "SELECT_BRAND",
                "FILTER_PRODUCTS",
                "RECOMMEND",
                "CORRECTION",
              ].includes(x.action)
            ) {
              await say("¿Busca una laptop Windows, un iPad o una MacBook?");
              return;
            }
            const available = [...snapshot.available.values()].filter(
              (item) => !c.family || family(item) === c.family,
            );
            let items = engine.rank(available, c.filters);
            let alternative = false;
            if (!items.length) {
              items = engine.nearest(available, c.filters);
              alternative = items.length > 0;
            }
            if (x.action === "DISAMBIGUATE") {
              const options = (c.lastOptions || [])
                .filter((o) => p.skus.includes(o.sku))
                .map((o) => snapshot.available.get(o.sku))
                .filter(Boolean);
              engine.remember(c, options);
              if (!options.length)
                await say(
                  "Esas opciones ya no están disponibles. ¿Desea que busque otra con las mismas características?",
                );
              else {
                const varied = (key) =>
                  new Set(options.map((item) => specs(item)[key])).size > 1;
                const samePrice =
                  new Set(options.map((item) => item.precio)).size === 1;
                const details = options.map((item) =>
                  [
                    item.capacidad,
                    varied("screen") && specs(item).screen
                      ? "de " + specs(item).screen + " pulgadas"
                      : "",
                    varied("ram") ? "RAM " + item.ram : "",
                    varied("cpu") ? specs(item).cpu : "",
                    !samePrice ? "$" + item.precio.toFixed(2) : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                await say(
                  `Tengo ${options.length} opciones${samePrice ? " de $" + options[0].precio.toFixed(2) : ""} 😊 ${details.join("; ")}. ¿Cuál desea?`,
                );
              }
            } else if (x.action === "ANSWER_TECHNICAL") {
              const selected = snapshot.available.get(c.selectedSku);
              if (!selected)
                await say("¿De qué modelo desea conocer las características?");
              else if (!p.field)
                await say("¿Qué característica del equipo desea conocer?");
              else if (
                [
                  "specifications",
                  "ram",
                  "storage",
                  "cpu",
                  "screen",
                  "touch",
                ].includes(p.field) &&
                (p.field === "specifications" ||
                  specs(selected)[p.field] !== undefined)
              )
                await say(
                  selected.informacion_producto ?? selected.informacion,
                );
              else await human("UNVERIFIED_TECHNICAL_DETAIL");
            } else if (x.action === "WINDOWS_ENTRY") {
              const brands = [
                ...new Set(
                  items.map((item) => specs(item).brand).filter(Boolean),
                ),
              ];
              await say(
                brands.length
                  ? `Actualmente contamos con: ${brands.join(", ")}. ¿Tiene alguna marca de preferencia o desea que le recomiende una?`
                  : "Por el momento no tenemos unidades disponibles de esa categoría.",
              );
            } else {
              let selected;
              if (
                [
                  "SELECT_SKU",
                  "REQUEST_MEDIA",
                  "REQUEST_PRESENTATION",
                ].includes(x.action)
              ) {
                selected = snapshot.available.get(
                  ["REQUEST_MEDIA", "REQUEST_PRESENTATION"].includes(x.action)
                    ? p.sku || c.selectedSku
                    : Number.isInteger(p.option) &&
                        p.option >= 1 &&
                        p.option <= c.alternatives.length
                      ? c.alternatives[p.option - 1]
                      : p.sku,
                );
                if (
                  !selected ||
                  (c.family && family(selected) !== c.family) ||
                  (engine.rank([selected], c.filters).length === 0 &&
                    !(c.lastOptions || []).some(
                      (o) => o.sku === selected.id_producto,
                    ))
                ) {
                  await say(
                    "¿Cuál modelo o variante desea conocer? Puede elegir una de las opciones disponibles.",
                  );
                  return;
                }
              } else if (
                !alternative &&
                (x.action === "RECOMMEND" || items.length === 1)
              )
                selected = items[0];
              if (selected) {
                if (
                  c.presentedSku === selected.id_producto &&
                  !["REQUEST_MEDIA", "REQUEST_PRESENTATION"].includes(x.action)
                ) {
                  c.selectedSku = selected.id_producto;
                  c.step = "LOCATION";
                  await say(
                    "¿En qué ciudad y provincia se encuentra para continuar con la compra?",
                  );
                  await store.set(number, c);
                  return;
                }
                const files = resources.products[selected.id_producto] || [],
                  image = files.find((f) => f.type === "image"),
                  video = files.find((f) => f.type === "video"),
                  audio = resources.audios.commercial1;
                if (
                  !image ||
                  !video ||
                  !audio ||
                  audio.ambiguous ||
                  !String(
                    selected.informacion_producto ?? selected.informacion ?? "",
                  ).trim() ||
                  String(
                    selected.informacion_producto ?? selected.informacion,
                  ).includes(selected.id_producto)
                ) {
                  await human("MISSING_PRESENTATION_RESOURCE");
                  return;
                }
                c.selectedSku = selected.id_producto;
                c.family = family(selected);
                c.step = "PRESENTATION";
                await store.set(number, c); // Preserve selection before transport side effects.
                for (const photo of files.filter(
                  (file) => file.type === "image",
                ))
                  await media(photo);
                await media(video);
                await say(
                  selected.informacion_producto ?? selected.informacion,
                );
                await media(audio);
                c.presentedSku = selected.id_producto;
                c.step = "LOCATION";
                await store.set(number, c);
                await say(
                  "¿En qué ciudad y provincia se encuentra para continuar con la compra?",
                );
                c.step = "LOCATION";
              } else if (!items.length) {
                engine.remember(c, []);
                await say(
                  "No encontré unidades disponibles con esas características. ¿Desea ajustar algún criterio?",
                );
              } else {
                items = items.slice(0, c.family === "ipad" ? 4 : 3);
                engine.remember(c, items);
                const ramMin = c.filters.ram?.min;
                const upgrade =
                  ramMin && !items.some((item) => specs(item).ram === ramMin)
                    ? `Actualmente no tengo una de ${ramMin} GB RAM con esos criterios; sí tengo desde ${Math.min(...items.map((item) => specs(item).ram))} GB RAM, desde $${Math.min(...items.map((item) => item.precio)).toFixed(2)}.\n`
                    : "";
                await say(
                  upgrade +
                    items
                      .slice(0, c.family === "ipad" ? 4 : 3)
                      .map(
                        (item, i) =>
                          `${items.length > 1 ? i + 1 + ". " : ""}${c.family === "ipad" ? item.producto + " · " + item.capacidad : engine.label(item)}`,
                      )
                      .join("\n") +
                    (alternative
                      ? "\nNo tengo coincidencia exacta; estas opciones tienen mayor RAM o almacenamiento que lo solicitado."
                      : "") +
                    (items.length > 1
                      ? "\n¿Cuál opción prefiere?"
                      : "\n¿Le interesa esta alternativa?"),
                );
                c.step = "PRODUCT_SELECTION";
              }
            }
          }
          await store.set(number, c);
          log({
            event: "v4_context",
            family: c.family,
            selectedSku:
              typeof c.selectedSku === "string" &&
              /^[A-Za-z0-9][A-Za-z0-9_ ."-]{0,99}$/.test(c.selectedSku)
                ? c.selectedSku
                : null,
            step: c.step,
          });
        } catch (error) {
          log(safeError(error, "v4.process"));
          await say(
            "Disculpe, no pude completar esa consulta. ¿Podría indicarme el modelo o las características que busca?",
          );
        }
      });
    locks.set(number, task);
    try {
      await task;
    } finally {
      if (locks.get(number) === task) locks.delete(number);
    }
  }
  async function reset(number, release = false) {
    number = phone(number);
    if (!number) return false;
    const task = (locks.get(number) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const c = release ? await load(number) : fresh(number);
        delete c.handoff;
        await store.set(number, c);
      });
    locks.set(number, task);
    try {
      await task;
    } finally {
      if (locks.get(number) === task) locks.delete(number);
    }
    return true;
  }
  return { process, load, reset };
}
module.exports = {
  createFlow,
  fresh,
  STEPS,
  family,
  specs,
  filters,
  matching,
  MACBOOK_ENTRY,
};
