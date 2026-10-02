"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  createFlow,
  fresh,
  matching,
  filters,
  MACBOOK_ENTRY,
} = require("../lib/v4-flow");
const { createInterpreter, validate } = require("../lib/v4-interpreter");
const { createRuntime } = require("../lib/v4-runtime");
const NUMBER = "+593999123456";
const products = [
  {
    id_producto: "W-DELL",
    producto: "Dell Windows 12 pulgadas",
    capacidad: "128 GB",
    ram: "4 GB",
    stock: 10,
    precio: 100,
    informacion_producto:
      "Intel Celeron\nRAM: 4 GB\n😊 Información oficial sin cambios",
  },
  {
    id_producto: "W-ACER",
    producto: "Acer Windows",
    capacidad: "256 GB",
    ram: "8 GB",
    stock: 20,
    precio: 150,
    informacion_producto: "RAM: 8 GB\nTouch: no",
  },
  {
    id_producto: "W-HP",
    producto: "HP Windows",
    capacidad: "128 GB",
    ram: "4 GB",
    stock: 0,
    precio: 90,
    informacion_producto: "Oficial",
  },
  {
    id_producto: "I-16",
    producto: "iPad Air",
    capacidad: "16 GB",
    ram: "1 GB",
    stock: 3,
    precio: 100,
    informacion_producto: "iPad oficial",
  },
  {
    id_producto: "I-32",
    producto: "iPad Air",
    capacidad: "32 GB",
    ram: "1 GB",
    stock: 5,
    precio: 120,
    informacion_producto: "iPad oficial 32 GB",
  },
  ...[250, 500, 750, 1000, 2000].map((gb, i) => ({
    id_producto: `M-${i}`,
    producto: "MacBook Pro Core i5 13 pulgadas",
    capacidad: gb === 2000 ? "2 TB" : `${gb} GB`,
    ram: "8 GB",
    stock: 5 - i,
    precio: 200 + i * 30,
    informacion_producto: `Core i5\nRAM: 8 GB\n${gb} GB oficial`,
  })),
];
function harness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v4-fixture-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "fixture");
  fs.writeFileSync(file, "mock media bytes");
  const resources = {
    products: Object.fromEntries(
      products.map((p) => [
        p.id_producto,
        [
          { path: file, type: "image", mime: "image/jpeg" },
          { path: file, type: "video", mime: "video/mp4" },
        ],
      ]),
    ),
    audios: {
      commercial1: {
        path: file,
        mime: "audio/mp4",
        text: "Comercial 1 oficial",
      },
      warranty: { text: "Garantía oficial" },
      location: { text: "Ubicación oficial" },
      shipping: { text: "Envíos oficiales" },
      ipad: { text: "Incluye iPad oficial" },
      macbook: { text: "Incluye MacBook oficial" },
    },
  };
  const sent = [],
    events = [],
    human = [],
    inputs = [];
  let next;
  const catalog = async () => {
    events.push("catalog");
    if (options.catalogFailure) throw Error("offline");
    return {
      master: new Map(products.map((p) => [p.id_producto, p])),
      available: new Map(
        products.filter((p) => p.stock > 0).map((p) => [p.id_producto, p]),
      ),
    };
  };
  const interpret = async (input) => {
    inputs.push(input);
    if (options.interpreterFailure) throw Error("Bearer fixture-private-key");
    return typeof next === "function" ? next(input) : next;
  };
  const flow = createFlow({
    catalog,
    resources,
    interpret,
    sendText: async (n, text) => {
      if (options.sendFailure) throw Error("offline");
      sent.push({ type: "text", text });
    },
    sendMedia: async (n, b, mime) => {
      if (options.mediaFailure) throw Error("offline");
      sent.push({ type: mime });
    },
    prepare: async () => events.push("prepare"),
    escalate: async (value) => human.push(value),
    log: (diagnostic) => events.push(diagnostic),
  });
  return {
    flow,
    sent,
    events,
    human,
    resources,
    catalog,
    inputs,
    interpret,
    set: (value) => {
      next = value;
    },
    message: async (text, action, params = {}) => {
      next = { action, params };
      await flow.process(NUMBER, text);
    },
  };
}
test("Windows conversation: greeting, brands with stock, recommendation, exact official presentation", async (t) => {
  const h = harness(t);
  await h.message("Hola", "GREETING");
  assert.equal((await h.flow.load(NUMBER)).step, "START");
  assert.ok(!h.events.includes("catalog"));
  await h.message("quiero laptops", "WINDOWS_ENTRY");
  assert.match(h.sent.at(-1).text, /ACER/);
  assert.doesNotMatch(h.sent.at(-1).text, /HP|W-ACER/);
  h.sent.length = 0;
  h.events.length = 0;
  await h.message("recomiéndeme una", "RECOMMEND");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "W-ACER");
  assert.equal((await h.flow.load(NUMBER)).step, "LOCATION");
  assert.deepEqual(
    h.sent.map((s) => s.type),
    ["image/jpeg", "video/mp4", "text", "audio/mp4", "text"],
  );
  assert.equal(h.sent[2].text, products[1].informacion_producto);
  assert.equal(h.events.filter((e) => e === "prepare").length, 1);
});
test("iPad entry contains model and storage only, selection via option", async (t) => {
  const h = harness(t);
  await h.message("iPad", "IPAD_ENTRY");
  assert.match(h.sent.at(-1).text, /iPad Air · 16 GB/);
  assert.doesNotMatch(h.sent.at(-1).text, /\$|RAM|I-16/);
  await h.message("la segunda", "SELECT_SKU", { option: 2 });
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "I-16"); // stock ranking puts 32 GB first
});
for (const phrase of [
  "MacBook",
  "MacBooks",
  "me interesa una MacBook",
  "qué MacBook tienen",
])
  test(`MacBook entry: ${phrase}`, async (t) => {
    const h = harness(t, { catalogFailure: true });
    await h.message(phrase, "MACBOOK_ENTRY");
    assert.equal(h.sent[0].text, MACBOOK_ENTRY);
    assert.ok(!h.events.includes("catalog"));
    assert.equal((await h.flow.load(NUMBER)).family, "macbook");
  });
test("MacBook criteria show at most four nearest official alternatives without SKU", async (t) => {
  const h = harness(t);
  await h.message("MacBook", "MACBOOK_ENTRY");
  await h.message("i5, 8 RAM, unos 750 GB hasta $300", "FILTER_PRODUCTS", {
    filters: {
      cpu: "i5",
      ram: 8,
      storage: { target: 750 },
      budget: { max: 300 },
    },
  });
  const c = await h.flow.load(NUMBER);
  assert.equal(c.alternatives[0], "M-2");
  assert.ok(c.alternatives.length >= 2 && c.alternatives.length <= 4);
  assert.doesNotMatch(h.sent.at(-1).text, /M-\d/);
  await h.message("la primera", "SELECT_SKU", { option: 1 });
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-2");
});
test("min/max and missing official attributes are deterministic", () => {
  assert.equal(matching(products[0], { storage: { min: 256 } }), null);
  assert.equal(matching(products[1], { screen: { min: 10 } }), null);
  assert.equal(matching(products[1], { touch: false }), 0);
  assert.equal(matching(products.at(-1), { storage: 2048 }), 0);
  assert.throws(() => filters({ ram: { min: 16, max: 8 } }));
  assert.throws(() => filters({ budget: NaN }));
  assert.throws(() => filters({ stock: 99 }));
});
test("auxiliary warranty, shipping, location and included preserve LOCATION", async (t) => {
  const h = harness(t);
  await h.message("iPad", "IPAD_ENTRY");
  await h.message("recomienda", "RECOMMEND");
  const before = await h.flow.load(NUMBER);
  for (const action of [
    "ANSWER_WARRANTY",
    "ANSWER_SHIPPING",
    "ANSWER_LOCATION",
    "ANSWER_INCLUDED",
  ]) {
    await h.message("pregunta auxiliar", action);
    const c = await h.flow.load(NUMBER);
    assert.equal(c.step, before.step);
    assert.equal(c.selectedSku, before.selectedSku);
  }
  assert.equal(h.human.length, 0);
});
test("invalid SKU, no stock and invalid filters clarify without PAUSED", async (t) => {
  const h = harness(t);
  await h.message("Windows", "WINDOWS_ENTRY");
  await h.message("sku inventado", "SELECT_SKU", { sku: "FAKE" });
  await h.message("16 RAM", "FILTER_PRODUCTS", { filters: { ram: 16 } });
  assert.match(h.sent.at(-1).text, /ajustar/);
  await h.message("filtro inválido", "FILTER_PRODUCTS", {
    filters: { stock: 50 },
  });
  assert.equal((await h.flow.load(NUMBER)).step, "PRODUCT_SELECTION");
  assert.equal(h.human.length, 0);
  assert.equal((await h.flow.load(NUMBER)).pauseState, undefined);
});
test("unknown question is reinterpreted with official context, not arbitrary generated answer", async (t) => {
  const h = harness(t);
  h.set((input) =>
    input.officialPolicies
      ? { action: "ANSWER_WARRANTY", params: {} }
      : { action: "UNKNOWN_QUESTION", params: {} },
  );
  await h.flow.process(NUMBER, "¿qué cobertura ofrecen?");
  assert.equal(h.sent.at(-1).text, "Garantía oficial");
  assert.equal(h.inputs.length, 2);
  assert.equal((await h.flow.load(NUMBER)).step, "START");
});
test("missing media, unknown technical fact and post-sale go to human without freezing", async (t) => {
  const h = harness(t);
  await h.message("Windows", "WINDOWS_ENTRY");
  delete h.resources.products["W-ACER"];
  await h.message("recomienda", "RECOMMEND");
  assert.equal(h.human[0].reason, "MISSING_PRESENTATION_RESOURCE");
  const post = harness(t);
  await post.message("mi compra llegó rota", "POSTSALE");
  assert.equal(post.human.at(-1).reason, "POSTSALE");
  assert.equal((await h.flow.load(NUMBER)).pauseState, undefined);
});
test("interpreter and transport failures do not create paused states or reveal credentials", async (t) => {
  const h = harness(t, { interpreterFailure: true });
  await h.message("hola", "GREETING");
  assert.equal((await h.flow.load(NUMBER)).step, "START");
  assert.doesNotMatch(JSON.stringify(h.events), /fixture-private-key/);
  assert.equal(h.sent.length, 1);
  const m = harness(t, { mediaFailure: true });
  await m.message("Windows", "WINDOWS_ENTRY");
  await m.message("recomienda", "RECOMMEND");
  assert.equal((await m.flow.load(NUMBER)).step, "PRESENTATION");
  assert.equal((await m.flow.load(NUMBER)).pauseState, undefined);
});
test("structured AI contract and configurable model", async () => {
  let request;
  const run = createInterpreter(
    {
      responses: {
        create: async (value) => {
          request = value;
          return {
            status: "completed",
            output_text: '{"action":"GREETING","params":{}}',
          };
        },
      },
    },
    { MODEL_LOW: "fixture-model" },
  );
  assert.equal((await run({ text: "hola" })).action, "GREETING");
  assert.equal(request.model, "fixture-model");
  assert.equal(request.reasoning.effort, "minimal");
  assert.equal(request.max_output_tokens, 800);
  assert.throws(() => validate({ action: "HACK", params: {} }));
  assert.equal(
    (
      await createInterpreter(
        {
          responses: {
            create: async () => ({
              status: "incomplete",
              output_text: '{"action":"GREETING","params":{}}',
            }),
          },
        },
        { MODEL_LOW: "fixture" },
      )({})
    ).action,
    "UNKNOWN_QUESTION",
  );
});
test("runtime read then typing then one 5s wait; ignored/admin/duplicate messages don't type", async (t) => {
  const h = harness(t),
    events = [];
  h.set({ action: "GREETING", params: {} });
  const runtime = createRuntime({
    env: { ASESOR_WHATSAPP: "+593999111111" },
    catalog: h.catalog,
    resources: h.resources,
    interpret: h.interpret,
    wait: async (ms) => events.push(ms),
    ycloud: {
      markRead: async (id) => events.push(["read", id]),
      typing: async (id) => events.push(["typing", id]),
      sendText: async () => {
        events.push("send");
        return {};
      },
    },
  });
  const m = {
    id: "wamid.fixture",
    inboundId: "real-inbound",
    from: NUMBER,
    type: "text",
    text: { body: "Hola" },
  };
  await runtime.handleMessage(m);
  assert.deepEqual(events, [
    ["read", "real-inbound"],
    ["typing", "real-inbound"],
    5000,
    "send",
  ]);
  assert.equal(await runtime.handleMessage(m), "duplicate");
  assert.equal(
    await runtime.handleMessage({ ...m, id: "admin", from: "+593999111111" }),
    "ignored",
  );
  assert.equal(
    await runtime.handleMessage({ ...m, id: "echo", from_me: true }),
    "ignored",
  );
  assert.equal(events.length, 4);
});
test("typing failure does not block runtime response", async (t) => {
  const h = harness(t),
    events = [];
  h.set({ action: "GREETING", params: {} });
  const runtime = createRuntime({
    env: {},
    catalog: h.catalog,
    resources: h.resources,
    interpret: h.interpret,
    wait: async (ms) => events.push(ms),
    ycloud: {
      markRead: async () => {
        throw Error("offline");
      },
      typing: async () => {
        throw Error("offline");
      },
      sendText: async () => {
        events.push("sent");
        return {};
      },
    },
  });
  await runtime.handleMessage({
    id: "id",
    from: NUMBER,
    type: "text",
    text: { body: "Hola" },
  });
  assert.deepEqual(events, [5000, "sent"]);
});
test("deferred ordering actions never confirm or mutate customer context", async (t) => {
  const h = harness(t);
  for (const action of [
    "CONFIRM",
    "SET_LOCATION",
    "SELECT_AGENCY",
    "SET_CUSTOMER_DATA",
  ]) {
    await h.message("dato", action, { name: "Ana", city: "Cuenca" });
    assert.deepEqual((await h.flow.load(NUMBER)).customer, {
      name: null,
      cedula: null,
    });
    assert.equal((await h.flow.load(NUMBER)).step, "START");
  }
});

test("named selection is resolved with official available products rather than invented IDs", async (t) => {
  const h = harness(t);
  await h.message("Windows", "WINDOWS_ENTRY");
  h.set((input) =>
    input.products
      ? {
          action: "SELECT_SKU",
          params: {
            sku: input.products.find((p) => /Dell/.test(p.producto))
              .id_producto,
          },
        }
      : { action: "SELECT_SKU", params: { query: "Dell 128 GB" } },
  );
  await h.flow.process(NUMBER, "la Dell de 128 GB");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "W-DELL");
  assert.ok(h.inputs.at(-1).products.every((p) => p.stock > 0));
});
test("correction automatically presents the sole compatible product without changing official prices", async (t) => {
  const h = harness(t);
  await h.message("MacBook", "MACBOOK_ENTRY");
  await h.message("recomienda", "RECOMMEND");
  await h.message("mejor 500 GB", "CORRECTION", { filters: { storage: 500 } });
  const c = await h.flow.load(NUMBER);
  assert.equal(c.selectedSku, "M-1");
  assert.equal(c.step, "LOCATION");
  assert.equal(c.presentedSku, "M-1");
});
test("stock outage is recoverable without handoff or paused state", async (t) => {
  const h = harness(t, { catalogFailure: true });
  await h.message("Windows", "WINDOWS_ENTRY");
  assert.equal((await h.flow.load(NUMBER)).step, "START");
  assert.equal((await h.flow.load(NUMBER)).handoff, undefined);
  assert.match(h.sent[0].text, /no pude/i);
});
test("post-sale handoff blocks automation until authorized release; admin doesn't type", async (t) => {
  const h = harness(t);
  h.set({ action: "POSTSALE", params: {} });
  const events = [];
  const runtime = createRuntime({
    env: { ASESOR_WHATSAPP: "+593999111111" },
    catalog: h.catalog,
    resources: h.resources,
    interpret: h.interpret,
    wait: async (ms) => events.push(ms),
    escalate: async () => events.push("human"),
    ycloud: {
      markRead: async () => {},
      typing: async () => events.push("typing"),
      sendText: async () => ({}),
    },
  });
  await runtime.handleMessage({
    from: NUMBER,
    id: "post",
    type: "text",
    text: { body: "me llegó roto" },
  });
  assert.equal((await runtime.flow.load(NUMBER)).handoff.reason, "POSTSALE");
  const before = events.length;
  h.set({ action: "GREETING", params: {} });
  await runtime.handleMessage({
    from: NUMBER,
    id: "greet",
    type: "text",
    text: { body: "Hola" },
  });
  assert.equal(events.length, before);
  assert.equal(
    await runtime.handleMessage({
      from: "+593999111111",
      id: "release",
      type: "text",
      text: { body: `/liberar ${NUMBER}` },
    }),
    "admin_processed",
  );
  assert.equal((await runtime.flow.load(NUMBER)).handoff, undefined);
  assert.equal(events.length, before);
});
test("runtime presentation uploads in order with one wait and official unmodified text", async (t) => {
  const h = harness(t),
    events = [];
  h.set({ action: "SELECT_SKU", params: { sku: "W-DELL" } });
  const ycloud = {
    markRead: async () => events.push("read"),
    typing: async () => events.push("typing"),
    uploadMedia: async (bytes, { mime }) => {
      events.push(mime);
      return { id: "uploaded" };
    },
    sendImage: async () => {
      events.push("image");
      return {};
    },
    sendVideo: async () => {
      events.push("video");
      return {};
    },
    sendAudio: async () => {
      events.push("audio");
      return {};
    },
    sendText: async (_, text) => {
      events.push(text);
      return {};
    },
  };
  const runtime = createRuntime({
    env: {},
    catalog: h.catalog,
    resources: h.resources,
    interpret: h.interpret,
    ycloud,
    wait: async (ms) => events.push(ms),
  });
  await runtime.handleMessage({
    from: NUMBER,
    id: "presentation",
    type: "text",
    text: { body: "quiero Dell" },
  });
  assert.deepEqual(events, [
    "read",
    "typing",
    5000,
    "image/jpeg",
    "image",
    "video/mp4",
    "video",
    products[0].informacion_producto,
    "audio/mp4",
    "audio",
    "¿En qué ciudad y provincia se encuentra para continuar con la compra?",
  ]);
});

test("technical answer uses official complete text and preserves location step", async (t) => {
  const h = harness(t);
  await h.message("Windows", "WINDOWS_ENTRY");
  await h.message("Dell", "SELECT_SKU", { sku: "W-DELL" });
  await h.message("¿cuánta RAM?", "ANSWER_TECHNICAL", { field: "ram" });
  assert.equal(h.sent.at(-1).text, products[0].informacion_producto);
  assert.equal((await h.flow.load(NUMBER)).step, "LOCATION");
  await h.message("¿dura 10 horas la batería?", "ANSWER_TECHNICAL", {
    field: "battery",
  });
  assert.equal(h.human.at(-1).reason, "UNVERIFIED_TECHNICAL_DETAIL");
});
test("AI supplied price, stock and specification overrides never enter the presentation", async (t) => {
  const h = harness(t);
  await h.message("Dell", "SELECT_SKU", {
    sku: "W-DELL",
    precio: 1,
    stock: 999,
    informacion_producto: "fake 64 GB RAM",
  });
  assert.equal(
    h.sent.find((s) => s.type === "text").text,
    products[0].informacion_producto,
  );
  assert.doesNotMatch(JSON.stringify(h.sent), /fake 64/);
});
test("missing selection criteria ask for attributes without showing an unfiltered MacBook catalog", async (t) => {
  const h = harness(t);
  await h.message("MacBook", "MACBOOK_ENTRY");
  await h.message("no sé", "FILTER_PRODUCTS");
  assert.match(h.sent.at(-1).text, /RAM/);
  assert.equal((await h.flow.load(NUMBER)).alternatives.length, 0);
});

test("local signed YCloud webhook routes USE_V4=true to V4 and replies 200 before processing finishes", async (t) => {
  const http = require("node:http"),
    { createHmac } = require("node:crypto"),
    { createApp } = require("../server"),
    { memorySheets } = require("../lib/v2-storage");
  const sheets = memorySheets(),
    writes = [];
  const update = sheets.spreadsheets.values.update.bind(
    sheets.spreadsheets.values,
  );
  sheets.spreadsheets.values.update = async (args) => {
    writes.push(args);
    return update(args);
  };
  const env = {
      USE_V4: "true",
      TEST_MODE: "true",
      YCLOUD_WEBHOOK_SECRET: "fixture-secret",
      YCLOUD_API_KEY: "fixture-api-key",
      YCLOUD_PHONE_NUMBER: "+593999222222",
      ASESOR_WHATSAPP: "+593999111111",
      MEMORIA_SPREADSHEET_ID: "fixture-memory",
    },
    waits = [],
    requests = [],
    logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const runtime = createApp({
    env,
    sheets,
    v4Interpret: async () => ({ action: "MACBOOK_ENTRY", params: {} }),
    interpret: async () => {
      throw Error("V3 must not run");
    },
    wait: async (ms) => {
      waits.push(ms);
      await gate;
    },
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({}) };
    },
  });
  const server = http.createServer(runtime.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        release();
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  async function post(text, id, from = NUMBER) {
    const body = JSON.stringify({
        type: "whatsapp.inbound_message.received",
        whatsappInboundMessage: {
          id,
          wamid: "wamid." + id,
          from,
          type: "text",
          text: { body: text },
        },
      }),
      time = Math.floor(Date.now() / 1000),
      sig = createHmac("sha256", env.YCLOUD_WEBHOOK_SECRET)
        .update(`${time}.${body}`)
        .digest("hex");
    return fetch(`http://127.0.0.1:${server.address().port}/ycloud/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "YCloud-Signature": `t=${time},s=${sig}`,
      },
      body,
    });
  }
  assert.equal((await post("MacBook", "route-v4")).status, 200);
  release();
  await runtime.drainV4();
  assert.equal((await runtime.v4.flow.load(NUMBER)).family, "macbook");
  assert.deepEqual(waits, [5000]);
  assert.ok(requests.some((url) => url.endsWith("route-v4/markAsRead")));
  assert.ok(requests.some((url) => url.endsWith("route-v4/typingIndicator")));
  assert.equal(writes.length, 0);
  assert.equal(
    (await post(`/borrar ${NUMBER}`, "admin-v4", env.ASESOR_WHATSAPP)).status,
    200,
  );
  await runtime.drainV4();
  assert.equal((await runtime.v4.flow.load(NUMBER)).family, null);
  assert.deepEqual(waits, [5000]);
  assert.equal(writes.length, 0);
  assert.ok(logs.some((args) => args[1]?.action === "MACBOOK_ENTRY"));
  assert.ok(
    logs.some(
      (args) =>
        args[1]?.event === "v4_context" && args[1]?.family === "macbook",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(logs),
    /fixture-secret|fixture-api-key|999123456/,
  );
});
for (const flag of [undefined, "false"])
  test(`V3 routing and existing admin path remain default for USE_V4=${flag}`, async (t) => {
    const { createApp } = require("../server"),
      { memorySheets } = require("../lib/v2-storage");
    const runtime = createApp({
      env: {
        TEST_MODE: "true",
        USE_V4: flag,
        ASESOR_WHATSAPP: "+593999111111",
      },
      sheets: memorySheets(),
      interpret: async () => ({}),
    });
    const routes = [];
    t.mock.method(runtime.flow, "process", async () => routes.push("V3"));
    t.mock.method(runtime.flow, "admin", async () => routes.push("admin"));
    assert.equal(runtime.v4, null);
    await runtime.processMessage({
      from: NUMBER,
      id: "v3-route",
      provider: "ycloud",
      type: "text",
      text: { body: "Hola" },
    });
    await runtime.processMessage({
      from: "+593999111111",
      id: "admin",
      provider: "ycloud",
      type: "text",
      text: { body: `/liberar ${NUMBER}` },
    });
    assert.deepEqual(routes, ["V3", "admin"]);
  });

for (const invalid of [
  { status: "incomplete", output_text: "" },
  { status: "completed", output_text: "" },
  { status: "completed", output_text: "not-json Bearer fixture-private-key" },
  { status: "completed", output_text: '{"action":"INVALID","params":{}}' },
])
  test(`V4 interpreter retries once for ${invalid.status}/${invalid.output_text.slice(0, 10)}`, async () => {
    const requests = [],
      logs = [];
    const interpret = createInterpreter(
      {
        responses: {
          create: async (request) => {
            requests.push(request);
            return requests.length === 1
              ? invalid
              : {
                  status: "completed",
                  output_text:
                    '{"action":"FILTER_PRODUCTS","params":{"family":"macbook","filters":{"cpu":"i7","ram":16}}}',
                };
          },
        },
      },
      { MODEL_LOW: "fixture-nano" },
      { log: (e) => logs.push(e) },
    );
    const result = await interpret({
      text: "core i7 y 16 de ram",
      context: { family: "macbook" },
    });
    assert.equal(result.action, "FILTER_PRODUCTS");
    assert.deepEqual(
      requests.map((r) => r.max_output_tokens),
      [800, 1500],
    );
    assert.ok(
      requests.every(
        (r) => r.reasoning.effort === "minimal" && r.model === "fixture-nano",
      ),
    );
    assert.ok(logs.some((e) => e.event === "V4_INTERPRETER_RETRY_OK"));
    assert.doesNotMatch(JSON.stringify(logs), /fixture-private-key/);
  });
test("MacBook fallback extracts explicit supported criteria without inferring Windows as MacBook", () => {
  const { fallback } = require("../lib/v4-interpreter");
  assert.deepEqual(
    fallback({
      text: "Ando buscando una core i7 y 16 de ram",
      context: { family: "macbook" },
    }),
    {
      action: "FILTER_PRODUCTS",
      params: { family: "macbook", filters: { cpu: "i7", ram: 16 } },
    },
  );
  assert.deepEqual(
    fallback({
      text: "MacBook core i5 RAM 8 GB, almacenamiento 1 TB, 15 pulgadas",
    }).params.filters,
    { cpu: "i5", ram: 8, storage: 1024, screen: 15 },
  );
  assert.equal(
    fallback({ text: "core i7 y 16 de ram", context: { family: "windows" } })
      .action,
    "UNKNOWN_QUESTION",
  );
});
test("both attempts fail: MacBook still lists official matches with no paused state", async (t) => {
  const h = harness(t),
    sent = [],
    logs = [];
  let calls = 0;
  const interpret = createInterpreter(
    {
      responses: {
        create: async () => {
          calls++;
          return { status: "incomplete", output_text: "" };
        },
      },
    },
    { MODEL_LOW: "fixture-nano" },
    { log: (e) => logs.push(e) },
  );
  const matches = products.slice(-2).map((p, i) => ({
    ...p,
    id_producto: `TEST-MAC-${i}`,
    producto: "MacBook Pro Core i7",
    ram: "16 GB",
    informacion_producto: "Core i7 RAM: 16 GB",
  }));
  const flow = createFlow({
    resources: h.resources,
    catalog: async () => ({
      available: new Map(matches.map((p) => [p.id_producto, p])),
    }),
    interpret,
    sendText: async (_, text) => sent.push(text),
    sendMedia: async () => {},
    log: (e) => logs.push(e),
  });
  await flow.process(NUMBER, "MacBook");
  await flow.process(NUMBER, "Ando buscando una core i7 y 16 de ram");
  assert.equal(calls, 4);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /MacBook Pro Core i7/);
  const c = await flow.load(NUMBER);
  assert.equal(c.family, "macbook");
  assert.equal(c.filters.ram, 16);
  assert.equal(c.step, "PRODUCT_SELECTION");
  assert.equal(c.handoff, undefined);
  assert.equal(c.pauseState, undefined);
  assert.ok(logs.some((e) => e.event === "V4_INTERPRETER_FALLBACK"));
});
for (const result of [
  { status: "incomplete", output_text: "" },
  { status: "completed", output_text: "" },
  { status: "completed", output_text: "{" },
])
  test(`exhausted ${result.status}/${result.output_text} returns clarification without extra interpretation or silence`, async (t) => {
    const h = harness(t),
      sent = [];
    let calls = 0;
    const interpret = createInterpreter(
      {
        responses: {
          create: async () => {
            calls++;
            return result;
          },
        },
      },
      { MODEL_LOW: "fixture" },
    );
    const flow = createFlow({
      resources: h.resources,
      catalog: h.catalog,
      interpret,
      sendText: async (_, text) => sent.push(text),
      sendMedia: async () => {},
    });
    await flow.process(NUMBER, "Una pregunta que no se entiende");
    assert.equal(calls, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /detalle/);
    assert.equal((await flow.load(NUMBER)).pauseState, undefined);
    assert.equal((await flow.load(NUMBER)).handoff, undefined);
  });

test("technical fallback asks clarification for unsupported or contradictory constraints", () => {
  const { fallback } = require("../lib/v4-interpreter");
  for (const text of [
    "core i7 RAM 32 GB",
    "i5 o i7 y 16 de ram",
    "core i7, disco 2 TB",
    "core i7 hasta $300",
    "Dell core i7 16 RAM",
  ]) {
    assert.equal(
      fallback({ text, context: { family: "macbook" } }).action,
      "UNKNOWN_QUESTION",
    );
  }
  assert.equal(
    fallback({
      text: "¿tiene core i7 y 16 RAM?",
      context: { family: "macbook", selectedSku: "M-1" },
    }).action,
    "UNKNOWN_QUESTION",
  );
});

function salesConversation(t) {
  const h = harness(t),
    sent = [],
    events = [];
  const available = [
    {
      ...products[5],
      id_producto: "M-0",
      producto: "MACBOOK PRO I7",
      capacidad: "250 GB",
      ram: "16 GB",
      precio: 290,
      stock: 5,
      informacion_producto: "Core i7\nRAM: 16 GB\nPantalla: 13 pulgadas",
    },
    {
      ...products[6],
      id_producto: "M-1",
      producto: "MACBOOK PRO I7",
      capacidad: "160 GB",
      ram: "16 GB",
      precio: 290,
      stock: 3,
      informacion_producto: "Core i7\nRAM: 16 GB\nPantalla: 15 pulgadas",
    },
    {
      ...products[7],
      id_producto: "M-2",
      producto: "MACBOOK PRO I7",
      capacidad: "1 TB",
      ram: "8 GB",
      precio: 350,
      stock: 2,
      informacion_producto: "Core i7\nRAM: 8 GB\nPantalla: 13 pulgadas",
    },
  ];
  const contexts = new Map();
  const store = {
    get: async (n) => structuredClone(contexts.get(n)),
    set: async (n, c) => contexts.set(n, structuredClone(c)),
  };
  let result = {
    action: "UNKNOWN_QUESTION",
    params: { interpreterFallback: true },
  };
  const flow = createFlow({
    store,
    resources: h.resources,
    catalog: async () => ({
      available: new Map(
        available.filter((p) => p.stock > 0).map((p) => [p.id_producto, p]),
      ),
    }),
    interpret: async () => result,
    sendText: async (_, text) => sent.push({ type: "text", text }),
    sendMedia: async (_, bytes, mime) => sent.push({ type: mime }),
    prepare: async () => events.push("prepare"),
  });
  return {
    flow,
    sent,
    events,
    available,
    offer: (items = available) => {
      const c = fresh(NUMBER);
      c.family = "macbook";
      c.step = "PRODUCT_SELECTION";
      const { createDecisionEngine } = require("../lib/v4-decision");
      const { specs, matching, family } = require("../lib/v4-flow");
      createDecisionEngine({ specs, matching, family }).remember(c, items);
      contexts.set(NUMBER, c);
    },
    send: async (text, action, params = {}) => {
      result = action
        ? { action, params }
        : { action: "UNKNOWN_QUESTION", params: { interpreterFallback: true } };
      await flow.process(NUMBER, text);
    },
  };
}
test("sales decision: partial i7 minimum RAM and cheap preference list official lowest-priced candidates", async (t) => {
  const h = salesConversation(t);
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Busco una no tan cara Core i7 de al menos 8 de RAM");
  const c = await h.flow.load(NUMBER);
  assert.deepEqual(c.filters.ram, { min: 8 });
  assert.equal(c.filters.price_preference, "lowest");
  assert.equal(c.lastOptions[0].price, 290);
  assert.ok(c.lastOptions.length <= 3);
  assert.doesNotMatch(h.sent.at(-1).text, /un poco mas|un poco más de detalle/);
  assert.match(h.sent.at(-1).text, /Cuál opción prefiere/);
});
test("sales decision: exact RAM criteria, ambiguous price resolved by minimal capacity/screen difference", async (t) => {
  const h = salesConversation(t);
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 y 16 de RAM");
  assert.equal((await h.flow.load(NUMBER)).lastOptions.length, 2);
  await h.send("La de 290");
  assert.match(h.sent.at(-1).text, /250 GB/);
  assert.match(h.sent.at(-1).text, /160 GB de 15 pulgadas/);
  assert.doesNotMatch(h.sent.at(-1).text, /detalle qué/);
  await h.send("la segunda");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-1");
});
test("sales decision: full pasted commercial label selects unique recent SKU", async (t) => {
  const h = salesConversation(t);
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 y 16 de RAM");
  await h.send("MACBOOK PRO I7 · 250 GB · RAM 16 GB · $290");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-0");
  assert.equal((await h.flow.load(NUMBER)).step, "LOCATION");
  assert.equal(h.sent.filter((s) => s.type === "image/jpeg").length, 1);
});
test("sales decision: photos/features reference selected product and wait once for whole block", async (t) => {
  const h = salesConversation(t);
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 y 16 de RAM");
  await h.send("la primera");
  h.sent.length = 0;
  h.events.length = 0;
  await h.send("Ayúdame con características y fotos del equipo");
  assert.deepEqual(
    h.sent.map((s) => s.type),
    ["image/jpeg", "video/mp4", "text", "audio/mp4", "text"],
  );
  assert.equal(h.events.length, 1);
  assert.match(h.sent.at(-1).text, /ciudad y provincia/);
});
test("sales decision: no exact match offers greater RAM without violating processor or price maximum", async (t) => {
  const h = salesConversation(t);
  h.available.pop();
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 8 de ram");
  assert.match(h.sent.at(-1).text, /mayor RAM/);
  assert.match(h.sent.at(-1).text, /RAM 16 GB/);
  assert.equal((await h.flow.load(NUMBER)).lastOptions.length, 2);
  await h.send("Busco otra", "FILTER_PRODUCTS", {
    filters: { cpu: "i7", ram_exact: 8, budget_max: 100 },
  });
  assert.equal((await h.flow.load(NUMBER)).filters.budget.max, 100);
  assert.match(h.sent.at(-1).text, /No encontré/);
});
test("sales decision: minimum 8 with only 16 in stock explains actual upgrade and price", async (t) => {
  const h = salesConversation(t);
  h.available.pop();
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 de al menos 8 de ram no tan cara");
  assert.match(h.sent.at(-1).text, /no tengo una de 8 GB RAM/);
  assert.match(h.sent.at(-1).text, /desde 16 GB RAM, desde \$290/);
});
test("sales decision: one recent option resolves media request, MacBook catalog never dumps full list", async (t) => {
  const h = salesConversation(t);
  h.available.splice(1);
  await h.send("MacBook", "MACBOOK_ENTRY");
  await h.send("Core i7 y 16 de RAM");
  await h.send("mándame fotos");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-0");
  await h.send("catálogo MacBook");
  assert.match(h.sent.at(-1).text, /Qué características/);
  assert.equal((await h.flow.load(NUMBER)).lastOptions.length, 0);
});
test("sales decision ranking supports preferences and never includes out-of-stock products", () => {
  const {
      createDecisionEngine,
      normalizeFilters,
    } = require("../lib/v4-decision"),
    { specs, family, matching } = require("../lib/v4-flow");
  const engine = createDecisionEngine({ specs, family, matching });
  assert.deepEqual(
    normalizeFilters({
      ram_min: 8,
      ram_max: 16,
      storage_exact: 500,
      budget_max: 300,
    }),
    { ram: { min: 8, max: 16 }, storage: 500, budget: { max: 300 } },
  );
  const available = products.filter(
    (p) => p.stock > 0 && /Mac/.test(p.producto),
  );
  assert.equal(
    engine.rank(available, { price_preference: "highest" })[0].precio,
    320,
  );
  assert.equal(
    engine.rank(available, { storage_preference: "highest" })[0].capacidad,
    "2 TB",
  );
});

test("sales decision does not confuse RAM or storage maxima with price budget", () => {
  const { createDecisionEngine } = require("../lib/v4-decision"),
    { specs, family, matching } = require("../lib/v4-flow");
  const engine = createDecisionEngine({ specs, family, matching }),
    c = { family: "macbook", filters: {}, lastOptions: [] };
  const result = engine.decision(
    "core i7, RAM 16, hasta 500 GB almacenamiento",
    c,
    { action: "UNKNOWN_QUESTION", params: {} },
  );
  assert.equal(result.params.filters.ram, 16);
  assert.deepEqual(result.params.filters.storage, { max: 500 });
  assert.equal(result.params.filters.budget, undefined);
  const price = engine.decision("core i7, 16 de RAM hasta $300", c, {
    action: "UNKNOWN_QUESTION",
    params: {},
  });
  assert.equal(price.params.filters.ram, 16);
  assert.deepEqual(price.params.filters.budget, { max: 300 });
});

test("automatic presentation: exact last-option phrase selects without intermediary question", async (t) => {
  const h = salesConversation(t);
  h.available[2].capacidad = "250 GB";
  h.offer();
  await h.send("La última me interesa la de 250 y 8 de ram");
  const c = await h.flow.load(NUMBER);
  assert.equal(c.selectedSku, "M-2");
  assert.equal(c.presentedSku, "M-2");
  assert.equal(c.step, "LOCATION");
  assert.deepEqual(
    h.sent.map((s) => s.type),
    ["image/jpeg", "video/mp4", "text", "audio/mp4", "text"],
  );
  assert.doesNotMatch(
    h.sent.map((s) => s.text || "").join(" "),
    /Desea.*fotos|Cuál opción prefiere/,
  );
  assert.equal(h.events.length, 1);
});
test("automatic presentation: yes please accepts a single recent product only during selection", async (t) => {
  const h = salesConversation(t);
  h.offer([h.available[0]]);
  await h.send("Sí por favor");
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-0");
  assert.equal((await h.flow.load(NUMBER)).step, "LOCATION");
  assert.equal(h.sent[0].type, "image/jpeg");
  const empty = salesConversation(t);
  await empty.send("Sí por favor", "CONFIRM");
  assert.equal((await empty.flow.load(NUMBER)).selectedSku, null);
  assert.equal((await empty.flow.load(NUMBER)).step, "START");
});
test("automatic presentation: unique filtered candidate presents; multiple candidates remain selection", async (t) => {
  const single = salesConversation(t);
  await single.send("MacBook", "MACBOOK_ENTRY");
  single.sent.length = 0;
  await single.send("Core i7 y 8 de RAM");
  assert.equal((await single.flow.load(NUMBER)).selectedSku, "M-2");
  assert.equal(single.sent[0].type, "image/jpeg");
  assert.equal(single.sent.filter((s) => s.type === "audio/mp4").length, 1);
  const many = salesConversation(t);
  await many.send("MacBook", "MACBOOK_ENTRY");
  await many.send("Core i7 y 16 de RAM");
  assert.equal((await many.flow.load(NUMBER)).selectedSku, null);
  assert.equal((await many.flow.load(NUMBER)).step, "PRODUCT_SELECTION");
  assert.ok(many.sent.every((s) => s.type === "text"));
});
for (const text of ["Sí", "sí, me interesa", "me interesa", "quiero comprarlo"])
  test(`completed presentation does not repeat for ${text}`, async (t) => {
    const h = salesConversation(t);
    h.offer();
    await h.send("la primera");
    const count = h.sent.filter((s) => s.type !== "text").length;
    await h.send(text, "CONFIRM");
    assert.equal(h.sent.filter((s) => s.type !== "text").length, count);
    assert.equal((await h.flow.load(NUMBER)).step, "LOCATION");
    assert.match(h.sent.at(-1).text, /ciudad y provincia/);
  });
for (const text of [
  "Envíeme fotos y características",
  "Muéstreme fotos",
  "Quiero ver el equipo",
  "Fotos y video",
  "Características",
  "Enséñeme el equipo",
  "Quiero verlo",
])
  test(`explicit presentation request resends selected product: ${text}`, async (t) => {
    const h = salesConversation(t);
    h.offer();
    await h.send("la primera");
    h.sent.length = 0;
    h.events.length = 0;
    await h.send(text);
    assert.equal(h.sent[0].type, "image/jpeg");
    assert.equal(h.sent.filter((s) => s.type === "audio/mp4").length, 1);
    assert.equal(h.events.length, 1);
  });
test("full pasted label without price uses screen to select unambiguously", async (t) => {
  const h = salesConversation(t);
  h.available[0].ram = "8 GB";
  h.available[1].ram = "8 GB";
  h.available[1].capacidad = "250 GB";
  h.offer();
  await h.send('MACBOOK PRO I7 15" · 250 GB · RAM 8 GB');
  assert.equal((await h.flow.load(NUMBER)).selectedSku, "M-1");
  assert.equal(h.sent[0].type, "image/jpeg");
});
