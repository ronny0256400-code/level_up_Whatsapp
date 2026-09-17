const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const resumen = '📋 RESUMEN DE TU PEDIDO\nProducto: iPad Air 1\nPrecio: $100\n¿Me confirmas que todos estos datos están correctos?';
function entorno({ falloAsesor = false, falloVideo = false, falloCliente = false, sinJson = false, video = '' } = {}) {
    let memoria = [], aprendizaje = [], creada = false, secuencia = 0;
    const control = { openaiCaido: false, llamadasOpenAI: 0, llamadasClasificador: 0, llamadasAtencion: 0, atencion: "NO_SOLICITA", etiqueta: "AMBIGUO" };
    const eventos = [], mensajes = [], logs = [], prompts = [], respuestas = [];
    const sheets = { spreadsheets: {
        get: async () => ({ data: { sheets: creada ? [{ properties: { title: 'APRENDIZAJE' } }] : [] } }),
        batchUpdate: async () => { creada = true; },
        values: {
            get: async ({ range }) => ({ data: { values: range === "'PAGINA DE STOCK'!A2:G2" ? [require('./helpers/inventory-fixture').HEADERS] : range.startsWith('APRENDIZAJE') ? aprendizaje : range.startsWith('MEMORIA') ? memoria : [['IPADAIR1-32-PLA','iPad Air 1','32 GB','plateado',20,100,'Para lectura; incluye cable']] } }),
            update: async ({ range, requestBody }) => { if (range.startsWith('MEMORIA')) { requestBody.values.forEach((row,i)=>{memoria[Number(range.match(/A(\d+)/)[1])-2+i]=row;}); eventos.push('memoria'); } else aprendizaje = requestBody.values; },
            append: async ({ requestBody }) => { aprendizaje.push(...requestBody.values); eventos.push('aprendizaje'); }
        }
    } };
    const routes = {}; const app = { use() {}, get() {}, post(r,h) { routes[r]=h; }, listen() { return { on() {} }; } };
    function express() { return app; } express.json = () => {};
    const env = Object.fromEntries(['OPENAI_API_KEY','VERIFY_TOKEN','PHONE_NUMBER_ID','WHATSAPP_TOKEN','STOCK_SPREADSHEET_ID','MEMORIA_SPREADSHEET_ID'].map(k => [k,'dummy']));
    env.ASESOR_WHATSAPP='000000000001'; env.GOOGLE_SERVICE_ACCOUNT_JSON='{}'; env.MODEL_LOW='fixture'; env.MODEL_NORMAL='fixture'; env.MODEL_HIGH='fixture'; env.IPAD_AIR_1_VIDEO_MEDIA_ID=video;
    const context = vm.createContext({ require(name) {
        if (name.startsWith('./lib/')) return require('../' + name.slice(2));
        if (name === 'node:async_hooks') return require(name);
        if (name === './lib/ycloud-webhook') return require('../lib/ycloud-webhook');
        if (name === 'node:crypto') return require(name);
        if (name === 'express') return express;
        if (name === 'googleapis') return { google: { auth: { GoogleAuth: class {} }, sheets: () => sheets } };
        if (name === 'openai') return class { constructor() { this.responses = { create: async args => {
            control.llamadasOpenAI++;
            if (control.openaiCaido) throw new Error('OpenAI simulado caído');
            if (args.instructions.startsWith('Clasifica únicamente intención de atención humana')) {
                control.llamadasAtencion++;
                return { output_text: control.atencion };
            }
            if (args.instructions.startsWith('Eres únicamente un clasificador')) {
                control.llamadasClasificador++;
                return { output_text: control.etiqueta };
            }
            if (args.text && !args.input.some(m => m.role === 'user' && /datos/.test(m.content))) return { output_text: 'null' };
            if (args.text) return { output_text: JSON.stringify({ id_producto:'IPADAIR1-32-PLA',nombre:'Persona Ficticia',cedula:'0000000000',telefono:'000000000002',provincia:'Prueba',ciudad:'Prueba',producto:'iPad Air 1',variante:'32 GB',cantidad:1,precio:100 }) };
            prompts.push(args.instructions); return { output_text: respuestas.shift() || 'Gracias, continuamos.' };
        } }; } };
        throw Error(name);
    }, process: { env }, console: { log: (...a) => logs.push(a), error: (...a) => logs.push(a) }, fetch: async (url,args) => {
        const body=JSON.parse(args.body); mensajes.push(body);
        const asesor=body.to===env.ASESOR_WHATSAPP;
        if (asesor) eventos.push('asesor');
        const fallo = (asesor && falloAsesor) || (body.type === 'video' && falloVideo) || (!asesor && body.type === 'text' && falloCliente);
        return { ok: !fallo, status: fallo ? 500 : 200, text: async () => sinJson ? '<html>error</html>' : JSON.stringify({ error: { code: 131000, message:'Persona Ficticia 000000000002' } }) };
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8')+'\nthis.api={procesarMensajeV2,conversaciones,esConfirmacionAfirmativa};',context);
    async function turno(texto, respuesta, id = `msg-${++secuencia}`, esperado = 200) {
        if (respuesta) respuestas.push(respuesta);
        let status;
        await context.api.procesarMensajeV2({ body:{entry:[{changes:[{value:{messages:[{id,from:'000000000002',type:'text',text:{body:texto}}]}}]}]} },{ sendStatus(code) { status=code; }, status(code) { status=code; return this; }, json() {} });
        assert.equal(status,esperado);
    }
    return { control, turno, eventos, mensajes, logs, prompts, api:context.api, memoria:()=>JSON.parse(memoria.find(row=>row[0]==='000000000002')[1]), aprendizaje:()=>aprendizaje };
}

test('turno A persiste espera; turno B confirma sin frase de IA, incluso recargando MEMORIA', async () => {
    const e=entorno(); await e.turno('Estos son mis datos',resumen);
    assert.equal(e.memoria().esperandoConfirmacionPedido,true);
    assert.equal(e.memoria().confirmado,false);
    e.api.conversaciones.clear();
    await e.turno('Sí, confirmo','Gracias, un asesor te contactará.');
    assert.equal(e.memoria().confirmado,true); assert.ok(e.memoria().pedido.id);
    assert.equal(e.memoria().esperandoConfirmacionPedido,false);
});
test('sí sin contexto y sí con objeción no crean pedido', async () => {
    const e=entorno(); await e.turno('sí','¿Qué producto buscas?');
    assert.equal(e.memoria().pedido,undefined);
    await e.turno('mis datos',resumen);
    await e.turno('sí, pero cambia la capacidad','Revisemos la capacidad.');
    assert.equal(e.memoria().pedido,undefined);
});
test('mensajes repetidos y concurrentes no duplican pedido ni APRENDIZAJE', async () => {
    const e=entorno(); await e.turno('datos',resumen);
    await Promise.all([e.turno('confirmo',null,'repetido'),e.turno('confirmo',null,'repetido')]);
    const id=e.memoria().pedido.id; await e.turno('confirmo');
    assert.equal(e.memoria().pedido.id,id);
    assert.equal(e.eventos.filter(x=>x==='asesor').length,1);
    assert.equal(e.aprendizaje().length,2);
});
test('cierre persiste MEMORIA, notifica asesor y después registra aprendizaje', async () => {
    const e=entorno(); await e.turno('datos',resumen); await e.turno('está correcto');
    const i=e.eventos.indexOf('asesor'); assert.equal(e.eventos[i-1],'memoria'); assert.equal(e.eventos[i+1],'aprendizaje');
    assert.ok(e.logs.flat().includes('Notificación al asesor enviada'));
});
test('error WhatsApp al asesor conserva pedido y aprendizaje sin PII en logs', async () => {
    const e=entorno({falloAsesor:true}); await e.turno('datos',resumen); await e.turno('de acuerdo');
    assert.equal(e.memoria().confirmado,true); assert.equal(e.aprendizaje().length,2);
    assert.doesNotMatch(JSON.stringify(e.logs),/Persona Ficticia|000000000002|0000000000/);
    assert.ok(!e.logs.flat().includes('Notificación al asesor enviada'));
});
test('prompt de objeción limita afirmaciones a catálogo y no garantiza apps o nube gratuita', async () => {
    const e=entorno(); await e.turno('32 GB me parece poco');
    const p=e.prompts[0];
    for (const regla of ['Nunca cierres una objeción con una negativa seca','No inventes características','No garantices compatibilidad','ni inventes cantidades gratuitas','antes de pedir datos de compra','video de funcionamiento/prueba','*nombre destacado*']) assert.ok(p.includes(regla),regla);
});
test('sin video configurado continúa respuesta normal', async () => {
    const e=entorno(); await e.turno('Me interesa iPad Air 1','*iPad Air 1*\n32 GB — $100');
    assert.equal(e.mensajes.length,1); assert.equal(e.mensajes[0].type,'text');
});
test('video configurado precede ficha y se envía una sola vez', async () => {
    const e=entorno({video:'123456789'}); await e.turno('Me interesa iPad Air 1','*iPad Air 1*\n32 GB — $100');
    assert.deepEqual(e.mensajes.map(m=>m.type),['video','text']);
    await e.turno('Me interesa iPad Air 1');
    assert.equal(e.mensajes.filter(m=>m.type==='video').length,1);
});

test('fallo de video no impide ficha ni marca video enviado', async () => {
    const e=entorno({video:'123456789',falloVideo:true});
    await e.turno('Me interesa iPad Air 1','*iPad Air 1*\n32 GB — $100');
    assert.deepEqual(e.mensajes.map(m=>m.type),['video','text']);
    assert.equal(e.memoria().videoIpadAir1Enviado,undefined);
});
test('un sí anterior al primer resumen no confirma en ese mismo turno', async () => {
    const e=entorno(); await e.turno('sí',resumen);
    assert.equal(e.memoria().pedido,undefined);
    assert.ok(!e.memoria().esperandoConfirmacionPedido);
});

for (const frase of ['sí', 'si', 'confirmo', 'Confirmo mi pedido', 'sí, confirmo', 'Sí, está todo correcto', 'está correcto', 'todo correcto', 'de acuerdo', 'estoy de acuerdo', 'adelante', 'Sí, adelante', 'procedamos', 'correcto', 'correcto, procedamos', 'De acuerdo, procedamos', 'SÍ, CONFIRMO MI PEDIDO, MUCHAS GRACIAS!']) {
    test(`aceptación contextual sin OpenAI: ${frase}`, async () => {
        const e=entorno(); await e.turno('Estos son mis datos');
        assert.equal(e.memoria().esperandoConfirmacionPedido,true);
        const llamadas=e.control.llamadasOpenAI;
        e.control.openaiCaido=true;
        await e.turno(frase);
        assert.equal(e.memoria().confirmado,true);
        assert.equal(e.control.llamadasOpenAI,llamadas);
        assert.equal(e.aprendizaje().length,2);
        const id=e.memoria().pedido.id;
        await e.turno(frase);
        assert.equal(e.memoria().pedido.id,id);
        assert.equal(e.eventos.filter(x=>x==='asesor').length,1);
    });
}
for (const sinJson of [false,true]) {
    test(`resumen con Meta 500 ${sinJson ? 'sin' : 'con'} JSON no activa espera`, async () => {
        const e=entorno({falloCliente:true,sinJson});
        await e.turno('Estos son mis datos',null,'fallido',500);
        assert.ok(!e.memoria().esperandoConfirmacionPedido);
        assert.ok(e.logs.some(args => args[0]==='Error de envío WhatsApp' && args[1].http===500));
        assert.ok(!e.memoria().historial.some(m=>m.role==='assistant'));
    });
}
test('asesor con Meta 500 sin JSON conserva status y pedido', async () => {
    const e=entorno({falloAsesor:true,sinJson:true});
    await e.turno('Estos son mis datos'); await e.turno('Confirmo mi pedido');
    assert.equal(e.memoria().confirmado,true);
    assert.ok(e.logs.some(args=>args[0]==='Notificación asesor fallida' && args[1].http===500));
});
test('espera sin datos obligatorios no confirma ni llama a OpenAI', async () => {
    const e=entorno(); await e.turno('sí');
    const c=e.api.conversaciones.get('000000000002');
    c.esperandoConfirmacionPedido=true; c.borradorPedido={producto:'iPad Air 1'};
    e.control.openaiCaido=true;
    await e.turno('confirmo');
    assert.ok(!e.memoria().pedido);
});

for (const frase of ['dale', 'todo bien por mí', 'me parece correcto', 'así está bien', 'sí, hagámoslo', 'perfecto, continuemos']) {
    test(`semántica ACEPTA en contexto: ${frase}`, async () => {
        const e=entorno(); await e.turno('Estos son mis datos');
        e.control.etiqueta='ACEPTA'; await e.turno(frase);
        assert.equal(e.memoria().confirmado,true);
        assert.equal(e.control.llamadasClasificador,1);
        assert.equal(e.eventos.filter(x=>x==='asesor').length,1);
    });
}
for (const [frase,etiqueta] of [
    ['sí, pero cambia la ciudad','CORRIGE'], ['todo bien menos el precio','CORRIGE'],
    ['creo que sí','AMBIGUO'], ['déjame pensarlo','AMBIGUO'], ['no estoy seguro','AMBIGUO'],
    ['corrige mi número','CORRIGE'], ['no quiero comprar','RECHAZA']
]) {
    test(`semántica ${etiqueta} no confirma: ${frase}`, async () => {
        const e=entorno(); await e.turno('Estos son mis datos');
        e.control.etiqueta=etiqueta; await e.turno(frase);
        assert.ok(!e.memoria().pedido);
        assert.equal(e.control.llamadasClasificador, frase === 'no quiero comprar' ? 0 : 1);
        if (frase === 'no quiero comprar') assert.equal(e.memoria().estado, 'no_interesado');
    });
}
test('sin espera perfecto no crea pedido ni consulta clasificador', async () => {
    const e=entorno(); e.control.etiqueta='ACEPTA'; await e.turno('perfecto');
    assert.ok(!e.memoria().pedido); assert.equal(e.control.llamadasClasificador,0);
});
test('bloque comercial entregado antes de pedir datos y no repetido', async () => {
    const e=entorno(); await e.turno('Quiero comprar','Dime nombre, cédula, teléfono, provincia y ciudad.');
    const texto=e.mensajes[0].text.body;
    for (const dato of ['GRATIS','todas las provincias del Ecuador','Servientrega','contraentrega','asesor','video de funcionamiento/prueba','video del empaque']) {
        assert.ok(texto.indexOf(dato)>=0 && texto.indexOf(dato)<texto.indexOf('Dime nombre'));
    }
    assert.equal(e.memoria().bloqueComercialEnviado,true);
    await e.turno('otra pregunta','Seguimos.');
    assert.ok(!e.mensajes[1].text.body.includes('Envíos GRATIS'));
});
test('post-confirmación menciona ambos videos y luego Servientrega', async () => {
    const e=entorno(); await e.turno('Estos son mis datos'); await e.turno('sí');
    const texto=e.mensajes.at(-1).text.body;
    for (const dato of ['Pedido confirmado','asesor','video de funcionamiento/prueba','video del empaque','antes del despacho','Servientrega']) assert.ok(texto.includes(dato));
});
test('clasificador inválido o caído no confirma y conserva espera', async () => {
    for (const caido of [false,true]) {
        const e=entorno(); await e.turno('Estos son mis datos');
        e.control.etiqueta='ACEPTA porque quiere comprar'; e.control.openaiCaido=caido;
        await e.turno('dale');
        assert.ok(!e.memoria().pedido); assert.equal(e.memoria().esperandoConfirmacionPedido,true);
    }
});
for (const frase of ['todo bien','me parece bien','todo en orden']) {
    test(`aceptación obvia local: ${frase}`, async () => {
        const e=entorno(); await e.turno('Estos son mis datos');
        e.control.openaiCaido=true; await e.turno(frase);
        assert.equal(e.memoria().confirmado,true); assert.equal(e.control.llamadasClasificador,0);
    });
}

for (const frase of ['Quiero hablar con un asesor', '¿Puedo hablar con una persona?', 'Prefiero que me atienda alguien']) {
    test(`atención humana sin pedido: ${frase}`, async () => {
        const e=entorno(); await e.turno(frase);
        const texto=e.mensajes.at(-1).text.body;
        assert.match(texto,/Primero.*registrar tu pedido/);
        assert.match(texto,/mismo chat/);
        assert.ok(!e.memoria().pedido); assert.ok(!e.memoria().confirmado);
        assert.ok(!e.eventos.includes('asesor'));
        assert.equal(e.control.llamadasClasificador,0);
        await e.turno('Me interesa iPad Air 1','Ficha del producto');
        assert.match(e.mensajes.at(-1).text.body,/Ficha del producto/);
    });
}
test('solicitud equivalente usa clasificador de atención humana', async () => {
    const e=entorno(); e.control.atencion='SOLICITA';
    await e.turno('Pásame con quien lleva las ventas');
    assert.equal(e.control.llamadasAtencion,1);
    assert.match(e.mensajes.at(-1).text.body,/Primero.*registrar tu pedido/);
    assert.ok(!e.eventos.includes('asesor'));
});
test('pedido registrado no exige registrarse otra vez al pedir asesor', async () => {
    const e=entorno(); await e.turno('Estos son mis datos'); await e.turno('sí');
    const notificaciones=e.eventos.filter(x=>x==='asesor').length;
    await e.turno('Quiero hablar con un asesor');
    assert.match(e.mensajes.at(-1).text.body,/pedido ya está registrado/);
    assert.doesNotMatch(e.mensajes.at(-1).text.body,/Primero|registrar tu pedido/);
    assert.equal(e.eventos.filter(x=>x==='asesor').length,notificaciones);
});
test('pedido pendiente: pedir asesor no activa clasificador de confirmación', async () => {
    const e=entorno(); await e.turno('Estos son mis datos'); e.control.etiqueta='ACEPTA';
    await e.turno('Quiero hablar con un asesor');
    assert.equal(e.control.llamadasClasificador,0);
    assert.ok(!e.memoria().pedido); assert.ok(!e.eventos.includes('asesor'));
    assert.equal(e.memoria().esperandoConfirmacionPedido,true);
    await e.turno('sí'); assert.equal(e.memoria().confirmado,true);
});
test('bloque previo incluye coordinación, zona y dos videos antes del primer dato', async () => {
    const e=entorno(); await e.turno('Quiero comprar','Dime nombre, cédula, teléfono, provincia y ciudad.');
    const texto=e.mensajes.at(-1).text.body;
    for (const dato of ['personalmente','mismo chat','coordinar la opción de entrega','agencias/puntos disponibles en tu zona','video de funcionamiento/prueba','video del empaque']) {
        assert.ok(texto.indexOf(dato)>=0 && texto.indexOf(dato)<texto.indexOf('Dime nombre'));
    }
});
test('mención sin solicitud no desvía flujo de venta', async () => {
    const e=entorno(); await e.turno('Es para una persona que estudia','Ficha para estudio');
    assert.match(e.mensajes.at(-1).text.body,/Ficha para estudio/);
});

test('solicitud semántica pendiente no se interpreta como aprobación', async () => {
    const e=entorno(); await e.turno('Estos son mis datos');
    e.control.atencion='SOLICITA'; e.control.etiqueta='ACEPTA';
    await e.turno('Quiero tratar esto con quien está a cargo');
    assert.ok(!e.memoria().pedido); assert.ok(!e.eventos.includes('asesor'));
    assert.equal(e.control.llamadasClasificador,0);
    assert.equal(e.memoria().esperandoConfirmacionPedido,true);
});
test('fallo de detección humana conserva pendiente sin confirmar', async () => {
    const e=entorno(); await e.turno('Estos son mis datos');
    e.control.openaiCaido=true;
    await e.turno('Quiero tratar esto con quien está a cargo');
    assert.ok(!e.memoria().pedido); assert.ok(!e.eventos.includes('asesor'));
    assert.equal(e.memoria().esperandoConfirmacionPedido,true);
});
