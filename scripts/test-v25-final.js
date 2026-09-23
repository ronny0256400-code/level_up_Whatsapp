"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { runtime } = require("./helpers/v2-runtime");
const { seedInventory } = require("./helpers/inventory-fixture");
const {
  dispatchMessage,
  criticalAnswer,
  manualOffer,
} = require("../lib/v2-final-rules");
const { createAgencies } = require("../lib/v2-agencies");
const { createCommercialFlow } = require("../lib/v2-commercial-flow");
const { createInventory } = require("../lib/v2-inventory");
const path = require("node:path"),
  fs = require("node:fs");
const CLIENT = "000000000002",
  ADMIN = "000000000001";
function draft(price = 100) {
  return {
    nombre: "Persona sintética",
    cedula: "1234567890",
    telefono: CLIENT,
    provincia: "Guayas",
    ciudad: "Guayaquil",
    agencia: { id: "fixture", nombre: "Agencia sintética" },
    lineas: [
      {
        id_producto: "EQUIPO",
        producto: "Equipo de prueba",
        capacidad: "32 GB",
        color: "plateado",
        cantidad: 1,
        precio_unitario: price,
      },
    ],
    total: price,
  };
}
async function waiting(price = 100, options = {}) {
  const e = runtime(options);
  await e.inventoryReady;
  await seedInventory(e.sheets, [
    [
      "EQUIPO",
      "Equipo de prueba",
      "32 GB",
      "plateado",
      3,
      price,
      "Dato oficial",
    ],
  ]);
  const read = e.sheets.spreadsheets.values.get;
  e.sheets.spreadsheets.values.get = async (args) => {
    const result = await read(args);
    if (args.range === "'PAGINA DE STOCK'!A3:G") {
      const sales = (await read({ range: "'REGISTRO DE VENTAS'!A5:W" })).data
        .values;
      result.data.values = result.data.values.map((row) => {
        const v = [...row];
        if (v[0] === "EQUIPO")
          v[4] =
            3 -
            sales
              .filter(
                (r) =>
                  r[14] === "EQUIPO" &&
                  ["enviado", "en agencia", "retirado", "cancelado"].includes(
                    r[5],
                  ),
              )
              .reduce((n, r) => n + Number(r[18]), 0);
        return v;
      });
    }
    return result;
  };
  await e.seed({
    estado: "esperando_confirmacion",
    esperandoConfirmacionPedido: true,
    historial: [],
    borradorPedido: draft(price),
  });
  return e;
}
for (const amount of [299, 300, 301, 1000, 10000])
  test(`monto ${amount}: mismo flujo, CH/LU durable, confirmación no afecta stock y GUIA registra`, async () => {
    const e = await waiting(amount);
    await e.message("confirmo", { provider: "ycloud", id: "confirm" });
    const c = await e.load();
    assert.equal(c.pedido.total, amount);
    assert.equal(c.pedido.id_chat, "CH000001");
    assert.equal(c.datosCliente.cedula, "1234567890");
    assert.equal(c.human_takeover, true);
    assert.equal(
      (await e.api.inventarioFinal().findSale({ orderId: c.pedido.id })).length,
      0,
    );
    assert.equal(
      (await e.api.inventarioFinal().catalog()).available.get("EQUIPO").stock,
      3,
    );
    const r = runtime({ sheets: e.sheets });
    await r.message("confirmo", { provider: "ycloud" });
    assert.equal(r.sent.length, 0);
    assert.equal((await r.load()).pedido.id, c.pedido.id);
    await r.message("GUIA (CH000001) (FINAL)", { from: ADMIN });
    assert.equal(
      (await r.api.inventarioFinal().findSale({ orderId: c.pedido.id })).length,
      1,
    );
    assert.equal(
      (await r.api.inventarioFinal().catalog()).available.get("EQUIPO").stock,
      2,
    );
  });
for (const [when, label] of [
  ["2026-09-18T21:59Z", "día de hoy"],
  ["2026-09-18T22:00Z", "día de hoy"],
  ["2026-09-18T22:01Z", "el sábado"],
  ["2026-09-19T15:59Z", "día de hoy"],
  ["2026-09-19T16:00Z", "día de hoy"],
  ["2026-09-19T16:01Z", "el lunes"],
  ["2026-09-20T15:00Z", "el lunes"],
  ["2026-09-30T23:00Z", "el jueves"],
])
  test(`despacho ${when}`, () =>
    assert.ok(dispatchMessage(new Date(when)).includes(label)));
for (const phrase of ["dale de una", "hágale", "envíelo", "está coredto"])
  test(`confirmación inequívoca ${phrase}`, async () => {
    const e = await waiting();
    await e.message(phrase);
    assert.equal((await e.load()).pedido.estado, "confirmado");
    assert.equal(e.calls.length, 0);
  });
test("sí pero cambie mi cédula no confirma", async () => {
  const e = await waiting();
  e.control.data = { cedula: "9999999999" };
  await e.message("sí pero cambie mi cédula");
  assert.ok(!(await e.load()).pedido);
  assert.equal((await e.load()).borradorPedido.cedula, "9999999999");
});
for (const fail of [false, true])
  test(`logística TTS ${fail ? "fallback exacto" : "audio"} una vez, aun tras reinicio`, async () => {
    const e = await waiting(100, {
      env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
      speech: async () => {
        if (fail) throw Error("fixture");
        return { arrayBuffer: async () => Buffer.from("opus") };
      },
    });
    await e.message("confirmo", { provider: "ycloud", id: "same" });
    const c = await e.load();
    assert.equal(c.pedido.logisticaCliente.estado, "enviada");
    assert.equal(
      e.sent.filter(
        (m) =>
          m.to === CLIENT &&
          m.text?.body === "✅ Pedido confirmado correctamente.",
      ).length,
      1,
    );
    assert.equal(
      e.sent.filter((m) => m.to === CLIENT && m.type === "audio").length,
      fail ? 0 : 1,
    );
    if (fail)
      assert.equal(
        e.sent.filter((m) => m.text?.body === c.pedido.logisticaCliente.text)
          .length,
        1,
      );
    await e.message("confirmo", { provider: "ycloud", id: "same" });
    const r = runtime({ sheets: e.sheets });
    await r.api.revisarSeguimientos();
    assert.equal(r.sent.length, 0);
    assert.equal(e.control.tts, 1);
  });
test("TEST_MODE postconfirmación sin generación ni transporte", async () => {
  const e = await waiting(1000, {
    env: { TEST_MODE: "true", OPENAI_TTS_ENABLED: "true" },
    testModeSharedSheets: true,
  });
  await e.message("confirmo");
  assert.equal(e.control.tts, 0);
  assert.equal(e.sent.length, 0);
  assert.equal((await e.load()).pedido.logisticaCliente.estado, "enviada");
});
for (const answer of [
  "Sí, correcto.",
  "Le queda en $185.",
  "Le comparto la información que revisamos sobre la compra y su preparación. ".repeat(
    6,
  ),
])
  test(`RESPONDER tipo ${answer.length}`, async () => {
    const e = runtime({
      env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
    });
    await e.seed({
      estado: "interesado",
      provider: "ycloud",
      pendingQuestion: { estado: "pendiente", notice: { estado: "enviada" } },
      commerce: { stage: "ubicacion" },
    });
    await e.message(`RESPONDER (${CLIENT}): ${answer}`, { from: ADMIN });
    assert.equal((await e.load()).pendingQuestion.estado, "resuelta");
    assert.equal(
      e.sent[0].type || (e.sent[0].text ? "text" : null),
      criticalAnswer(answer) || answer.length <= 250 ? "text" : "audio",
    );
    await e.message(`RESPONDER (${CLIENT}): ${answer}`, { from: ADMIN });
    assert.equal(e.sent.length, 1);
  });
for (const message of [
  "sí estimado le queda en $185",
  `RESPONDER ${CLIENT}: Hola`,
  `RESPONDER (${CLIENT}) Hola`,
  "IR (CH000001)",
])
  test(`admin inválido silencioso ${message}`, async () => {
    const e = runtime();
    await e.message(message, { from: ADMIN });
    assert.equal(e.sent.length, 0);
    assert.equal(e.calls.length, 0);
  });
test("no queda regla de purga/límite en runtime", () => {
  for (const file of ["server.js", "lib/v2-policy.js", "lib/v2-inventory.js"])
    assert.doesNotMatch(
      fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
      /limite_300|limit_300|LIMITE_300|purgarPedidoHumano|requires_human/,
    );
});
const agencies = createAgencies(
  path.join(__dirname, "../resources/agencias/Ecuador"),
);
for (const city of ["Guayaquil", "Guayaqui", "Cuenca"])
  test(`ciudad inequívoca ${city} resuelve provincia`, () => {
    const rows = agencies.find(null, city);
    assert.ok(rows.length);
    assert.equal(new Set(rows.map((r) => r.provincia)).size, 1);
  });
for (const [query, index] of [
  ["la primera", 0],
  ["la segunda", 1],
])
  test(`agencia ${query}`, () => {
    const rows = agencies.all.slice(0, 2);
    assert.equal(agencies.select(rows, query).id, rows[index].id);
  });
test("esa/anterior requieren una única agencia, no adivinan", () => {
  const rows = agencies.all.slice(0, 2);
  assert.equal(agencies.select(rows, "esa"), null);
  assert.equal(agencies.select(rows, "la anterior"), null);
  assert.equal(agencies.select(rows.slice(0, 1), "esa").id, rows[0].id);
});
test("oferta manual exacta solo SKU/cantidad/chat actual; no extrapola", async () => {
  const e = await waiting();
  const d = draft();
  d.lineas[0].cantidad = 2;
  d.manualOffer = manualOffer(
    "Por la compra de 2 equipos ambos le salen en $185",
    d,
  );
  const inv = e.api.inventarioFinal();
  assert.equal((await inv.resolve(d)).total, 185);
  const other = draft();
  other.lineas[0].cantidad = 2;
  assert.equal((await inv.resolve(other)).total, 200);
  for (const qty of [1, 3]) {
    d.lineas[0].cantidad = qty;
    assert.equal((await inv.resolve(d)).total, qty * 100);
  }
});
function commercial() {
  const messages = [],
    spoken = [],
    c = { estado: "interesado", historial: [] };
  const e = runtime();
  const inv = createInventory({
    sheets: e.sheets,
    spreadsheetId: "stock-fixture",
  });
  let data = null;
  const run = createCommercialFlow({
    agencies,
    save: async () => {},
    sendText: async (n, t) => messages.push(t),
    sendMedia: async () => true,
    media: async () => ({ images: 0, videos: 0 }),
    tts: { deliver: async (n, c, t) => spoken.push(t) },
    extract: async () => data,
    resolve: (d) => inv.resolve(d),
    summary: (d) => JSON.stringify(d),
    complete: (d) => !!(d.nombre && d.cedula && d.agencia),
    pending: async () => {
      c.pendingQuestion = { estado: "pendiente" };
    },
    now: () => new Date("2026-09-16T15:00Z"),
  });
  return {
    e,
    c,
    inv,
    messages,
    spoken,
    setData: (d) => (data = d),
    run: async (text, options = {}) => {
      await e.inventoryReady;
      return run(CLIENT, c, text, await inv.catalog(), {
        correction: true,
        messageKey: text,
        ...options,
      });
    },
  };
}
test("producto Dell a iPad y cantidad 1→2→1→3 no mezcla ni conserva descuento", async () => {
  const f = commercial();
  await f.e.inventoryReady;
  await seedInventory(f.e.sheets, [
    ["DELL", "Dell", "32 GB", "negro", 5, 100, "Ficha Dell"],
    ["IPAD", "iPad", "64 GB", "plata", 5, 110, "Ficha iPad"],
  ]);
  Object.assign(f.c, {
    commerce: { selected: "DELL", stage: "datos" },
    borradorPedido: {
      ...draft(),
      lineas: [
        {
          id_producto: "DELL",
          producto: "Dell",
          cantidad: 1,
          precio_unitario: 100,
        },
      ],
    },
  });
  await f.run("cambia a iPad");
  assert.equal(f.c.borradorPedido.lineas[0].id_producto, "IPAD");
  assert.equal(f.c.borradorPedido.total, 110);
  for (const qty of [2, 1, 3]) {
    await f.run(`cantidad ${qty}`);
    assert.equal(f.c.borradorPedido.total, 110 * qty);
    assert.equal(f.c.borradorPedido.lineas.length, 1);
  }
});
test("ciudad única en flujo no llama extractor ni pregunta provincia", async () => {
  const f = commercial();
  await f.run("Equipo de prueba");
  await f.run("Guayaquil");
  assert.equal(f.c.borradorPedido.provincia, "GUAYAS");
  assert.equal(f.c.commerce.stage, "agencia");
  assert.match(f.messages.at(-1), /Indíqueme por favor/);
});
test("oferta RESPONDER se guarda solo en borrador de ese cliente", async () => {
  const e = await waiting();
  const c = await e.load();
  c.esperandoConfirmacionPedido = false;
  c.estado = "interesado";
  c.borradorPedido.lineas[0].cantidad = 2;
  c.pendingQuestion = { estado: "pendiente", notice: { estado: "enviada" } };
  await e.seed(c);
  await e.message(
    `RESPONDER (${CLIENT}): Por la compra de 2 equipos ambos le salen en $185`,
    { from: ADMIN },
  );
  assert.equal((await e.load()).borradorPedido.total, 185);
  assert.ok(!(await e.load("000000000003")).borradorPedido);
});

test("audio postconfirmación incierto no agrega texto ni se repite", async () => {
  const e = await waiting(100, {
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
    mediaError: Error("timeout"),
  });
  await e.message("confirmo", { provider: "ycloud" });
  assert.equal((await e.load()).pedido.logisticaCliente.estado, "incierta");
  assert.equal(e.sent.filter((m) => m.to === CLIENT).length, 1);
  const r = runtime({ sheets: e.sheets });
  await r.api.revisarSeguimientos();
  assert.equal(r.sent.length, 0);
});
test("RESPONDER audio incierto queda para reconciliación", async () => {
  const e = runtime({
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
    mediaError: Error("timeout"),
  });
  await e.seed({
    estado: "interesado",
    provider: "ycloud",
    pendingQuestion: { estado: "pendiente", notice: { estado: "enviada" } },
  });
  await e.message(
    `RESPONDER (${CLIENT}): ${"Información comercial verificada para su consulta. ".repeat(8)}`,
    { from: ADMIN },
  );
  assert.equal((await e.load()).pendingQuestion.responseBox.estado, "incierta");
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 0);
  assert.equal(e.control.tts, 1);
});
test("cantidad corregida en router real emite resumen nuevo sin confirmar", async () => {
  const e = await waiting();
  await e.message("cantidad 2");
  const c = await e.load();
  assert.ok(!c.pedido);
  assert.equal(c.borradorPedido.total, 200);
  assert.equal(c.esperandoConfirmacionPedido, true);
  assert.match(e.sent.at(-1).text.body, /Cantidad: 2/);
});
test("cédula se recopila sin checksum matemático", async () => {
  const e = await waiting();
  e.control.data = { cedula: "1111111111" };
  await e.message("corrige mi cédula a 1111111111");
  await e.message("confirmo");
  assert.equal((await e.load()).datosCliente.cedula, "1111111111");
});
test("stock desaparece después de confirmar y GUIA no escribe", async () => {
  const e = await waiting();
  await e.message("confirmo");
  await e.sheets.spreadsheets.values.update({
    range: "'PAGINA DE STOCK'!A3:G",
    requestBody: { values: [["OTRO", "Otro", "32 GB", "plata", 1, 100, ""]] },
  });
  await e.message("GUIA (CH000001) (SIN-STOCK)", { from: ADMIN });
  assert.equal(
    (await e.api.inventarioFinal().findSale({ orderId: "LU0001" })).length,
    0,
  );
  assert.equal((await e.load()).pedido.guia, null);
});
test("retiro semántico antes de LLEGO conserva enviado", async () => {
  const e = await waiting();
  await e.message("confirmo");
  await e.message("GUIA (CH000001) (G)", { from: ADMIN });
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  await e.message("ya lo tengo");
  assert.equal((await e.load()).pedido.estado, "enviado");
});
test("LLEGO reinicio y dos LIBERAR emiten llegada una vez", async () => {
  const e = await waiting();
  await e.message("confirmo");
  await e.message("GUIA (CH000001) (G)", { from: ADMIN });
  await e.message("LLEGO (G)", { from: ADMIN });
  const date = (await e.load()).pedido.fechaLlegada;
  const r = runtime({ sheets: e.sheets });
  await r.message("LLEGO (G)", { from: ADMIN });
  await r.message("LIBERAR (CH000001)", { from: ADMIN });
  const count = r.sent.length;
  await r.message("LIBERAR (CH000001)", { from: ADMIN });
  assert.equal(r.sent.length, count);
  assert.equal((await r.load()).pedido.fechaLlegada, date);
  assert.equal((await r.load()).pedido.avisoLlegada.estado, "enviada");
});
test("72h no ejecuta el followup de 96h", async () => {
  const e = runtime();
  await e.seed({
    estado: "interesado",
    commercialFollowups: 1,
    last_customer_message_at: "2026-09-14T15:00:00Z",
  });
  e.control.time = Date.parse("2026-09-17T15:00:00Z");
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 0);
  e.control.time = Date.parse("2026-09-18T15:00:00Z");
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 1);
  assert.equal((await e.load()).estado, "abandono");
});
test("ubicación de bodegas usa contenido aprobado sin dirección inventada", async () => {
  const f = commercial();
  await f.run("¿Dónde están?", { correction: false });
  assert.match(f.spoken.at(-1), /Guayaquil/);
  assert.match(f.spoken.at(-1), /no recibimos clientes/);
  assert.ok(!f.c.pedido);
});
test("capacidad mayor agotada distingue nube de memoria física", async () => {
  const f = commercial();
  await f.run("Equipo de prueba");
  await f.run("Quiero mayor capacidad", { correction: false });
  assert.match(f.spoken.at(-1), /no aumentan la memoria física/);
  assert.match(f.spoken.at(-1), /Google Drive o iCloud/);
});
test("dato no registrado nunca inventa CPU/RAM", async () => {
  const f = commercial();
  await f.run("Equipo de prueba");
  await f.run("¿Tiene Celeron y 4 GB RAM?", { correction: false });
  assert.equal(f.c.pendingQuestion.estado, "pendiente");
  assert.doesNotMatch(f.messages.join(" "), /Celeron|4 GB RAM/);
});
test("compra futura no crea estado ni reserva ni timer especial", async () => {
  const f = commercial();
  await f.run("me pagan a fin de mes", { correction: false });
  assert.equal(f.c.estado, "interesado");
  assert.ok(!f.c.pedido);
  assert.ok(!f.c.next_followup_at);
  assert.doesNotMatch(f.messages.at(-1), /\$10|reserva/);
});
test("precio y audio comercial no duplican envío gratis", async () => {
  const f = commercial();
  await f.run("Equipo de prueba");
  assert.equal(
    (
      f.messages
        .concat(f.spoken)
        .join(" ")
        .match(/envío gratis/gi) || []
    ).length,
    1,
  );
  assert.ok(f.c.communicated.promotion);
});
test("cambio de agencia regenera resumen con agencia elegida", async () => {
  const f = commercial();
  f.c.borradorPedido = draft();
  f.c.commerce = { selected: "EQUIPO", stage: "ubicacion" };
  await f.run("Guayaquil");
  const ids = f.c.commerce.agencyCandidates;
  await f.run("la segunda");
  assert.equal(f.c.borradorPedido.agencia.id, ids[1]);
  assert.equal(f.c.estado, "esperando_confirmacion");
  assert.match(f.messages.at(-1), new RegExp(ids[1]));
});
test("oferta manual invalida al variar catálogo, no autoriza precio viejo", async () => {
  const e = await waiting();
  const d = draft();
  d.lineas[0].cantidad = 2;
  d.manualOffer = manualOffer(
    "Por la compra de 2 equipos ambos le salen en $185",
    d,
  );
  await seedInventory(e.sheets, [
    ["EQUIPO", "Equipo de prueba", "32 GB", "plateado", 3, 120, ""],
  ]);
  assert.equal((await e.api.inventarioFinal().resolve(d)).total, 240);
});
test("GUIA conserva oferta aprobada y fórmulas de precio intactas", async () => {
  const e = await waiting();
  const c = await e.load();
  c.borradorPedido.lineas[0].cantidad = 2;
  c.borradorPedido.manualOffer = manualOffer(
    "Por la compra de 2 equipos ambos le salen en $185",
    c.borradorPedido,
  );
  Object.assign(
    c.borradorPedido,
    await e.api.inventarioFinal().resolve(c.borradorPedido),
  );
  await e.seed(c);
  await e.message("confirmo");
  await e.message("GUIA (CH000001) (OFERTA)", { from: ADMIN });
  assert.equal((await e.load()).pedido.total, 185);
  assert.equal((await e.load()).pedido.estado, "enviado");
  const row = (
    await e.sheets.spreadsheets.values.get({
      range: "'REGISTRO DE VENTAS'!A5:W",
      valueRenderOption: "FORMULA",
    })
  ).data.values[0];
  assert.match(row[19], /^=FORMULA/);
  assert.match(row[20], /^=FORMULA/);
});

test("ciudad homónima entre provincias requiere aclaración", () => {
  const os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lu-agency-"));
  try {
    const row = (p) =>
      "<tr>" +
      [
        "R",
        p,
        "Ciudad común",
        "T",
        "Agencia " + p,
        "Centro",
        "Dirección",
        "T",
        "S",
        "E",
        "H",
        "L",
        "F",
        "M",
      ]
        .map((v) => "<td>" + v + "</td>")
        .join("") +
      "</tr>";
    fs.writeFileSync(
      path.join(root, "a.html"),
      "<table>" + row("Provincia A") + row("Provincia B") + "</table>",
    );
    const index = createAgencies(root);
    assert.equal(index.find(null, "Ciudad común").length, 0);
    assert.equal(index.find("Provincia A", "Ciudad común").length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("video fallido no impide procesar siguiente video ni duplica fotos", async () => {
  const os = require("node:os"),
    { createProductMedia } = require("../lib/v2-product-media");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lu-video-"));
  try {
    for (const dir of ["imagen", "video"])
      fs.mkdirSync(path.join(root, "SKU", dir), { recursive: true });
    fs.writeFileSync(path.join(root, "SKU/imagen/foto.jpg"), "photo");
    for (const n of [1, 2])
      fs.writeFileSync(path.join(root, `SKU/video/video-${n}.mp4`), String(n));
    let calls = 0;
    const c = {};
    const media = createProductMedia({
      root,
      catalog: async () => ({ available: new Map([["SKU", {}]]) }),
      save: async () => {},
      send: async (n, b) => {
        calls++;
        if (b.toString() === "1") throw Error("fixture");
        return true;
      },
    });
    const result = await media(CLIENT, c, "SKU");
    assert.deepEqual(result, { images: 1, videos: 1 });
    assert.equal(calls, 3);
    await media(CLIENT, c, "SKU");
    assert.equal(calls, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("dos confirmaciones cercanas no recrean LU/CH ni cierre", async () => {
  const e = await waiting();
  await Promise.all([
    e.message("confirmo", { id: "same" }),
    e.message("confirmo", { id: "same" }),
  ]);
  assert.equal((await e.load()).pedido.id_chat, "CH000001");
  assert.equal(
    e.sent.filter((m) => m.text?.body === "✅ Pedido confirmado correctamente.")
      .length,
    1,
  );
});
test("oferta por cantidad diferente no se aplica ni se aprende", () => {
  const d = draft();
  assert.equal(
    manualOffer("Por la compra de 2 equipos ambos le salen en $185", d),
    null,
  );
  assert.equal(d.manualOffer, undefined);
});
test("cambio de variante conserva datos y sustituye SKU/precio desde catálogo", async () => {
  const f = commercial();
  await f.e.inventoryReady;
  await seedInventory(f.e.sheets, [
    ["BLANCO", "Equipo", "32 GB", "blanco", 5, 100, "Ficha blanca"],
    ["NEGRO", "Equipo", "32 GB", "negro", 5, 120, "Ficha negra"],
  ]);
  f.c.commerce = { selected: "BLANCO", stage: "datos" };
  f.c.borradorPedido = {
    ...draft(),
    lineas: [
      {
        id_producto: "BLANCO",
        producto: "Equipo",
        cantidad: 1,
        precio_unitario: 100,
      },
    ],
  };
  await f.run("cambia el color a negro");
  assert.equal(f.c.borradorPedido.lineas[0].id_producto, "NEGRO");
  assert.equal(f.c.borradorPedido.total, 120);
  assert.equal(f.c.borradorPedido.nombre, "Persona sintética");
});
