"use strict";
const fs = require("node:fs");
const { norm } = require("./v2-agencies");
const { safeInformation, capture } = require("./v2-commercial-input");
const { agencyMedia } = require("./sales-resources");
const { sentFacts, answerFact, digest } = require("./sales-media-facts");
const path = require("node:path");
const { safeError } = require("./v2-errors");
const MACBOOK_ENTRY =
  "Qué tal estimado/a 😊 ¿Tiene algún modelo de preferencia que haya visto o desea que le envíe nuestro catálogo completo de MacBook Pro?";
const DAY = 86400000;
function phone(value) {
  const n = String(value || "")
    .replace(/[\s()+-]/g, "")
    .replace(/^00/, "");
  return /^09\d{8}$/.test(n)
    ? "+593" + n.slice(1)
    : /^5939\d{8}$/.test(n)
      ? "+" + n
      : null;
}
function command(text) {
  const m = /^\s*\/\s*(liberar|borrar)\s+([+\d\s()-]+)\s*$/i.exec(text || "");
  return m && phone(m[2])
    ? { action: m[1].toLowerCase(), phone: phone(m[2]) }
    : null;
}
function fresh(number, time) {
  return {
    schema: 3,
    phone: number,
    stage: "PRODUCT",
    pauseState: "ACTIVE",
    qty: 1,
    prefersText: false,
    sentAudios: [],
    handledIntents: [],
    reserveIntent: false,
    createdAt: time,
    lastInteraction: time,
    history: [],
  };
}
function family(p) {
  return /ipad/i.test(p?.producto)
    ? "ipad"
    : /macbook/i.test(p?.producto)
      ? "macbook"
      : "windows";
}
// Only general entry enquiries: concrete specs, corrections and negotiations stay semantic.
function initialProductQuery(text, context) {
  if (context.sku) return null;
  const value = norm(text)
    .replace(/^l (?=estoy interesad[oa] en\b)/, "")
    .replace(/^(hola|buenos dias|buenas tardes|buenas noches|buenas)\s*/, "");
  const macTopic =
    "(?:(?:la|las|el|los|un|una|unas|unos) )?(?:mac ?books?|laptop apple|computadora apple)";
  const macExpressions = [
    `^${macTopic}$`,
    `^(?:quiero|quisiera|deseo|me gustaria) (?:ver|conocer) ${macTopic}$`,
    `^(?:(?:quiero|quisiera|deseo|me gustaria) )?(?:mas )?(?:informacion|saber|conocer) (?:sobre|de|acerca de) ${macTopic}$`,
    `^(?:estoy interesado|estoy interesada|me interesa|me interesan) (?:en )?${macTopic}(?: y (?:quisiera|quiero|deseo) (?:mas )?informacion)?$`,
    `^que ${macTopic} tienen(?: disponibles)?$`,
  ];
  if (macExpressions.some((expression) => new RegExp(expression).test(value)))
    return { family: "macbook", initialMacbook: true };
  if (context.stage !== "PRODUCT") return null;
  if (/^(?:las? |los? )?(?:windows|laptops?|portatiles?|ipads?)$/.test(value))
    return { family: /ipad/.test(value) ? "ipad" : "windows" };
  const topic =
    "(?:(?:la|las|el|los|un|una|unas|unos) )?(laptops?|portatiles?|windows|ipads?|mac ?books?)";
  const extra = "(?: y (?:quisiera|quiero|deseo) (?:mas )?informacion)?";
  const expressions = [
    `^(?:quiero|quisiera|deseo|me gustaria) (?:mas )?(?:informacion|saber|conocer) (?:sobre|de|acerca de) ${topic}${extra}$`,
    `^(?:estoy interesado|estoy interesada|me interesa|me interesan) (?:en )?${topic}${extra}$`,
    `^que ${topic} tienen(?: disponibles)?$`,
  ];
  for (const expression of expressions) {
    const match = new RegExp(expression).exec(value);
    if (match)
      return {
        family: /ipad/.test(match[1])
          ? "ipad"
          : /mac/.test(match[1])
            ? "macbook"
            : "windows",
      };
  }
  return null;
}
function brand(p) {
  return (
    /\b(Dell|HP|Lenovo|Asus|Acer|Toshiba|Samsung|Microsoft|Huawei|MSI|LG)\b/i.exec(
      p.producto,
    )?.[1] || p.producto
  );
}
function dispatch(now) {
  const d = new Date(now.getTime() - 5 * 3600000),
    day = d.getUTCDay(),
    hour = d.getUTCHours();
  const today = day !== 0 && hour < (day === 6 ? 11 : 17);
  if (!today) {
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() === 0);
  }
  return { today, date: d.toISOString().slice(0, 10) };
}
function deliveryWindow(now) {
  const d = new Date(now.getTime() - 5 * 3600000);
  if (
    d.getUTCDay() > 0 &&
    d.getUTCDay() < 6 &&
    d.getUTCHours() >= 10 &&
    d.getUTCHours() < 18
  )
    return { today: true, date: d.toISOString().slice(0, 10) };
  if (d.getUTCDay() > 0 && d.getUTCDay() < 6 && d.getUTCHours() < 10)
    return { today: true, date: d.toISOString().slice(0, 10) };
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while ([0, 6].includes(d.getUTCDay()));
  return { today: false, date: d.toISOString().slice(0, 10) };
}
const policies = {
  warranty:
    "La garantía es de 6 meses y cubre fallas propias del equipo o de funcionamiento/sistema cuando corresponda. Si aplica, se cambia por un equipo igual o equivalente. No cubre golpes posteriores, caídas, humedad, mal uso, pérdida, robo ni expectativas estéticas. Daños de transporte que afecten el funcionamiento se atienden; marcas leves sin efecto funcional no generan cambio automático.",
  reserve:
    "La reserva es de $20 por transferencia, válida 14 días y no reembolsable. Se descuenta del precio final y cubre almacenamiento/mantenimiento. Debe coordinar el envío dentro de 14 días; un segundo envío por no retirar puede generar costo. Después de confirmar, el humano proporciona los datos bancarios y verifica el pago.",
  shipping:
    "Envío GRATIS a nivel nacional por Servientrega. La llegada estimada es de 24–48 horas después del despacho y depende del operador logístico; no garantizamos una hora exacta.",
  trust:
    "Autorizamos la apertura y revisión del paquete, pero cada agencia Servientrega puede tener políticas operativas distintas. Antes del envío, logística humana prepara videos de funcionamiento y de empaque, accesorios y guía. La guía es única y permite comprobar el paquete mostrado.",
  delivery:
    "En Guayaquil tenemos delivery en puntos/malls habilitados, de lunes a viernes de 10:00 a 18:00. Puede revisar y probar antes de pagar en efectivo o transferencia. También puede elegir contraentrega en Servientrega.",
  invoice:
    "Si desea factura, se agrega 15% por IVA; sin factura se mantiene el precio mostrado.",
  stock:
    "Aún existen unidades disponibles. El sistema comercial trabaja principalmente con disponibilidad.",
};
function includes(p) {
  const f = family(p);
  return f === "ipad"
    ? "Incluye cargador, audífonos y 6 meses de garantía."
    : f === "macbook"
      ? "Incluye cargador original, audífonos de obsequio, Office instalado y activado, y 6 meses de garantía."
      : `Incluye cargador original, audífonos, Office instalado y activado, obsequio sorpresa y microSD de ${p.precio <= 100 ? 128 : 256} GB de almacenamiento externo. Todos tienen 6 meses de garantía. El obsequio sorpresa se conoce al recibir el equipo.`;
}
function characteristics(p) {
  return `${p.producto}\nSKU: ${p.id_producto}\n${p.capacidad}\nColor: ${p.color}\n${p.informacion}\nPrecio: $${p.precio.toFixed(2)}${p.stock === 1 ? "\n🔥 ÚLTIMA UNIDAD DISPONIBLE" : ""}`;
}
function summary(c, p) {
  const subtotal = Math.round(p.precio * 100) * c.qty,
    total = Math.round(subtotal * (c.invoice ? 1.15 : 1)) / 100;
  return `📋 Resumen del pedido\nNombre: ${c.name}\nCédula: ${c.cedula}\nTeléfono: ${c.phone}\nCiudad: ${c.city}${c.province ? "\nProvincia: " + c.province : ""}\n${c.delivery === "delivery" ? "Mall" : "Agencia"}: ${c.destination.nombre}\nProducto: ${p.producto}\nSKU: ${p.id_producto}\nVariante: ${p.capacidad} · ${p.color}\nCantidad: ${c.qty}\nPrecio unitario: $${p.precio.toFixed(2)}${c.invoice ? "\nIVA: 15%" : ""}\nTotal: $${total.toFixed(2)}\nEnvío gratis${c.reserveIntent ? "\nReserva: $20; vigencia 14 días; no reembolsable, descontada del total." : ""}\n¿Los datos están correctos y desea que procedamos ${c.reserveIntent ? "con la reserva" : "con el envío"}?`;
}
function createSalesFlow({
  store,
  catalog,
  agencies,
  resources,
  interpret,
  sendText,
  sendMedia,
  prepare = async () => {},
  now = () => new Date(),
  businessName = "Level Up Store",
  malls = [],
}) {
  const locks = new Map();
  function exclusive(key, fn) {
    const task = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, task);
    return task.finally(() => {
      if (locks.get(key) === task) locks.delete(key);
    });
  }
  const save = (c) => store.set(c.phone, c);
  const pause = async (c, state, reason) => {
    c.pauseState = state;
    c.pauseReason = reason;
    c.pausedAt = now().toISOString();
    await save(c);
  };
  async function load(number) {
    let c = await store.get(number);
    const time = now().toISOString();
    if (
      c &&
      Date.parse(
        c.lastInteraction ||
          c.ultimaInteraccion ||
          c.updated_at ||
          c.fechaUltimoMensaje ||
          "",
      ) <=
        now().getTime() - 30 * DAY
    )
      c = null;
    if (!c) return fresh(number, time);
    if (c.schema !== 3) {
      const draft = c.borradorPedido || c.datosCliente || {},
        line = draft.lineas?.[0] || c.pedido?.lineas?.[0] || draft;
      return {
        ...fresh(number, time),
        name: draft.nombre,
        cedula: draft.cedula,
        city: draft.ciudad,
        province: draft.provincia,
        sku: line.id_producto,
        qty: line.cantidad || 1,
        reserveIntent: !!c.reserveIntent,
        prefersText: !!c.prefersText,
        pauseState: "PAUSED_ESCALATION",
        pauseReason: "LEGACY_CONTEXT_REQUIRES_REVIEW",
        legacyContext: c,
      };
    }
    return c;
  }
  async function purge() {
    const purged = [];
    for (const number of await store.keys())
      await exclusive(number, async () => {
        const c = await store.get(number);
        if (
          c &&
          Date.parse(c.lastInteraction || c.updated_at || "") <=
            now().getTime() - 30 * DAY
        ) {
          await store.set(number, fresh(number, now().toISOString()));
          purged.push(number);
        }
      });
    return purged;
  }
  async function admin(text) {
    const cmd = command(text);
    if (!cmd) return false;
    await exclusive(cmd.phone, async () => {
      let c =
        cmd.action === "borrar"
          ? fresh(cmd.phone, now().toISOString())
          : await load(cmd.phone);
      c.pauseState = "ACTIVE";
      delete c.pauseReason;
      delete c.finalizing;
      c.lastInteraction = now().toISOString();
      if (cmd.action === "borrar")
        await store.set(c.phone, c, { clearAliases: true });
      else await save(c);
    });
    return true;
  }
  async function process(number, text, options = {}) {
    number = phone(number);
    if (!number) return;
    return exclusive(number, async () => {
      const c = await load(number);
      if (c.pauseState !== "ACTIVE") return;
      if (c.finalizing) {
        await pause(c, "PAUSED_ESCALATION", "CONFIRMATION_DELIVERY_UNCERTAIN");
        return;
      }
      c.lastInteraction = now().toISOString();
      c.provider = options.provider || c.provider || "ycloud";
      await save(c);
      const n = norm(text);
      // Claim guard precedes interpretation, inventory and all replies.
      if (
        /\b(reclamo|devolucion|me llego roto|equipo que compre|compra anterior|quiero aplicar la garantia)\b/.test(
          n,
        ) ||
        (/\b(no funciona|dejo de funcionar|se apaga)\b/.test(n) &&
          (c.confirmedAt ||
            /\b(mi equipo|mi laptop|mi ipad|mi macbook|ya compre|lo compre)\b/.test(
              n,
            )) &&
          !/\b(si|en caso|que pasa)\b/.test(n))
      ) {
        await pause(c, "PAUSED_CLAIM", "POSTSALE_CLAIM");
        return;
      }
      let prepared = options.replyPrepared === true;
      const say = async (t) => {
        if (c.pauseState !== "ACTIVE") return;
        if (!prepared) {
          await prepare(number, options.messageId, c);
          prepared = true;
        }
        const ok = await sendText(number, t, c);
        if (ok === false) throw Error("SEND_BLOCKED");
        c.history.push({ role: "assistant", content: t });
      };
      const media = async (bytes, mime) => {
        if (!prepared) {
          await prepare(number, options.messageId, c);
          prepared = true;
        }
        if ((await sendMedia(number, bytes, mime, c)) === false)
          throw Error("MEDIA_BLOCKED");
      };
      if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches)$/.test(n)) {
        c.history.push({ role: "user", content: String(text).slice(0, 4000) });
        await say(
          `¡Hola! 👋 Bienvenido a ${businessName}. ¿Qué equipo le gustaría conocer?`,
        );
        await save(c);
        return;
      }
      const initialQuery = initialProductQuery(text, c);
      if (initialQuery?.initialMacbook) {
        c.family = "macbook";
        c.stage = "PRODUCT";
        c.history.push({ role: "user", content: String(text).slice(0, 4000) });
        c.history = c.history.slice(-16);
        await save(c);
        await say(MACBOOK_ENTRY);
        await save(c);
        return;
      }
      const generalRecommendation =
        /^(recomiendame una|recomiendeme una|cual me recomienda|que me recomienda|escoja usted|cual me conviene|cual escogeria)$/.test(
          n,
        );
      const stockQuery =
        generalRecommendation &&
        ["windows", "ipad", "macbook"].includes(c.family)
          ? { recommend: true }
          : null;
      const catalogRequest =
        /^(?:(?:quiero|quisiera|deseo) (?:ver )?|(?:envieme|mandeme|muestrame|muestreme) )?(?:el |su |nuestro )?catalogo(?: completo)?(?: de (?:windows|laptops?|ipads?|mac ?books?))?$/.test(
          n,
        );
      let snapshot, x;
      try {
        snapshot = await catalog({ fresh: c.stage === "CONFIRMATION" });
        if (snapshot.stale) {
          await say(
            "No pude cargar el catálogo disponible en este momento. Por favor, vuelva a solicitarlo en unos instantes.",
          );
          await save(c);
          return;
        }
        const explicitSKU = [...snapshot.master.keys()].filter((sku) =>
          new RegExp(
            `^(?:(?:quiero|elijo|escojo|me interesa|quiero ver) (?:el |la )?)?${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i",
          ).test(String(text).trim()),
        );
        const direct = catalogRequest
          ? {
              catalog: true,
              family: /ipad/.test(n)
                ? "ipad"
                : /mac ?book/.test(n)
                  ? "macbook"
                  : /windows|laptop/.test(n)
                    ? "windows"
                    : c.family,
            }
          : explicitSKU.length === 1
            ? { sku: explicitSKU[0] }
            : null;
        if (direct?.catalog) {
          const items = [...snapshot.available.values()].filter(
            (p) => !direct.family || family(p) === direct.family,
          );
          if (!c.sku) c.family = direct.family;
          c.history.push({
            role: "user",
            content: String(text).slice(0, 4000),
          });
          if (!items.length)
            await say(
              "Por el momento no tenemos unidades disponibles de esa categoría.",
            );
          else
            await say(
              `${direct.family === "ipad" ? "¡Hola! 👋 Sí tenemos disponibles nuestras iPads para estudio y trabajo desde $" + Math.min(...items.map((p) => p.precio)).toFixed(2) : "Catálogo disponible"}\n${items.map((p) => `${p.producto} · ${p.capacidad} · ${p.color} · SKU ${p.id_producto} · $${p.precio.toFixed(2)}`).join("\n")}\n🔥 Promoción hasta agotar stock. Envíos GRATIS a nivel nacional. ¿Cuál modelo le gustaría conocer?`,
            );
          await save(c);
          return;
        }
        x =
          stockQuery ||
          direct ||
          initialQuery ||
          (await interpret({
            text,
            context: c,
            mediaFacts: sentFacts(resources, c).map((f) => ({
              type: f.type,
              shows: f.shows,
              visibleDetails: f.visibleDetails,
              canAnswer: f.canAnswer,
              notVisible: f.notVisible,
            })),
            products: [...snapshot.available.values()].map((p) => ({
              sku: p.id_producto,
              product: p.producto,
              variant: p.capacidad,
              color: p.color,
              info: p.informacion,
            })),
            cities: [...new Set(agencies.all.map((a) => a.ciudad))],
          }));
      } catch (err) {
        console.warn(
          "Commercial source or interpreter failed",
          safeError(err, "sales.resolve"),
        );
        if (
          initialQuery ||
          catalogRequest ||
          stockQuery ||
          c.stage === "CONFIRMATION"
        ) {
          console.warn("Initial catalog unavailable");
          await say(
            "No pude cargar el catálogo disponible en este momento. Por favor, vuelva a solicitarlo en unos instantes.",
          );
          await save(c);
          return;
        }
        await pause(
          c,
          "PAUSED_ESCALATION",
          "SOURCE_OR_INTERPRETER_UNAVAILABLE",
        );
        return;
      }
      if (!x || typeof x !== "object") {
        await pause(c, "PAUSED_ESCALATION", "INVALID_INTERPRETATION");
        return;
      }
      if (x.claim) {
        await pause(c, "PAUSED_CLAIM", "POSTSALE_CLAIM");
        return;
      }
      c.history.push({ role: "user", content: String(text).slice(0, 4000) });
      c.history = c.history.slice(-16);
      const audio = async (intent, fallback, force = false) => {
        const a = resources.audios[intent];
        if (a?.ambiguous) {
          await pause(c, "PAUSED_ESCALATION", "AMBIGUOUS_OFFICIAL_AUDIO");
          return;
        }
        if (c.prefersText || (!force && c.sentAudios.includes(intent))) {
          if (a && !a.text) {
            await pause(c, "PAUSED_ESCALATION", "MISSING_OFFICIAL_TRANSCRIPT");
            return;
          }
          await say(
            a?.text ||
              fallback ||
              "Esta información oficial requiere revisión humana.",
          );
        } else if (a) {
          await media(fs.readFileSync(a.path), a.mime);
          c.sentAudios.push(intent);
        } else if (fallback) await say(fallback);
        else
          await pause(
            c,
            "PAUSED_ESCALATION",
            `MISSING_OFFICIAL_AUDIO:${intent}`,
          );
        c.handledIntents = [...new Set([...c.handledIntents, intent])];
        await save(c);
      };
      if (x.prefersText || /no.*audios|no puedo escuchar|escribame/.test(n))
        c.prefersText = true;
      if (x.reserve || /\breserv/.test(n)) c.reserveIntent = true;
      const data = x.data || {};
      const oldSKU = c.sku;
      let changed = false;
      for (const [field, value] of Object.entries({
        name: data.name || capture(text, { nombre: c.name }).nombre,
        cedula: data.cedula || (/(?:cedula\s*:?\s*)(\d{10})/i.exec(n) || [])[1],
        city: data.city,
        province: data.province,
      })) {
        if (
          typeof value === "string" &&
          value.trim() &&
          (field === "city" || field === "province"
            ? norm(c[field]) !== norm(value)
            : c[field] !== value.trim())
        ) {
          c[field] = value.trim();
          changed = true;
          if (field === "city" || field === "province") {
            delete c.destination;
            delete c.agencyCandidates;
            c.locationPresented = false;
            c.delivery = null;
          }
        }
      }
      if (
        Number.isSafeInteger(data.qty) &&
        data.qty > 0 &&
        data.qty !== c.qty
      ) {
        c.qty = data.qty;
        changed = true;
      }
      if (typeof data.invoice === "boolean" && data.invoice !== c.invoice) {
        c.invoice = data.invoice;
        changed = true;
      }
      if (x.family && ["ipad", "windows", "macbook"].includes(x.family))
        c.family = x.family;
      const recommendationIntent = [
        "recommendation",
        "recommend",
        "recomendacion",
      ].includes(norm(x.intent));
      const recommend =
        generalRecommendation || x.recommend || recommendationIntent;
      if (x.sku && !recommend) {
        if (!snapshot.available.has(x.sku)) {
          await pause(c, "PAUSED_ESCALATION", "SKU_UNAVAILABLE_OR_UNKNOWN");
          return;
        }
        if (c.sku !== x.sku) {
          c.sku = x.sku;
          c.stage = "PRESENTATION";
          c.presentation = null;
          changed = true;
        }
      }
      if (recommend) {
        const eligible = [...snapshot.available.values()].filter(
          (p) =>
            (!c.family || family(p) === c.family) &&
            (generalRecommendation ||
              !x.compatibleSkus ||
              x.compatibleSkus.includes(p.id_producto)),
        );
        eligible.sort((a, b) => b.stock - a.stock);
        if (eligible.length) {
          if (c.sku !== eligible[0].id_producto) c.presentation = null;
          c.sku = eligible[0].id_producto;
          c.stage = "PRESENTATION";
        } else {
          c.sku = null;
          c.presentation = null;
          delete c.product;
          delete c.variant;
          delete c.unitPrice;
        }
      }
      if (!c.sku && !x.sku && !x.catalog && !initialQuery) {
        const matched = [...snapshot.available.values()].filter((p) =>
          n.includes(norm(p.id_producto)),
        );
        if (matched.length === 1) {
          c.sku = matched[0].id_producto;
          c.stage = "PRESENTATION";
        }
      }
      const p = c.sku ? snapshot.available.get(c.sku) : null;
      if (c.sku && (!p || p.stock < c.qty || safeInformation(p) === null)) {
        await pause(
          c,
          "PAUSED_ESCALATION",
          "STOCK_OR_SPECIFICATION_CONTRADICTION",
        );
        return;
      }
      if (p) {
        c.family = family(p);
        c.product = p.producto;
        c.variant = p.capacidad + " · " + p.color;
        c.unitPrice = p.precio;
      }
      await save(c); // Persist mixed-message data before any response or media side effect.
      if (x.negotiation || c.negotiation) {
        c.negotiation = true;
        c.negotiationLines = data.lines || c.negotiationLines;
        await save(c);
        if (c.negotiationLines?.length) {
          const valid = c.negotiationLines.every(
            (l) =>
              snapshot.available.has(l.sku) &&
              Number.isSafeInteger(l.qty) &&
              l.qty > 0,
          );
          if (valid) {
            await pause(c, "PAUSED_ESCALATION", "NEGOTIATION");
            return;
          }
        }
        if (p && data.qty && data.sameProducts !== undefined) {
          await pause(c, "PAUSED_ESCALATION", "NEGOTIATION");
          return;
        }
        await say(
          "Indíqueme los productos/modelos, variantes y cantidades, y si son iguales o variados.",
        );
        await save(c);
        return;
      }
      if (x.discount) {
        if (c.qty > 1) {
          c.negotiation = true;
          await say(
            "¿Las unidades son iguales o desea productos variados? Indíqueme los modelos, variantes y cantidades.",
          );
          await save(c);
          return;
        }
        await say("Los precios publicados son los oficiales del stock.");
      }
      if (x.specificMedia) {
        const fact = answerFact(resources, c, x.specificMedia);
        if (c.presentation?.done && fact)
          await say(
            `Puede observar ese detalle en ${fact?.type === "image" ? "la foto" : "el video"} que le envié.`,
          );
        else {
          await pause(c, "PAUSED_ESCALATION", "SPECIFIC_MEDIA_UNAVAILABLE");
          return;
        }
        await save(c);
        return;
      }
      if (x.compareSkus?.length) {
        const items = x.compareSkus.map((s) => snapshot.available.get(s));
        if (items.some((p) => !p)) {
          await pause(c, "PAUSED_ESCALATION", "COMPARISON_SKU_UNAVAILABLE");
          return;
        }
        await say(items.map(characteristics).join("\n\n"));
        await save(c);
        return;
      }
      if (x.mediaRequest && c.presentation?.done) {
        await say(
          `Puede revisar ${x.mediaRequest === "video" ? "el video" : "la foto"} que le envié de este SKU.`,
        );
        await save(c);
        return;
      }
      const intent = recommendationIntent ? null : x.intent;
      if (["includes", "technical"].includes(intent) && !p) {
        await say(
          "Para darle información exacta, ¿qué modelo o SKU desea conocer?",
        );
        await save(c);
        return;
      }
      if (intent) {
        let fallback = policies[intent],
          key = intent;
        if (intent === "includes" && p) {
          fallback = includes(p);
          key =
            family(p) === "windows"
              ? p.precio <= 100
                ? "windowsLow"
                : "windowsHigh"
              : family(p);
        }
        if (intent === "technical" && p) {
          fallback =
            x.technicalField === "specifications"
              ? characteristics(p)
              : require("./sales-technical").technicalAnswer(
                  p,
                  x.technicalField,
                );
          key = "technical";
        }
        if (["invoice", "stock", "technical"].includes(key)) {
          if (fallback) await say(fallback);
          else
            await pause(
              c,
              "PAUSED_ESCALATION",
              "UNCONFIGURED_TECHNICAL_POLICY",
            );
        } else await audio(key, fallback);
        if (c.pauseState !== "ACTIVE") return;
      }
      if (c.reserveIntent && !c.handledIntents.includes("reserve"))
        await audio("reserve", policies.reserve);
      if (c.pauseState !== "ACTIVE") return;
      if (!p) {
        const items = [...snapshot.available.values()].filter(
          (p) => !c.family || family(p) === c.family,
        );
        if (!items.length) {
          await say(
            "Por el momento no tenemos unidades disponibles de esa categoría.",
          );
        } else if (x.catalog || c.family === "ipad")
          await say(
            `${c.family === "ipad" ? "¡Hola! 👋 Sí tenemos disponibles nuestras iPads para estudio y trabajo desde $" + Math.min(...items.map((p) => p.precio)).toFixed(2) : "Catálogo disponible"}\n${items.map((p) => `${p.producto} · ${p.capacidad} · ${p.color} · SKU ${p.id_producto} · $${p.precio.toFixed(2)}`).join("\n")}\n🔥 Promoción hasta agotar stock. Envíos GRATIS a nivel nacional. ¿Cuál modelo le gustaría conocer?`,
          );
        else if (c.family === "windows")
          await say(
            `¡Hola! 👋 Sí tenemos disponibles nuestras laptops desde $${Math.min(...items.map((p) => p.precio)).toFixed(2)}.\nActualmente contamos con:\n💻 ${[...new Set(items.map((p) => brand(p)))].join(", ")}\n🔥 Precio promocional hasta agotar stock. Por promoción del mes, envíos GRATIS a nivel nacional. ¿Tiene alguna marca de preferencia o desea que le recomiende una?`,
          );
        else if (c.family === "macbook") await say(MACBOOK_ENTRY);
        else
          await say(
            `¡Hola! 👋 Bienvenido a ${businessName}. ¿Qué equipo le gustaría conocer?`,
          );
        c.stage = "PRODUCT";
        await save(c);
        return;
      }
      if (!c.presentation?.done || (oldSKU && oldSKU !== c.sku)) {
        const mediaFiles = resources.products[c.sku] || [],
          image = mediaFiles.find((f) => f.type === "image"),
          video = mediaFiles.find((f) => f.type === "video");
        if (!image || !video) {
          await pause(c, "PAUSED_ESCALATION", "MISSING_PRODUCT_MEDIA");
          return;
        }
        c.presentation ||= { sku: c.sku, index: 0 };
        async function productMedia(file) {
          const bytes = fs.readFileSync(file.path);
          await media(bytes, file.mime);
          c.presentation.sentMedia ||= [];
          c.presentation.sentMedia.push({
            file: path.basename(file.path),
            type: file.type,
            sha256: digest(bytes),
          });
        }
        const actions = [
          () => productMedia(image),
          () => productMedia(video),
          () => say(characteristics(p)),
          () => audio("commercial1", null, true),
        ];
        for (; c.presentation.index < actions.length; ) {
          c.presentation.status = "reserved";
          await save(c);
          try {
            await actions[c.presentation.index]();
          } catch (err) {
            const diagnostic = safeError(err, "presentation");
            // Static transport codes and standard JS messages contain no request payload.
            const message = typeof err?.message === "string" ? err.message : "";
            if (
              /^(?:MEDIA_SIZE_INVALID|MEDIA_TYPE_INVALID|MEDIA_ID_MISSING|MEDIA_BLOCKED|SEND_BLOCKED|UPLOAD_FAILED|TIMEOUT)$/.test(
                message,
              ) ||
              /^(?:Cannot read properties of (?:undefined|null) \(reading '[A-Za-z_$][A-Za-z0-9_$]*'\)|[A-Za-z_$][A-Za-z0-9_$]* is not defined)$/.test(
                message,
              )
            ) {
              diagnostic.message = message;
              diagnostic.message_redacted = false;
            }
            if (
              /^(?:ENOENT|EACCES|EPERM|EISDIR|ERR_INVALID_ARG_TYPE|ERR_INVALID_URL|MEDIA_SIZE_INVALID|MEDIA_TYPE_INVALID|MEDIA_ID_MISSING)$/.test(
                err?.code,
              )
            )
              diagnostic.code = err.code;
            console.warn("Presentation delivery failed", {
              sku: c.sku,
              index: c.presentation.index,
              ...diagnostic,
            });
            await pause(
              c,
              "PAUSED_ESCALATION",
              "PRESENTATION_DELIVERY_UNCERTAIN",
            );
            return;
          }
          if (c.pauseState !== "ACTIVE") return;
          c.presentation.index++;
          c.presentation.status = "sent";
          await save(c);
        }
        c.presentation.done = true;
        c.stage = "CITY";
      }
      if (!c.city) {
        c.stage = "CITY";
        await say("¿En qué ciudad se encuentra?");
        await save(c);
        return;
      }
      if (norm(c.city) === "guayaquil") {
        if (x.delivery && x.delivery !== c.delivery) {
          c.delivery = x.delivery;
          c.locationPresented = false;
          delete c.destination;
        }
        if (!c.delivery) {
          if (x.delivery === "delivery" || x.delivery === "agency")
            c.delivery = x.delivery;
          else {
            c.stage = "DELIVERY";
            await say(
              "En Guayaquil puede elegir delivery en puntos/malls habilitados o contraentrega en agencia Servientrega. ¿Cuál prefiere?",
            );
            await save(c);
            return;
          }
        }
      } else {
        if (x.delivery === "delivery")
          await say(
            "Fuera de Guayaquil ofrecemos contraentrega en agencia Servientrega.",
          );
        c.delivery = "agency";
      }
      if (c.delivery === "delivery" && !c.locationPresented) {
        if (!malls.length) {
          await pause(c, "PAUSED_ESCALATION", "MALLS_NOT_CONFIGURED");
          return;
        }
        c.deliveryDate = deliveryWindow(now()).date;
        await audio("delivery", policies.delivery);
        await say(
          `Puntos habilitados: ${malls.join(", ")}. ${deliveryWindow(now()).today ? "Puede solicitarlo para hoy si alcanza el tiempo dentro del horario; de lo contrario, se programa el siguiente día disponible" : "Podemos programarlo para el siguiente día disponible: " + c.deliveryDate}. ¿Qué mall prefiere? Si no puede por horario, puede elegir Servientrega.`,
        );
        c.locationPresented = true;
      }
      if (c.delivery === "agency" && !c.locationPresented) {
        const candidates = agencies.find(c.province, c.city);
        if (!candidates.length) {
          c.stage = "CITY";
          await say(
            c.province
              ? "No encontré agencias para esa ciudad. Indíqueme la ciudad exacta."
              : "Indíqueme la provincia para ubicar la ciudad sin confundirla.",
          );
          await save(c);
          return;
        }
        c.city = candidates[0].ciudad;
        c.province = candidates[0].provincia;
        c.agencyCandidates = candidates.map((a) => a.id);
        for (const m of agencyMedia(candidates)) await media(m.bytes, m.mime);
        await say("Seleccione una agencia por su número, nombre o dirección.");
        await audio("commercial2", null, true);
        if (c.pauseState !== "ACTIVE") return;
        c.locationPresented = true;
      }
      if (!c.destination) {
        if (c.delivery === "delivery") {
          const mall = malls.find(
            (m) => norm(data.destination || text) === norm(m),
          );
          if (mall) c.destination = { nombre: mall };
        } else {
          const candidates = agencies.all.filter((a) =>
            c.agencyCandidates?.includes(a.id),
          );
          c.destination =
            agencies.select(candidates, data.destination || text) || undefined;
        }
        if (!c.destination) {
          c.stage = "DESTINATION";
          await save(c);
          return;
        }
      }
      if (!c.name || !c.cedula) {
        c.stage = "DATA";
        await say(
          `Indíqueme ${[!c.name && "su nombre completo", !c.cedula && "su cédula"].filter(Boolean).join(" y ")}. Usaremos su número de WhatsApp como teléfono.`,
        );
        await save(c);
        return;
      }
      if (
        !/^[\p{L}]+(?:[ '-][\p{L}]+)+$/u.test(c.name) ||
        !/^\d{10}$/.test(c.cedula)
      ) {
        c.stage = "DATA";
        await say("Revise su nombre completo y cédula de 10 dígitos.");
        await save(c);
        return;
      }
      const fingerprint = JSON.stringify([
        c.name,
        c.cedula,
        c.city,
        c.province,
        c.destination,
        c.sku,
        c.qty,
        p.precio,
        c.invoice,
        c.reserveIntent,
      ]);
      if (
        c.stage === "CONFIRMATION" &&
        c.summaryFingerprint === fingerprint &&
        !changed &&
        x.confirmation === "positive" &&
        !x.correction &&
        !x.intent &&
        !/[¿?]/.test(text) &&
        !/\b(no|pero|aunque|cambia|corrige|menos)\b/.test(n)
      ) {
        c.finalizing = true;
        await save(c);
        await say(
          `✅ Pedido confirmado. ${c.reserveIntent ? "La reserva queda para gestión humana." : c.delivery === "delivery" ? `Se coordina delivery en ${c.destination.nombre} para ${c.deliveryDate}, dentro del horario y sujeto a disponibilidad de coordinación.` : `Se procesa para despacho ${dispatch(now()).today ? "hoy" : "el siguiente día operativo (" + dispatch(now()).date + ")"}. Llegada estimada: 24–48 horas después del despacho.`}`,
        );
        c.confirmedAt = now().toISOString();
        delete c.finalizing;
        await pause(c, "PAUSED_CONFIRMED", "FINAL_CONFIRMATION");
        return;
      }
      if (
        c.stage === "CONFIRMATION" &&
        c.summaryFingerprint === fingerprint &&
        !changed &&
        !x.correction
      ) {
        await say(
          "Disculpe, solo para confirmar: ¿los datos están correctos y desea que procedamos con el pedido?",
        );
        await save(c);
        return;
      }
      await say(summary(c, p));
      c.summaryFingerprint = fingerprint;
      c.stage = "CONFIRMATION";
      await save(c);
    });
  }
  return { process, load, admin, purge, pause };
}
module.exports = {
  createSalesFlow,
  phone,
  command,
  fresh,
  family,
  dispatch,
  deliveryWindow,
  characteristics,
  includes,
  summary,
  policies,
};
