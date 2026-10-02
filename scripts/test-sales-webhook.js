"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  { createHmac } = require("node:crypto");
const { createApp } = require("../server");
const { memorySheets } = require("../lib/v2-storage");
const { fresh } = require("../lib/sales-flow");
const { discover } = require("../lib/sales-resources");
const NUMBER = "+593999123456",
  ADMIN = "+593999111111";
test("active V3 server signed YCloud/Meta webhook, dedup, pause and admin reset", async (t) => {
  const sheets = memorySheets(),
    env = {
      TEST_MODE: "true",
      MEMORIA_SPREADSHEET_ID: "memory",
      STOCK_SPREADSHEET_ID: "stock",
      YCLOUD_WEBHOOK_SECRET: "fixture-y",
      WHATSAPP_APP_SECRET: "fixture-m",
      VERIFY_TOKEN: "fixture-v",
      ASESOR_WHATSAPP: ADMIN,
    };
  const runtime = createApp({ env, sheets, interpret: async () => ({}) });
  const server = http.createServer(runtime.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const event = (text, id = "wim-v3", from = NUMBER) => ({
    type: "whatsapp.inbound_message.received",
    whatsappInboundMessage: {
      id,
      wamid: "wamid." + id,
      from,
      type: "text",
      text: { body: text },
    },
  });
  async function postY(value, valid = true) {
    const body = JSON.stringify(value),
      time = Math.floor(Date.now() / 1000),
      sig = createHmac("sha256", env.YCLOUD_WEBHOOK_SECRET)
        .update(`${time}.${body}`)
        .digest("hex");
    return fetch(base + "/ycloud/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "YCloud-Signature": `t=${time},s=${valid ? sig : "0".repeat(64)}`,
      },
      body,
    });
  }
  await t.test(
    "YCloud signed inbound persists provider and inbound ID, deduplicates",
    async () => {
      assert.equal((await postY(event("Hola"))).status, 200);
      assert.equal((await postY(event("Hola"))).status, 200);
      const rows = (
        await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" })
      ).data.values;
      const inbox = JSON.parse(rows[0].slice(1).join(""));
      assert.equal(inbox.pending.length, 1);
      assert.equal(inbox.pending[0].message.inboundId, "wim-v3");
      assert.equal(inbox.pending[0].message.provider, "ycloud");
    },
  );
  await t.test("invalid signature/phone never queued", async () => {
    assert.equal((await postY(event("PRIVATE", "bad"), false)).status, 401);
    assert.equal(
      (await postY(event("Hello", "bad-phone", "invalid"))).status,
      200,
    );
  });
  await t.test(
    "paused messages and audio do not grow inbox or call model",
    async () => {
      await runtime.store.set(NUMBER, {
        ...fresh(NUMBER, new Date().toISOString()),
        pauseState: "PAUSED_CONFIRMED",
      });
      const before = JSON.stringify(
        (await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" }))
          .data.values,
      );
      assert.equal((await postY(event("Todavía aquí", "paused"))).status, 200);
      const audio = event("", "audio");
      audio.whatsappInboundMessage.type = "audio";
      audio.whatsappInboundMessage.audio = { link: "https://invalid.example" };
      assert.equal((await postY(audio)).status, 200);
      assert.equal(
        JSON.stringify(
          (await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" }))
            .data.values,
        ),
        before,
      );
    },
  );
  await t.test(
    "authorized /borrar activates and removes queued commercial messages",
    async () => {
      assert.equal(
        (await postY(event("/borrar " + NUMBER, "admin", ADMIN))).status,
        200,
      );
      await runtime.ingress.flush(ADMIN.replace("+", ""));
      assert.equal((await runtime.store.get(NUMBER)).pauseState, "ACTIVE");
      const rows = (
        await sheets.spreadsheets.values.get({ range: "ENTRADAS_V2!A:ZZ" })
      ).data.values;
      assert.equal(
        JSON.parse(
          rows
            .find((r) => r[0] === NUMBER.replace("+", ""))
            .slice(1)
            .join(""),
        ).pending.length,
        0,
      );
    },
  );
  await t.test(
    "Meta route retains verification and signature requirements",
    async () => {
      assert.equal(
        await (
          await fetch(
            base +
              "/webhook?hub.mode=subscribe&hub.verify_token=fixture-v&hub.challenge=abc",
          )
        ).text(),
        "abc",
      );
      const body = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "meta-v3",
                      from: NUMBER,
                      type: "text",
                      text: { body: "Hola" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      const sig = createHmac("sha256", env.WHATSAPP_APP_SECRET)
        .update(body)
        .digest("hex");
      const post = (signature) =>
        fetch(base + "/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature,
          },
          body,
        });
      assert.equal((await post("sha256=" + sig)).status, 200);
      assert.equal((await post("sha256=" + "0".repeat(64))).status, 401);
    },
  );
});
test("V3 server full confirmation writes memory only; stock and sales untouched", async () => {
  const sheets = memorySheets(),
    writes = [],
    original = sheets.spreadsheets.values.update;
  sheets.spreadsheets.values.update = async (args) => {
    writes.push(args.range);
    return original(args);
  };
  await original({
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
          "IPADAIR1-32-PLA",
          "iPad Air 1",
          "32 GB",
          "1 GB",
          "Plateado",
          5,
          99.99,
          "RAM: 1 GB; almacenamiento: 32 GB",
        ],
      ],
    },
  });
  const resources = discover("resources"),
    file = resources.products["IPADAIR1-32-PLA"][0];
  for (const key of ["commercial1", "commercial2"])
    resources.audios[key] = {
      path: file.path,
      mime: "audio/mpeg",
      text: "Fixture oficial",
    };
  let x = {};
  const runtime = createApp({
    env: {
      TEST_MODE: "true",
      MEMORIA_SPREADSHEET_ID: "fixture",
      STOCK_SPREADSHEET_ID: "fixture",
    },
    sheets,
    resources,
    interpret: async () => x,
  });
  let count = 0;
  async function message(text, value) {
    x = value;
    await runtime.processMessage({
      id: "fixture-" + ++count,
      from: NUMBER,
      type: "text",
      text: { body: text },
      provider: "ycloud",
    });
  }
  await message("Quiero esta iPad", {
    sku: "IPADAIR1-32-PLA",
    data: { city: "Cuenca", name: "Ana Perez", cedula: "0912345678" },
  });
  await message("1", { data: { destination: "1" } });
  assert.equal((await runtime.store.get(NUMBER)).stage, "CONFIRMATION");
  await message("Perfecto, hagámoslo", { confirmation: "positive" });
  assert.equal(
    (await runtime.store.get(NUMBER)).pauseState,
    "PAUSED_CONFIRMED",
  );
  const before = writes.length;
  await message("Gracias", { confirmation: "positive" });
  assert.equal(writes.length, before);
  assert.ok(writes.every((r) => r.startsWith("MEMORIA!")));
  assert.equal(
    (await sheets.spreadsheets.values.get({ range: "'PAGINA DE STOCK'!F3:G3" }))
      .data.values[0][0],
    5,
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

test("YCloud real transport prepares inbound ID once; typing failure never escalates", async (t) => {
  for (const typingFails of [false, true])
    await t.test(
      typingFails
        ? "typing/read failure still responds"
        : "typing marks read before natural wait and response",
      async () => {
        const sheets = memorySheets(),
          calls = [],
          waits = [];
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
                "IPADAIR1-32-PLA",
                "iPad Air 1",
                "32 GB",
                "1 GB",
                "Plateado",
                9,
                99.99,
                "RAM: 1 GB; almacenamiento: 32 GB",
              ],
            ],
          },
        });
        const env = {
          MEMORIA_SPREADSHEET_ID: "fixture-memory",
          STOCK_SPREADSHEET_ID: "fixture-stock",
          YCLOUD_API_KEY: "fixture-key",
          YCLOUD_PHONE_NUMBER: "+593999000000",
          ASESOR_WHATSAPP: ADMIN,
        };
        const runtime = createApp({
          env,
          sheets,
          interpret: async () => {
            throw Error("interpreter unavailable");
          },
          wait: async (ms) => {
            waits.push(ms);
            calls.push({ type: "wait", ms });
          },
          fetchImpl: async (url, options) => {
            assert.ok(url.startsWith("https://api.ycloud.com/v2/whatsapp/"));
            const endpoint = url.split("/whatsapp/")[1];
            calls.push({
              type: endpoint,
              body:
                typeof options.body === "string"
                  ? JSON.parse(options.body)
                  : null,
            });
            if (typingFails && /typingIndicator|markAsRead/.test(endpoint))
              return { ok: false, status: 503 };
            return { ok: true, json: async () => ({ id: "fixture-upload" }) };
          },
        });
        const message = {
          provider: "ycloud",
          id: "wamid.fixture",
          inboundId: "wim-real-inbound-id",
          from: NUMBER,
          type: "text",
          text: { body: "quiero información de las iPad" },
        };
        await runtime.processMessage(message);
        assert.equal(
          calls[0].type,
          "inboundMessages/wim-real-inbound-id/typingIndicator",
        );
        assert.equal(
          calls.filter((c) => c.type.endsWith("/typingIndicator")).length,
          1,
        );
        assert.equal(
          calls.filter((c) => c.type.endsWith("/markAsRead")).length,
          typingFails ? 1 : 0,
        );
        assert.deepEqual(waits, [5000]);
        const response = calls.find((c) => c.type === "messages");
        assert.match(response.body.text.body, /iPads/);
        assert.equal(response.body.to, NUMBER);
        assert.equal((await runtime.flow.load(NUMBER)).pauseState, "ACTIVE");
        assert.ok(calls.every((c) => c.body?.to !== ADMIN));
        const before = calls.length;
        await runtime.store.set(NUMBER, {
          ...fresh(NUMBER, new Date().toISOString()),
          pauseState: "PAUSED_CONFIRMED",
        });
        await runtime.processMessage({ ...message, inboundId: "paused" });
        assert.equal(calls.length, before);
        await runtime.processMessage({
          ...message,
          from: ADMIN,
          inboundId: "admin",
          text: { body: "/liberar " + NUMBER },
        });
        assert.equal(calls.length, before);
        await runtime.processMessage({
          ...message,
          inboundId: "ignored",
          type: "image",
          text: undefined,
        });
        assert.equal(calls.length, before);
        // Actual four-element presentation: only one natural wait, despite media gaps.
        const blockCalls = [],
          blockWaits = [];
        const block = createApp({
          env,
          sheets,
          interpret: async () => ({ sku: "IPADAIR1-32-PLA" }),
          wait: async (ms) => blockWaits.push(ms),
          fetchImpl: async (url, options) => {
            blockCalls.push({
              url,
              body:
                typeof options.body === "string"
                  ? JSON.parse(options.body)
                  : null,
            });
            return { ok: true, json: async () => ({ id: "fixture-media" }) };
          },
        });
        await block.processMessage({
          ...message,
          inboundId: "wim-block",
          from: "+593999222222",
          text: { body: "IPADAIR1-32-PLA" },
        });
        assert.equal(
          blockCalls.filter((c) => c.url.endsWith("/typingIndicator")).length,
          1,
        );
        assert.equal(blockWaits.filter((ms) => ms === 5000).length, 1);
        assert.ok(
          blockWaits.filter((ms) => ms !== 5000).every((ms) => ms === 250),
        );
        assert.deepEqual(
          blockCalls
            .filter((c) => c.url.endsWith("/messages"))
            .slice(0, 4)
            .map((c) => c.body.type),
          ["image", "video", "text", "audio"],
        );
      },
    );
});

test("YCloud text and commercial blocks both wait exactly five seconds after typing", async () => {
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
          "WIN",
          "Dell Windows",
          "128 GB",
          "4 GB",
          "Negro",
          3,
          123,
          "Almacenamiento: 128 GB",
        ],
      ],
    },
  });
  const events = [];
  const runtime = createApp({
    env: {
      MEMORIA_SPREADSHEET_ID: "fixture-memory",
      STOCK_SPREADSHEET_ID: "fixture-stock",
      YCLOUD_API_KEY: "fixture-only-key",
      YCLOUD_PHONE_NUMBER: "+593999000000",
    },
    sheets,
    interpret: async () => ({}),
    wait: async (ms) => events.push(ms),
    fetchImpl: async (url) => {
      events.push(url.split("/whatsapp/")[1]);
      return { ok: true, json: async () => ({ id: "fixture-id" }) };
    },
  });
  await runtime.processMessage({
    from: NUMBER,
    provider: "ycloud",
    id: "wamid.quick",
    inboundId: "inbound-quick",
    type: "text",
    text: { body: "Hola" },
  });
  assert.deepEqual(events, [
    "inboundMessages/inbound-quick/typingIndicator",
    5000,
    "messages",
  ]);
  events.length = 0;
  await runtime.processMessage({
    from: NUMBER,
    provider: "ycloud",
    id: "wamid.catalog",
    inboundId: "inbound-catalog",
    type: "text",
    text: { body: "quiero información de las laptops" },
  });
  assert.deepEqual(events, [
    "inboundMessages/inbound-catalog/typingIndicator",
    5000,
    "messages",
  ]);
});

test("global flow.process failure logs safe diagnostics and preserves escalation", async (t) => {
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args));
  for (const sensitive of [false, true]) {
    const runtime = createApp({
      env: { TEST_MODE: "true", MEMORIA_SPREADSHEET_ID: "fixture-memory" },
      sheets: memorySheets(),
      interpret: async () => ({}),
    });
    const secret = "sk-fixture-private-credential";
    const error = Object.assign(
      new Error(
        sensitive
          ? "Authorization: Bearer " + secret + " payload cedula=1234567890"
          : "YCloud HTTP 503",
      ),
      {
        status: 503,
        code: "ECONNRESET",
        request: {
          headers: { "X-API-Key": secret },
          body: "sensitive-full-request",
        },
        cause: new Error(secret),
      },
    );
    runtime.flow.process = async () => {
      throw error;
    };
    await runtime.processMessage({
      from: NUMBER,
      type: "text",
      provider: "ycloud",
      inboundId: "fixture-inbound",
      id: "wamid.fixture",
      text: { body: "MacBooks" },
    });
    const log = logs.at(-1);
    assert.equal(log[0], "Flow processing failed");
    assert.equal(log[1].name, "Error");
    assert.equal(log[1].status, 503);
    assert.equal(log[1].code, "ECONNRESET");
    if (!sensitive) assert.equal(log[1].message, "YCloud HTTP 503");
    else assert.ok(log[1].message_redacted);
    const c = await runtime.flow.load(NUMBER);
    assert.equal(c.pauseState, "PAUSED_ESCALATION");
    assert.equal(c.pauseReason, "PROCESSING_OR_DELIVERY_UNCERTAIN");
  }
  assert.doesNotMatch(
    JSON.stringify(logs),
    /sk-fixture-private-credential|sensitive-full-request|1234567890|X-API-Key|Bearer/,
  );
});
test("MacBooks initial entry succeeds when semantic interpreter throws and waits five seconds after typing", async () => {
  const events = [],
    sheets = memorySheets();
  const runtime = createApp({
    env: {
      MEMORIA_SPREADSHEET_ID: "fixture-memory",
      YCLOUD_API_KEY: "fixture-key",
      YCLOUD_PHONE_NUMBER: "+593999000000",
    },
    sheets,
    interpret: async () => {
      throw Error("Interpreter down");
    },
    wait: async (ms) => events.push(ms),
    fetchImpl: async (url, options) => {
      events.push(url.split("/whatsapp/")[1]);
      return { ok: true, json: async () => ({ id: "fixture-id" }) };
    },
  });
  await runtime.processMessage({
    from: NUMBER,
    type: "text",
    provider: "ycloud",
    id: "wamid.mac",
    inboundId: "inbound-mac",
    text: { body: "Estoy interesado en las MacBooks" },
  });
  const c = await runtime.flow.load(NUMBER);
  assert.equal(c.family, "macbook");
  assert.equal(c.stage, "PRODUCT");
  assert.equal(c.pauseState, "ACTIVE");
  assert.deepEqual(events, [
    "inboundMessages/inbound-mac/typingIndicator",
    5000,
    "messages",
  ]);
});

test("exact screenshot MacBook message responds through inbox recovery with failed interpreter", async () => {
  const sheets = memorySheets(),
    events = [];
  const runtime = createApp({
    env: {
      MEMORIA_SPREADSHEET_ID: "fixture-memory",
      YCLOUD_API_KEY: "fixture-key",
      YCLOUD_PHONE_NUMBER: "+593999000000",
    },
    sheets,
    interpret: async () => {
      throw Error("Interpreter down");
    },
    wait: async (ms) => events.push({ wait: ms }),
    fetchImpl: async (url, options) => {
      events.push({
        endpoint: url.split("/whatsapp/")[1],
        body:
          typeof options.body === "string" ? JSON.parse(options.body) : null,
      });
      return { ok: true, json: async () => ({ id: "fixture-id" }) };
    },
  });
  const message = {
    from: NUMBER,
    type: "text",
    provider: "ycloud",
    id: "wamid.screenshot",
    inboundId: "inbound-screenshot",
    text: { body: "L estoy interesado en la MacBooks" },
  };
  assert.equal(await runtime.ingress.accept(message), "queued");
  const range = "ENTRADAS_V2!A:ZZ";
  const rows = (await sheets.spreadsheets.values.get({ range })).data.values;
  const entry = JSON.parse(rows[0].slice(1).join(""));
  assert.equal(entry.pending[0].message.replyPrepared, true);
  assert.ok(entry.pending[0].due > Date.now());
  entry.pending[0].due = 0;
  await sheets.spreadsheets.values.update({
    range: "ENTRADAS_V2!A1",
    requestBody: { values: [[rows[0][0], JSON.stringify(entry)]] },
  });
  await runtime.ingress.recover();
  const c = await runtime.flow.load(NUMBER);
  assert.equal(c.family, "macbook");
  assert.equal(c.pauseState, "ACTIVE");
  assert.equal(c.stage, "PRODUCT");
  assert.deepEqual(
    events.map((e) => e.endpoint || e.wait),
    ["inboundMessages/inbound-screenshot/typingIndicator", "messages"],
  );
  assert.match(events.at(-1).body.text.body, /modelo de preferencia/);
  assert.equal(
    JSON.parse(
      (await sheets.spreadsheets.values.get({ range })).data.values[0]
        .slice(1)
        .join(""),
    ).pending.length,
    0,
  );
});
