"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { runtime } = require("./helpers/v2-runtime");
const { seedInventory } = require("./helpers/inventory-fixture");
const { parse } = require("../lib/v2-admin-commands");
const { createAgencies, card } = require("../lib/v2-agencies");
const { nextWindow, pickupDeadline } = require("../lib/v2-calendar");
const { createTTS } = require("../lib/v2-tts");
const { createYCloud } = require("../lib/ycloud-client");
const { createProductMedia, files } = require("../lib/v2-product-media");
const ADMIN = "000000000001",
  CLIENT = "000000000002";
const draft = () => ({
  nombre: "Cliente sintético",
  cedula: "fixture-private",
  telefono: CLIENT,
  provincia: "Guayas",
  ciudad: "Guayaquil",
  agencia: {
    id: "fixture-agency",
    nombre: "Oficina sintética",
    direccion: "Centro",
  },
  lineas: [
    {
      id_producto: "EQUIPO",
      producto: "Equipo de prueba",
      capacidad: "32 GB",
      color: "plateado",
      cantidad: 1,
      precio_unitario: 100,
    },
  ],
});
async function waiting(options = {}) {
  const e = runtime(options);
  await e.inventoryReady;
  await e.seed({
    estado: "esperando_confirmacion",
    esperandoConfirmacionPedido: true,
    borradorPedido: draft(),
    historial: [],
  });
  return e;
}
async function shipped() {
  const e = await waiting();
  await e.message("confirmo", { provider: "ycloud" });
  const c = await e.load();
  await e.message(`GUIA (${c.pedido.id_chat}) (G-25)`, {
    from: ADMIN,
    provider: "ycloud",
  });
  return e;
}
for (const value of [
  "GUIA CH000001 G",
  "GUIA (LU0001) (G)",
  "GUIA (CH000001) (G) extra",
  "PAGO (G)",
  "LIBERAR (000000000002)",
  "RESPONDER (LU0001): respuesta",
])
  test(`parser rechaza ${value}`, () => assert.equal(parse(value), null));
for (const value of [
  "GUIA (CH000001) (G)",
  "LLEGO (G)",
  "RETIRADO (G)",
  "CANCELADO (CH000001)",
  "CANCELADO (G)",
  "LIBERAR (CH000001)",
  "RESPONDER (CH000001): Respuesta exacta.",
  "RESPONDER (000000000002): Respuesta exacta.",
])
  test(`parser admite ${value}`, () => assert.ok(parse(value)));
test("ID_CHAT nace al confirmar, persiste, y otra compra posterior usa otro ID", async () => {
  const e = await waiting();
  assert.equal((await e.load()).pedido, undefined);
  await e.message("si amigo");
  const first = (await e.load()).pedido;
  assert.equal(first.id_chat, "CH000001");
  const restart = runtime({ sheets: e.sheets });
  assert.equal((await restart.load()).pedido.id_chat, first.id_chat);
  await restart.message("GUIA (CH000001) (G)", { from: ADMIN });
  await restart.message("LLEGO (G)", { from: ADMIN });
  await restart.message("RETIRADO (G)", { from: ADMIN });
  await restart.message("LIBERAR (CH000001)", { from: ADMIN });
  await restart.message("quiero comprar otro equipo");
  const c = await restart.load();
  assert.equal(c.pedido, undefined);
  c.borradorPedido = draft();
  c.esperandoConfirmacionPedido = true;
  c.estado = "esperando_confirmacion";
  await restart.seed(c);
  await restart.message("proceda");
  assert.equal((await restart.load()).pedido.id_chat, "CH000002");
  assert.equal(
    (await restart.load()).oportunidades[0].pedido.id_chat,
    first.id_chat,
  );
});
for (const count of [0, 2])
  test(`GUIA con ${count} candidatos no escribe`, async () => {
    const e = await waiting();
    if (count) {
      for (const num of [CLIENT, "000000000003"])
        await e.seed(
          {
            estado: "confirmado",
            pedido: {
              id: "LU" + num.slice(-1),
              id_chat: "CH000001",
              estado: "confirmado",
              lineas: draft().lineas,
            },
          },
          num,
        );
    }
    await e.message("GUIA (CH000001) (G)", { from: ADMIN });
    assert.equal(
      (await e.api.inventarioFinal().findSale({ guide: "G" })).length,
      0,
    );
    assert.equal(e.sent.filter((s) => s.to === CLIENT).length, 0);
  });
test("LLEGO con takeover persiste y LIBERAR entrega solo una vez", async () => {
  const e = await shipped(),
    before = e.sent.filter((s) => s.to === CLIENT).length;
  await e.message("LLEGO (G-25)", { from: ADMIN });
  let c = await e.load();
  assert.equal(c.pedido.estado, "disponible_retiro");
  assert.equal(c.pedido.avisoLlegada.estado, "pendiente");
  assert.equal(e.sent.filter((s) => s.to === CLIENT).length, before);
  const arrival = c.pedido.fechaLlegada;
  await e.message("LLEGO (G-25)", { from: ADMIN });
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  c = await e.load();
  assert.equal(c.pedido.fechaLlegada, arrival);
  assert.equal(e.sent.filter((s) => s.to === CLIENT).length, before + 1);
});
for (const client of [false, true])
  test(`retiro central ${client ? "cliente" : "admin"} escribe estado y día, alerta una vez`, async () => {
    const e = await shipped();
    await e.message("LLEGO (G-25)", { from: ADMIN });
    await e.message("LIBERAR (CH000001)", { from: ADMIN });
    for (let i = 0; i < 2; i++)
      await e.message(client ? "ya lo retiré" : "RETIRADO (G-25)", {
        from: client ? CLIENT : ADMIN,
      });
    const c = await e.load();
    assert.equal(c.pedido.estado, "retirado");
    assert.ok(c.pedido.fechaRetiro);
    assert.equal(c.pedido.fechaPago, null);
    assert.equal(
      c.pedido.events.filter((x) => x.next === "retirado").length,
      1,
    );
    assert.equal(c.pedido.proximaVerificacionRetiro, null);
    const rows = (
      await e.sheets.spreadsheets.values.get({
        range: "'REGISTRO DE VENTAS'!B5:W",
      })
    ).data.values;
    assert.equal(rows[0][4], "retirado");
    assert.equal(typeof rows[0][6], "number");
    assert.equal(
      e.sent.filter(
        (s) => s.to === ADMIN && s.text?.body.includes("PEDIDO RETIRADO"),
      ).length,
      1,
    );
  });
test("cancelado no restaura stock y permite retiro tardío", async () => {
  const e = await shipped();
  await e.message("CANCELADO (CH000001)", { from: ADMIN });
  assert.equal((await e.load()).pedido.estado, "enviado");
  await e.message("CANCELADO (G-25)", { from: ADMIN });
  assert.equal((await e.load()).pedido.estado, "cancelado");
  assert.equal(
    (await e.api.inventarioFinal().findSale({ guide: "G-25" }))[0].state,
    "cancelado",
  );
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  await e.message("ya lo recogí");
  assert.equal((await e.load()).pedido.estado, "retirado");
});
test("cancelación antes de guía no crea registro", async () => {
  const e = await waiting();
  await e.message("confirmo");
  await e.message("CANCELADO (CH000001)", { from: ADMIN });
  assert.equal((await e.load()).pedido.estado, "cancelado");
  assert.equal(
    (await e.api.inventarioFinal().findSale({ orderId: "LU0001" })).length,
    0,
  );
});
for (const legacy of ["pagado", "sin_respuesta", "no_retirado"])
  test(`histórico ${legacy} no se reabre ni sigue`, async () => {
    const e = runtime();
    await e.seed({
      pedido: {
        id: "LU9",
        estado: legacy,
        guia: "G",
        fechaPago: "legacy",
        seguimientoRetiro: true,
      },
      historial: ["histórico"],
    });
    await e.message("ya retiré");
    await e.api.revisarSeguimientos();
    const c = await e.load();
    assert.equal(
      c.pedido.estado,
      legacy === "pagado" ? "retirado" : "cancelado",
    );
    assert.equal(c.pedido.fechaPago, "legacy");
    assert.equal(e.sent.length, 0);
  });
for (const [input, expected] of [
  ["2026-09-14T12:00:00Z", "2026-09-14T13:00:00.000Z"],
  ["2026-09-14T22:00:00Z", "2026-09-15T13:00:00.000Z"],
  ["2026-09-19T17:00:00Z", "2026-09-21T13:00:00.000Z"],
  ["2026-09-20T15:00:00Z", "2026-09-21T13:00:00.000Z"],
])
  test(`ventana ${input}`, () =>
    assert.equal(nextWindow(input).toISOString(), expected));
test("tres días laborales cuentan sábado y excluyen domingo", () => {
  assert.equal(
    pickupDeadline("2026-09-18T15:00:00Z").toISOString(),
    "2026-09-21T22:00:00.000Z",
  );
  assert.equal(
    pickupDeadline("2026-09-19T18:00:00Z").toISOString(),
    "2026-09-23T22:00:00.000Z",
  );
});
for (const amount of [300, 300.01])
  test(`confirmación ${amount}: conserva pedido e identidades`, async () => {
    const e = await waiting();
    await seedInventory(e.sheets, [
      ["EQUIPO", "Equipo de prueba", "32 GB", "plateado", 3, amount, ""],
    ]);
    const c = await e.load();
    c.borradorPedido.lineas[0].precio_unitario = amount;
    c.audioTranscriptions = [{ text: "secreto del pedido" }];
    await e.seed(c);
    await e.message("confirmo");
    const after = await e.load();
    assert.equal(after.pedido.id_chat, "CH000001");
    assert.equal(after.pedido.estado, "confirmado");
    assert.equal(after.pedido.total,amount);
    assert.equal(after.datosCliente.cedula,'fixture-private');
    assert.equal(
      (await e.api.inventarioFinal().findSale({ orderId: "LU0001" })).length,
      0,
    );
    assert.equal(
      (await e.api.inventarioFinal().catalog()).available.get("EQUIPO").stock,
      3,
    );
  });
test("pregunta difícil mantiene etapa y RESPONDER temporal envía literal una vez", async () => {
  const e = runtime();
  await e.inventoryReady;
  await e.seed({
    estado: "interesado",
    provider: "ycloud",
    commerce: { selected: "EQUIPO", stage: "ubicacion" },
    borradorPedido: draft(),
    historial: [],
  });
  await e.message("¿Tiene una función desconocida?", { provider: "ycloud" });
  let c = await e.load();
  assert.equal(c.pendingQuestion.estado, "pendiente");
  assert.equal(c.pedido, undefined);
  await e.message("¿Y ese dato?", { provider: "ycloud" });
  assert.equal(e.sent.filter((s) => s.to === ADMIN).length, 1);
  const exact = "La respuesta humana, exactamente.";
  await e.message(`RESPONDER (${CLIENT}): ${exact}`, {
    from: ADMIN,
    provider: "ycloud",
  });
  await e.message(`RESPONDER (${CLIENT}): ${exact}`, {
    from: ADMIN,
    provider: "ycloud",
  });
  c = await e.load();
  assert.equal(c.pendingQuestion.estado, "resuelta");
  assert.equal(c.commerce.stage, "ubicacion");
  assert.equal(e.sent.filter((s) => s.text?.body === exact).length, 1);
});
test("RESPONDER postconfirmación respeta takeover", async () => {
  const e = await waiting();
  await e.message("confirmo");
  let c = await e.load();
  c.pendingQuestion = { estado: "pendiente" };
  await e.seed(c);
  const count = e.sent.length;
  await e.message("RESPONDER (CH000001): respuesta", { from: ADMIN });
  assert.equal(e.sent.length, count);
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  await e.message("RESPONDER (CH000001): respuesta", { from: ADMIN });
  assert.equal(e.sent.at(-1).text.body, "respuesta");
});
function agencyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lu-agencies-"));
  const row = (city, name) =>
    "<tr>" +
    [
      "Regional",
      "Provincia",
      city,
      "CS",
      name,
      "Centro",
      "Calle local",
      "tel",
      "supervisor",
      "SI",
      "9",
      "8-17",
      "8-12",
      "email",
    ]
      .map((x) => `<td>${x}</td>`)
      .join("") +
    "</tr>";
  fs.writeFileSync(
    path.join(dir, "SERVIENTREGA.html"),
    "<table>" +
      row("Ciudad", "Oficina Uno") +
      row("Ciudad", "Oficina Dos") +
      row("Unica", "Oficina Única") +
      "</table><script>throw 1</script>",
  );
  return { dir, index: createAgencies(dir) };
}
test("agencias únicas, múltiples, fuzzy y ambigüedad sin inventar", () => {
  const { dir, index } = agencyFixture();
  try {
    assert.equal(index.find("PROVINCIA", "única").length, 1);
    assert.equal(index.find("Provincai", "Unica").length, 0);
    assert.equal(index.find("Provinci", "Unica").length, 1);
    const list = index.find("Provincia", "Ciudad");
    assert.equal(list.length, 2);
    assert.equal(index.select(list, "Centro"), null);
    assert.equal(index.select(list, "2").nombre, "Oficina Dos");
    assert.equal(index.find("Provincia", "Ausente").length, 0);
    assert.ok(card(list[0]).subarray(1, 4).equals(Buffer.from("PNG")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function ttsFixture(extra = {}) {
  const calls = [],
    sent = [],
    logs = [];
  const tts = createTTS({
    env: {},
    openai: {
      audio: {
        speech: {
          create: async (a) => {
            calls.push(a);
            return { arrayBuffer: async () => Buffer.from("audio") };
          },
        },
      },
    },
    convertAudio: async () => Buffer.from("opus"),
    sendAudio: async (n, b, m) => {
      sent.push({ type: "audio", mime: m });
      return {};
    },
    sendText: async (n, text) => {
      sent.push({ type: "text", text });
      return {};
    },
    canSend: async () => true,
    save: async () => {},
    log: (e) => logs.push(e),
    ...extra,
  });
  return { tts, calls, sent, logs };
}
test("TTS defaults cedar 1.15 wav->opus y logs seguros", async () => {
  const f = ttsFixture();
  await f.tts.deliver(CLIENT, {}, "private ".repeat(40));
  assert.equal(f.calls[0].voice, "cedar");
  assert.equal(f.calls[0].speed, 1.15);
  assert.equal(f.calls[0].model, "gpt-4o-mini-tts");
  assert.equal(f.calls[0].response_format, "wav");
  assert.equal(f.sent[0].mime, "audio/ogg");
  assert.doesNotMatch(JSON.stringify(f.logs), /private|000000000002/);
});
for (const [text, opts, expected] of [
  ["corto", {}, "text"],
  ["x".repeat(251), {}, "audio"],
  ["x".repeat(251), { critical: true }, "text"],
  ["Audio comercial 1", { force: true }, "audio"],
])
  test(`TTS routing ${text.length} ${JSON.stringify(opts)}`, async () => {
    const f = ttsFixture();
    await f.tts.deliver(CLIENT, {}, text, opts);
    assert.equal(f.sent[0].type, expected);
  });
test("threshold configurable y fallback igual texto una vez", async () => {
  const f = ttsFixture({
    env: { OPENAI_TTS_MIN_CHARS: "5" },
    openai: {
      audio: {
        speech: {
          create: async () => {
            throw Error("secret");
          },
        },
      },
    },
  });
  await f.tts.deliver(CLIENT, {}, "abcdef");
  assert.deepEqual(f.sent, [{ type: "text", text: "abcdef" }]);
});
test("sin ffmpeg genera opus directamente; clave durable evita doble TTS", async () => {
  const f = ttsFixture({
      convertAudio: async () => {
        throw Error("ENOENT");
      },
    }),
    c = {};
  await f.tts.deliver(CLIENT, c, "audio", { force: true, key: "a" });
  await f.tts.deliver(CLIENT, JSON.parse(JSON.stringify(c)), "audio", {
    force: true,
    key: "a",
  });
  assert.deepEqual(
    f.calls.map((a) => a.response_format),
    ["wav", "opus"],
  );
  assert.equal(f.sent.length, 1);
});
test("TEST_MODE TTS sin llamada externa", async () => {
  const f = ttsFixture({ testMode: true });
  await f.tts.deliver(CLIENT, {}, "audio", { force: true });
  assert.equal(f.calls.length, 0);
  assert.equal(f.sent.length, 0);
});
test("YCloud upload y tipos usan ID, guardas y TEST_MODE", async () => {
  const req = [],
    client = createYCloud({
      env: { YCLOUD_API_KEY: "secret", YCLOUD_PHONE_NUMBER: "fixture" },
      fetchImpl: async (url, args) => {
        req.push({ url, args });
        return { ok: true, json: async () => ({ id: "media-id" }) };
      },
    });
  const opts = { canSend: async () => true };
  const media = await client.uploadMedia(Buffer.from("png"), {
    ...opts,
    mime: "image/png",
  });
  await client.sendImage(CLIENT, media.id, opts);
  await client.sendVideo(CLIENT, media.id, opts);
  await client.sendAudio(CLIENT, media.id, opts);
  assert.deepEqual(
    req.slice(1).map((r) => JSON.parse(r.args.body).type),
    ["image", "video", "audio"],
  );
  assert.equal(
    await client.sendAudio(CLIENT, media.id, { canSend: async () => false }),
    false,
  );
  await client.sendText(CLIENT, "text", { ...opts, testMode: true });
  assert.equal(req.length, 4);
});
test("multimedia SKU: orden numérico, fallo de foto no bloquea resto, no repite ni ofrece agotados", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lu-product-"));
  fs.mkdirSync(path.join(root, "SKU", "imagen"), { recursive: true });
  fs.mkdirSync(path.join(root, "SKU", "video"));
  for (const name of ["SKU-foto-10.jpg", "SKU-foto-2.jpg", "SKU-foto-1.jpg"])
    fs.writeFileSync(path.join(root, "SKU", "imagen", name), "img");
  fs.writeFileSync(path.join(root, "SKU", "video", "SKU-video.mp4"), "vid");
  const attempts = [];
  let available = true;
  const deliver = createProductMedia({
    root,
    catalog: async () => ({
      available: new Map(available ? [["SKU", {}]] : []),
    }),
    save: async () => {},
    send: async (n, b, m) => {
      attempts.push(m);
      if (attempts.length === 1) throw Error("photo failed");
      return {};
    },
  });
  try {
    assert.ok(files(root, "SKU")[0].path.endsWith("foto-1.jpg"));
    const c = {};
    await deliver(CLIENT, c, "SKU");
    assert.equal(attempts.length, 4);
    assert.equal(attempts.at(-1), "video/mp4");
    await deliver(CLIENT, c, "SKU");
    assert.equal(attempts.length, 4);
    available = false;
    await deliver(CLIENT, {}, "SKU");
    assert.equal(attempts.length, 4);
    assert.deepEqual(await deliver(CLIENT, {}, "missing"), {
      images: 0,
      videos: 0,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("diagnóstico de fórmula detecta pagado antiguo sin escribir", async () => {
  const {
    diagnoseSheets,
    diagnoseStockFormula,
  } = require("../lib/v2-sheet-migration");
  assert.equal(
    diagnoseStockFormula([['=SUMIF(F:F,"pagado",S:S)']]).compatible,
    false,
  );
  assert.equal(
    diagnoseStockFormula([
      [
        '=SUMIF(F:F,"enviado",S:S)+SUMIF(F:F,"en agencia",S:S)+SUMIF(F:F,"retirado",S:S)+SUMIF(F:F,"cancelado",S:S)-SUMIF(F:F,"devuelto",S:S)',
      ],
    ]).compatible,
    true,
  );
  let reads = 0;
  await diagnoseSheets(
    {
      spreadsheets: {
        values: {
          get: async (args) => {
            reads++;
            assert.equal(args.valueRenderOption, "FORMULA");
            return { data: { values: [] } };
          },
        },
      },
    },
    "fixture",
  );
  assert.equal(reads, 1);
});
test("followups comerciales 48/96 horas exactas, sin IA, último cierra", async () => {
  const e = runtime();
  e.control.time = Date.parse("2026-09-14T15:00:00Z");
  const at = e.control.time;
  await e.seed({
    estado: "interesado",
    last_customer_message_at: new Date(at).toISOString(),
  });
  e.control.time = at + 48 * 3600000 - 1;
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 0);
  e.control.time++;
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 1);
  e.control.time = at + 96 * 3600000;
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 2);
  assert.equal((await e.load()).estado, "abandono");
  assert.equal(e.calls.length, 0);
  await e.api.revisarSeguimientos();
  assert.equal(e.sent.length, 2);
});
test("retiro sigue cuatro horas y vence al tercer día aun pausado", async () => {
  const e = await shipped();
  await e.message("LLEGO (G-25)", { from: ADMIN });
  const c = await e.load();
  assert.equal(
    Date.parse(c.pedido.proximaVerificacionRetiro) -
      Date.parse(c.pedido.fechaLlegada),
    4 * 3600000,
  );
  const before = e.sent.filter((m) => m.to === CLIENT).length;
  e.control.time = pickupDeadline(c.pedido.fechaLlegada).getTime();
  await e.api.revisarSeguimientos();
  assert.equal((await e.load()).pedido.estado, "cancelado");
  assert.equal(e.sent.filter((m) => m.to === CLIENT).length, before);
});
test("reinicio entre estado en Sheets y MEMORIA recupera cierre una vez", async () => {
  const e = await shipped();
  const update = e.sheets.spreadsheets.values.update;
  let fail = true;
  e.sheets.spreadsheets.values.update = async (args) => {
    if (
      fail &&
      args.range.startsWith("MEMORIA") &&
      JSON.parse(args.requestBody.values[0][1]).pedido?.estado === "retirado"
    ) {
      fail = false;
      throw Error("crash");
    }
    return update(args);
  };
  await e.message("RETIRADO (G-25)", { from: ADMIN });
  assert.equal(
    (await e.api.inventarioFinal().findSale({ guide: "G-25" }))[0].state,
    "retirado",
  );
  const restart = runtime({ sheets: e.sheets });
  await restart.api.revisarSeguimientos();
  assert.equal((await restart.load()).pedido.estado, "retirado");
  assert.equal(restart.sent.filter((m) => m.to === ADMIN).length, 1);
  await restart.api.revisarSeguimientos();
  assert.equal(restart.sent.filter((m) => m.to === ADMIN).length, 1);
});
test("audio comercial en pipeline real y webhook duplicado producen un solo TTS", async () => {
  const e = runtime({
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
  });
  await e.inventoryReady;
  const msg = {
    id: "tts-once",
    from: CLIENT,
    provider: "ycloud",
    type: "text",
    text: { body: "Quiero Equipo de prueba" },
  };
  await e.api.entradaV2.accept(msg);
  await e.api.entradaV2.accept(msg);
  e.control.time += 5000;
  await e.api.entradaV2.recover();
  assert.equal(e.control.tts, 1);
  assert.equal(e.sent.filter((m) => m.type === "audio").length, 1);
  const restart = runtime({
    sheets: e.sheets,
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
  });
  assert.equal(await restart.api.entradaV2.accept(msg), "duplicate");
  assert.equal(restart.control.tts, 0);
});
test("fallo de conversión limpia todos sus temporales", async () => {
  const { convert } = require("../lib/v2-tts");
  const before = new Set(
    fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("lu-tts-")),
  );
  await assert.rejects(convert(Buffer.from("invalid-wav")));
  assert.deepEqual(
    fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("lu-tts-") && !before.has(n)),
    [],
  );
});
test("RESPONDER rechazado reintenta tras reinicio, sin cambiar etapa ni repetir éxito", async () => {
  const e = runtime({ failSendTo: CLIENT, failSendStatus: 429 });
  await e.seed({
    estado: "interesado",
    commerce: { stage: "ubicacion" },
    pendingQuestion: {
      estado: "pendiente",
      stage: "ubicacion",
      question: "dato",
      notice: { estado: "enviada" },
    },
  });
  await e.message(`RESPONDER (${CLIENT}): Respuesta exacta`, { from: ADMIN });
  assert.equal(
    (await e.load()).pendingQuestion.responseBox.estado,
    "pendiente",
  );
  const restart = runtime({ sheets: e.sheets });
  restart.control.time += 61000;
  await restart.api.revisarSeguimientos();
  assert.equal(restart.sent.length, 1);
  assert.equal(restart.sent[0].text.body, "Respuesta exacta");
  assert.equal((await restart.load()).pendingQuestion.estado, "resuelta");
  assert.equal((await restart.load()).commerce.stage, "ubicacion");
  await restart.api.revisarSeguimientos();
  assert.equal(restart.sent.length, 1);
});
test("cancelado a retirado emite avisos diferentes una vez, conserva ambos eventos", async () => {
  const e = await shipped();
  await e.message("CANCELADO (G-25)", { from: ADMIN });
  await e.message("RETIRADO (G-25)", { from: ADMIN });
  await e.message("RETIRADO (G-25)", { from: ADMIN });
  assert.equal(
    e.sent.filter((m) => m.text?.body.includes("PEDIDO CANCELADO")).length,
    1,
  );
  assert.equal(
    e.sent.filter((m) => m.text?.body.includes("PEDIDO RETIRADO")).length,
    1,
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify((await e.load()).pedido.events.map((x) => x.next)),
    ),
    ["cancelado", "retirado"],
  );
});
test("CANCELADO no cierra GUIA escrita cuya respuesta se perdió", async () => {
  const e = await waiting();
  await e.message("confirmo");
  const batch = e.sheets.spreadsheets.batchUpdate;
  let fail = true;
  e.sheets.spreadsheets.batchUpdate = async (args) => {
    const result = await batch(args);
    if (fail) {
      fail = false;
      throw Error("lost response");
    }
    return result;
  };
  await e.message("GUIA (CH000001) (G)", { from: ADMIN });
  await e.message("CANCELADO (CH000001)", { from: ADMIN });
  assert.equal((await e.load()).pedido.estado, "confirmado");
  assert.equal(
    (await e.api.inventarioFinal().findSale({ orderId: "LU0001" }))[0].state,
    "enviado",
  );
  await e.message("GUIA (CH000001) (G)", { from: ADMIN });
  assert.equal((await e.load()).pedido.estado, "enviado");
});
test("elección de color conserva candidatos y no inventa variante", async () => {
  const e = runtime();
  await e.inventoryReady;
  await seedInventory(e.sheets, [
    ["WHITE", "Modelo", "32 GB", "blanco", 2, 100, "Ficha"],
    ["BLACK", "Modelo", "32 GB", "negro", 2, 100, "Ficha"],
  ]);
  await e.message("Quiero Modelo", { provider: "ycloud" });
  assert.equal((await e.load()).commerce.selected, undefined);
  await e.message("negro", { provider: "ycloud" });
  assert.equal((await e.load()).commerce.selected, "BLACK");
  assert.equal((await e.load()).borradorPedido.lineas[0].color, "negro");
});
test("LLEGO con aceptación incierta no duplica aviso tras reinicio", async () => {
  const e = await shipped();
  await e.message("LIBERAR (CH000001)", { from: ADMIN });
  e.control.failSend = true;
  await e.message("LLEGO (G-25)", { from: ADMIN });
  const c = await e.load();
  assert.equal(c.pedido.avisoLlegada.estado, "incierta");
  const restart = runtime({ sheets: e.sheets });
  restart.control.time += 61000;
  await restart.api.revisarSeguimientos();
  await restart.message("LLEGO (G-25)", { from: ADMIN });
  assert.equal(
    restart.sent.filter((m) => m.text?.body.includes("Tu pedido ya llegó"))
      .length,
    0,
  );
});
test("respuesta comercial larga con persistencia perdida no regenera TTS al repetir mensaje", async () => {
  const e = runtime({
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
  });
  await e.inventoryReady;
  await seedInventory(e.sheets, [
    [
      "EQUIPO",
      "Equipo de prueba",
      "32 GB",
      "plateado",
      3,
      100,
      "Características verificadas del equipo. ".repeat(12),
    ],
  ]);
  await e.seed({
    estado: "interesado",
    provider: "ycloud",
    commerce: { selected: "EQUIPO", stage: "ubicacion" },
    historial: [],
  });
  const update = e.sheets.spreadsheets.values.update;
  let fail = true;
  e.sheets.spreadsheets.values.update = async (args) => {
    if (
      fail &&
      args.range.startsWith("MEMORIA") &&
      JSON.parse(args.requestBody.values[0][1]).tts?.["reply:long-tts"] ===
        "sent"
    ) {
      fail = false;
      throw Error("memory after send");
    }
    return update(args);
  };
  await e.message("qué características tiene", {
    id: "long-tts",
    provider: "ycloud",
  });
  assert.equal(e.control.tts, 1);
  const restart = runtime({
    sheets: e.sheets,
    env: { OPENAI_TTS_ENABLED: "true", OPENAI_TTS_FORMAT: "opus" },
  });
  await restart.message("qué características tiene", {
    id: "long-tts",
    provider: "ycloud",
  });
  assert.equal(restart.control.tts, 0);
  assert.equal(restart.sent.length, 0);
});
test("garantía no documentada antes de compra espera respuesta puntual, no takeover permanente", async () => {
  const e = runtime();
  await e.inventoryReady;
  await e.seed({
    estado: "interesado",
    commerce: { selected: "EQUIPO", stage: "ubicacion" },
    historial: [],
  });
  await e.message("¿Qué garantía tiene este producto?", { provider: "ycloud" });
  const c = await e.load();
  assert.equal(c.pendingQuestion.estado, "pendiente");
  assert.equal(c.human_takeover, false);
  assert.equal(c.commerce.stage, "ubicacion");
});
test("pago/envío conocidos se responden por texto sin inventar ni abrir pregunta humana", async () => {
  const e = runtime();
  await e.message("¿Cuánto cuesta el envío?", { provider: "ycloud" });
  assert.match(e.sent[0].text.body, /gratis.*contraentrega.*sin adelantos/);
  assert.equal((await e.load()).pendingQuestion, undefined);
  assert.equal((await e.load()).pedido, undefined);
});
