"use strict";
const { test, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { runtime } = require("./helpers/v2-runtime");
const { seedInventory } = require("./helpers/inventory-fixture");
const { createCommercialFlow } = require("../lib/v2-commercial-flow");
const { createAgencies, cityPages } = require("../lib/v2-agencies");
const { createProductMedia } = require("../lib/v2-product-media");
const { parse, canonicalPhone } = require("../lib/v2-admin-commands");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lu-hotfix-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const fields = (name, sector = "Centro") => [
  "R",
  "PICHINCHA",
  "QUITO",
  "T",
  name,
  sector,
  "Dirección sintética",
  "000",
  "S",
  "E",
  "H",
  "08 a 17",
  "08 a 12",
  "M",
];
fs.writeFileSync(
  path.join(root, "agencies.html"),
  "<table>" +
    [fields("QUITO_ASUNCION"), fields("QUITO_NORTE", "Norte")]
      .map((r) => "<tr>" + r.map((v) => `<td>${v}</td>`).join("") + "</tr>")
      .join("") +
    "</table>",
);
const agencies = createAgencies(root);
const items = [
  {
    id_producto: "IPAD16",
    producto: "IPAD AIR 1",
    capacidad: "16 GB",
    color: "plata",
    precio: 90,
    stock: 5,
    informacion: "Almacenamiento: 16 GB. Ficha dieciséis.",
  },
  {
    id_producto: "IPAD32",
    producto: "IPAD AIR 1",
    capacidad: "32 GB",
    color: "plata",
    precio: 100,
    stock: 5,
    informacion: "Almacenamiento: 32 GB. Ficha treinta y dos.",
  },
  {
    id_producto: "DELL",
    producto: "Chromebook Dell",
    capacidad: "64 GB",
    color: "negro",
    precio: 110,
    stock: 5,
    informacion: "Ficha oficial Dell.",
  },
];
const CLIENT = "000000000002",
  ADMIN = "000000000001";
function draft() {
  return {
    telefono: CLIENT,
    provincia: "PICHINCHA",
    ciudad: "QUITO",
    agencia: { id: agencies.all[0].id, nombre: "QUITO_ASUNCION" },
    lineas: [
      {
        id_producto: "IPAD16",
        producto: "IPAD AIR 1",
        capacidad: "16 GB",
        color: "plata",
        cantidad: 1,
        precio_unitario: 90,
      },
    ],
  };
}
function flow() {
  const texts = [],
    audio = [],
    images = [],
    media = [],
    logs = [],
    saved = [];
  let c = { estado: "interesado", historial: [] };
  const snapshot = { available: new Map(items.map((p) => [p.id_producto, p])) };
  const f = createCommercialFlow({
    agencies,
    save: async (n, c) => saved.push(structuredClone(c)),
    sendText: async (n, t) => texts.push(t),
    sendMedia: async (n, b) => {
      images.push(b);
      return true;
    },
    media: async (n, c, sku, options) => {
      media.push({ sku, options });
      return { images: 2, videos: 1 };
    },
    tts: {
      deliver: async (n, c, t, o) => {
        audio.push({ text: t, options: o });
      },
    },
    extract: async () => null,
    resolve: async (d) => {
      const lineas = d.lineas.map((l) => ({
        ...l,
        subtotal: l.cantidad * l.precio_unitario,
      }));
      return { lineas, total: lineas.reduce((n, l) => n + l.subtotal, 0) };
    },
    summary: (d) => "RESUMEN " + JSON.stringify(d),
    complete: (d) => !!(d.nombre && d.cedula && d.agencia),
    pending: async (n, c) => {
      c.pendingQuestion = { estado: "pendiente" };
      saved.push(structuredClone(c));
    },
    log: (e) => logs.push(e),
    now: () => new Date("2026-09-16T15:00Z"),
  });
  let id = 0;
  return {
    c,
    texts,
    audio,
    images,
    media,
    logs,
    saved,
    run: (t) => f(CLIENT, c, t, snapshot, { messageKey: "test" + ++id }),
    select: () => {
      c.commerce = { selected: "IPAD16", stage: "datos" };
      c.borradorPedido = draft();
    },
  };
}
for (const text of ["Hola", "Hola qué tal", "Buenas"])
  test(`saludo ${text} sin catálogo ni modelo`, async () => {
    const e = runtime();
    await e.message(text);
    assert.equal(e.calls.length, 0);
    assert.match(e.sent[0].text.body, /Hola/);
    assert.doesNotMatch(e.sent[0].text.body, /GB|\$|opciones disponibles/);
  });
test("intención iPad limita opciones a iPad", async () => {
  const f = flow();
  await f.run("quiero un iPad");
  assert.match(f.texts[0], /16 GB/);
  assert.match(f.texts[0], /32 GB/);
  assert.doesNotMatch(f.texts[0], /Dell/);
});
for (const capacity of [16, 32])
  test(`SKU ${capacity} usa fila exacta de información`, async () => {
    const f = flow();
    await f.run(`IPAD AIR 1 ${capacity} GB`);
    assert.equal(f.c.commerce.selected, "IPAD" + capacity);
    assert.match(f.audio[0].text, new RegExp(`Almacenamiento: ${capacity} GB`));
    assert.doesNotMatch(
      f.audio[0].text,
      new RegExp(`Almacenamiento: ${capacity === 16 ? 32 : 16} GB`),
    );
    assert.equal(f.media[0].sku, "IPAD" + capacity);
  });
test("16→32→16 cambia ficha y SKU sin mezclar", async () => {
  const f = flow();
  for (const capacity of [16, 32, 16]) {
    await f.run(`IPAD AIR 1 ${capacity} GB`);
    assert.equal(f.c.commerce.selected, "IPAD" + capacity);
    assert.match(
      f.audio.filter((x) => x.text.includes("Almacenamiento")).at(-1).text,
      new RegExp(`Almacenamiento: ${capacity} GB`),
    );
    assert.equal(f.c.borradorPedido.lineas[0].id_producto, "IPAD" + capacity);
  }
});
for (const [question, type] of [
  ["¿Tiene fotos del producto?", "image"],
  ["¿Tiene video?", "video"],
  ["¿Cómo se ve?", "image"],
  ["Quiero ver el funcionamiento", "video"],
])
  test(`solicitud ${type} atiende antes de ciudad y conserva etapa`, async () => {
    const f = flow();
    f.select();
    const before = structuredClone(f.c.borradorPedido);
    await f.run(question);
    assert.equal(f.media[0].options.type, type);
    assert.equal(f.media[0].sku, "IPAD16");
    assert.equal(f.c.commerce.stage, "datos");
    assert.deepEqual(f.c.borradorPedido, before);
    assert.equal(f.texts.length, 0);
  });
for (const forbidden of [/\bIA\b/i, /asistente virtual/i, /chatbot/i])
  test(`audio comercial sin ${forbidden}`, async () => {
    const f = flow();
    await f.run("IPAD16");
    assert.doesNotMatch(f.audio.at(-1).text, forbidden);
    assert.match(f.audio.at(-1).text, /^¿Qué tal, estimado/);
  });
test("característica larga pasa por servicio TTS, precio permanece texto", async () => {
  const f = flow();
  await f.run("IPAD16");
  assert.ok(f.audio.some((x) => x.text.includes("Ficha")));
  assert.ok(f.texts.some((t) => t.includes("$90.00")));
  assert.ok(!f.audio.some((x) => x.text.includes("$90.00")));
});
test("Quito infiere provincia y envía una imagen completa sin lista duplicada", async () => {
  const f = flow();
  await f.run("IPAD16");
  const start = f.texts.length;
  await f.run("Soy de Quito");
  assert.equal(f.c.borradorPedido.provincia, "PICHINCHA");
  assert.equal(f.images.length, 1);
  assert.deepEqual(f.texts.slice(start), [
    "Indíqueme por favor a cuál de estas agencias desea que le enviemos el equipo 😊",
  ]);
});
test("imagen contiene todos los bloques en orden, páginas completas si hace falta", () => {
  const many = Array.from({ length: 35 }, (_, i) => ({
    ...agencies.all[0],
    id: String(i),
    nombre: "Agencia " + i,
  }));
  const pages = cityPages(many);
  assert.ok(pages.length > 1);
  assert.deepEqual(
    pages.flatMap((p) => p.agencies).map((a) => a.id),
    many.map((a) => a.id),
  );
  assert.ok(pages.every((p) => p.bytes.length < 5 * 1024 * 1024));
});
for (const query of [
  "Quito Asunción",
  "Quito la Asunción",
  "Asunción",
  "la de Asunción",
  "agencia Asunción",
])
  test(`matching seguro ${query}`, () =>
    assert.equal(
      agencies.select(agencies.all, query).nombre,
      "QUITO_ASUNCION",
    ));
test("Asunción ambigua no adivina", () => {
  const rows = [
    ...agencies.all,
    { ...agencies.all[0], id: "other", nombre: "OTRA_ASUNCION" },
  ];
  assert.equal(agencies.select(rows, "Asunción"), null);
});
test("provincia posterior a ciudad no repite imágenes ni preguntas", async () => {
  const f = flow();
  await f.run("IPAD16");
  await f.run("Soy de Quito");
  const count = f.texts.length;
  await f.run("Pichincha");
  assert.equal(f.texts.length, count);
  assert.equal(f.images.length, 1);
});
test("nombre/cédula guardados antes de pregunta de entrega agrupada", async () => {
  const f = flow();
  f.select();
  await f.run("Pepe Tola\n0987654321\n¿En qué tiempo me llega?");
  assert.equal(f.saved[0].borradorPedido.nombre, "Pepe Tola");
  assert.equal(f.saved[0].borradorPedido.cedula, "0987654321");
  assert.match(f.texts[0], /24 y 48/);
  assert.match(f.texts[1], /RESUMEN/);
  assert.ok(!f.c.pendingQuestion);
  assert.doesNotMatch(f.texts.join(" "), /comparte.*cédula/);
});
test("pregunta posterior no borra datos ni repite resumen", async () => {
  const f = flow();
  f.select();
  await f.run("Pepe Tola\n0987654321");
  await f.run("¿En qué tiempo me llega?");
  assert.equal(f.c.borradorPedido.nombre, "Pepe Tola");
  assert.equal(f.texts.filter((t) => t.startsWith("RESUMEN")).length, 1);
  assert.equal(f.c.esperandoConfirmacionPedido, true);
});
test("pregunta complicada guarda datos antes de escalar", async () => {
  const f = flow();
  f.select();
  await f.run(
    "Pepe Tola\n0987654321\n¿Me garantiza una hora exacta de entrega?",
  );
  assert.equal(f.c.borradorPedido.cedula, "0987654321");
  assert.equal(f.c.pendingQuestion.estado, "pendiente");
});
const phone = "593990000001";
async function pendingRuntime(stored = phone, options = {}) {
  const e = runtime(options);
  await e.seed(
    {
      estado: "interesado",
      provider: "ycloud",
      pendingQuestion: { estado: "pendiente", notice: { estado: "enviada" } },
      commerce: { selected: "IPAD16", stage: "datos" },
      borradorPedido: { ...draft(), nombre: "Pepe Tola", cedula: "0987654321" },
      historial: [],
    },
    stored,
  );
  return e;
}
for (const ref of ["+593990000001", "593990000001", "0990000001"])
  for (const stored of [phone, "+" + phone])
    test(`RESPONDER ${ref} resuelve MEMORIA ${stored[0] === "+" ? "con +" : "sin +"}`, async () => {
      const e = await pendingRuntime(stored);
      await e.message(`RESPONDER (${ref}): Sí.`, { from: ADMIN });
      assert.equal(e.sent.length, 1);
      assert.equal(e.sent[0].to, stored);
      assert.equal(e.sent[0].text.body, "Sí.");
      const c = await e.load(stored);
      assert.equal(c.pendingQuestion.estado, "resuelta");
      assert.equal(c.pendingQuestion.question, undefined);
      assert.equal(c.historial.at(-1).content, "Sí.");
      assert.equal(c.borradorPedido.cedula, "0987654321");
      assert.equal(c.commerce.selected, "IPAD16");
      assert.equal(c.commerce.stage, "datos");
      assert.equal(e.calls.length, 0);
    });
test("RESPONDER CH resuelve pregunta sin saltar takeover real", async () => {
  const e = await pendingRuntime();
  let c = await e.load(phone);
  c.pedido = { id: "LU0001", id_chat: "CH000123", estado: "confirmado" };
  await e.seed(c, phone);
  await e.message("RESPONDER (CH000123): Sí.", { from: ADMIN });
  assert.equal(e.sent.length, 1);
  c = await e.load(phone);
  c.pendingQuestion = { estado: "pendiente" };
  c.human_takeover = true;
  await e.seed(c, phone);
  await e.message("RESPONDER (CH000123): Otra.", { from: ADMIN });
  assert.equal(e.sent.length, 1);
});
for (const command of [
  "RESPONDER +593990000001: Sí.",
  "RESPONDER 0990000001: Sí.",
  "Sí, estimado",
])
  test(`admin sin sintaxis permanece silencioso ${command}`, async () => {
    const e = await pendingRuntime();
    await e.message(command, { from: ADMIN });
    assert.equal(e.sent.length, 0);
    assert.equal(e.calls.length, 0);
    assert.equal((await e.load(phone)).pendingQuestion.estado, "pendiente");
  });
test("RESPONDER largo usa audio y webhook duplicado no duplica", async () => {
  const e = await pendingRuntime(phone, {
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
  });
  const text =
    "Con gusto le comparto la explicación comercial verificada para su consulta. ".repeat(
      6,
    );
  await e.message(`RESPONDER (0990000001): ${text}`, {
    from: ADMIN,
    id: "reply",
  });
  await e.message(`RESPONDER (0990000001): ${text}`, {
    from: ADMIN,
    id: "reply",
  });
  assert.equal(e.sent.length, 1);
  assert.equal(e.sent[0].type, "audio");
  assert.equal(e.control.tts, 1);
});
test("normalización Ecuador no altera fixtures ni crea identidad CH", () => {
  assert.equal(canonicalPhone("0990000001"), phone);
  assert.equal(canonicalPhone("+593990000001"), phone);
  assert.equal(parse("RESPONDER (CH000123): Sí.").ref, "CH000123");
  assert.equal(canonicalPhone(CLIENT), CLIENT);
});
test("datos y etapa sobreviven reinicio y RESPONDER permite continuar", async () => {
  const e = await pendingRuntime();
  await e.inventoryReady;
  await seedInventory(
    e.sheets,
    items.map((p) => [
      p.id_producto,
      p.producto,
      p.capacidad,
      p.color,
      p.stock,
      p.precio,
      p.informacion,
    ]),
  );
  await e.message(`RESPONDER (${phone}): Sí.`, { from: ADMIN });
  const r = runtime({ sheets: e.sheets });
  await r.message("¿En qué tiempo me llega?", {
    from: phone,
    provider: "ycloud",
  });
  const c = await r.load(phone);
  assert.equal(c.borradorPedido.nombre, "Pepe Tola");
  assert.equal(c.commerce.stage, "datos");
  assert.equal(c.esperandoConfirmacionPedido, true);
  assert.match(r.sent[0].text.body, /24 y 48/);
});
test("logs de comando no contienen teléfono/cédula ni respuesta", async () => {
  const e = await pendingRuntime();
  await e.message(`RESPONDER (${phone}): contenido privado sensible`, {
    from: ADMIN,
  });
  const logs = JSON.stringify(e.logs);
  for (const value of [phone, "0987654321", "contenido privado sensible"])
    assert.ok(!logs.includes(value));
  for (const name of [
    "admin_command_received",
    "admin_command_valid",
    "admin_target_resolved",
    "admin_response_sent",
  ])
    assert.ok(logs.includes(name));
});
test("solicitud explícita repite media solo para nueva entrada, no para retry", async () => {
  const dir = path.join(root, "products");
  fs.mkdirSync(path.join(dir, "IPAD16/imagen"), { recursive: true });
  fs.writeFileSync(path.join(dir, "IPAD16/imagen/foto.jpg"), "image");
  let count = 0;
  const media = createProductMedia({
      root: dir,
      catalog: async () => ({ available: new Map([["IPAD16", {}]]) }),
      save: async () => {},
      send: async () => {
        count++;
        return true;
      },
    }),
    c = {};
  await media(CLIENT, c, "IPAD16");
  await media(CLIENT, c, "IPAD16", { type: "image", requestKey: "request" });
  await media(CLIENT, c, "IPAD16", { type: "image", requestKey: "request" });
  assert.equal(count, 2);
});
test("promoción no se repite al cambiar variante", async () => {
  const f = flow();
  await f.run("IPAD16");
  await f.run("IPAD32");
  assert.equal((f.texts.join(" ").match(/Envío gratis/g) || []).length, 1);
});
test("G contradictoria no publica almacenamiento de otra variante", async () => {
  const f = flow();
  const original = items[0].informacion;
  try {
    items[0].informacion = "Almacenamiento: 32 GB";
    await f.run("IPAD16");
    assert.doesNotMatch(
      f.audio.map((x) => x.text).join(" "),
      /Almacenamiento: 32 GB/,
    );
    assert.equal(f.c.pendingQuestion.estado, "pendiente");
  } finally {
    items[0].informacion = original;
  }
});
