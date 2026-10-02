"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const {
  createSalesFlow,
  fresh,
  phone,
  command,
  dispatch,
  deliveryWindow,
  includes,
  characteristics,
} = require("../lib/sales-flow");
const { discover, agencyMedia, agencyPDF } = require("../lib/sales-resources");
const { createAgencies } = require("../lib/v2-agencies");
const { memorySheets } = require("../lib/v2-storage");
const { createInventory } = require("../lib/v2-inventory");
const { createSalesStore } = require("../lib/sales-store");
const { createApp } = require("../server");
const NUMBER = "+593999123456";
const agencies = createAgencies(path.join(__dirname, "../resources/Ecuador"));
const resources = discover(path.join(__dirname, "../resources"));
const fixtureFile = resources.products["IPADAIR1-32-PLA"][0];
const products = [
  {
    id_producto: "IPAD",
    producto: "iPad Air",
    capacidad: "32 GB",
    color: "Plateado",
    stock: 9,
    precio: 99.99,
    informacion: "RAM: 1 GB; almacenamiento: 32 GB",
  },
  {
    id_producto: "WIN",
    producto: "Dell Windows",
    capacidad: "16 GB",
    color: "Negro",
    stock: 20,
    precio: 100,
    informacion: "RAM: 4 GB; almacenamiento: 16 GB; Intel Celeron",
  },
  {
    id_producto: "MAC",
    producto: "MacBook Pro 13",
    capacidad: "256 GB",
    color: "Plateado",
    stock: 8,
    precio: 250,
    informacion: "RAM: 8 GB; almacenamiento: 256 GB; Core i5",
  },
];
function runtime(options = {}) {
  const memory = new Map(),
    sent = [],
    calls = [],
    prepared = [];
  let current = new Date("2026-10-01T15:00:00Z");
  let next = {};
  const store = {
    get: async (n) => (memory.has(n) ? structuredClone(memory.get(n)) : null),
    set: async (n, c) => {
      memory.set(n, structuredClone(c));
    },
    keys: async () => [...memory.keys()],
  };
  const items = structuredClone(options.products || products);
  const res = structuredClone(resources);
  for (const p of items)
    res.products[p.id_producto] = [
      { ...fixtureFile, type: "image", mime: "image/jpeg" },
      { ...fixtureFile, type: "video", mime: "video/mp4" },
    ];
  for (const intent of [
    "commercial1",
    "commercial2",
    "warranty",
    "reserve",
    "delivery",
    "ipad",
    "macbook",
    "windowsLow",
    "windowsHigh",
    "shipping",
    "trust",
  ])
    res.audios[intent] = {
      path: fixtureFile.path,
      mime: "audio/mpeg",
      text: `Texto oficial ${intent}`,
    };
  if (options.noAudio) res.audios = {};
  if (options.missingMedia) res.products = {};
  res.mediaFacts.IPAD = [
    {
      file: "video/" + path.basename(fixtureFile.path),
      type: "video",
      sha256: require("../lib/sales-media-facts").digest(
        fs.readFileSync(fixtureFile.path),
      ),
      canAnswer: ["puerto visible"],
      shows: [],
      notVisible: [],
    },
  ];
  const flow = createSalesFlow({
    store,
    catalog: async (request) => {
      options.onCatalog?.(request);
      calls.push("catalog");
      if (options.catalogError) throw Error("SOURCE");
      return {
        master: new Map(items.map((p) => [p.id_producto, p])),
        available: new Map(
          items.filter((p) => p.stock > 0).map((p) => [p.id_producto, p]),
        ),
      };
    },
    agencies,
    resources: res,
    interpret: async (input) => {
      calls.push("interpret");
      return next;
    },
    sendText: async (n, text) => {
      sent.push({ type: "text", text });
    },
    sendMedia: async (n, bytes, mime) => {
      if (options.mediaError)
        throw options.mediaError instanceof Error
          ? options.mediaError
          : Error("TIMEOUT");
      sent.push({
        type: mime.startsWith("image")
          ? "image"
          : mime.startsWith("video")
            ? "video"
            : mime === "application/pdf"
              ? "document"
              : "audio",
        bytes,
      });
    },
    prepare: async (number, id, context, kind) => {
      options.onPrepare?.(kind);
      prepared.push("prepare");
    },
    now: () => current,
    malls: options.noMalls ? [] : ["Mall del Sol", "City Mall"],
  });
  return {
    flow,
    memory,
    sent,
    calls,
    items,
    prepared,
    res,
    message: async (text, x = {}) => {
      next = x;
      await flow.process(NUMBER, text);
    },
    load: () => flow.load(NUMBER),
    seed: (c) =>
      memory.set(NUMBER, { ...fresh(NUMBER, current.toISOString()), ...c }),
    time: (t) => {
      current = new Date(t);
    },
  };
}
async function buy(r, sku = "IPAD", delivery = "agency") {
  await r.message("Quiero comprar", {
    sku,
    data: { city: delivery === "delivery" ? "Guayaquil" : "Cuenca" },
  });
  if (delivery === "delivery")
    await r.message("Delivery", { delivery: "delivery" });
  await r.message(delivery === "delivery" ? "Mall del Sol" : "1", {
    data: {
      destination: delivery === "delivery" ? "Mall del Sol" : "1",
      name: "Ana Perez",
      cedula: "0912345678",
    },
  });
  assert.equal((await r.load()).stage, "CONFIRMATION");
}
test("greeting uses configured business and no presentation", async () => {
  const r = runtime();
  await r.message("Hola");
  assert.match(r.sent[0].text, /Level Up Store/);
  assert.equal((await r.load()).stage, "PRODUCT");
});
for (const [family, sku] of [
  ["ipad", "IPAD"],
  ["windows", "WIN"],
  ["macbook", "MAC"],
])
  test(`${family} full flow and semantic confirmation`, async () => {
    const r = runtime();
    await r.message(family, { family });
    await buy(r, sku);
    const before = r.sent.length;
    await r.message("Así está perfecto, sigamos adelante", {
      confirmation: "positive",
    });
    assert.equal((await r.load()).pauseState, "PAUSED_CONFIRMED");
    assert.equal(r.sent.length, before + 1);
    const calls = r.calls.length;
    await r.message("Gracias");
    assert.equal(r.calls.length, calls);
    assert.equal(r.sent.length, before + 1);
  });
test("recommend highest stock compatible family", async () => {
  const r = runtime();
  await r.message("Recomiéndeme", { recommend: true, family: "windows" });
  assert.equal((await r.load()).sku, "WIN");
});
test("ties choose one of highest stock", async () => {
  const list = [products[0], { ...products[0], id_producto: "IPAD2" }];
  const r = runtime({ products: list });
  await r.message("Recomiende", { recommend: true, family: "ipad" });
  assert.ok(["IPAD", "IPAD2"].includes((await r.load()).sku));
});
test("requirements restrict recommendations", async () => {
  const r = runtime();
  await r.message("Necesito 8GB RAM", {
    recommend: true,
    compatibleSkus: ["MAC"],
  });
  assert.equal((await r.load()).sku, "MAC");
});
test("exact SKU and no cross-SKU specs; stock from current snapshot", async () => {
  const r = runtime();
  await r.message("MAC", { sku: "MAC" });
  const card = r.sent.find((s) => s.type === "text");
  assert.match(card.text, /8 GB/);
  assert.doesNotMatch(card.text, /Intel Celeron/);
  assert.match(card.text, /250.00/);
});
test("stock one suffix attached to characteristics", () => {
  assert.ok(
    characteristics({ ...products[0], stock: 1 }).endsWith(
      "🔥 ÚLTIMA UNIDAD DISPONIBLE",
    ),
  );
  assert.doesNotMatch(characteristics(products[0]), /9 unidades/);
});
test("mandatory photo video features audio order and one prepare", async () => {
  const r = runtime();
  await r.message("IPAD", { sku: "IPAD" });
  assert.deepEqual(
    r.sent.slice(0, 4).map((s) => s.type),
    ["image", "video", "text", "audio"],
  );
  assert.equal(r.prepared.length, 1);
  await r.message("Quiero comprar");
  assert.equal(r.sent.filter((s) => s.type === "image").length, 1);
});
test("audio first and repeated question text without stage reset", async () => {
  const r = runtime();
  await r.message("Garantía", { intent: "warranty" });
  assert.equal(r.sent[0].type, "audio");
  const count = r.sent.length;
  await r.message("Más sobre garantía", { intent: "warranty" });
  assert.equal(r.sent[count].type, "text");
  assert.match(r.sent[count].text, /Texto oficial warranty/);
  assert.equal((await r.load()).stage, "PRODUCT");
});
test("prefers text persists and official transcript replaces audio", async () => {
  const r = runtime();
  await r.message("No audios", { prefersText: true });
  await r.message("Garantía", { intent: "warranty" });
  assert.ok((await r.load()).prefersText);
  assert.equal(r.sent.filter((s) => s.type === "audio").length, 0);
  assert.match(r.sent.at(-2).text, /Texto oficial warranty/);
});
test("known city not asked again", async () => {
  const r = runtime();
  await r.message("Cuenca", { data: { city: "Cuenca" } });
  await r.message("IPAD", { sku: "IPAD" });
  assert.doesNotMatch(
    r.sent.map((s) => s.text || "").join("\n"),
    /¿En qué ciudad/,
  );
  assert.equal((await r.load()).city, "CUENCA");
});
test("agencies threshold image/PDF and every row in PDF", () => {
  const candidates = agencies.find("Guayas", "Guayaquil");
  assert.ok(candidates.length > 15);
  assert.ok(
    agencyMedia(candidates.slice(0, 15)).every((m) => m.mime === "image/png"),
  );
  const pdf = agencyMedia(candidates)[0];
  assert.equal(pdf.mime, "application/pdf");
  assert.match(pdf.bytes.toString("latin1"), /%PDF-1.4/);
  for (const [i, a] of candidates.entries())
    assert.ok(pdf.bytes.toString("latin1").includes(`${i + 1}. `));
});
test("commercial2 after agency media and selection question", async () => {
  const r = runtime();
  await r.message("IPAD Cuenca", { sku: "IPAD", data: { city: "Cuenca" } });
  const i = r.sent.findIndex((s) => s.text?.includes("Seleccione"));
  assert.ok(i > 0);
  assert.ok(["image", "document"].includes(r.sent[i - 1].type));
  assert.equal(r.sent[i + 1].type, "audio");
});
test("Guayaquil delivery selects mall, captures WhatsApp phone", async () => {
  const r = runtime();
  await buy(r, "WIN", "delivery");
  const c = await r.load();
  assert.equal(c.destination.nombre, "Mall del Sol");
  assert.equal(c.phone, NUMBER);
  assert.equal(c.delivery, "delivery");
});
test("Guayaquil contraentrega offers agencies", async () => {
  const r = runtime();
  await r.message("WIN Guayaquil", { sku: "WIN", data: { city: "Guayaquil" } });
  await r.message("Servientrega", { delivery: "agency" });
  assert.ok(r.sent.some((s) => s.type === "document"));
  assert.equal((await r.load()).delivery, "agency");
});
test("outside Guayaquil cannot choose home delivery", async () => {
  const r = runtime();
  await r.message("WIN Cuenca", {
    sku: "WIN",
    data: { city: "Cuenca" },
    delivery: "delivery",
  });
  assert.equal((await r.load()).delivery, "agency");
  assert.match(r.sent.map((s) => s.text || "").join(" "), /Fuera de Guayaquil/);
});
test("mixed data persists immediately and not requested again", async () => {
  const r = runtime();
  await r.message("Soy Ana Perez, cédula 0912345678, Cuenca. Garantía?", {
    data: { name: "Ana Perez", cedula: "0912345678", city: "Cuenca" },
    intent: "warranty",
  });
  assert.equal((await r.load()).name, "Ana Perez");
  await r.message("IPAD", { sku: "IPAD" });
  await r.message("1", { data: { destination: "1" } });
  assert.equal((await r.load()).stage, "CONFIRMATION");
});
test("semantic ambiguous does not confirm", async () => {
  const r = runtime();
  await buy(r);
  await r.message("Creo que podría ser", { confirmation: "ambiguous" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /solo para confirmar/);
});
test("correction beats positive and repeats updated summary", async () => {
  const r = runtime();
  await buy(r);
  await r.message("Sí, pero cédula 0912345679", {
    confirmation: "positive",
    correction: true,
    data: { cedula: "0912345679" },
  });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /0912345679/);
  await r.message("👍", { confirmation: "positive" });
  assert.equal((await r.load()).pauseState, "PAUSED_CONFIRMED");
});
for (const [time, today, date] of [
  ["2026-10-01T21:59:59Z", true, "2026-10-01"],
  ["2026-10-01T22:00:00Z", false, "2026-10-02"],
  ["2026-10-03T15:59:59Z", true, "2026-10-03"],
  ["2026-10-03T16:00:00Z", false, "2026-10-05"],
  ["2026-10-04T15:00:00Z", false, "2026-10-05"],
])
  test(`dispatch cutoff ${time}`, () =>
    assert.deepEqual(dispatch(new Date(time)), { today, date }));
test("delivery next weekday and before hours", () => {
  assert.deepEqual(deliveryWindow(new Date("2026-10-02T23:00:00Z")), {
    today: false,
    date: "2026-10-05",
  });
  assert.equal(deliveryWindow(new Date("2026-10-01T13:00:00Z")).today, true);
});
test("reservation never skips stages, no accounts, pause after confirm", async () => {
  const r = runtime();
  await r.message("Reserve", { reserve: true });
  assert.equal((await r.load()).stage, "PRODUCT");
  await buy(r);
  assert.match(r.sent.at(-1).text, /Reserva: \$20/);
  await r.message("Sí", { confirmation: "positive" });
  assert.equal((await r.load()).pauseState, "PAUSED_CONFIRMED");
  assert.doesNotMatch(
    r.sent.map((s) => s.text || "").join(" "),
    /cuenta bancaria|Banco Pichincha/,
  );
});
for (const negotiation of ["discount", "wholesale", "special warranty"])
  test(`${negotiation} gathers then pauses silently`, async () => {
    const r = runtime();
    await r.message("Precio especial", { negotiation: true });
    assert.equal((await r.load()).pauseState, "ACTIVE");
    const before = r.sent.length;
    await r.message("Dos iguales WIN", {
      data: { lines: [{ sku: "WIN", qty: 2 }] },
    });
    assert.equal((await r.load()).pauseState, "PAUSED_ESCALATION");
    assert.equal(r.sent.length, before);
  });
test("single unit discount uses official price", async () => {
  const r = runtime();
  await r.message("Descuento", { discount: true });
  assert.match(r.sent[0].text, /oficiales/);
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("specific media missing escalates, known video fact points to video", async () => {
  const r = runtime();
  await r.message("IPAD", { sku: "IPAD" });
  await r.message("Puerto visible", { specificMedia: "puerto visible" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /video que le envié/);
  const before = r.sent.length;
  await r.message("Serial", { specificMedia: "serial" });
  assert.equal((await r.load()).pauseState, "PAUSED_ESCALATION");
  assert.equal(r.sent.length, before);
});
test("contradictory stock specs escalates silently", async () => {
  const r = runtime({
    products: [{ ...products[0], informacion: "Almacenamiento: 256 GB" }],
  });
  await r.message("IPAD", { sku: "IPAD" });
  assert.equal((await r.load()).pauseState, "PAUSED_ESCALATION");
  assert.equal(r.sent.length, 0);
});
test("claim immediately pauses with no inventory/model or reply", async () => {
  const r = runtime();
  await r.message("Mi equipo no funciona");
  assert.equal((await r.load()).pauseState, "PAUSED_CLAIM");
  assert.equal(r.calls.length, 0);
  assert.equal(r.sent.length, 0);
});
test("semantic post-sale claim pauses without reply", async () => {
  const r = runtime();
  await r.message("Compré aquí y se apaga", { claim: true });
  assert.equal((await r.load()).pauseState, "PAUSED_CLAIM");
  assert.equal(r.sent.length, 0);
});
test("all paused states ignore inbound", async () => {
  for (const pauseState of [
    "PAUSED_CONFIRMED",
    "PAUSED_ESCALATION",
    "PAUSED_CLAIM",
  ]) {
    const r = runtime();
    r.seed({ pauseState });
    await r.message("Hola");
    assert.equal(r.calls.length, 0);
    assert.equal(r.sent.length, 0);
  }
});
test("/liberar retains all context and resumes; /borrar clears", async () => {
  const r = runtime();
  r.seed({
    pauseState: "PAUSED_ESCALATION",
    sku: "IPAD",
    name: "Ana Perez",
    prefersText: true,
    sentAudios: ["warranty"],
    reserveIntent: true,
  });
  assert.ok(await r.flow.admin(" / LiBeRaR 0999123456 "));
  const c = await r.load();
  assert.equal(c.pauseState, "ACTIVE");
  assert.equal(c.sku, "IPAD");
  assert.ok(c.prefersText);
  await r.message("Garantía", { intent: "warranty" });
  assert.match(r.sent[0].text, /Texto oficial/);
  await r.flow.admin("/borrar +593 999 123 456");
  assert.equal((await r.load()).sku, undefined);
  assert.deepEqual((await r.load()).sentAudios, []);
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("auto purge thirty days clears paused memory", async () => {
  const r = runtime();
  r.seed({
    pauseState: "PAUSED_CONFIRMED",
    sku: "IPAD",
    lastInteraction: "2026-08-01T00:00:00Z",
  });
  await r.flow.purge();
  assert.equal((await r.load()).sku, undefined);
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("only slash liberar and borrar commands; Ecuador phone normalization", () => {
  for (const n of [
    "0999123456",
    "593999123456",
    "+593999123456",
    "00593999123456",
  ])
    assert.equal(phone(n), NUMBER);
  for (const text of [
    "GUIA (CH000001) (123)",
    "RESPONDER (0999123456): hola",
    "PAGO 123",
    "IR 1",
    "LIBERAR (CH000001)",
  ])
    assert.equal(command(text), null);
  assert.equal(phone("../secret"), null);
  assert.equal(command("/borrar 123"), null);
});
test("includes microSD external and price boundary", () => {
  assert.match(includes(products[1]), /128 GB de almacenamiento externo/);
  assert.match(includes({ ...products[1], precio: 100.01 }), /256 GB/);
  assert.match(includes(products[2]), /Office instalado y activado/);
});
test("missing resource is explicit pause, no fabricated official commercial audio", async () => {
  const r = runtime({ noAudio: true });
  await r.message("IPAD", { sku: "IPAD" });
  assert.equal(
    (await r.load()).pauseReason,
    "MISSING_OFFICIAL_AUDIO:commercial1",
  );
  assert.deepEqual(
    r.sent.map((s) => s.type),
    ["image", "video", "text"],
  );
});
test("missing product media pauses before incomplete presentation", async () => {
  const r = runtime({ missingMedia: true });
  await r.message("MAC", { sku: "MAC" });
  assert.equal((await r.load()).pauseReason, "MISSING_PRODUCT_MEDIA");
  assert.equal(r.sent.length, 0);
});
test("uncertain media delivery paused and never automatically resent", async () => {
  const r = runtime({ mediaError: true });
  await r.message("IPAD", { sku: "IPAD" });
  assert.equal((await r.load()).pauseReason, "PRESENTATION_DELIVERY_UNCERTAIN");
  const calls = r.calls.length;
  await r.message("Hola");
  assert.equal(r.calls.length, calls);
});
test("catalog fresh before confirmation; changed price requires new summary", async () => {
  const r = runtime();
  await buy(r);
  r.items[0].precio = 110;
  await r.message("Sí", { confirmation: "positive" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /110.00/);
});
test("sheet is source of stock price, memory canonical aliases and no sale writes", async () => {
  const sheets = memorySheets();
  await sheets.spreadsheets.values.update({
    range: "'PAGINA DE STOCK'!A2:H3",
    requestBody: {
      values: [
        [
          "ID-PRODUCTO",
          "PRODUCTO",
          "CAPACIDAD",
          "RAM",
          "COLOR",
          "STOCK",
          "PRECIO",
          "INFORMACION DEL PRODUCTO",
        ],
        [
          "X",
          "iPad",
          "16 GB",
          "",
          "Plateado",
          7,
          123.45,
          "Almacenamiento: 16 GB",
        ],
      ],
    },
  });
  const inventory = createInventory({ sheets, spreadsheetId: "fixture" });
  assert.equal((await inventory.catalog()).available.get("X").precio, 123.45);
  const store = createSalesStore(sheets, "fixture");
  await sheets.spreadsheets.values.update({
    range: "MEMORIA!A2:C2",
    requestBody: {
      values: [
        [
          "0999123456",
          JSON.stringify(fresh(NUMBER, "2026-10-01T00:00:00Z")),
          "2026-10-01T00:00:00Z",
        ],
      ],
    },
  });
  assert.equal((await store.get(NUMBER)).phone, NUMBER);
  await store.set(NUMBER, {
    ...(await store.get(NUMBER)),
    pauseState: "PAUSED_CONFIRMED",
  });
  assert.equal(
    (await sheets.spreadsheets.values.get({ range: "MEMORIA!A2:C" })).data
      .values.length,
    1,
  );
  assert.deepEqual(
    (
      await sheets.spreadsheets.values.get({
        range: "'REGISTRO DE VENTAS'!A:Z",
      })
    ).data.values,
    [],
  );
});
test("server authorization prevents customer admin command; paused audio no transcription", async () => {
  const sheets = memorySheets(),
    memory = new Map();
  const store = {
    get: async (n) => memory.get(n),
    set: async (n, c) => memory.set(n, c),
    keys: async () => [...memory.keys()],
  };
  memory.set(NUMBER, {
    ...fresh(NUMBER, new Date().toISOString()),
    pauseState: "PAUSED_CLAIM",
  });
  const app = createApp({
    env: { TEST_MODE: "true", ASESOR_WHATSAPP: "+593999111111" },
    sheets,
    store,
    interpret: async () => {
      throw Error("MUST_NOT_CALL");
    },
  });
  await app.processMessage({
    from: NUMBER,
    type: "text",
    text: { body: "/liberar " + NUMBER },
  });
  assert.equal(memory.get(NUMBER).pauseState, "PAUSED_CLAIM");
  await app.processMessage({
    from: NUMBER,
    type: "audio",
    audio: { link: "bad" },
    provider: "ycloud",
  });
  await app.processMessage({
    from: "+593999111111",
    type: "text",
    text: { body: "/liberar " + NUMBER },
  });
  assert.equal(memory.get(NUMBER).pauseState, "ACTIVE");
});
test("resource audit exact manifest and parse all HTML", () => {
  assert.equal(agencies.stats.html, 233);
  assert.equal(agencies.stats.provincias, 24);
  assert.equal(Object.keys(resources.products).length, 32);
  assert.equal(Object.keys(resources.audios).length, 14);
  assert.deepEqual(resources.errors, []);
});
test("general technical HDMI does not invent five ports, iPad not universal", () => {
  const { technicalAnswer } = require("../lib/sales-technical");
  assert.match(technicalAnswer(products[1], "hdmi"), /un puerto HDMI/);
  assert.doesNotMatch(technicalAnswer(products[1], "hdmi"), /5 HDMI/);
  assert.match(technicalAnswer(products[0], "hdmi"), /depende del modelo/);
  assert.match(technicalAnswer(products[2], "ram"), /8 GB/);
  assert.equal(technicalAnswer(products[2], "year"), null);
});
test("confirmation with auxiliary question never finalizes even positive classification", async () => {
  const r = runtime();
  await buy(r);
  await r.message("Sí, ¿qué garantía tengo?", {
    confirmation: "positive",
    intent: "warranty",
  });
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("legacy memory is paused until release, preserves context and can resume", async () => {
  const r = runtime();
  r.memory.set(NUMBER, {
    borradorPedido: {
      nombre: "Ana Perez",
      cedula: "0912345678",
      ciudad: "Cuenca",
      lineas: [{ id_producto: "IPAD", cantidad: 1 }],
    },
    lastInteraction: new Date().toISOString(),
  });
  assert.equal((await r.load()).pauseState, "PAUSED_ESCALATION");
  await r.flow.admin("/liberar " + NUMBER);
  assert.ok((await r.load()).legacyContext);
  await r.message("Sigamos");
  assert.equal((await r.load()).name, "Ana Perez");
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.ok(r.sent.some((s) => s.type === "video"));
});
test("strict sales catalog detects duplicate and invalid stock rows", async () => {
  const { createSalesCatalog } = require("../lib/sales-catalog");
  const sheets = memorySheets();
  await sheets.spreadsheets.values.update({
    range: "'PAGINA DE STOCK'!A2:H4",
    requestBody: {
      values: [
        [
          "ID-PRODUCTO",
          "PRODUCTO",
          "CAPACIDAD",
          "RAM",
          "COLOR",
          "STOCK",
          "PRECIO",
          "INFORMACION DEL PRODUCTO",
        ],
        ["X", "iPad", "16 GB", "", "Plateado", 1, 99, "Info"],
        ["X", "iPad", "32 GB", "", "Plateado", 2, 110, "Info"],
      ],
    },
  });
  await assert.rejects(
    createSalesCatalog(sheets, "fixture"),
    /CATALOGO_INVALIDO|INVALID_OR_DUPLICATE/,
  );
});
test("free-form source failure pauses silently", async () => {
  const r = runtime({ catalogError: true });
  await r.message("Tengo una pregunta específica");
  assert.equal((await r.load()).pauseState, "PAUSED_ESCALATION");
  assert.equal(r.sent.length, 0);
});
test("invoice updates summary with 15 percent without escalation", async () => {
  const r = runtime();
  await buy(r, "WIN");
  await r.message("Quiero factura", {
    intent: "invoice",
    data: { invoice: true },
  });
  assert.match(r.sent.at(-1).text, /Total: \$115.00/);
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("semantic negative cannot confirm", async () => {
  const r = runtime();
  await buy(r);
  await r.message("No continuemos", { confirmation: "negative" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("same city with different casing preserves agency and data", async () => {
  const r = runtime();
  await buy(r);
  const before = (await r.load()).destination.id;
  await r.message("Cuenca", { data: { city: "Cuenca" } });
  assert.equal((await r.load()).destination.id, before);
});
test("presentation for a different SKU sends commercial1 again", async () => {
  const r = runtime();
  await r.message("IPAD", { sku: "IPAD" });
  await r.message("Prefiero MAC", { sku: "MAC" });
  assert.deepEqual(r.sent.filter((s) => s.type === "audio").length, 2);
});
test("paused inactivity purge boundary at exactly thirty days", async () => {
  const r = runtime();
  r.seed({
    pauseState: "PAUSED_CLAIM",
    lastInteraction: "2026-09-01T15:00:00Z",
  });
  await r.flow.purge();
  assert.equal((await r.load()).pauseState, "ACTIVE");
});
test("large memory chunks round trip and borrar clears every trailing chunk", async () => {
  const sheets = memorySheets(),
    store = createSalesStore(sheets, "fixture");
  const c = {
    ...fresh(NUMBER, new Date().toISOString()),
    legacyContext: { text: "a".repeat(65000) },
  };
  await store.set(NUMBER, c);
  assert.equal((await store.get(NUMBER)).legacyContext.text.length, 65000);
  const flow = runtime().flow;
  await store.set(NUMBER, fresh(NUMBER, new Date().toISOString()), {
    clearAliases: true,
  });
  const row = (await sheets.spreadsheets.values.get({ range: "MEMORIA!A2:ZZ" }))
    .data.values[0];
  assert.ok(row.slice(3).every((cell) => cell === ""));
  assert.equal((await store.get(NUMBER)).legacyContext, undefined);
});
test("duplicate phone aliases are detected and explicit reset clears both", async () => {
  const sheets = memorySheets(),
    store = createSalesStore(sheets, "fixture");
  await sheets.spreadsheets.values.update({
    range: "MEMORIA!A2:C3",
    requestBody: {
      values: [
        ["0999123456", "{}", "2026-10-01T00:00:00Z"],
        [NUMBER, "{}", "2026-10-01T00:00:00Z"],
      ],
    },
  });
  await assert.rejects(store.get(NUMBER), /AMBIGUOUS_MEMORY/);
  await store.set(NUMBER, fresh(NUMBER, new Date().toISOString()), {
    clearAliases: true,
  });
  assert.equal((await store.get(NUMBER)).pauseState, "ACTIVE");
  assert.deepEqual(await store.keys(), [NUMBER]);
});
test("generic media request points to sent media, keeps stage and never resends", async () => {
  const r = runtime();
  await r.message("IPAD", { sku: "IPAD" });
  const stage = (await r.load()).stage;
  await r.message("Video por favor", { mediaRequest: "video" });
  assert.match(r.sent.at(-1).text, /video que le envié/);
  assert.equal((await r.load()).stage, stage);
  assert.equal(r.sent.filter((s) => s.type === "video").length, 1);
});
test("technical/includes before exact SKU asks model without escalation", async () => {
  const r = runtime();
  await r.message("Qué incluye?", { intent: "includes", family: "windows" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /modelo o SKU/);
});
test("audio discovery differentiates <=100 and >100 and detects ambiguity", () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "level-up-resources-test-"),
  );
  try {
    fs.mkdirSync(path.join(dir, "Audios"));
    fs.writeFileSync(
      path.join(dir, "Audios", "Incluye Windows <=100.mp3"),
      "fixture",
    );
    fs.writeFileSync(
      path.join(dir, "Audios", "Incluye Windows >100.mp3"),
      "fixture",
    );
    let found = discover(dir);
    assert.match(found.audios.windowsLow.path, /<=100/);
    assert.match(found.audios.windowsHigh.path, />100/);
    fs.writeFileSync(path.join(dir, "Audios", "Windows 256 GB.mp3"), "fixture");
    found = discover(dir);
    assert.ok(found.audios.windowsHigh.ambiguous);
    assert.ok(found.errors.includes("AMBIGUOUS_AUDIO:windowsHigh"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("hypothetical warranty question is not automatically a real claim", async () => {
  const r = runtime();
  await r.message("¿Qué pasa si mi equipo no funciona?", {
    intent: "warranty",
  });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.equal(r.sent[0].type, "audio");
});
test("final M4A resources map all official categories without invented transcripts", () => {
  const found = discover(path.join(__dirname, "../resources"));
  for (const intent of [
    "commercial1",
    "commercial2",
    "location",
    "trust",
    "reserve",
    "openbox",
    "shipping",
    "warranty",
    "delivery",
    "ipad",
    "macbook",
    "windowsLow",
    "windowsHigh",
    "includes",
  ]) {
    assert.ok(found.audios[intent], intent);
    assert.equal(found.audios[intent].mime, "audio/mp4");
    assert.equal(
      found.audios[intent].text,
      fs
        .readFileSync(
          found.audios[intent].path.replace(/\.m4a$/, ".txt"),
          "utf8",
        )
        .trim(),
    );
  }
  assert.match(found.audios.windowsLow.path, /Windows \$100/);
  assert.match(found.audios.windowsHigh.path, /Windows superior a \$100/);
});
test("quoted 15-inch SKU folders retain exact IDs and resolve real images/video safely", () => {
  const { files } = require("../lib/v2-product-media");
  const root = path.join(__dirname, "../resources/productos");
  const quoted = Object.keys(resources.products).filter((sku) =>
    sku.endsWith('15"'),
  );
  assert.equal(quoted.length, 3);
  for (const sku of quoted) {
    const media = files(root, sku);
    assert.equal(media.filter((f) => f.type === "image").length, 2);
    assert.equal(media.filter((f) => f.type === "video").length, 1);
  }
  for (const sku of [
    "../IPADAIR1-32-PLA",
    "foo/../IPADAIR1-32-PLA",
    "..",
    "/tmp",
  ])
    assert.deepEqual(files(root, sku), []);
});
test("physical missing media only reports the two empty iMac SKU folders", () => {
  for (const type of ["image", "video"])
    assert.deepEqual(
      Object.entries(resources.products)
        .filter(([, f]) => !f.some((m) => m.type === type))
        .map(([sku]) => sku),
      ["IMAC2011-250", "IMAC2012-250"],
    );
});
test("YCloud accepts M4A MIME in simulated upload without external requests", async () => {
  const { createYCloud } = require("../lib/ycloud-client");
  const client = createYCloud({
    fetchImpl: async () => assert.fail("external request"),
  });
  assert.deepEqual(
    await client.uploadMedia(Buffer.from("fixture-m4a"), {
      mime: "audio/mp4",
      testMode: true,
      canSend: async () => true,
    }),
    { id: "simulated-media" },
  );
});

test("approved delivery malls default, override and excluded Durán points", () => {
  const { DELIVERY_MALLS, deliveryMalls } = require("../lib/sales-malls");
  assert.equal(DELIVERY_MALLS.length, 11);
  assert.deepEqual(deliveryMalls({}), [...DELIVERY_MALLS]);
  assert.deepEqual(
    deliveryMalls({ DELIVERY_MALLS_JSON: '["CityMall","Mall del Sol"]' }),
    ["CityMall", "Mall del Sol"],
  );
  for (const forbidden of [
    "Mall del Sur",
    "Riocentro Sur",
    "Mall El Fortín",
    "Durán Shopping",
    "Mall de Durán",
    "Otro mall",
  ])
    assert.throws(
      () => deliveryMalls({ DELIVERY_MALLS_JSON: JSON.stringify([forbidden]) }),
      /NOT_APPROVED/,
    );
  assert.deepEqual(deliveryMalls({ DELIVERY_MALLS_JSON: "[]" }), []);
});
// Decode PNG scanlines independently: a valid PNG containing only background fails.
function pngPixels(bytes) {
  const zlib = require("node:zlib");
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6);
  let offset = 8;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.subarray(offset + 4, offset + 8).toString();
    if (type === "IDAT")
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)),
    stride = width * 4,
    pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x,
        a = x >= 4 ? pixels[index - 4] : 0,
        b = y ? pixels[index - stride] : 0,
        c = y && x >= 4 ? pixels[index - stride - 4] : 0;
      pixels[index] =
        (raw[y * (stride + 1) + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return { width, height, pixels };
}
test("bundled font renders real dark agency text for PNG 1..15; PDF above 15", () => {
  const { agencyFont } = require("../lib/agency-font");
  assert.match(agencyFont().fontFiles[0], /lib\/assets\/fonts\/NotoSans.ttf$/);
  for (const count of [1, 15]) {
    const candidates = agencies.all.slice(0, count),
      pages = agencyMedia(candidates);
    assert.ok(pages.every((p) => p.mime === "image/png"));
    for (const page of pages) {
      const { width, height, pixels } = pngPixels(page.bytes);
      assert.equal(width, 900);
      assert.ok(height > 125);
      let dark = 0;
      for (let i = width * 4 * 70; i < pixels.length; i += 4)
        if (
          pixels[i] < 80 &&
          pixels[i + 1] < 80 &&
          pixels[i + 2] < 80 &&
          pixels[i + 3] > 0
        )
          dark++;
      assert.ok(dark > 1000, `Body text pixels: ${dark}`);
    }
  }
  const pdf = agencyMedia(agencies.all.slice(0, 16));
  assert.equal(pdf.length, 1);
  assert.equal(pdf[0].mime, "application/pdf");
  const text = pdf[0].bytes.toString("latin1");
  assert.match(text, /\/Type \/Pages/);
  assert.match(text, /%%EOF/);
  for (const a of agencies.all.slice(0, 16)) assert.ok(text.includes(a.nombre));
});
test("14 physical M4A audio/TXT pairs, exact intents and no fabricated text", () => {
  const root = path.join(__dirname, "../resources/Audios"),
    names = fs.readdirSync(root);
  assert.equal(names.filter((n) => n.endsWith(".m4a")).length, 14);
  assert.equal(names.filter((n) => n.endsWith(".txt")).length, 14);
  assert.deepEqual(
    Object.keys(resources.audios).sort(),
    [
      "commercial1",
      "commercial2",
      "location",
      "trust",
      "reserve",
      "openbox",
      "shipping",
      "warranty",
      "delivery",
      "ipad",
      "macbook",
      "windowsLow",
      "windowsHigh",
      "includes",
    ].sort(),
  );
  for (const audio of Object.values(resources.audios)) {
    assert.equal(audio.mime, "audio/mp4");
    assert.ok(audio.text);
    assert.equal(
      audio.text,
      fs.readFileSync(audio.path.replace(/\.m4a$/, ".txt"), "utf8").trim(),
    );
  }
});
test("media facts load all actual files, shared hashes, iMac empty and corrected iPad photos", () => {
  const source = require("../resources/media-facts.json");
  assert.equal(Object.keys(source).length, 32);
  assert.equal(Object.values(resources.mediaFacts).flat().length, 87);
  for (const [sku, files] of Object.entries(resources.products))
    assert.equal(resources.mediaFacts[sku].length, files.length);
  assert.deepEqual(source["IMAC2011-250"], { images: [], videos: [] });
  assert.deepEqual(source["IMAC2012-250"], { images: [], videos: [] });
  assert.ok(
    source["IPADAIR1-32-PLA"].images.every(
      (record) =>
        record.canAnswer.length > 0 &&
        record.shows[0].includes("iPad") &&
        !record.resourceMismatch,
    ),
  );
  assert.equal(
    source["MAC-I5-500-4Ram"].videos[0].sha256,
    source["MAC-I5-250-8Ram"].videos[0].sha256,
  );
});
test("facts refer only to actually sent filename/hash, never secondary or stale media", () => {
  const { sentFacts, answerFact } = require("../lib/sales-media-facts");
  const sku = "MAC-I5-500-4Ram",
    record = resources.mediaFacts[sku].find((f) => f.type === "video");
  const context = {
    sku,
    presentation: {
      done: true,
      sentMedia: [
        {
          file: path.basename(record.file),
          type: "video",
          sha256: record.sha256,
        },
      ],
    },
  };
  assert.equal(sentFacts(resources, context).length, 1);
  assert.ok(answerFact(resources, context, "si Word está visible"));
  assert.equal(
    answerFact(resources, context, "autonomía real de batería"),
    undefined,
  );
  context.presentation.sentMedia[0].sha256 = "changed";
  assert.equal(sentFacts(resources, context).length, 0);
});
test("fact discovery rejects a record after its source media changes", () => {
  const os = require("node:os"),
    { loadMediaFacts, digest } = require("../lib/sales-media-facts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "level-facts-"));
  try {
    const file = path.join(root, "productos", "SKU", "imagen", "one.jpg");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "original");
    fs.writeFileSync(
      path.join(root, "media-facts.json"),
      JSON.stringify({
        SKU: {
          images: [
            {
              file: "imagen/one.jpg",
              type: "image",
              sha256: digest(Buffer.from("original")),
              canAnswer: ["teclado visible"],
            },
          ],
          videos: [],
        },
      }),
    );
    const products = { SKU: [{ path: file, type: "image" }] };
    assert.equal(loadMediaFacts(root, products).SKU.length, 1);
    fs.writeFileSync(file, "replacement");
    assert.equal(loadMediaFacts(root, products).SKU.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("general initial family enquiries bypass unavailable/ambiguous interpreter without escalation", async () => {
  const examples = [
    [
      "Hola, estoy interesado en las laptops y quisiera más información.",
      "windows",
      /laptops desde \$100\.00/,
    ],
    ["quiero información de las laptops", "windows", /laptops desde \$100\.00/],
    ["quiero saber de las laptops", "windows", /laptops desde/],
    ["estoy interesado en las laptops", "windows", /laptops desde/],
    ["qué laptops tienen", "windows", /laptops desde/],
    ["me interesa una laptop", "windows", /laptops desde/],
    ["quiero información de las iPad", "ipad", /iPads.*desde \$99\.99/],
    ["quiero información de iPad", "ipad", /iPads/],
    ["qué iPads tienen", "ipad", /iPads/],
    ["quiero información de las MacBook", "macbook", /modelo de preferencia/],
    ["quiero saber de las MacBook", "macbook", /MacBook Pro/],
    ["qué MacBook tienen", "macbook", /MacBook Pro/],
  ];
  for (const [text, family, expected] of examples) {
    const r = runtime();
    await r.message(text, {
      claim: true,
      sku: "UNKNOWN",
      confirmation: "positive",
    });
    const c = await r.load();
    assert.equal(c.pauseState, "ACTIVE", text);
    assert.equal(c.family, family);
    assert.equal(c.stage, "PRODUCT");
    assert.equal(c.sku, undefined);
    assert.ok(!r.calls.includes("interpret"));
    assert.match(r.sent[0].text, expected);
    assert.ok(
      r.sent.every((item) => !/Permítame verificar/.test(item.text || "")),
    );
  }
});
test("initial catalog source outage stays active without inventing prices or urgent escalation", async () => {
  const r = runtime({ catalogError: true });
  await r.message("quiero información de las laptops");
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent[0].text, /No pude cargar el catálogo/);
  assert.doesNotMatch(r.sent[0].text, /\$|Permítame verificar/);
});
test("concrete requirements, negotiations and corrections retain semantic interpretation", async () => {
  for (const text of [
    "quiero información de laptops con 16 GB de RAM",
    "quiero información de las laptops con descuento",
    "no quiero laptops",
    "quiero información de las laptops y reservar dos",
  ]) {
    const r = runtime();
    await r.message(text, {});
    assert.ok(r.calls.includes("interpret"), text);
    assert.notEqual((await r.load()).pauseState, "PAUSED_CONFIRMED");
  }
  const r = runtime();
  r.seed({ sku: "IPAD", stage: "CONFIRMATION", presentation: { done: true } });
  await r.message("quiero información de las laptops", {
    confirmation: "ambiguous",
  });
  assert.ok(r.calls.includes("interpret"));
  assert.notEqual((await r.load()).pauseState, "PAUSED_CONFIRMED");
});

async function inboxRecoveryFixture(rows, expectedPhones) {
  const { createInboxStore } = require("../lib/v2-storage");
  const { createIngress } = require("../lib/v2-ingress");
  const sheets = memorySheets();
  if (rows.length)
    await sheets.spreadsheets.values.update({
      range: "ENTRADAS_V2!A1",
      requestBody: { values: rows },
    });
  const store = createInboxStore(sheets, "fixture-inbox"),
    processed = [];
  const before = (
    await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" })
  ).data.values;
  assert.deepEqual(await store.keys(), expectedPhones);
  assert.deepEqual(
    (await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" })).data
      .values,
    before,
    "keys never modifies rows",
  );
  const ingress = createIngress({
    store,
    processMessage: async (message) => processed.push(message.from),
    now: () => 100000,
    delay: () => ({ unref() {} }),
    cancelDelay: () => {},
  });
  await assert.doesNotReject(() => ingress.recover());
  assert.deepEqual(processed.sort(), [...expectedPhones].sort());
  for (const number of expectedPhones) {
    const record = await store.get(number);
    assert.equal(record.retained, "valid record");
    assert.deepEqual(record.pending, []);
  }
  return { sheets, store };
}
function pendingInboxRow(number) {
  return [
    number,
    JSON.stringify({
      retained: "valid record",
      ids: {},
      rate: [],
      pending: [
        {
          due: 0,
          immediate: false,
          message: {
            id: "inbound-" + number,
            from: number,
            type: "text",
            text: { body: "Hola" },
          },
        },
      ],
    }),
  ];
}
test("ENTRADAS_V2 recovery ignores blank rows before a valid record, empty content and missing phones", async () => {
  const number = "593999123456";
  await inboxRecoveryFixture(
    [
      [],
      ["", ""],
      ["", JSON.stringify({ pending: [{}] })],
      ["   ", "{}"],
      ["593999000001", ""],
      ["593999000002", "  ", ""],
      pendingInboxRow(number),
    ],
    [number],
  );
});
test("ENTRADAS_V2 recovery processes both valid records across an intermediate blank row", async () => {
  const a = "593999123456",
    b = "593999222222";
  await inboxRecoveryFixture(
    [pendingInboxRow(a), [], ["", ""], pendingInboxRow(b)],
    [a, b],
  );
});
test("ENTRADAS_V2 empty sheet recovers without parsing empty content", async () => {
  await inboxRecoveryFixture([], []);
});
test("ENTRADAS_V2 normal valid record preserves chunked JSON and recovery behavior", async () => {
  const number = "593999123456",
    row = pendingInboxRow(number),
    json = row[1];
  await inboxRecoveryFixture(
    [
      [number, json.slice(0, 40), json.slice(40), ""],
      [
        "593999000003",
        JSON.stringify({ pending: [], retained: "no queued messages" }),
      ],
    ],
    [number],
  );
});
test("ENTRADAS_V2 malformed JSON is preserved and does not prevent other records recovering", async () => {
  const number = "593999123456",
    malformed = ["593999000004", '{"pending":'];
  const { sheets } = await inboxRecoveryFixture(
    [malformed, pendingInboxRow(number), ["593999000005", "null"]],
    [number],
  );
  const rows = (
    await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" })
  ).data.values;
  assert.deepEqual(rows[0], malformed);
});

test("sales interpreter requests minimal reasoning and visible JSON margin with configurable MODEL_LOW", async () => {
  const { createInterpreter } = require("../lib/sales-interpreter");
  const input = {
    text: "Necesito una laptop con 8 GB",
    context: { stage: "PRODUCT" },
  };
  const expected = {
    family: "windows",
    recommend: true,
    compatibleSkus: ["WIN"],
    data: { qty: 1 },
  };
  for (const model of ["gpt-5-nano", "fixture-configurable-model"]) {
    let request;
    const interpret = createInterpreter(
      {
        responses: {
          create: async (params) => {
            request = params;
            return {
              status: "completed",
              output_text: JSON.stringify(expected),
            };
          },
        },
      },
      { MODEL_LOW: model },
    );
    assert.deepEqual(await interpret(input), expected);
    assert.equal(request.model, model);
    assert.equal(request.reasoning.effort, "minimal");
    assert.equal(request.max_output_tokens, 2500);
    assert.deepEqual(JSON.parse(request.input[0].content), input);
    assert.deepEqual(input.context, { stage: "PRODUCT" });
  }
});
test("sales interpreter still rejects incomplete responses even with parseable output", async () => {
  const { createInterpreter } = require("../lib/sales-interpreter");
  for (const output_text of ["", '{"family":"windows"}']) {
    const interpret = createInterpreter(
      {
        responses: {
          create: async () => ({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output_text,
          }),
        },
      },
      { MODEL_LOW: "gpt-5-nano" },
    );
    await assert.rejects(
      () => interpret({ text: "Consulta" }),
      /INTERPRETATION_INCOMPLETE/,
    );
  }
});
test("sales interpreter JSON contract still rejects invalid completed extraction", async () => {
  const { createInterpreter } = require("../lib/sales-interpreter");
  for (const [output_text, error] of [
    ["not JSON", SyntaxError],
    ["[]", /INTERPRETATION_INVALID/],
    ['{"recommend":"yes"}', /INTERPRETATION_INVALID_BOOLEAN/],
    ['{"compatibleSkus":[1]}', /INTERPRETATION_INVALID_SKUS/],
    ['{"data":[]}', /INTERPRETATION_INVALID_DATA/],
  ]) {
    const interpret = createInterpreter(
      {
        responses: {
          create: async () => ({ status: "completed", output_text }),
        },
      },
      { MODEL_LOW: "gpt-5-nano" },
    );
    await assert.rejects(() => interpret({ text: "Consulta" }), error);
  }
});

const currentStockHeaders = [
  "ID-PRODUCTO",
  "PRODUCTO",
  "CAPACIDAD",
  "RAM",
  "COLOR",
  "STOCK",
  "PRECIO",
  "INFORMACION DEL PRODUCTO",
];
const currentStockRows = [
  [
    "ACERN16Q13-NEG",
    'Acer 12"',
    "128 GB",
    "4 GB",
    "Negro",
    7,
    129.25,
    '  💻 Acer 12"\nRAM: 4 GB\nAlmacenamiento: 128 GB\n📝 Texto completo de prueba, sin reescribir.  ',
  ],
  [
    "ASUSC202S-NEG",
    'ASUS 12"',
    "256 GB",
    "8 GB",
    "Negro",
    3,
    179.5,
    '💻 ASUS 12"\nRAM: 8 GB\nAlmacenamiento: 256 GB\n🔌 Información de producto de prueba',
  ],
  [
    "ASUSC300S-NEG",
    'ASUS 14"',
    "512 GB",
    "16 GB",
    "Negro",
    2,
    219.75,
    '💻 ASUS 14"\nRAM: 16 GB\nAlmacenamiento: 512 GB\n📚 Segunda línea completa',
  ],
  [
    "FUTURE-NO-RAM",
    "Producto futuro",
    "N/A",
    "",
    "Blanco",
    0,
    25,
    "Ficha de prueba sin RAM",
  ],
];
async function currentStockFixture() {
  const sheets = memorySheets();
  await sheets.spreadsheets.values.update({
    range: "'PAGINA DE STOCK'!A2:H6",
    requestBody: { values: [currentStockHeaders, ...currentStockRows] },
  });
  return sheets;
}
test("official eight-column headers require RAM and complete product-information title", () => {
  const { validateHeaders } = require("../lib/v2-inventory");
  assert.doesNotThrow(() => validateHeaders(currentStockHeaders));
  for (let column = 0; column < 8; column++) {
    const invalid = [...currentStockHeaders];
    invalid[column] = "";
    assert.throws(() => validateHeaders(invalid), /CATALOGO_INVALIDO/);
  }
  assert.throws(
    () =>
      validateHeaders([
        "ID-PRODUCTO",
        "PRODUCTO",
        "CAPACIDAD",
        "COLOR",
        "STOCK",
        "PRECIO",
        "INFO",
      ]),
    /CATALOGO_INVALIDO/,
  );
});
test("Acer 12, ASUS 12 and ASUS 14 catalog preserve RAM, stock, price and raw multiline emoji information", async () => {
  const { createSalesCatalog } = require("../lib/sales-catalog");
  const sheets = await currentStockFixture(),
    reads = [],
    read = sheets.spreadsheets.values.get;
  sheets.spreadsheets.values.get = async (args) => {
    reads.push(args);
    return read(args);
  };
  const snapshot = await createInventory({
    sheets,
    spreadsheetId: "fixture",
  }).catalog();
  const active = await createSalesCatalog(sheets, "fixture")();
  assert.deepEqual(active.master, snapshot.master);
  assert.deepEqual(active.available, snapshot.available);
  assert.equal(active.master.size, 4);
  assert.equal(active.available.size, 3);
  for (const row of currentStockRows) {
    const product = active.master.get(row[0]);
    assert.equal(product.producto, row[1]);
    assert.equal(product.capacidad, row[2]);
    assert.equal(product.ram, row[3]);
    assert.equal(product.color, row[4]);
    assert.equal(product.stock, row[5]);
    assert.equal(product.precio, row[6]);
    assert.equal(product.informacion_producto, row[7]);
    assert.equal(product.informacion, row[7]);
  }
  assert.ok(
    reads.every((args) =>
      ["'PAGINA DE STOCK'!A2:H2", "'PAGINA DE STOCK'!A3:H"].includes(
        args.range,
      ),
    ),
  );
  assert.ok(
    reads.every((args) => args.valueRenderOption === "UNFORMATTED_VALUE"),
  );
});
test("real initial laptop enquiry builds dynamic Windows offer from eight-column stock without writes", async () => {
  const { createSalesCatalog } = require("../lib/sales-catalog");
  const sheets = await currentStockFixture(),
    catalog = createSalesCatalog(sheets, "fixture");
  const writes = [];
  for (const operation of ["update", "append"])
    sheets.spreadsheets.values[operation] = async () => {
      writes.push(operation);
      throw Error("Unexpected sheet mutation");
    };
  sheets.spreadsheets.batchUpdate = async () => {
    writes.push("batchUpdate");
    throw Error("Unexpected sheet mutation");
  };
  const memory = new Map(),
    sent = [];
  const flow = createSalesFlow({
    store: {
      get: async (n) => memory.get(n) || null,
      set: async (n, c) => memory.set(n, structuredClone(c)),
      keys: async () => [...memory.keys()],
    },
    catalog,
    agencies,
    resources,
    interpret: async () => {
      throw Error("General query must bypass interpreter");
    },
    sendText: async (n, text) => sent.push(text),
  });
  await flow.process(
    NUMBER,
    "Hola, estoy interesado en las laptops y quisiera más información.",
  );
  assert.equal((await flow.load(NUMBER)).pauseState, "ACTIVE");
  assert.equal((await flow.load(NUMBER)).family, "windows");
  assert.match(sent[0], /laptops desde \$129\.25/);
  assert.match(sent[0], /Acer, Asus/i);
  assert.doesNotMatch(sent[0], /No pude cargar/);
  assert.deepEqual(writes, []);
});

test("general recommendation selects largest stock across five Windows brands and never requests recommendation audio", async () => {
  const items = ["Dell", "HP", "Lenovo", "Asus", "Acer"].map((name, i) => ({
    ...products[1],
    id_producto: "WIN-" + i,
    producto: name + " Windows",
    stock: [5, 8, 30, 12, 9][i],
    precio: 100 + i,
  }));
  for (const text of [
    "Recomiéndame una",
    "cuál me recomienda",
    "qué me recomienda",
    "escoja usted",
    "cuál me conviene",
    "cuál escogería",
  ]) {
    const r = runtime({ products: items });
    r.seed({ family: "windows" });
    await r.message(text, { intent: "recommendation", compatibleSkus: [] });
    const c = await r.load();
    assert.equal(c.sku, "WIN-2");
    assert.equal(c.family, "windows");
    assert.equal(c.product, "Lenovo Windows");
    assert.equal(c.variant, items[2].capacidad + " · " + items[2].color);
    assert.equal(c.unitPrice, 102);
    assert.equal(c.pauseState, "ACTIVE");
    assert.equal(c.pauseReason, undefined);
    assert.equal(c.presentation.sku, "WIN-2");
    assert.equal(c.presentation.done, true);
    assert.equal(c.stage, "CITY");
    assert.deepEqual(
      r.sent.slice(0, 4).map((s) => s.type),
      ["image", "video", "text", "audio"],
    );
    assert.ok(!r.calls.includes("interpret"));
  }
});
test("recommendation intent alone uses existing presentation for iPad and MacBook, highest stock and valid ties", async () => {
  for (const [family, base] of [
    ["ipad", products[0]],
    ["macbook", products[2]],
  ]) {
    const items = [
      { ...base, id_producto: family + "-low", stock: 1 },
      { ...base, id_producto: family + "-high", stock: 10 },
      { ...base, id_producto: family + "-tie", stock: 10 },
    ];
    const r = runtime({ products: items });
    r.seed({ family });
    await r.message("Sugiérame un modelo", { intent: "recommendation" });
    const c = await r.load();
    assert.ok([family + "-high", family + "-tie"].includes(c.sku));
    assert.equal(c.family, family);
    assert.equal(c.unitPrice, base.precio);
    assert.equal(c.pauseState, "ACTIVE");
    assert.equal(c.presentation.done, true);
    assert.equal(c.stage, "CITY");
    assert.deepEqual(
      r.sent.slice(0, 4).map((s) => s.type),
      ["image", "video", "text", "audio"],
    );
  }
});
test("recommendation with no available family stock is a normal response and requires no audio", async () => {
  for (const family of ["windows", "ipad", "macbook"]) {
    const r = runtime({ products: products.map((p) => ({ ...p, stock: 0 })) });
    r.seed({ family });
    await r.message("Recomiéndame una", { intent: "recommendation" });
    const c = await r.load();
    assert.equal(c.pauseState, "ACTIVE");
    assert.equal(c.stage, "PRODUCT");
    assert.equal(c.sku, null);
    assert.match(r.sent[0].text, /no tenemos unidades disponibles/);
    assert.ok(r.sent.every((s) => s.type === "text"));
    assert.equal(c.pauseReason, undefined);
  }
});

test("all response types prepare once without quick/block timing categories", async () => {
  for (const [text, interpretation] of [
    ["Hola", {}],
    ["quiero información de las MacBook", {}],
    ["quiero información de las laptops", {}],
    ["Garantía", { intent: "warranty" }],
    ["IPAD", { sku: "IPAD" }],
  ]) {
    const modes = [];
    const r = runtime({ onPrepare: (mode) => modes.push(mode) });
    await r.message(text, interpretation);
    assert.deepEqual(modes, [undefined], text);
  }
});
test("action zero failure logs safe index/SKU/error diagnostics without changing presentation pause", async (t) => {
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  const error = Object.assign(new Error("YCloud HTTP 503"), {
    status: 503,
    code: "ECONNRESET",
    request: {
      headers: { "X-API-Key": "fixture-SECRET-KEY" },
      body: "sensitive client payload",
    },
    cause: new Error("Bearer fixture-SECRET-TOKEN"),
  });
  const r = runtime({ mediaError: error });
  await r.message("IPAD", { sku: "IPAD" });
  const c = await r.load();
  assert.equal(c.stage, "PRESENTATION");
  assert.equal(c.pauseState, "PAUSED_ESCALATION");
  assert.equal(c.pauseReason, "PRESENTATION_DELIVERY_UNCERTAIN");
  assert.equal(c.presentation.index, 0);
  assert.equal(c.presentation.status, "reserved");
  const log = logs.find((row) => row[0] === "Presentation delivery failed");
  assert.ok(log);
  assert.equal(log[1].sku, "IPAD");
  assert.equal(log[1].index, 0);
  assert.equal(log[1].name, "Error");
  assert.equal(log[1].message, "YCloud HTTP 503");
  assert.equal(log[1].status, 503);
  assert.equal(log[1].code, "ECONNRESET");
  assert.doesNotMatch(
    JSON.stringify(logs),
    /fixture-SECRET|sensitive client payload|X-API-Key/,
  );
});
test("presentation diagnostic redacts secrets in arbitrary error fields but exposes standard JS failures", async (t) => {
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  const secret = "sk-fixture-private-key";
  const error = Object.assign(
    new Error(
      "Request Authorization: Bearer " +
        secret +
        " payload customer cedula=1234567890",
    ),
    { name: secret, code: secret, status: secret, cause: new Error(secret) },
  );
  const r = runtime({ mediaError: error });
  await r.message("IPAD", { sku: "IPAD" });
  assert.doesNotMatch(
    JSON.stringify(logs),
    /sk-fixture-private-key|1234567890|Authorization|Bearer/,
  );
  assert.ok(logs[0][1].message_redacted);
  assert.ok(logs[0][1].message_fingerprint);
  const standard = runtime({
    mediaError: new TypeError(
      "Cannot read properties of undefined (reading 'path')",
    ),
  });
  await standard.message("IPAD", { sku: "IPAD" });
  assert.equal(
    logs.at(-1)[1].message,
    "Cannot read properties of undefined (reading 'path')",
  );
});

test("MacBook entry recognises natural variants without inventory/interpreter dependency or automatic catalog", async () => {
  const question =
    "Qué tal estimado/a 😊 ¿Tiene algún modelo de preferencia que haya visto o desea que le envíe nuestro catálogo completo de MacBook Pro?";
  for (const text of [
    "MacBook",
    "MacBooks",
    "Mac Book",
    "Mac Books",
    "laptop Apple",
    "computadora Apple",
    "quiero ver las MacBook",
    "Estoy interesado en las MacBooks",
    "L estoy interesado en la MacBooks",
    "Estoy interesado en las MacBook",
    "Quiero información de Mac Books",
    "información de MacBook",
    "qué MacBook tienen",
  ]) {
    const r = runtime({ catalogError: true });
    await r.message(text, { sku: "UNKNOWN", intent: "unconfigured" });
    const c = await r.load();
    assert.equal(c.family, "macbook", text);
    assert.equal(c.stage, "PRODUCT");
    assert.equal(c.pauseState, "ACTIVE");
    assert.equal(c.sku, undefined);
    assert.equal(c.presentation, undefined);
    assert.deepEqual(r.sent, [{ type: "text", text: question }]);
    assert.ok(!r.calls.includes("catalog"));
    assert.ok(!r.calls.includes("interpret"));
  }
});

test("phase one greetings need neither inventory nor interpreter", async () => {
  const r = runtime({ catalogError: true });
  await r.message("Hola");
  assert.deepEqual(r.calls, []);
  assert.match(r.sent[0].text, /Bienvenido/);
  assert.equal((await r.load()).sku, undefined);
});
test("phase one catalog and exact SKU bypass interpretation", async () => {
  const r = runtime();
  await r.message("Quiero ver el catálogo de Windows");
  assert.ok(!r.calls.includes("interpret"));
  assert.match(r.sent.at(-1).text, /SKU WIN/);
  await r.message("Quiero WIN");
  assert.ok(!r.calls.includes("interpret"));
  assert.equal((await r.load()).sku, "WIN");
  assert.deepEqual(
    r.sent.filter((x) => x.type !== "text").map((x) => x.type),
    ["image", "video", "audio"],
  );
});
test("catalog cache expires, preserves valid data on failure and fresh reads fail closed", async () => {
  const { createSalesCatalog } = require("../lib/sales-catalog");
  let time = 100,
    reads = 0,
    fail = false,
    price = 100;
  const headers = [
    "ID-PRODUCTO",
    "PRODUCTO",
    "CAPACIDAD",
    "RAM",
    "COLOR",
    "STOCK",
    "PRECIO",
    "INFORMACION DEL PRODUCTO",
  ];
  const sheets = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          reads++;
          if (fail) throw Error("offline");
          return {
            data: {
              values: range.endsWith("H2")
                ? [headers]
                : [
                    [
                      "W",
                      "Dell Windows",
                      "16 GB",
                      "",
                      "Negro",
                      3,
                      price,
                      "Texto\n😊 completo",
                    ],
                  ],
            },
          };
        },
      },
    },
  };
  const catalog = createSalesCatalog(sheets, "fixture", {
    now: () => time,
    ttlMs: 30,
  });
  const first = await catalog();
  first.master.get("W").precio = 999;
  assert.equal((await catalog()).master.get("W").precio, 100);
  assert.equal(reads, 2);
  time += 31;
  fail = true;
  const stale = await catalog();
  assert.equal(stale.stale, true);
  assert.equal(stale.ageMs, 31);
  await assert.rejects(catalog({ fresh: true }), /offline/);
  fail = false;
  price = 120;
  assert.equal((await catalog({ fresh: true })).master.get("W").precio, 120);
});
test("confirmation always requests fresh catalog and rejects stale availability", async () => {
  const r = runtime();
  await buy(r, "WIN");
  const c = await r.load();
  assert.equal(c.stage, "CONFIRMATION");
  r.items[1].precio = 140;
  await r.message("Sí confirmo", { confirmation: "positive" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.match(r.sent.at(-1).text, /140/);
});

test("confirmation explicitly bypasses catalog cache", async () => {
  let freshRead = false;
  const r = runtime({
    onCatalog: (request) => {
      if (request?.fresh) freshRead = true;
    },
  });
  await buy(r, "WIN");
  await r.message("Sí confirmo", { confirmation: "positive" });
  assert.equal(freshRead, true);
});

test("confirmation outage never confirms and preserves active state", async () => {
  let fail = false;
  const r = runtime({
    onCatalog: (request) => {
      if (fail && request?.fresh) throw Error("offline");
    },
  });
  await buy(r, "WIN");
  fail = true;
  const before = r.sent.length;
  await r.message("Sí confirmo", { confirmation: "positive" });
  assert.equal((await r.load()).pauseState, "ACTIVE");
  assert.equal((await r.load()).confirmedAt, undefined);
  assert.equal(r.sent.length, before + 1);
  assert.match(r.sent.at(-1).text, /No pude cargar/);
});
test("ingress owns a single five-second window with typing before it and no duplicate preparation", async () => {
  const { createIngress } = require("../lib/v2-ingress");
  const data = new Map(),
    events = [];
  let clock = 1000;
  const store = {
    get: async (n) => structuredClone(data.get(n)),
    set: async (n, v) => data.set(n, structuredClone(v)),
    keys: async () => [...data.keys()],
  };
  const ingress = createIngress({
    store,
    now: () => clock,
    delay: (fn, ms) => {
      events.push(ms);
      return { unref() {} };
    },
    beforeWait: async () => {
      events.push("typing");
      return true;
    },
    processMessage: async (message) => {
      assert.equal(message.replyPrepared, true);
      events.push(message.text.body);
    },
  });
  const message = {
    from: NUMBER,
    id: "one",
    type: "text",
    text: { body: "Hola" },
  };
  await ingress.accept(message);
  assert.deepEqual(events, ["typing", 5000]);
  assert.equal(await ingress.accept(message), "duplicate");
  clock += 1000;
  await ingress.accept({ ...message, id: "two", text: { body: "MacBook" } });
  clock = 6000;
  await ingress.recover();
  assert.equal(events.at(-1), "Hola\nMacBook");
  assert.equal(events.filter((e) => e === 5000).length, 1);
});

test("bare Windows and iPad entries use stock without interpretation", async () => {
  for (const text of ["Windows", "laptops", "iPad", "las iPads"]) {
    const r = runtime();
    await r.message(text);
    assert.ok(!r.calls.includes("interpret"));
    assert.equal((await r.load()).pauseState, "ACTIVE");
  }
});

test("explicit catalog request preserves existing selected product and stage", async () => {
  const r = runtime();
  await buy(r, "WIN");
  const before = await r.load();
  r.calls.length = 0;
  await r.message("catálogo de iPad");
  const after = await r.load();
  assert.equal(after.sku, before.sku);
  assert.equal(after.family, before.family);
  assert.equal(after.stage, before.stage);
  assert.ok(!r.calls.includes("interpret"));
  assert.match(r.sent.at(-1).text, /SKU IPAD/);
});
