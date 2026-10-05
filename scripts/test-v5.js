"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  createFlow,
  context,
  nextBestAction,
  createAnswer,
} = require("../lib/v5-seller");
const { createRuntime } = require("../lib/v4-runtime");
function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v5-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "media");
  fs.writeFileSync(file, "mock");
  const products = [
    ["W1", "DELL", 128, 4, 100, 13],
    ["W2", "ACER", 256, 8, 150, 15],
    ["W3", "HP", 500, 16, 180, 15],
    ["M1", "MacBook Pro Core i7", 250, 8, 290, 13],
    ["M2", "MacBook Pro Core i7", 500, 16, 350, 15],
    ["I1", "iPad Air", 16, 1, 80, 9],
    ["I2", "iPad Air", 32, 1, 100, 9],
  ].map(([id_producto, producto, gb, ram, precio, screen]) => ({
    id_producto,
    producto,
    capacidad: gb + " GB",
    ram: ram + " GB",
    precio,
    stock: 5,
    informacion_producto: producto.startsWith("iPad")
      ? "Pantalla oficial iPad"
      : `${producto}\nRAM: ${ram} GB\n${screen} pulgadas\nTouch: no`,
  }));
  const rows = new Map(products.map((p) => [p.id_producto, p])),
    sent = [],
    waits = [],
    reads = [],
    memory = new Map(),
    logs = [];
  const resources = {
    products: Object.fromEntries(
      products.map((p) => [
        p.id_producto,
        [
          { type: "image", mime: "image/jpeg", path: file },
          { type: "video", mime: "video/mp4", path: file },
        ],
      ]),
    ),
    audios: { commercial1: { path: file, mime: "audio/mpeg" } },
  };
  const dependencies = {
    catalog: async () => ({ available: rows }),
    resources,
    store: {
      get: async (n) => structuredClone(memory.get(n)),
      set: async (n, c) => memory.set(n, structuredClone(c)),
    },
    interpret: async () => ({ action: "UNKNOWN_QUESTION", params: {} }),
    prepare: async (n, id) => {
      reads.push(id);
      waits.push(5000);
    },
    sendText: async (n, text) => sent.push({ text }),
    sendMedia: async (n, b, mime) => sent.push({ mime }),
    log: (x) => logs.push(x),
  };
  const flow = createFlow(dependencies);
  let serial = 0;
  return {
    flow,
    dependencies,
    products,
    rows,
    memory,
    sent,
    waits,
    reads,
    logs,
    async send(text) {
      sent.length = 0;
      await flow.process("+593999999999", text, {
        messageId: "inbound-" + ++serial,
      });
      return flow.load("+593999999999");
    },
    async seed(update) {
      memory.set("+593999999999", { ...context("+593999999999"), ...update });
    },
  };
}
test("Windows entry uses stock brands and conversational context", async (t) => {
  const h = harness(t),
    c = await h.send("Hola quiero comprar una laptop");
  assert.equal(c.family, "windows");
  assert.match(h.sent[0].text, /DELL/);
  assert.equal(c.lastBotMessageType, "brands");
});
test("large cheapest Windows automatically presents official SKU with one wait", async (t) => {
  const h = harness(t),
    c = await h.send("Quiero una laptop grande cuál es la más económica");
  assert.equal(c.selectedSku, "W2");
  assert.equal(c.step, "LOCATION");
  assert.equal(h.waits.length, 1);
  assert.deepEqual(
    h.sent.slice(0, 5).map((e) => e.mime || e.text),
    [
      "image/jpeg",
      "video/mp4",
      h.rows.get("W2").informacion_producto,
      "Precio: $150.00.",
      "audio/mpeg",
    ],
  );
});
test("features query preserves step and uses official text without media", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "windows",
    selectedSku: "W2",
    presentedSku: "W2",
    step: "LOCATION",
  });
  const c = await h.send("Sus características");
  assert.equal(c.step, "LOCATION");
  assert.match(h.sent[0].text, /RAM: 8 GB/);
  assert.equal(h.sent.length, 1);
});
test("MacBook entry does not dump catalogue", async (t) => {
  const h = harness(t),
    c = await h.send("Me interesan las MacBook");
  assert.equal(c.family, "macbook");
  assert.match(h.sent[0].text, /Qué características/);
  assert.doesNotMatch(h.sent[0].text, /290/);
});
test("MacBook minimum RAM and price criteria use official options", async (t) => {
  const h = harness(t);
  await h.seed({ family: "macbook" });
  const c = await h.send("Core i7 mínimo 8 RAM no tan cara");
  assert.equal(c.filters.cpu, "i7");
  assert.deepEqual(c.filters.ram, { min: 8 });
  assert.equal(c.lastOptions.length, 2);
  assert.equal(c.lastOptions[0].sku, "M1");
});
test("last option reference presents last official product", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "macbook",
    lastOptions: [
      { sku: "M1", label: "first" },
      { sku: "M2", label: "last" },
    ],
  });
  const c = await h.send("La última");
  assert.equal(c.selectedSku, "M2");
  assert.equal(c.presentedSku, "M2");
});
test("yes after sole option presents and proceeds to location", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "windows",
    step: "PRODUCT_SELECTION",
    lastOptions: [{ sku: "W1", label: "Dell" }],
  });
  const c = await h.send("Sí por favor");
  assert.equal(c.selectedSku, "W1");
  assert.equal(c.step, "LOCATION");
});
test("price query uses selected official price without changing step", async (t) => {
  const h = harness(t);
  await h.seed({ family: "windows", selectedSku: "W3", step: "LOCATION" });
  const c = await h.send("¿Qué precio tiene?");
  assert.match(h.sent[0].text, /180.00/);
  assert.equal(c.step, "LOCATION");
});
test("iPad variant comparison uses capacity and official price without repeated media", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "ipad",
    selectedSku: "I2",
    presentedSku: "I2",
    step: "LOCATION",
  });
  await h.send("¿Y la de 16 GB?");
  assert.match(h.sent[0].text, /80.00/);
  assert.match(h.sent[0].text, /características base se mantienen/);
  assert.equal(h.sent.length, 1);
});
test("explicit photos resend presentation once", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "windows",
    selectedSku: "W1",
    presentedSku: "W1",
    step: "LOCATION",
  });
  await h.send("Envíeme fotos");
  assert.equal(h.sent[0].mime, "image/jpeg");
  assert.equal(h.waits.length, 1);
});
test("unknown specific question uses grounded answer and continues without changing step", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "windows",
    selectedSku: "W2",
    presentedSku: "W2",
    step: "LOCATION",
  });
  const flow = createFlow({
    ...h.dependencies,
    answer: async ({ sources, context }) => {
      assert.equal(context.selectedSku, "W2");
      return sources[0].split("\n")[1];
    },
  });
  await flow.process("+593999999999", "¿Qué memoria trae de fábrica?");
  assert.match(h.sent[0].text, /RAM: 8 GB/);
  assert.match(h.sent[0].text, /ciudad y provincia/);
  assert.equal((await flow.load("+593999999999")).step, "LOCATION");
});
test("interpretation failure retains commercial deterministic response", async (t) => {
  const h = harness(t),
    flow = createFlow({
      ...h.dependencies,
      interpret: async () => {
        throw Error("secret token");
      },
    });
  await flow.process("+593999999999", "Hola quiero comprar una laptop");
  assert.match(h.sent[0].text, /ACER/);
  assert.ok(!JSON.stringify(h.logs).includes("secret token"));
  assert.ok(!h.sent.some((x) => /Podría indicarme/.test(x.text || "")));
});
test("grounded composer rejects invented excerpt", async () => {
  const openai = {
    responses: {
      create: async () => ({
        status: "completed",
        output_text: JSON.stringify({
          excerpts: [{ source: 0, text: "Garantía de cinco años" }],
        }),
      }),
    },
  };
  assert.equal(
    await createAnswer(openai, { MODEL_LOW: "configured" })({
      text: "garantía",
      context: {},
      sources: ["RAM: 8 GB"],
    }),
    null,
  );
});
test("grounded composer accepts exact evidence and configurable model", async () => {
  const openai = {
    responses: {
      create: async (req) => {
        assert.equal(req.model, "configured");
        return {
          status: "completed",
          output_text: '{"excerpts":[{"source":0,"text":"RAM: 8 GB"}]}',
        };
      },
    },
  };
  assert.equal(
    await createAnswer(openai, { MODEL_LOW: "configured" })({
      text: "ram",
      context: {},
      sources: ["RAM: 8 GB"],
    }),
    "RAM: 8 GB",
  );
});
test("runtime reuses read typing and exactly one five second delay", async (t) => {
  const h = harness(t),
    events = [];
  const runtime = createRuntime({
    ...h.dependencies,
    env: { TEST_MODE: "true" },
    flowFactory: createFlow,
    ycloud: {
      markRead: async (id) => events.push(["read", id]),
      typing: async (id) => events.push(["typing", id]),
      sendText: async () => {},
      uploadMedia: async () => ({ id: "media" }),
      sendImage: async () => {},
      sendVideo: async () => {},
      sendAudio: async () => {},
    },
    wait: async (ms) => events.push(["wait", ms]),
  });
  await runtime.handleMessage({
    from: "+593999999999",
    id: "real-inbound",
    type: "text",
    text: { body: "Hola quiero comprar una laptop" },
  });
  assert.deepEqual(events, [
    ["read", "real-inbound"],
    ["typing", "real-inbound"],
    ["wait", 5000],
  ]);
});
test("nextBestAction derives location/agency without complex pause states", () => {
  assert.equal(nextBestAction(context("x")), "CHOOSE_FAMILY");
  assert.equal(
    nextBestAction({ ...context("x"), selectedSku: "X", presentedSku: "X" }),
    "LOCATION",
  );
  assert.equal(
    nextBestAction({
      ...context("x"),
      location: { city: "Quito", province: "Pichincha" },
    }),
    "AGENCY",
  );
});

test("USE_V5 local routing chooses seller and retains admin reset", async (t) => {
  const { createApp } = require("../server");
  const { memorySheets } = require("../lib/v2-storage");
  const runtime = createApp({
    env: {
      TEST_MODE: "true",
      USE_V5: "true",
      ASESOR_WHATSAPP: "+593999111111",
    },
    sheets: memorySheets(),
    v5Interpret: async () => ({ action: "GREETING", params: {} }),
    wait: async () => {},
  });
  const routes = [];
  t.mock.method(runtime.v4.flow, "process", async () => routes.push("V5"));
  t.mock.method(runtime.v4.flow, "reset", async () => routes.push("admin"));
  t.mock.method(runtime.flow, "process", async () => {
    throw Error("unexpected V3");
  });
  await runtime.processMessage({
    from: "+593999999999",
    provider: "ycloud",
    id: "customer",
    type: "text",
    text: { body: "Hola" },
  });
  await runtime.processMessage({
    from: "+593999111111",
    provider: "ycloud",
    id: "admin",
    type: "text",
    text: { body: "/liberar +593999999999" },
  });
  assert.equal(runtime.useV5, true);
  assert.deepEqual(routes, ["V5", "admin"]);
});

test("interpreter receives last bot message and known customer context", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "macbook",
    lastBotMessage: "¿Qué RAM busca?",
    customer: { name: "Cliente", cedula: null },
  });
  const flow = createFlow({
    ...h.dependencies,
    interpret: async (input) => {
      assert.equal(input.context.lastBotMessage, "¿Qué RAM busca?");
      assert.equal(input.context.customer.name, "Cliente");
      return {
        action: "FILTER_PRODUCTS",
        params: { family: "macbook", filters: { ram_min: 8 } },
      };
    },
  });
  await flow.process("+593999999999", "8 o más");
  assert.ok(h.sent.length);
});
test("accepting an iPad variant after price selects the new variant", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "ipad",
    selectedSku: "I2",
    presentedSku: "I2",
    step: "LOCATION",
  });
  await h.send("¿Y la de 16 GB?");
  const c = await h.send("Sí por favor");
  assert.equal(c.selectedSku, "I1");
  assert.equal(c.presentedSku, "I1");
});

test("MacBook numeric reference does not reopen family or erase recent options", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "macbook",
    step: "PRODUCT_SELECTION",
    lastOptions: [
      { sku: "M1", label: "MACBOOK PRO I7 · 250 GB · RAM 8 GB · 13 pulgadas · $290.00", price: 290, cpu: "i7", ram: 8, storage: 250, screen: 13 },
      { sku: "M2", label: "MACBOOK PRO I7 · 500 GB · RAM 16 GB · 15 pulgadas · $350.00", price: 350, cpu: "i7", ram: 16, storage: 500, screen: 15 },
    ],
  });
  const c = await h.send("La MacBook Pro de 250");
  assert.equal(c.selectedSku, "M1");
  assert.equal(c.presentedSku, "M1");
  assert.equal(c.step, "LOCATION");
  assert.equal(h.sent[0].mime, "image/jpeg");
});

test("exact recent MacBook label resolves without interpreter", async (t) => {
  const h = harness(t);
  let calls = 0;
  const flow = createFlow({
    ...h.dependencies,
    interpret: async () => {
      calls++;
      throw Error("interpreter should not be needed");
    },
  });
  await h.dependencies.store.set("+593999999999", {
    ...context("+593999999999"),
    family: "macbook",
    step: "PRODUCT_SELECTION",
    lastOptions: [
      { sku: "M1", label: "MACBOOK PRO I7 · 250 GB · RAM 8 GB · 13 pulgadas · $290.00", price: 290, cpu: "i7", ram: 8, storage: 250, screen: 13 },
    ],
  });
  await flow.process(
    "+593999999999",
    "MACBOOK PRO I7 · 250 GB · RAM 8 GB · 13 pulgadas · $290",
    { messageId: "exact-label" },
  );
  const c = await flow.load("+593999999999");
  assert.equal(c.selectedSku, "M1");
  assert.equal(c.presentedSku, "M1");
  assert.equal(c.step, "LOCATION");
  assert.equal(calls, 0);
});

test("photos plus characteristics requests presentation rather than text-only features", async (t) => {
  const h = harness(t);
  await h.seed({
    family: "windows",
    selectedSku: "W2",
    presentedSku: "W2",
    step: "LOCATION",
  });
  const c = await h.send("Envíeme fotos y características del equipo");
  assert.equal(c.selectedSku, "W2");
  assert.equal(h.sent[0].mime, "image/jpeg");
  assert.ok(h.sent.some((x) => x.mime === "video/mp4"));
  assert.ok(h.sent.some((x) => x.mime === "audio/mpeg"));
});

test("V5 runtime transcribes audio and routes transcript through same seller flow", async (t) => {
  const h = harness(t), events = [], transcripts = [];
  const runtime = createRuntime({
    ...h.dependencies,
    env: { TEST_MODE: "true" },
    flowFactory: createFlow,
    transcribeAudio: async () => {
      transcripts.push("called");
      return "Hola quiero comprar una laptop";
    },
    ycloud: {
      markRead: async (id) => events.push(["read", id]),
      typing: async (id) => events.push(["typing", id]),
      sendText: async () => {},
      uploadMedia: async () => ({ id: "media" }),
      sendImage: async () => {},
      sendVideo: async () => {},
      sendAudio: async () => {},
    },
    wait: async (ms) => events.push(["wait", ms]),
  });
  const result = await runtime.handleMessage({
    from: "+593999999999",
    id: "audio-1",
    inboundId: "audio-inbound-1",
    type: "audio",
    audio: { link: "https://api.ycloud.com/v2/whatsapp/media/download/1" },
  });
  assert.equal(result, "processed");
  assert.deepEqual(transcripts, ["called"]);
  assert.equal((await runtime.flow.load("+593999999999")).family, "windows");
  assert.deepEqual(events, [
    ["read", "audio-inbound-1"],
    ["typing", "audio-inbound-1"],
    ["wait", 5000],
  ]);
});

test("V5 runtime audio failure answers instead of going silent", async (t) => {
  const h = harness(t), sent = [], events = [];
  const runtime = createRuntime({
    ...h.dependencies,
    env: { TEST_MODE: "true" },
    flowFactory: createFlow,
    transcribeAudio: async () => null,
    ycloud: {
      markRead: async (id) => events.push(["read", id]),
      typing: async (id) => events.push(["typing", id]),
      sendText: async (_, text) => sent.push(text),
      uploadMedia: async () => ({ id: "media" }),
      sendImage: async () => {},
      sendVideo: async () => {},
      sendAudio: async () => {},
    },
    wait: async (ms) => events.push(["wait", ms]),
  });
  const result = await runtime.handleMessage({
    from: "+593999999999",
    id: "audio-fail",
    type: "audio",
    audio: {},
  });
  assert.equal(result, "audio_failed");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /enviar nuevamente/i);
  assert.deepEqual(events, [
    ["read", "audio-fail"],
    ["typing", "audio-fail"],
    ["wait", 5000],
  ]);
});
