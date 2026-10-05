"use strict";
const fs = require("node:fs/promises");
const {
  fresh,
  family,
  specs,
  filters,
  matching,
  MACBOOK_ENTRY,
} = require("./v4-flow");
const { createDecisionEngine, normalizeFilters } = require("./v4-decision");
const { createInterpreter } = require("./v4-interpreter");
const { norm } = require("./v2-agencies");
const { phone } = require("./sales-flow");
const { safeError } = require("./v2-errors");
function context(number) {
  return {
    ...fresh(number),
    lastBotAction: null,
    lastBotMessageType: null,
    lastBotMessage: null,
    presentedSku: null,
  };
}
function nextBestAction(c) {
  if (c.location.city && c.location.province) return "AGENCY";
  if (c.presentedSku && c.selectedSku) return "LOCATION";
  if (c.selectedSku) return "PRESENTATION";
  if (!c.family) return "CHOOSE_FAMILY";
  if (
    c.family === "macbook" &&
    !Object.values(c.filters).some((v) => v != null)
  )
    return "ASK_CRITERIA";
  return c.family === "windows" && !c.filters.brand
    ? "BRANDS_OR_RECOMMEND"
    : "CHOOSE_PRODUCT";
}
// The model selects exact excerpts, rather than being trusted to fabricate commercial facts.
function createAnswer(openai, env) {
  return async ({ text, context: c, sources }) => {
    if (!openai || !env.MODEL_LOW) return null;
    const r = await openai.responses.create(
      {
        model: env.MODEL_LOW,
        reasoning: { effort: "minimal" },
        max_output_tokens: 800,
        text: { format: { type: "json_object" } },
        instructions:
          'Contesta la pregunta seleccionando uno o dos extractos cortos EXACTOS de sources. Devuelve {"excerpts":[{"source":0,"text":"extracto literal"}]}. No inventes datos. Si las fuentes no responden, devuelve excerpts vacío. Usa el contexto conversacional.',
        input: JSON.stringify({ text, context: c, sources }),
      },
      { timeout: 30000, maxRetries: 0 },
    );
    if (r.status !== "completed" || !r.output_text) return null;
    const x = JSON.parse(r.output_text);
    if (
      !Array.isArray(x.excerpts) ||
      !x.excerpts.length ||
      x.excerpts.length > 2
    )
      return null;
    if (
      x.excerpts.some(
        (e) =>
          !Number.isInteger(e.source) ||
          typeof e.text !== "string" ||
          !e.text.trim() ||
          e.text.length > 600 ||
          !sources[e.source]?.includes(e.text),
      )
    )
      return null;
    return x.excerpts.map((e) => e.text).join("\n");
  };
}
function createFlow({
  catalog,
  resources,
  interpret,
  answer,
  store,
  sendText,
  sendMedia,
  prepare = async () => {},
  agencies,
  log = () => {},
  escalate = async () => {},
}) {
  const memory = new Map(),
    locks = new Map();
  store ||= {
    get: async (n) => structuredClone(memory.get(n)),
    set: async (n, c) => memory.set(n, structuredClone(c)),
  };
  const engine = createDecisionEngine({ specs, family, matching });
  const load = async (n) => (await store.get(n)) || context(n);
  function queued(n, fn) {
    const p = (locks.get(n) || Promise.resolve()).catch(() => {}).then(fn);
    locks.set(n, p);
    return p.finally(() => {
      if (locks.get(n) === p) locks.delete(n);
    });
  }
  async function process(raw, text, { messageId } = {}) {
    const number = phone(raw);
    if (!number || !String(text || "").trim()) return;
    return queued(number, async () => {
      const c = await load(number);
      if (c.handoff) return;
      let prepared = false,
        action = "UNKNOWN_QUESTION";
      const ready = async () => {
        if (!prepared) {
          prepared = true;
          await prepare(number, messageId);
        }
      };
      const say = async (t, type = "text") => {
        await ready();
        await sendText(number, t, c);
        c.lastBotMessage = t;
        c.lastBotMessageType = type;
        c.lastBotAction = action;
      };
      const media = async (f) => {
        await ready();
        await sendMedia(number, await fs.readFile(f.path), f.mime, c);
      };
      const direction = () =>
        nextBestAction(c) === "AGENCY"
          ? "El siguiente paso es elegir una agencia en su ciudad."
          : nextBestAction(c) === "LOCATION"
            ? "¿En qué ciudad y provincia se encuentra?"
            : c.selectedSku
              ? "¿Le gustaría continuar con este equipo?"
              : c.family === "macbook"
                ? "¿Qué procesador, RAM o presupuesto prefiere?"
                : "¿Cuál opción prefiere?";
      try {
        const n = norm(text),
          snapshot = await catalog();
        if (snapshot.stale) {
          await say(
            "No pude consultar el stock actualizado. Puede volver a intentarlo en unos instantes.",
          );
          return;
        }
        const rows = [...snapshot.available.values()].filter(
          (p) => p.stock > 0,
        );
        const active = () =>
          rows.find((p) => p.id_producto === c.selectedSku) ||
          (c.lastOptions.length === 1
            ? rows.find((p) => p.id_producto === c.lastOptions[0].sku)
            : null);
        let x;
        // Resolve references to already-shown options before spending a model call.
        // This prevents phrases such as "la última", "la de 160" or an exact
        // pasted label from losing context if the interpreter is unavailable.
        const deterministic = engine.decision(text, c, {
          action: "UNKNOWN_QUESTION",
          params: {},
        });
        if (
          ["SELECT_SKU", "DISAMBIGUATE", "REQUEST_PRESENTATION"].includes(
            deterministic.action,
          )
        )
          x = deterministic;
        if (!x) {
          try {
            x = await interpret({
              text,
              context: c,
              products: rows.filter(
                (p) => !c.family || family(p) === c.family,
              ),
            });
          } catch (e) {
            log(safeError(e, "v5.interpret"));
          }
        }
        x ||= { action: "UNKNOWN_QUESTION", params: {} };
        let p = x.params || {};
        action = x.action;
        const explicitFamily = /mac ?books?/.test(n)
          ? "macbook"
          : /ipad/.test(n)
            ? "ipad"
            : /windows|acer|asus|dell|hp|lenovo/.test(n) ||
                (/laptops?/.test(n) && (!c.family || c.family === "windows"))
              ? "windows"
              : null;
        const criteria =
          /core|\bi[57]\b|ram|almacenamiento|presupuesto|economica|barata|no tan cara|grande|tactil/.test(
            n,
          );
        const hasProductReference =
          /\d|gb|tb|ram|core|\bi[57]\b|precio|cuanto|fotos?|video|caracteristicas|pulgadas|["”]/.test(
            n,
          );
        const shouldOpenFamily =
          explicitFamily &&
          !criteria &&
          !hasProductReference &&
          (c.family !== explicitFamily ||
            (!c.selectedSku && !c.lastOptions.length && c.step === "START"));
        if (shouldOpenFamily) {
          action =
            explicitFamily === "macbook"
              ? "MACBOOK_ENTRY"
              : explicitFamily === "ipad"
                ? "IPAD_ENTRY"
                : "WINDOWS_ENTRY";
        }
        if (/^hola$|^buenas$/.test(n)) action = "GREETING";
        if (action === "GREETING") {
          await say(
            "¡Hola! 👋 Bienvenido a Level Up Store. ¿Qué equipo le gustaría conocer?",
          );
          return;
        }
        if (["WINDOWS_ENTRY", "IPAD_ENTRY", "MACBOOK_ENTRY"].includes(action)) {
          c.family =
            action === "WINDOWS_ENTRY"
              ? "windows"
              : action === "IPAD_ENTRY"
                ? "ipad"
                : "macbook";
          c.selectedSku = null;
          c.presentedSku = null;
          c.filters = context(number).filters;
          c.lastOptions = [];
          c.step = "PRODUCT_SELECTION";
          const available = rows.filter((r) => family(r) === c.family);
          if (!available.length) {
            await say(
              "Actualmente no hay unidades disponibles de esta familia.",
            );
            return;
          }
          if (c.family === "macbook") {
            await say(MACBOOK_ENTRY, "criteria");
            return;
          }
          if (c.family === "windows") {
            const brands = [...new Set(available.map((r) => specs(r).brand))]
              .filter(Boolean);
            const minPrice = Math.min(...available.map((r) => r.precio));
            await say(
              `¡Hola! 👋 Sí tenemos disponibles nuestras laptops desde $${minPrice.toFixed(2)}.\n\nActualmente contamos con:\n` +
                brands.map((b) => `💻 ${b}`).join("\n") +
                "\n\n🔥 Precio promocional hasta agotar stock.\nAdemás, por promoción del mes, los envíos son GRATIS a nivel nacional. 🚚✨\n\n¿Tiene alguna marca de preferencia o desea que le recomiende una?",
              "brands",
            );
            return;
          }
          const distinct = [
            ...new Map(
              available.map((r) => [
                `${norm(r.producto)}|${norm(r.capacidad)}`,
                r,
              ]),
            ).values(),
          ];
          engine.remember(c, distinct);
          const minPrice = Math.min(...distinct.map((r) => r.precio));
          await say(
            `¡Hola! 👋 Sí tenemos disponibles nuestras iPads desde $${minPrice.toFixed(2)}.\n\nActualmente contamos con:\n` +
              distinct
                .map((r) => `📱 ${r.producto} ${r.capacidad}`)
                .join("\n") +
              "\n\n🔥 Esta promoción es únicamente hasta agotar stock.\nAdemás, por promoción del mes, todos nuestros envíos son GRATIS a nivel nacional. 🚚✨\n\n¿Cuál modelo le interesa?",
            "options",
          );
          return;
        }
        if (explicitFamily && (!c.family || c.family !== explicitFamily)) {
          c.family = explicitFamily;
          c.filters = context(number).filters;
          c.selectedSku = null;
          c.presentedSku = null;
          c.lastOptions = [];
        }
        if (action === "SET_LOCATION") {
          if (typeof p.city === "string" && typeof p.province === "string") {
            const found = agencies?.find(p.province, p.city) || [];
            if (!found.length) {
              await say(
                "¿Puede confirmar la ciudad y provincia para buscar las agencias oficiales?",
              );
              return;
            }
            c.location = {
              ...c.location,
              city: found[0].ciudad,
              province: found[0].provincia,
            };
            c.step = "AGENCY";
            await say(
              found
                .map((a, i) => `${i + 1}. ${a.nombre}: ${a.direccion}`)
                .join("\n") + "\n¿Qué agencia prefiere?",
              "agencies",
            );
          } else await say("¿En qué ciudad y provincia se encuentra?");
          return;
        }
        if (action === "POSTSALE") {
          await escalate(number, "POSTSALE");
          c.handoff = { reason: "POSTSALE" };
          await say("Un asesor le ayudará con su solicitud de postventa.");
          return;
        }
        const mediaRequest =
            /fotos?|video|quiero verlo|muestramelo|muestreme|enseneme/.test(n),
          characteristic = /caracteristicas|sus especificaciones/.test(n),
          price = /precio|cuanto cuesta|cuanto vale|cuanto$/.test(n),
          variant = /\b(?:la|el) de (\d+)/.exec(n);
        let variantRows = [];
        if (variant)
          variantRows = rows.filter(
            (r) =>
              family(r) === c.family &&
              (specs(r).storage === Number(variant[1]) ||
                r.precio === Number(variant[1])),
          );
        if (
          (price || (variant && c.presentedSku)) &&
          (variantRows.length === 1 || (!variant && active()))
        ) {
          const item = variantRows[0] || active(),
            previous = active();
          let t = `Claro 😊 ${item.producto} ${item.capacidad} tiene un precio de $${item.precio.toFixed(2)}.`;
          if (previous && previous.id_producto !== item.id_producto) {
            const info = (r) =>
              String(r.informacion_producto ?? r.informacion ?? "");
            if (
              previous.producto === item.producto &&
              previous.ram === item.ram &&
              info(previous) === info(item)
            )
              t +=
                " Las características base se mantienen; cambia el almacenamiento y el precio.";
            else t += "\n" + info(item);
          }
          await say(t + "\n¿Desea continuar con esta opción?", "price");
          engine.remember(c, [item]);
          return;
        }
        if (characteristic && !mediaRequest && active()) {
          await say(
            (active().informacion_producto ?? active().informacion) +
              "\n" +
              direction(),
            "features",
          );
          return;
        }
        if (price) {
          const candidates = variantRows.length
            ? variantRows
            : c.lastOptions
                .map((o) => rows.find((r) => r.id_producto === o.sku))
                .filter(Boolean);
          await say(
            candidates.length
              ? candidates.map((r) => engine.label(r)).join("\n") +
                  "\n¿De qué capacidad o modelo desea el precio?"
              : "¿De qué modelo y capacidad desea el precio?",
            "price",
          );
          return;
        }
        if (/^esa misma$|^esa esta bien$/.test(n)) text = "esa me interesa";
        if (
          /^(si(?: por favor)?|esa misma|esa esta bien|esa me interesa)$/.test(
            n,
          ) &&
          c.lastOptions.length === 1 &&
          c.lastOptions[0].sku !== c.presentedSku
        ) {
          x = { action: "SELECT_SKU", params: { sku: c.lastOptions[0].sku } };
        }
        if (/^la grande$|^la tactil$/.test(n)) {
          const candidates = c.lastOptions
            .map((o) => rows.find((r) => r.id_producto === o.sku))
            .filter(Boolean);
          const chosen =
            n === "la tactil"
              ? candidates.filter((r) => specs(r).touch === true)
              : candidates.filter(
                  (r) =>
                    specs(r).screen ===
                    Math.max(...candidates.map((r) => specs(r).screen || 0)),
                );
          if (chosen.length === 1)
            x = {
              action: "SELECT_SKU",
              params: { sku: chosen[0].id_producto },
            };
        }
        // Preserve unknown specific questions for grounded answers; V4's unknown→continue shortcut is deliberately bypassed.
        let decision = engine.decision(
          text,
          c,
          x.action === "UNKNOWN_QUESTION"
            ? { action: "CONTEXT_QUESTION", params: {} }
            : x,
        );
        if (/^(si(?: por favor)?|esa misma|esa esta bien|esa me interesa)$/.test(n) && c.lastOptions.length===1 && c.lastOptions[0].sku!==c.presentedSku) decision={action:"SELECT_SKU",params:{sku:c.lastOptions[0].sku}};
        if (
          decision.action !== "CONTEXT_QUESTION" ||
          x.action !== "UNKNOWN_QUESTION"
        ) {
          action = decision.action;
          p = decision.params;
        }
        if (variantRows.length === 1 && !c.presentedSku) {
          action = "SELECT_SKU";
          p = { sku: variantRows[0].id_producto };
        }
        if (/recomiend|recomienda|escoja usted|cual me conviene/.test(n))
          action = "RECOMMEND";
        if (mediaRequest && active()) {
          action = "REQUEST_PRESENTATION";
          p = { sku: active().id_producto };
        }
        let criteriaFilters = normalizeFilters(p.filters || {});
        const brand = /\b(acer|asus|dell|hp|lenovo)\b/.exec(n);
        if (brand) {
          c.family = "windows";
          criteriaFilters.brand = brand[1].toUpperCase();
          action = "FILTER_PRODUCTS";
        }
        if (c.family === "windows" && criteria) {
          if (/economica|barata|no tan cara/.test(n))
            criteriaFilters.price_preference = "lowest";
          if (/grande/.test(n)) c.filters.screenPreference = "large";
          if (/tactil/.test(n)) criteriaFilters.touch = true;
          action = "FILTER_PRODUCTS";
        }
        if (action === "SELECT_BRAND") criteriaFilters.brand = p.brand;
        const { screenPreference, ...existing } = c.filters;
        const { screenPreference: requestedScreen, ...incoming } =
          criteriaFilters;
        c.filters = {
          ...existing,
          ...filters(incoming),
          ...(screenPreference || requestedScreen
            ? { screenPreference: requestedScreen || screenPreference }
            : {}),
        };
        let available = rows.filter((r) => family(r) === c.family);
        if (c.filters.screenPreference === "large") {
          const screens = available
            .map((r) => specs(r).screen)
            .filter(Number.isFinite);
          available = available.filter(
            (r) => screens.length && specs(r).screen === Math.max(...screens),
          );
        }
        const { screenPreference: ignored, ...hard } = c.filters;
        let items = engine.rank(available, hard);
        let nearest = false;
        if (!items.length) {
          items = engine.nearest(available, hard);
          nearest = items.length > 0;
        }
        let selected;
        if (
          ["SELECT_SKU", "REQUEST_MEDIA", "REQUEST_PRESENTATION"].includes(
            action,
          )
        )
          selected = available.find(
            (r) =>
              r.id_producto ===
              (p.sku || c.selectedSku || c.lastOptions[p.option - 1]?.sku),
          );
        if (["RECOMMEND", "FILTER_PRODUCTS", "SELECT_BRAND"].includes(action)) {
          c.step = "PRODUCT_SELECTION";
          if (!items.length) {
            await say(
              "No hay unidades disponibles con esos criterios. ¿Desea ajustar la RAM, capacidad o presupuesto?",
            );
            return;
          }
          if (
            !nearest &&
            (action === "RECOMMEND" ||
              items.length === 1 ||
              (c.filters.screenPreference === "large" &&
                hard.price_preference === "lowest"))
          )
            selected = items[0];
          else {
            engine.remember(c, items.slice(0, 3));
            await say(
              (nearest
                ? "Estas alternativas disponibles cumplen o superan la RAM y capacidad solicitadas:\n"
                : "") +
                c.lastOptions.map((o, i) => `${i + 1}. ${o.label}`).join("\n") +
                "\n¿Cuál opción prefiere?",
              "options",
            );
            return;
          }
        }
        if (
          selected &&
          !items.some((r) => r.id_producto === selected.id_producto) &&
          !c.lastOptions.some((o) => o.sku === selected.id_producto) &&
          c.selectedSku !== selected.id_producto
        )
          selected = null;
        if (selected) {
          if (
            !String(
              selected.informacion_producto ?? selected.informacion ?? "",
            ).trim()
          ) {
            await escalate(number, "OFFICIAL_FEATURES_UNAVAILABLE");
            await say("Un asesor confirmará la ficha oficial de este equipo.");
            return;
          }
          c.selectedSku = selected.id_producto;
          c.family = family(selected);
          if (
            c.presentedSku === selected.id_producto &&
            !["REQUEST_MEDIA", "REQUEST_PRESENTATION"].includes(action)
          ) {
            await say(direction());
            return;
          }
          c.step = "PRESENTATION";
          await store.set(number, c);
          const files = resources.products[selected.id_producto] || [],
            audio = resources.audios.commercial1;
          for (const photo of files.filter((f) => f.type === "image"))
            await media(photo);
          const video = files.find((f) => f.type === "video");
          if (video) await media(video);
          await say(
            selected.informacion_producto ?? selected.informacion,
            "features",
          );
          await say(`Precio: $${selected.precio.toFixed(2)}.`, "price");
          const sentCommercialAudio = !!(audio && !audio.ambiguous);
          if (sentCommercialAudio) await media(audio);
          if (
            !files.some((f) => f.type === "image") ||
            !video ||
            !audio ||
            audio.ambiguous
          )
            log({ event: "V5_PRESENTATION_RESOURCE_MISSING" });
          c.presentedSku = selected.id_producto;
          c.step =
            c.location.city && c.location.province ? "AGENCY" : "LOCATION";
          engine.remember(c, [selected]);
          // Comercial 1 already asks city/province. Only add text if that audio
          // is unavailable, avoiding a duplicated sales prompt.
          if (!sentCommercialAudio) await say(direction(), "next");
          return;
        }
        if (action === "DISAMBIGUATE") {
          engine.remember(
            c,
            available.filter((r) => p.skus.includes(r.id_producto)),
          );
          await say(
            c.lastOptions.map((o) => o.label).join("\n") +
              "\n¿Cuál modelo y capacidad prefiere?",
            "options",
          );
          return;
        }
        const policyIntent = {
          ANSWER_LOCATION: "location",
          ANSWER_WARRANTY: "warranty",
          ANSWER_SHIPPING: "shipping",
        }[action];
        const policy = resources.audios?.[policyIntent];
        if (policyIntent && policy?.text && !policy.ambiguous) {
          await say(policy.text + "\n" + direction(), "answer");
          return;
        }
        const policies = [];
        for (const a of Object.values(resources.audios || {})) {
          if (!a.ambiguous && typeof a.text === "string" && a.text.trim())
            policies.push(a.text);
        }
        const item = active();
        const sources = [
          ...(item
            ? [
                String(item.informacion_producto ?? item.informacion),
                `Precio oficial: $${item.precio.toFixed(2)}. Stock: ${item.stock}.`,
              ]
            : []),
          ...policies,
        ];
        let response;
        try {
          response = await answer?.({ text, context: c, sources });
        } catch (e) {
          log(safeError(e, "v5.answer"));
        }
        if (response) {
          await say(response + "\n" + direction(), "answer");
          return;
        }
        if (item && /informacion/.test(n)) {
          await say(
            (item.informacion_producto ?? item.informacion) +
              "\n" +
              direction(),
            "features",
          );
          return;
        }
        if (
          item &&
          (action === "UNKNOWN_QUESTION" || action.startsWith("ANSWER_")) &&
          !/^(?:quiero )?(?:informacion|catalogo)$/.test(n)
        ) {
          await escalate(number, "OFFICIAL_ANSWER_UNAVAILABLE");
          await say(
            "Un asesor le ayudará a confirmar ese dato específico.\n" +
              direction(),
          );
          return;
        }
        if (action === "CONTINUE" && c.selectedSku) {
          await say(direction());
          return;
        }
        if (c.lastOptions.length) {
          await say(
            c.lastOptions.map((o) => o.label).join("\n") +
              "\n¿Cuál opción prefiere?",
            "options",
          );
          return;
        }
        if (c.family === "windows") {
          await say(
            [...new Set(available.map((r) => specs(r).brand))]
              .filter(Boolean)
              .join("\n") +
              "\n¿Tiene alguna marca de preferencia o desea que le recomiende una?",
          );
          return;
        }
        if (c.family === "macbook") {
          await say(direction());
          return;
        }
        if (item) {
          await escalate(number, "OFFICIAL_ANSWER_UNAVAILABLE");
          await say(
            "Voy a solicitar a un asesor ese dato específico.\n" + direction(),
          );
          return;
        }
        await say("¿Le interesa una laptop Windows, una MacBook o un iPad?");
      } catch (e) {
        log(safeError(e, "v5.process"));
        await say(
          "No pude completar esa consulta. ¿Desea que intentemos nuevamente con el modelo o la capacidad que busca?",
        );
      } finally {
        log({
          event: "V5_DECISION",
          selectedSku: /^[A-Za-z0-9_-]{1,80}$/.test(c.selectedSku || "")
            ? c.selectedSku
            : null,
          action: /^[A-Z_]{1,32}$/.test(action) ? action : "UNKNOWN_QUESTION",
          family: c.family,
          step: c.step,
        });
        await store.set(number, c);
      }
    });
  }
  return {
    process,
    load,
    reset: (n, release = false) =>
      queued(n, async () => {
        const c = release ? await load(n) : context(n);
        delete c.handoff;
        await store.set(n, c);
      }),
  };
}
module.exports = {
  createFlow,
  context,
  nextBestAction,
  createAnswer,
  createInterpreter,
};
