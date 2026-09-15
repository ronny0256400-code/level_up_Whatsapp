const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
const CLIENTE = '000000000002', ADMIN = '000000000001';
const BASE = '2026-09-14T15:00:00.000Z'; // Lunes 10:00 America/Guayaquil.
function venta(estado = 'confirmado') {
    return { confirmado: true, datosCliente: { nombre: 'Persona de Prueba', telefono: CLIENTE, cedula: '0000000000', provincia: 'Prueba', ciudad: 'Prueba' },
        historial: [{ role: 'user', content: 'Historial sintético conservado' }], extra: { preservar: true },
        pedido: { id: 'PED-PRUEBA', estado, producto: 'Equipo de prueba', variante: '32 GB', precio: 100, cantidad: 1,
            guia: estado === 'confirmado' ? null : 'GUIA-PRUEBA', fechaConfirmacion: BASE,
            fechaLlegada: estado === 'disponible_retiro' ? BASE : null,
            fechaPago: null, seguimientoRetiro: estado === 'disponible_retiro', proximaVerificacionRetiro: '2026-09-14T17:00:00.000Z' } };
}
function entorno({ inicial = venta(), disco, ahora = BASE } = {}) {
    const almacen = disco || { rows: [[CLIENTE, JSON.stringify(inicial), BASE]] };
    const control = { ahora: Date.parse(ahora), api: 0, stock: 0, audio: 0, escritura: 0, fallaDespuesDeEnvio: false, falloEnvio: false, fallarEscrituras: false, etiqueta: 'AMBIGUO', intervalos: [] };
    const enviados = [], logs = [];
    class Reloj extends Date { constructor(...args) { super(...(args.length ? args : [control.ahora])); } static now() { return control.ahora; } }
    const routes = {};
    const app = { use() {}, get(r,h) { routes[`GET ${r}`]=h; }, post(r,h) { routes[r]=h; }, listen() { return { on() {} }; } };
    function express() { return app; } express.json = () => {};
    const env = Object.fromEntries(['OPENAI_API_KEY','VERIFY_TOKEN','PHONE_NUMBER_ID','WHATSAPP_TOKEN','STOCK_SPREADSHEET_ID','MEMORIA_SPREADSHEET_ID'].map(k=>[k,'dummy']));
    env.ASESOR_WHATSAPP=ADMIN; env.GOOGLE_SERVICE_ACCOUNT_JSON='{}';
    const sheets = { spreadsheets: { values: {
        get: async ({ range }) => {
            if (!range.startsWith('MEMORIA')) { control.stock++; return { data: { values: [] } }; }
            return { data: { values: clone(almacen.rows) } };
        },
        update: async ({ range, requestBody }) => {
            control.escritura++;
            if (control.fallarEscrituras) throw new Error('fallo de escritura simulado');
            assert.match(range,/^MEMORIA!/);
            const index=Number(range.match(/A(\d+)/)[1])-2;
            almacen.rows[index]=clone(requestBody.values[0]);
            if (control.saltoAlReservar && JSON.parse(almacen.rows[index][1]).pedido?.ultimoRecordatorioIntento) {
                control.ahora=Date.parse(control.saltoAlReservar); control.saltoAlReservar=null;
            }
        }
    } } };
    const context=vm.createContext({ Date:Reloj, process:{env}, console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)},
        setInterval(fn,ms) { control.intervalos.push({fn,ms}); return {unref(){}}; },
        require(name) {
            if(name==='./lib/ycloud-webhook') return require('../lib/ycloud-webhook');
            if(name==='express') return express;
            if(name==='node:crypto') return require(name);
            if(name==='googleapis') return {google:{auth:{GoogleAuth:class{}},sheets:()=>sheets}};
            if(name==='openai') return class {constructor(){this.responses={create:async args=>{
                control.api++;
                if(control.modelo) return {output_text:await control.modelo(args)};
                if(args.instructions.startsWith('Clasifica únicamente retiro')) return {output_text:control.etiqueta};
                if(args.instructions.startsWith('Clasifica únicamente intención')) return {output_text:'NO_SOLICITA'};
                if(args.text) return {output_text:'null'};
                return {output_text:'Respuesta comercial simulada'};
            }};this.audio={transcriptions:{create:async()=>{control.audio++;throw Error('no transcribir');}}};}};
            throw Error(`Importación no permitida: ${name}`);
        },
        fetch:async (url,args)=>{
            if(!url.endsWith('/messages')) {control.audio++;throw Error('no descargar medios');}
            const body=JSON.parse(args.body); enviados.push(body);
            if(control.antesDeEnviar) await control.antesDeEnviar(body);
            if(control.fallaDespuesDeEnvio) control.fallarEscrituras=true;
            return {ok:!control.falloEnvio,status:control.falloEnvio?500:200,text:async()=>control.falloEnvio?'error':'{}'};
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8')+'\nthis.api={revisarSeguimientos,interpretarHorarioRetiro,siguienteHorarioOperativo,sigueRetiro,iniciarSchedulerRetiro,conversaciones};',context);
    let serial=0;
    async function mensaje(texto,{admin=false,tipo='text',id,esperado=200,from=CLIENTE}={}) {
        const m={id:id||`msg-${++serial}`,from:admin?ADMIN:from,type:tipo,text:{body:texto},audio:{id:'media-sintetico'},image:{id:'imagen-sintetica'}};
        let status;
        await routes['/webhook']({body:{entry:[{changes:[{value:{messages:[m]}}]}]}},{sendStatus(c){status=c;},status(c){status=c;return this;},json(){}});
        assert.equal(status,esperado);
    }
    return {almacen,control,enviados,logs,env,api:context.api,mensaje,
        tick:()=>context.api.revisarSeguimientos(new Reloj()),
        tiempo:iso=>{control.ahora=Date.parse(iso);},
        actual:()=>JSON.parse(almacen.rows[0][1]),
        clientes:()=>enviados.filter(m=>m.to===CLIENTE), asesores:()=>enviados.filter(m=>m.to===ADMIN),
        reiniciar:()=>entorno({disco:almacen,ahora:new Date(control.ahora).toISOString()})};
}
async function llegada() {const e=entorno();await e.mensaje('GUIA PED-PRUEBA GUIA-PRUEBA',{admin:true});await e.mensaje('LLEGO GUIA-PRUEBA',{admin:true});return e;}

for(const [nombre,verifica] of [
 ['guía correcta',c=>assert.equal(c.pedido.guia,'GUIA-PRUEBA')],
 ['estado enviado',c=>assert.equal(c.pedido.estado,'enviado')],
 ['fechaEnvio actual',c=>assert.equal(c.pedido.fechaEnvio,BASE)],
 ['preserva cliente, historial y campos restantes',c=>{const esperado=venta();delete c.pedido.guia;delete c.pedido.estado;delete c.pedido.fechaEnvio;delete esperado.pedido.guia;delete esperado.pedido.estado;assert.deepEqual(c,esperado);}]
]) test(`GUIA: ${nombre}`,async()=>{const e=entorno();await e.mensaje('GUIA PED-PRUEBA GUIA-PRUEBA',{admin:true});verifica(e.actual());assert.equal(e.control.api,0);});
test('GUIA repetida no duplica pedido ni aviso',async()=>{const e=entorno();await e.mensaje('GUIA PED-PRUEBA GUIA-PRUEBA',{admin:true});const c=e.actual();await e.mensaje('GUIA PED-PRUEBA GUIA-PRUEBA',{admin:true});assert.deepEqual(e.actual(),c);assert.equal(e.clientes().length,1);});
for(const [nombre,verifica] of [
 ['busca por guía y estado disponible',e=>assert.equal(e.actual().pedido.estado,'disponible_retiro')],
 ['fechaLlegada persistente',e=>assert.equal(e.actual().pedido.fechaLlegada,BASE)],
 ['preserva datos e historial',e=>{assert.deepEqual(e.actual().datosCliente,venta().datosCliente);assert.deepEqual(e.actual().historial,venta().historial);assert.equal(e.actual().pedido.precio,100);assert.deepEqual(e.actual().extra,{preservar:true});}],
 ['aviso incluye requisitos, ID, guía, pago y horario',e=>{const m=e.clientes()[1].text.body;for(const str of ['Tu pedido ya llegó','cédula','guía','PED-PRUEBA','GUIA-PRUEBA','pago','día y a qué hora'])assert.ok(m.includes(str),str);}],
 ['activa seguimiento persistente',e=>{assert.ok(e.api.sigueRetiro(e.actual().pedido));assert.equal(e.actual().pedido.proximaVerificacionRetiro,'2026-09-14T17:00:00.000Z');}]
]) test(`LLEGO: ${nombre}`,async()=>{const e=await llegada();verifica(e);assert.equal(e.control.api,0);});
test('LLEGO repetido no reinicia los tres días ni vuelve a avisar',async()=>{const e=await llegada();const anterior=e.actual();e.tiempo('2026-09-15T15:00:00Z');await e.mensaje('LLEGO GUIA-PRUEBA',{admin:true});assert.deepEqual(e.actual(),anterior);assert.equal(e.clientes().length,2);});
for(const [texto,proxima,tipo] of [
 ['Hoy a las 2','2026-09-14T19:10:00.000Z','concreta'],
 ['Hoy a las 3','2026-09-14T20:10:00.000Z','concreta'],
 ['Mañana a las 10','2026-09-15T15:10:00.000Z','concreta'],
 ['Voy a las 2:30','2026-09-14T19:40:00.000Z','concreta'],
 ['Hoy en la tarde','2026-09-14T18:00:00.000Z','franja'],
 ['Mañana en la mañana','2026-09-15T14:00:00.000Z','franja'],
 ['Después del almuerzo','2026-09-14T18:00:00.000Z','franja']
]) test(`horario ${texto}`,async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje(texto);assert.equal(e.actual().pedido.proximaVerificacionRetiro,proxima);assert.equal(e.actual().pedido.horarioRetiro.tipo,tipo);if(tipo==='franja')assert.equal(e.actual().pedido.horaRetiroEstimada,null);assert.equal(e.control.api,0);});
test('en un rato conserva ambigüedad y pregunta sin inventar hora',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('En un rato');assert.ok(!e.actual().pedido.horarioRetiro);assert.match(e.clientes()[0].text.body,/día y horario/);});
test('hora concreta no envía antes; comprueba diez minutos después',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('Hoy a las 2 PM');const n=e.clientes().length;e.tiempo('2026-09-14T19:09:59Z');await e.tick();assert.equal(e.clientes().length,n);e.tiempo('2026-09-14T19:10:00Z');await e.tick();assert.equal(e.clientes().length,n+1);});
test('franja continúa con siguiente comprobación a dos horas',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('hoy en la tarde');e.tiempo('2026-09-14T18:00:00Z');await e.tick();assert.equal(e.actual().pedido.proximaVerificacionRetiro,'2026-09-14T20:00:00.000Z');});
for(const [entrada,salida] of [
 ['2026-09-14T22:01:00Z','2026-09-15T14:00:00.000Z'],
 ['2026-09-19T21:01:00Z','2026-09-21T14:00:00.000Z'],
 ['2026-09-20T15:00:00Z','2026-09-21T14:00:00.000Z'],
 ['2026-09-15T12:00:00Z','2026-09-15T14:00:00.000Z']
]) test(`horario operativo ${entrada}`,async()=>{const e=entorno();assert.equal(e.api.siguienteHorarioOperativo(new Date(entrada)).toISOString(),salida);});
for(const momento of ['2026-09-14T22:01:00Z','2026-09-19T21:01:00Z','2026-09-20T15:00:00Z']) test(`scheduler no envía fuera de horario ${momento}`,async()=>{const c=venta('disponible_retiro');c.pedido.fechaLlegada=new Date(Date.parse(momento)-3600000).toISOString();c.pedido.proximaVerificacionRetiro=c.pedido.fechaLlegada;const e=entorno({inicial:c,ahora:momento});await e.tick();assert.equal(e.enviados.length,0);assert.ok(Date.parse(e.actual().pedido.proximaVerificacionRetiro)>Date.parse(momento));});
test('menos de tres días no cierra',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T14:59:59Z'});await e.tick();assert.equal(e.actual().pedido.estado,'disponible_retiro');});
test('a las 72 horas cierra sin pago, sin recordatorio y alerta con datos requeridos',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});await e.tick();const p=e.actual().pedido;assert.equal(p.estado,'sin_respuesta');assert.equal(p.fechaPago,null);assert.equal(p.fechaCierreSinRespuesta,'2026-09-17T15:00:00.000Z');assert.equal(p.seguimientoRetiro,false);assert.equal(p.proximaVerificacionRetiro,null);assert.equal(e.clientes().length,0);assert.equal(e.asesores().length,1);const m=e.asesores()[0].text.body;for(const str of ['Persona de Prueba',CLIENTE,'Equipo de prueba','32 GB','GUIA-PRUEBA','PED-PRUEBA','no confirmó el retiro','3 días','cerrado'])assert.ok(m.includes(str),str);assert.equal(e.control.api,0);});
for(const falta of ['guia','fechaLlegada','seguimientoRetiro'])test(`no cierra sin prerrequisito ${falta}`,async()=>{const c=venta('disponible_retiro');delete c.pedido[falta];const e=entorno({inicial:c,ahora:'2026-09-18T15:00:00Z'});await e.tick();assert.equal(e.actual().pedido.estado,'disponible_retiro');assert.equal(e.enviados.length,0);});
test('mensajes intermedios no prolongan los tres días',async()=>{const e=entorno({inicial:venta('disponible_retiro')});e.tiempo('2026-09-16T15:00:00Z');await e.mensaje('mañana en la tarde');e.tiempo('2026-09-17T15:00:00Z');await e.tick();assert.equal(e.actual().pedido.estado,'sin_respuesta');});
test('segunda ejecución y reinicio no repiten alerta sin respuesta',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});await Promise.all([e.tick(),e.tick()]);assert.equal(e.asesores().length,1);const r=e.reiniciar();await r.tick();assert.equal(r.enviados.length,0);assert.equal(r.actual().pedido.alertaSinRespuesta.estado,'enviada');});
test('imagen pregunta retiro sin Vision ni marcar pago',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('',{tipo:'image'});assert.equal(e.control.api,0);assert.equal(e.control.audio,0);assert.equal(e.actual().pedido.estado,'disponible_retiro');assert.match(e.clientes()[0].text.body,/ya pudiste retirar/);});
for(const frase of ['Sí, ya retiré','Ya lo retiré','Ya tengo el equipo','Sí, ya lo tengo','Listo, ya retiré','Ya fui a buscarlo'])test(`retiro ${frase} cierra pagado y notifica una vez`,async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje(frase);const p=e.actual().pedido;assert.equal(p.estado,'pagado');assert.equal(p.fechaPago,BASE);assert.equal(p.fechaRetiro,BASE);assert.equal(p.seguimientoRetiro,false);assert.equal(e.asesores().length,1);for(const str of ['GUIA-PRUEBA','Equipo de prueba','Persona de Prueba','PED-PRUEBA','retiró y pagó'])assert.ok(e.asesores()[0].text.body.includes(str));assert.equal(e.control.api,0);});
test('semántica de retiro solo en disponible y etiqueta inequívoca',async()=>{const e=entorno({inicial:venta('disponible_retiro')});e.control.etiqueta='RETIRADO';await e.mensaje('Ahora está en mis manos');assert.equal(e.actual().pedido.estado,'pagado');assert.equal(e.control.api,1);});
test('ambiguo pregunta y conserva pendiente',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('creo que sí');assert.equal(e.actual().pedido.estado,'disponible_retiro');assert.equal(e.asesores().length,0);assert.match(e.clientes()[0].text.body,/confirmas/);});
test('fuera de disponible ya lo tengo no se interpreta como pago',async()=>{const e=entorno({inicial:venta('enviado')});await e.mensaje('ya lo tengo');assert.equal(e.actual().pedido.estado,'enviado');assert.equal(e.asesores().length,0);});
test('PAGO por ID preserva todos los campos, cancela efectivamente y es idempotente',async()=>{const inicial=venta('disponible_retiro');const e=entorno({inicial});await e.mensaje('PAGO PED-PRUEBA',{admin:true});const c=e.actual();assert.equal(c.pedido.estado,'pagado');assert.equal(c.pedido.fechaPago,BASE);assert.equal(e.api.sigueRetiro(c.pedido),false);c.pedido.estado=inicial.pedido.estado;c.pedido.fechaPago=null;assert.deepEqual(c,inicial);const escrituras=e.control.escritura;await e.mensaje('PAGO PED-PRUEBA',{admin:true});assert.equal(e.control.escritura,escrituras);assert.equal(e.enviados.length,0);assert.equal(e.control.api,0);e.tiempo('2026-09-18T15:00:00Z');await e.tick();assert.equal(e.actual().pedido.estado,'pagado');});
test('RETIRADO por guía es alias pagado, nunca retirado',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('RETIRADO GUIA-PRUEBA',{admin:true});assert.equal(e.actual().pedido.estado,'pagado');assert.equal(e.actual().pedido.fechaPago,BASE);assert.equal(e.api.sigueRetiro(e.actual().pedido),false);});
for(const estado of ['pagado','sin_respuesta'])for(const tipo of ['text','audio','image','video'])test(`bloqueo persistente ${estado} + ${tipo}`,async()=>{const c=venta(estado);const e=entorno({inicial:c});const r=e.reiniciar();await r.mensaje('hola quiero comprar',{tipo});assert.equal(r.control.api,0);assert.equal(r.control.audio,0);assert.equal(r.control.stock,0);assert.equal(r.enviados.length,0);assert.equal(r.control.escritura,0);assert.deepEqual(r.actual(),c);});
test('pagado jamás vence a sin respuesta ni reabre por GUIA/LLEGO',async()=>{const e=entorno({inicial:venta('pagado')});e.tiempo('2026-09-25T15:00:00Z');await e.tick();await e.mensaje('GUIA PED-PRUEBA OTRA',{admin:true});await e.mensaje('LLEGO GUIA-PRUEBA',{admin:true});assert.equal(e.actual().pedido.estado,'pagado');assert.equal(e.enviados.length,0);});
test('sin respuesta no se convierte automáticamente a pagado ni nueva venta',async()=>{const e=entorno({inicial:venta('sin_respuesta')});await e.mensaje('ya retiré');await e.mensaje('PAGO PED-PRUEBA',{admin:true});await e.mensaje('LLEGO GUIA-PRUEBA',{admin:true});assert.equal(e.actual().pedido.estado,'sin_respuesta');assert.equal(e.enviados.length,0);});
test('dos schedulers concurrentes no duplican recordatorio',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-14T17:00:00Z'});await Promise.all([e.tick(),e.tick()]);assert.equal(e.clientes().length,1);assert.equal(e.actual().pedido.ultimoRecordatorio,'2026-09-14T17:00:00.000Z');assert.equal(e.control.api,0);});
test('doble confirmación simultánea no duplica pago ni alerta',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await Promise.all([e.mensaje('ya retiré'),e.mensaje('ya retiré')]);assert.equal(e.asesores().length,1);assert.equal(e.actual().pedido.estado,'pagado');});
test('reinicio después de recordatorio reserva próxima y no repite',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-14T17:00:00Z'});await e.tick();const r=e.reiniciar();await r.tick();assert.equal(r.enviados.length,0);});
for(const tipo of ['recordatorio','sin_respuesta','pagado'])test(`caída tras enviar ${tipo} no duplica al reiniciar`,async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:tipo==='sin_respuesta'?'2026-09-17T15:00:00Z':'2026-09-14T17:00:00Z'});e.control.fallaDespuesDeEnvio=true;if(tipo==='pagado')await e.mensaje('ya retiré',{esperado:500});else await e.tick();assert.equal(e.enviados.length,1);const r=e.reiniciar();await r.tick();if(tipo==='pagado')await r.mensaje('ya retiré');assert.equal(r.enviados.length,0);});
test('fallo al reservar en Sheets no envía recordatorio ni alerta',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-14T17:00:00Z'});e.control.fallarEscrituras=true;await e.tick();assert.equal(e.enviados.length,0);});
test('scheduler registra intervalo real de 60 segundos sin OpenAI',async()=>{const e=entorno({inicial:venta('pagado')});e.api.iniciarSchedulerRetiro();assert.equal(e.control.intervalos.length,1);assert.equal(e.control.intervalos[0].ms,60000);await e.tick();assert.equal(e.control.api,0);});
test('logs del ciclo no incluyen datos privados',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});await e.tick();assert.doesNotMatch(JSON.stringify(e.logs),/Persona de Prueba|000000000002|0000000000|Historial sintético/);});

test('en la mañana no cambia accidentalmente al día siguiente',async()=>{const e=entorno({inicial:venta('disponible_retiro')});await e.mensaje('hoy en la mañana');assert.equal(e.actual().pedido.horarioRetiro.fecha,'2026-09-14');assert.equal(e.actual().pedido.horarioRetiro.hora,null);});
test('scheduler respeta una fechaLlegada futura',async()=>{const c=venta('disponible_retiro');c.pedido.fechaLlegada='2026-09-15T15:00:00.000Z';c.pedido.proximaVerificacionRetiro=BASE;const e=entorno({inicial:c});await e.tick();assert.equal(e.enviados.length,0);});
for(const estado of ['pagado','sin_respuesta'])test(`terminal ${estado} no necesita OpenAI configurado`,async()=>{const e=entorno({inicial:venta(estado)});delete e.env.OPENAI_API_KEY;await e.mensaje('audio',{tipo:'audio'});assert.equal(e.enviados.length,0);assert.equal(e.control.api,0);assert.equal(e.control.audio,0);});
test('al vencer con audio se cierra antes de descargar o transcribir',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});await e.mensaje('',{tipo:'audio'});assert.equal(e.actual().pedido.estado,'sin_respuesta');assert.equal(e.control.audio,0);assert.equal(e.control.api,0);assert.equal(e.asesores().length,1);});
test('alerta fallida queda persistida y no se duplica al reiniciar',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});e.control.falloEnvio=true;await e.tick();assert.equal(e.actual().pedido.alertaSinRespuesta.estado,'fallida');const r=e.reiniciar();await r.tick();assert.equal(r.enviados.length,0);});
test('reserva fallida de cierre no envía alerta ni persiste terminal',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T15:00:00Z'});e.control.fallarEscrituras=true;await e.tick();assert.equal(e.enviados.length,0);assert.equal(e.actual().pedido.estado,'disponible_retiro');});
test('reinicio tras aviso LLEGO no reinicia fecha ni duplica aviso',async()=>{const e=await llegada();const r=e.reiniciar();await r.mensaje('LLEGO GUIA-PRUEBA',{admin:true});assert.equal(r.enviados.length,0);assert.equal(r.actual().pedido.fechaLlegada,BASE);});

test('latencia de Sheets no permite enviar después del cierre diario',async()=>{const c=venta('disponible_retiro');const e=entorno({inicial:c,ahora:'2026-09-14T21:59:50Z'});e.control.saltoAlReservar='2026-09-14T22:00:10Z';await e.api.revisarSeguimientos();assert.equal(e.enviados.length,0);assert.equal(e.actual().pedido.proximaVerificacionRetiro,'2026-09-15T14:00:00.000Z');});
test('latencia de Sheets que cruza las 72 horas cierra sin recordatorio',async()=>{const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-17T14:59:50Z'});e.control.saltoAlReservar='2026-09-17T15:00:10Z';await e.api.revisarSeguimientos();assert.equal(e.clientes().length,0);assert.equal(e.actual().pedido.estado,'sin_respuesta');assert.equal(e.asesores().length,1);});

// Regresiones de auditoría: se conservan todas las pruebas anteriores.
for (const texto of ['ya lo tengo claro', 'ya tengo la guía', 'ya lo tengo claro, gracias']) test(`no confunde posesión con retiro: ${texto}`, async () => {
    const e = entorno({inicial:venta('disponible_retiro')});
    await e.mensaje(texto);
    assert.equal(e.actual().pedido.estado, 'disponible_retiro');
    assert.equal(e.asesores().length, 0);
    assert.equal(e.control.api, 1, 'el resto pasa por clasificación semántica');
});
for (const texto of ['Quiero hablar con un asesor', '¿Puedo hablar con una persona?', 'Prefiero que me atienda alguien', 'Quiero hablar con un asesor, mañana a las 2']) test(`asesor tiene prioridad: ${texto}`, async () => {
    const e = entorno({inicial:venta('disponible_retiro')}); const pedido = e.actual().pedido;
    await e.mensaje(texto);
    assert.deepEqual(e.actual().pedido, pedido);
    assert.match(e.clientes()[0].text.body, /ya está registrado.*asesor.*mismo chat/);
    assert.equal(e.asesores().length, 0);
    assert.equal(e.control.api, 0);
});
test('asesor semántico prevalece sobre un horario en el mismo mensaje', async () => {
    const e = entorno({inicial:venta('disponible_retiro')}); const pedido = e.actual().pedido;
    e.control.modelo = async args => { assert.match(args.instructions, /SOLICITA.*prioridad/); return 'SOLICITA'; };
    await e.mensaje('Mañana a las 2 quiero tratar esto con quien está a cargo');
    assert.deepEqual(e.actual().pedido, pedido);
    assert.match(e.clientes()[0].text.body, /ya está registrado/);
    assert.equal(e.control.api, 1);
});
test('LLEGO fallido se recupera tras reinicio sin cambiar fechaLlegada', async () => {
    const e = entorno({inicial:venta('enviado')}); e.control.falloEnvio = true;
    await e.mensaje('LLEGO GUIA-PRUEBA', {admin:true, esperado:500});
    assert.equal(e.actual().pedido.avisoLlegada.estado, 'fallida');
    const r = e.reiniciar(); await r.tick(); assert.equal(r.enviados.length, 0);
    r.tiempo('2026-09-14T15:01:00Z'); await r.tick();
    assert.equal(r.clientes().length, 1); assert.match(r.clientes()[0].text.body, /Tu pedido ya llegó/);
    assert.equal(r.actual().pedido.fechaLlegada, BASE);
    assert.equal(r.actual().pedido.avisoLlegada.estado, 'enviada');
    const rr = r.reiniciar(); rr.tiempo('2026-09-14T15:02:00Z'); await rr.tick();
    await rr.mensaje('LLEGO GUIA-PRUEBA', {admin:true}); assert.equal(rr.enviados.length, 0);
});
test('LLEGO repetido reintenta el aviso fallido sin reiniciar el plazo', async () => {
    const e = entorno({inicial:venta('enviado')}); e.control.falloEnvio = true;
    await e.mensaje('LLEGO GUIA-PRUEBA', {admin:true, esperado:500});
    e.control.falloEnvio = false; e.tiempo('2026-09-14T15:01:00Z');
    await e.mensaje('LLEGO GUIA-PRUEBA', {admin:true});
    assert.equal(e.actual().pedido.fechaLlegada, BASE);
    assert.equal(e.actual().pedido.avisoLlegada.intentos, 2);
    assert.equal(e.actual().pedido.avisoLlegada.estado, 'enviada');
});
for (const estado of ['pagado','sin_respuesta']) {
    test(`alerta ${estado} fallida reintenta tras reinicio y no repite éxito`, async () => {
        const e = entorno({inicial:venta('disponible_retiro'), ahora:estado==='pagado'?BASE:'2026-09-17T15:00:00Z'});
        e.control.falloEnvio=true;
        if(estado==='pagado') await e.mensaje('ya tengo el equipo'); else await e.tick();
        const campo=estado==='pagado'?'alertaPagado':'alertaSinRespuesta';
        assert.equal(e.actual().pedido[campo].estado,'fallida');
        const r=e.reiniciar(); r.control.ahora+=60000; await r.tick();
        assert.equal(r.asesores().length,1); assert.equal(r.actual().pedido[campo].estado,'enviada');
        assert.equal(r.actual().pedido[campo].intentos,2);
        r.control.ahora+=60000; await r.tick(); assert.equal(r.asesores().length,1);
        const rr=r.reiniciar(); await rr.tick(); assert.equal(rr.enviados.length,0);
    });
    test(`alerta ${estado} se detiene después de tres intentos`, async () => {
        const c=venta(estado), campo=estado==='pagado'?'alertaPagado':'alertaSinRespuesta';
        c.pedido[campo]={estado:'pendiente',intentos:0}; let e=entorno({inicial:c});
        for(let i=1;i<=4;i++) {
            e.control.falloEnvio=true; await e.tick();
            assert.equal(e.actual().pedido[campo].intentos,Math.min(i,3));
            assert.equal(e.asesores().length,i<=3?1:0);
            e=e.reiniciar(); e.control.ahora+=60000;
        }
    });
    test(`alerta ${estado} reservada al caer antes de envío se recupera`, async () => {
        const c=venta(estado), campo=estado==='pagado'?'alertaPagado':'alertaSinRespuesta';
        c.pedido[campo]={estado:'reservada',intentos:1,fechaIntento:BASE};
        const e=entorno({inicial:c,ahora:'2026-09-14T15:01:00Z'}); await e.tick();
        assert.equal(e.asesores().length,1); assert.equal(e.actual().pedido[campo].estado,'enviada');
    });
}
test('singleton devuelve el mismo timer al iniciar dos veces', async () => {
    const e=entorno({inicial:venta('pagado')});
    assert.equal(e.api.iniciarSchedulerRetiro(),e.api.iniciarSchedulerRetiro());
    assert.equal(e.control.intervalos.length,1); await e.tick();
});
for(const [entrada,salida] of [
    ['2026-09-19T16:59:59Z','2026-09-19T16:59:59.000Z'],
    ['2026-09-19T17:00:00Z','2026-09-21T14:00:00.000Z'],
    ['2026-09-19T18:00:00Z','2026-09-21T14:00:00.000Z']
]) test(`sábado cierra a las 12: ${entrada}`,()=>{
    const e=entorno(); assert.equal(e.api.siguienteHorarioOperativo(new Date(entrada)).toISOString(),salida);
});
for(const llegada of ['2026-09-16T18:00:00Z','2026-09-17T15:00:00Z','2026-09-14T23:00:00Z']) test(`72 horas cierra fuera de horario: ${llegada}`,async()=>{
    const c=venta('disponible_retiro'); c.pedido.fechaLlegada=llegada;
    const limite=Date.parse(llegada)+72*3600000;
    const e=entorno({inicial:c,ahora:new Date(limite-1).toISOString()}); await e.tick();
    assert.equal(e.actual().pedido.estado,'disponible_retiro'); e.control.ahora=limite; await e.tick();
    assert.equal(e.actual().pedido.estado,'sin_respuesta'); assert.equal(e.clientes().length,0);
    assert.equal(e.actual().pedido.fechaCierreSinRespuesta,new Date(limite).toISOString());
});
test('un cliente lento no bloquea otro webhook ni su scheduler',async()=>{
    const segundo='000000000003'; const c=venta('disponible_retiro'), c2=clone(c); c2.pedido.id='PED-SEGUNDO';
    const e=entorno({disco:{rows:[[CLIENTE,JSON.stringify(c),BASE],[segundo,JSON.stringify(c2),BASE]]}});
    let liberar, inicio; const bloqueado=new Promise(r=>{liberar=r;}); const comenzo=new Promise(r=>{inicio=r;});
    e.control.antesDeEnviar=async body=>{if(body.to===CLIENTE){inicio(); await bloqueado;}};
    const lento=e.mensaje('hoy a las 2'); await comenzo;
    try {
        await e.mensaje('hoy a las 3',{from:segundo});
        assert.ok(e.enviados.some(m=>m.to===segundo));
        e.tiempo('2026-09-14T20:10:00Z'); await e.tick();
        assert.equal(e.enviados.filter(m=>m.to===segundo).length,2);
    } finally {liberar();await lento;}
});
test('PAGO y scheduler del mismo cliente no sobrescriben el estado terminal',async()=>{
    const e=entorno({inicial:venta('disponible_retiro'),ahora:'2026-09-14T17:00:00Z'});
    await Promise.all([e.tick(),e.mensaje('PAGO PED-PRUEBA',{admin:true})]);
    assert.equal(e.actual().pedido.estado,'pagado');
    const n=e.enviados.length;e.control.ahora+=7200000;await e.tick();assert.equal(e.enviados.length,n);
});
for (const texto of ['ya lo tengo claro','ya tengo la guía']) test(`rechaza falso pago aun con clasificación incorrecta: ${texto}`,async()=>{
    const e=entorno({inicial:venta('disponible_retiro')});e.control.etiqueta='RETIRADO';
    await e.mensaje(texto);assert.equal(e.actual().pedido.estado,'disponible_retiro');assert.equal(e.asesores().length,0);
});
test('LLEGO respeta tres intentos persistentes aun repitiendo comando',async()=>{
    const e=entorno({inicial:venta('enviado')});e.control.falloEnvio=true;
    for(let i=1;i<=4;i++) {
        await e.mensaje('LLEGO GUIA-PRUEBA',{admin:true,esperado:i<=3?500:200});
        assert.equal(e.actual().pedido.avisoLlegada.intentos,Math.min(i,3));e.control.ahora+=60000;
    }
    assert.equal(e.clientes().length,3);assert.equal(e.actual().pedido.fechaLlegada,BASE);
    const r=e.reiniciar();await r.tick();assert.equal(r.enviados.length,0);
});
