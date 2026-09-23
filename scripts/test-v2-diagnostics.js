'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModels } = require('../lib/v2-models');
const { createIngress } = require('../lib/v2-ingress');
const { safeError, atStage } = require('../lib/v2-errors');
const { runtime } = require('./helpers/v2-runtime');
const { seedInventory } = require('./helpers/inventory-fixture');
const events = e => e.logs.flatMap(row => row.filter(x => x && typeof x === 'object'));
function modelFixture(create, env = {MODEL_LOW:'gpt-5-nano'}) {
  const logs=[];return {logs,model:createModels({client:{responses:{create}},env,log:e=>logs.push(e)})};
}
const emptyLow = args => args.instructions.startsWith('Clasifica únicamente intención')
  ? {output_text:'',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:185,output_tokens:0}}
  : {output_text:args.text?'null':'Respuesta sintética',status:'completed',usage:{input_tokens:5,output_tokens:2}};
test('reproduce LOW 185/0 seguido de InventoryError: etapa y stack identifican catálogo',async()=>{
  const e=runtime({respond:emptyLow});await e.inventoryReady;
  await seedInventory(e.sheets,[['A','Equipo','16 GB','negro',-1,100,'Ficha']]);
  assert.equal(await e.message('consulta sintética'),500);
  const rows=events(e),call=rows.find(x=>x.event==='model_call'),error=e.logs.find(x=>x[0]==='Webhook falló')[1];
  assert.equal(call.input_tokens,185);assert.equal(call.output_tokens,0);assert.equal(e.calls.length,1);
  assert.equal(error.stage,'inventory.catalog');assert.equal(error.code,'CATALOGO_INVALIDO');assert.equal(error.message,'CATALOGO_INVALIDO');
  assert.ok(error.stack.some(x=>x.includes('v2-inventory.js:')));assert.equal(e.sent.length,2);assert.equal((await e.load()).pendingQuestion.estado,'pendiente');
});
test('LOW sin texto con catálogo válido no causa por sí solo el fallo del webhook',async()=>{
  const e=runtime({respond:emptyLow});assert.equal(await e.message('consulta sintética'),200);
  assert.ok(events(e).some(x=>x.event==='model_response'&&x.incomplete_reason==='max_output_tokens'&&!x.has_text));assert.equal(e.sent.length,1);
});
test('OpenAI rechazado conserva la excepción original con status, code y etapa',async()=>{
  const error=Object.assign(new Error('customer-secret sk-test-secret 0999999999'),{status:401,code:'invalid_api_key'});
  const e=modelFixture(async()=>{throw error;});await assert.rejects(e.model.respond({}),x=>x===error);
  assert.equal(e.logs[0].stage,'openai.responses');assert.equal(e.logs[0].status,401);assert.equal(e.logs[0].code,'invalid_api_key');assert.doesNotMatch(JSON.stringify(e.logs),/customer-secret|sk-test-secret|0999999999/);
});
test('modelo sin configurar informa model.select sin llamada API',async()=>{
  const e=modelFixture(async()=>assert.fail('no llamar'),{});await assert.rejects(e.model.respond({}),error=>safeError(error).stage==='model.select');
});
test('extrae output_text del arreglo output cuando no existe el helper',async()=>{
  const e=modelFixture(async()=>({output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'NO_SOLICITA'}]}]}));
  assert.equal((await e.model.respond({})).output_text,'NO_SOLICITA');
});
test('output_text de tipo inválido se distingue de error de llamada',async()=>{
  const e=modelFixture(async()=>({output_text:{secret:'privado'}}));await assert.rejects(e.model.respond({}),error=>safeError(error).stage==='model.output_text');
});
test('JSON inválido conserva SyntaxError y frames sin filtrar contenido generado',async()=>{
  const e=runtime({respond:async args=>({output_text:args.text?'customer-secret 0999999999':args.instructions.startsWith('Clasifica')?'NO_SOLICITA':'Respuesta'})});
  await e.seed({estado:'recopilando_datos',commerce:{selected:'EQUIPO',stage:'datos'},borradorPedido:{lineas:[{id_producto:'EQUIPO',cantidad:1,precio_unitario:100}]}});
  assert.equal(await e.message('consulta sintética'),200); // Extraction diagnostic in its authorized phase.
  const error=events(e).find(x=>x.stage==='model.parse_order');assert.equal(error.name,'SyntaxError');assert.ok(error.stack.length);assert.doesNotMatch(JSON.stringify(e.logs),/customer-secret|0999999999/);
});
test('fallo YCloud se identifica después del modelo con error original',async()=>{
  const e=runtime({ycloudError:Object.assign(new Error('YCloud HTTP 403'),{status:403})});
  assert.equal(await e.message('consulta sintética',{provider:'ycloud'}),500);
  const error=e.logs.find(x=>x[0]==='Webhook falló')[1];assert.equal(error.stage,'transport.ycloud');assert.equal(error.status,403);
});
test('fallo de persistencia posterior se distingue de transporte y OpenAI',async()=>{
  const e=runtime();await e.inventoryReady;e.control.data={nombre:'Persona',cedula:'fixture',lineas:[{id_producto:'EQUIPO',producto:'Equipo de prueba',cantidad:1,precio_unitario:100}]};await e.seed({estado:'recopilando_datos',commerce:{selected:'EQUIPO',stage:'datos'},borradorPedido:{telefono:'000000000002',provincia:'Provincia',ciudad:'Ciudad',agencia:{id:'fixture'},lineas:e.control.data.lineas}});const update=e.sheets.spreadsheets.values.update;
  e.sheets.spreadsheets.values.update=async args=>{if(args.range.startsWith('MEMORIA')&&e.sent.length)throw Object.assign(new Error('private payload'),{status:503});return update(args);};
  assert.equal(await e.message('consulta sintética'),500);const error=e.logs.find(x=>x[0]==='Webhook falló')[1];assert.equal(error.stage,'memory.save');assert.equal(error.status,503);assert.equal(e.sent.length,1);
});
function ingressFixture(processMessage) {
  let time=100000;const db=new Map(),logs=[];const store={get:async n=>structuredClone(db.get(n)),set:async(n,v)=>db.set(n,structuredClone(v)),keys:async()=>[...db.keys()]};
  const options={store,processMessage,admin:'000000000001',now:()=>time,delay:()=>({}),log:e=>logs.push(e)};
  const message={id:'opaque-id',from:'000000000002',type:'text',text:{body:'private customer text'}};
  return{db,logs,options,message,engine:createIngress(options),advance:ms=>{time+=ms;}};
}
test('permanente se pone en cuarentena y mantiene deduplicación tras reinicio',async()=>{
  let calls=0;const e=ingressFixture(async()=>{calls++;throw atStage(Object.assign(new Error('YCloud HTTP 401'),{status:401}),'transport.ycloud');});
  await e.engine.accept(e.message);e.advance(5000);await e.engine.recover();
  const restart=createIngress(e.options);for(let i=0;i<5;i++){e.advance(60000);await restart.recover();}
  assert.equal(calls,1);assert.equal(await restart.accept(e.message),'duplicate');assert.equal(e.db.get(e.message.from).pending.length,0);assert.equal(e.db.get(e.message.from).failed.length,1);assert.doesNotMatch(JSON.stringify(e.logs),/private customer|opaque-id|000000000002/);
});
test('transitorio tiene backoff, máximo tres intentos persistentes y no loop',async()=>{
  let calls=0;const e=ingressFixture(async()=>{calls++;throw Object.assign(new Error('service unavailable'),{status:503});});await e.engine.accept(e.message);e.advance(5000);await e.engine.recover();assert.equal(calls,1);
  await e.engine.recover();assert.equal(calls,1);e.advance(30000);await createIngress(e.options).recover();assert.equal(calls,2);
  e.advance(60000);await createIngress(e.options).recover();assert.equal(calls,3);e.advance(900000);await e.engine.recover();assert.equal(calls,3);
  assert.equal(e.db.get(e.message.from).failed[0].attempts,3);
});
test('reintento exitoso no repite grupo anterior ni webhook duplicado',async()=>{
  const calls=[];let fail=true;const e=ingressFixture(async m=>{calls.push(m.id);if(m.id==='second'&&fail){fail=false;throw Error('temporary');}});
  await e.engine.accept({...e.message,type:'audio'});await e.engine.accept({...e.message,id:'second'});e.advance(5000);await e.engine.recover();
  e.advance(30000);await e.engine.recover();assert.deepEqual(calls,['opaque-id','second','second']);assert.equal(await e.engine.accept(e.message),'duplicate');await e.engine.recover();assert.equal(calls.length,3);
});
test('fallo al persistir reserva no ejecuta efectos y conserva mensaje pendiente',async()=>{
  let calls=0;const e=ingressFixture(async()=>calls++);await e.engine.accept(e.message);e.advance(5000);e.options.store.set=async()=>{throw Error('store down');};await e.engine.recover();assert.equal(calls,0);assert.equal(e.db.get(e.message.from).pending.length,1);
});
test('error real atraviesa webhook hasta ingress y detiene un permanente',async()=>{
  const e=runtime({ycloudError:Object.assign(new Error('YCloud HTTP 401'),{status:401})});await e.inventoryReady;
  const message={id:'synthetic-production',from:'000000000002',provider:'ycloud',type:'text',text:{body:'consulta sintética'}};
  await e.api.entradaV2.accept(message);e.control.time+=5000;await e.api.entradaV2.recover();
  const failure=events(e).find(x=>x.event==='ingress_failed');assert.equal(failure.stage,'transport.ycloud');assert.equal(failure.status,401);
  const calls=e.calls.length;e.control.time+=60000;await e.api.entradaV2.recover();assert.equal(e.calls.length,calls);assert.equal(await e.api.entradaV2.accept(message),'duplicate');
});
test('errores con secretos en message/code/details/stack no vuelcan payloads',()=>{
  const error=Object.assign(new Error('SECRET_CUSTOMER_CONTENT'),{code:'PRIVATE_SECRET',details:{token:'sk-secret'}});
  error.stack='Error: SECRET_CUSTOMER_CONTENT\nprivate customer payload\n    at safe (/opt/render/project/src/server.js:1827:22)';
  const safe=safeError(error);assert.deepEqual(safe.stack,['at server.js:1827:22']);assert.doesNotMatch(JSON.stringify(safe),/SECRET_CUSTOMER|PRIVATE_SECRET|sk-secret|private customer/);
});
test('reserva del último intento sobreviviente a un crash no vuelve a ejecutar',async()=>{
  let calls=0;const e=ingressFixture(async()=>calls++);await e.engine.accept(e.message);const data=e.db.get(e.message.from);data.pending[0].attempts=3;e.advance(5000);await createIngress(e.options).recover();assert.equal(calls,0);assert.equal(e.db.get(e.message.from).pending.length,0);assert.equal(e.db.get(e.message.from).failed[0].attempts,3);
});
test('fetch TypeError conserva causa de red y recibe reintento transitorio',async()=>{
  let calls=0;const cause=Object.assign(new Error('private hostname'),{code:'ECONNRESET'});
  const error=atStage(new TypeError('fetch failed',{cause}),'transport.ycloud');
  const e=ingressFixture(async()=>{calls++;if(calls===1)throw error;});await e.engine.accept(e.message);e.advance(5000);await e.engine.recover();
  assert.equal(e.logs[0].event,'ingress_retry');assert.equal(e.logs[0].cause.code,'ECONNRESET');assert.doesNotMatch(JSON.stringify(e.logs),/private hostname/);
  e.advance(30000);await e.engine.recover();assert.equal(calls,2);assert.equal(e.db.get(e.message.from).pending.length,0);
});
