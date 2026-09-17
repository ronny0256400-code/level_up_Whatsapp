const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function entorno() {
    const original = { confirmado: true, datosCliente: { nombre: 'Ana Perez', cedula: '1234567890', telefono: '0991234567' }, historial: [{ role: 'user', content: 'Soy Ana Perez, cédula 1234567890, teléfono 0991234567. Quiero zapatos talla 38 por $25. Otro número 098-765-4321.' }], pedido: { id: 'PED-UNO', confirmado: true, producto: 'zapatos', precio: 25, guia: 'GUIA-OTRA', estado: 'enviado', seguimientoRetiro: true } };
    const memoria = [['0991234567', JSON.stringify(original), 'fecha-original']];
    let aprendizaje = []; let creada = false;
    const escrituras = [], mensajes = [];
    const sheets = { spreadsheets: {
        get: async () => ({ data: { sheets: creada ? [{ properties: { title: 'APRENDIZAJE' } }] : [] } }),
        batchUpdate: async args => { escrituras.push(args); creada = true; },
        values: {
            get: async ({ range }) => ({ data: { values: range.startsWith('APRENDIZAJE') ? aprendizaje : memoria } }),
            update: async args => { escrituras.push(args); if (args.range.startsWith('APRENDIZAJE')) aprendizaje = args.requestBody.values; else memoria[0] = args.requestBody.values[0]; },
            append: async args => { escrituras.push(args); aprendizaje.push(...args.requestBody.values); }
        }
    } };
    const routes = {};
    const app = { use() {}, get() {}, post(route, handler) { routes[route] = handler; }, listen() { return { on() {} }; } };
    function express() { return app; } express.json = () => {};
    const env = Object.fromEntries(['OPENAI_API_KEY','VERIFY_TOKEN','PHONE_NUMBER_ID','WHATSAPP_TOKEN','STOCK_SPREADSHEET_ID','MEMORIA_SPREADSHEET_ID'].map(k => [k, 'dummy']));
    env.ASESOR_WHATSAPP = '593999999999'; env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}'; env.MODEL_LOW='fixture'; env.MODEL_NORMAL='fixture'; env.MODEL_HIGH='fixture';
    const context = vm.createContext({ require(name) {
        if (name.startsWith('./lib/')) return require('../' + name.slice(2));
        if (name === 'node:async_hooks') return require(name);
        if (name === './lib/ycloud-webhook') return require('../lib/ycloud-webhook');
        if (name === 'express') return express;
        if (name === 'openai') return class { constructor() { this.responses = { create() { throw new Error('No debe llegar a IA'); } }; } };
        if (name === 'googleapis') return { google: { auth: { GoogleAuth: class {} }, sheets: () => sheets } };
        throw new Error(name);
    }, process: { env }, console: { log() {}, error() {} }, fetch: async (url, args) => { mensajes.push(JSON.parse(args.body)); return { ok: true, text: async () => '{}' }; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') + '\nthis.api = { procesarMensajeV2, guardarAprendizaje, anonimizarHistorial };', context);
    async function comando(text) {
        let status;
        await context.api.procesarMensajeV2({ body: { entry: [{ changes: [{ value: { messages: [{ id: `msg-${text}`, from: env.ASESOR_WHATSAPP, type: 'text', text: { body: text } }] } }] }] } }, { sendStatus(code) { status = code; }, status(code) { status = code; return this; }, json() {} });
        assert.equal(status, 200);
    }
    return { original, memoria, escrituras, mensajes, comando, api: context.api, filas: () => aprendizaje };
}

test('V2: PAGO no modifica campos ni envía mensajes', async () => {
    const e = entorno();
    await e.comando('PAGO GUIA-OTRA');
    await e.comando('PAGO PED-UNO');
    await e.comando('PAGO');
    assert.deepEqual(JSON.parse(e.memoria[0][1]), e.original);
    assert.equal(e.escrituras.length, 0);
    assert.equal(e.mensajes.length, 0);
});

test('LLEGO envía aviso al cliente y termina el webhook', async () => {
    const e = entorno(); await e.comando('LLEGO GUIA-OTRA');
    assert.equal(e.mensajes.length, 1);
    assert.equal(e.mensajes[0].to, '0991234567');
    assert.match(e.mensajes[0].text.body, /Tu pedido ya llegó/);
});

test('APRENDIZAJE crea hoja y fila anonimizada sin modificar MEMORIA ni original', async () => {
    const e = entorno(); const anterior = JSON.stringify(e.original), memoria = JSON.stringify(e.memoria);
    assert.equal(await e.api.guardarAprendizaje(e.original, '0991234567'), true);
    const filas = e.filas();
    assert.equal(filas.length, 2);
    assert.deepEqual(Array.from(filas[0]), ['idAprendizaje','idPedido','producto','resultado','historial','aprobada','fecha']);
    assert.equal(filas[1][1], 'PED-UNO'); assert.equal(filas[1][3], 'venta'); assert.equal(filas[1][5], 'NO');
    const historial = JSON.parse(filas[1][4]);
    assert.equal(historial[0].role, 'user');
    assert.doesNotMatch(historial[0].content, /Ana|Perez|1234567890|0991234567|098-765-4321/);
    assert.match(historial[0].content, /zapatos talla 38 por \$25/);
    assert.equal(JSON.stringify(e.original), anterior); assert.equal(JSON.stringify(e.memoria), memoria);
    assert.ok(e.escrituras.every(x => !x.range || x.range.startsWith('APRENDIZAJE')));
});

test('APRENDIZAJE evita duplicados secuenciales y concurrentes por idPedido', async () => {
    const e = entorno();
    const resultados = await Promise.all([e.api.guardarAprendizaje(e.original), e.api.guardarAprendizaje(e.original)]);
    assert.deepEqual(resultados, [true, false]);
    assert.equal(await e.api.guardarAprendizaje(e.original), false);
    assert.equal(e.filas().length, 2);
});

test('APRENDIZAJE excluye pedidos sin confirmar', async () => {
    const e = entorno(); e.original.confirmado = false;
    assert.equal(await e.api.guardarAprendizaje(e.original), false);
    assert.equal(e.escrituras.length, 0);
});
