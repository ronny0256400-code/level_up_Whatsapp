'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./helpers/v2-runtime');
const {seedInventory}=require('./helpers/inventory-fixture');
const CLIENT='000000000002',ADMIN='000000000001',SKU='IPADAIR1-32-PLA';
function waiting(){return {estado:'esperando_confirmacion',esperandoConfirmacionPedido:true,historial:[],borradorPedido:{agencia:{id:'fixture-agency',nombre:'Agencia sintética',direccion:'Dirección sintética'},nombre:'Persona sintética',cedula:'0012345678',telefono:CLIENT,provincia:'Guayas',ciudad:'Guayaquil',lineas:[{id_producto:SKU,producto:'IPAD AIR 1',capacidad:'32 GB',color:'plateado',cantidad:1,precio_unitario:110}]}};}
async function fixture(options={}){const e=runtime(options);await e.inventoryReady;await seedInventory(e.sheets,[[SKU,'IPAD AIR 1','32 GB','plateado',3,110,'']]);await e.seed(waiting());return e;}
const incomplete={status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:'',usage:{input_tokens:181,output_tokens:0,output_tokens_details:{reasoning_tokens:0}}};
async function assertConfirmed(e){const c=await e.load();assert.equal(c.estado,'confirmado');assert.equal(c.pedido.estado,'confirmado');assert.match(c.pedido.id,/^LU\d+$/);assert.equal(c.pedido.total,110);
  assert.equal(e.sent.filter(m=>m.to===CLIENT&&m.text?.body?.includes('✅ Pedido confirmado correctamente.')).length,1);
  assert.equal(e.sent.filter(m=>m.to===ADMIN&&m.text?.body?.includes('NUEVO PEDIDO CONFIRMADO')).length,1);
  assert.equal((await e.api.inventarioFinal().catalog()).available.get(SKU).stock,3);
  const rows=(await e.sheets.spreadsheets.values.get({range:"'REGISTRO DE VENTAS'!A5:W"})).data.values;assert.equal(rows.filter(r=>r[2]).length,0);
  const memory=(await e.sheets.spreadsheets.values.get({range:'MEMORIA!A2:C'})).data.values;assert.equal(JSON.parse(memory.find(r=>r[0]===CLIENT)[1]).pedido.id,c.pedido.id);
}
for(const text of ['confirmo','confirmado','confirmar','sí','si','correcto','Es correcto','está correcto','esta correcto','Todo correcto','todo está correcto','todo esta correcto','todo bien','confirmo los datos','Confirmo los datos del pedido','Confirmar los datos del pedido','los datos están correctos','los datos estan correctos','  ¡ES   CORRECTO!  ','CONFIRMO, LOS DATOS DEL PEDIDO.'])test(`confirmación local antes de LOW: ${text}`,async()=>{
  const e=await fixture({respond:async()=>assert.fail('No debe llamar a OpenAI')});await e.message(text,{provider:'ycloud',id:'accept'});await assertConfirmed(e);assert.equal(e.calls.length,0);
  await e.message(text,{provider:'ycloud',id:'accept'});await e.message(text,{provider:'ycloud'});await assertConfirmed(e);assert.equal(e.calls.length,0);
});
for(const text of ['No es correcto','No confirmo','no está correcto','todavía no','espera','Quiero corregir la ciudad','está mal','Es correcto el precio pero cambia la ciudad'])test(`negación/corrección no confirma: ${text}`,async()=>{
  const e=await fixture();await e.message(text,{provider:'ycloud'});assert.ok(!(await e.load()).pedido);assert.equal(e.sent.filter(m=>m.to===ADMIN).length,0);assert.equal(e.sent.filter(m=>m.text?.body?.includes('✅ Pedido confirmado correctamente.')).length,0);
  assert.ok(e.calls.every(c=>!c.instructions.startsWith('Clasifica únicamente intención')&&!c.instructions.startsWith('Eres únicamente un clasificador')));
});
test('corrección entra a extracción y conserva el nuevo dato en otro resumen sin confirmar',async()=>{
  const e=await fixture();e.control.data={...waiting().borradorPedido,ciudad:'Quito',provincia:'Pichincha'};await e.message('Es correcto el precio pero cambia la ciudad a Quito',{provider:'ycloud'});
  const c=await e.load();assert.ok(!c.pedido);assert.equal(c.borradorPedido.ciudad,'Quito');assert.equal(c.esperandoConfirmacionPedido,false);assert.equal(c.borradorPedido.agencia,undefined);assert.equal(c.commerce.stage,'agencia');assert.equal(e.calls.filter(c=>!!c.text).length,1);
});
test('solicitud explícita de asesor conserva el resumen y usa flujo de asesor sin LOW',async()=>{
  const e=await fixture({respond:async()=>assert.fail('No LOW para asesor explícito')});await e.message('Quiero hablar con un asesor',{provider:'ycloud'});const c=await e.load();assert.ok(!c.pedido);assert.equal(c.esperandoConfirmacionPedido,true);assert.match(e.sent[0].text.body,/asesor/);assert.equal(e.calls.length,0);
});
for(const failureAt of ['atencion','confirmacion'])test(`incomplete en LOW ${failureAt}: una instrucción, conserva estado, reinicio y confirmación local`,async()=>{
  const e=await fixture({respond:async args=>failureAt==='confirmacion'&&args.instructions.startsWith('Clasifica únicamente intención')?{status:'completed',output_text:'NO_SOLICITA'}:incomplete});
  await e.message('lo estoy revisando',{provider:'ycloud'});const c=await e.load();assert.equal(c.estado,'esperando_confirmacion');assert.equal(c.esperandoConfirmacionPedido,true);assert.ok(!c.pedido);assert.deepEqual(JSON.parse(JSON.stringify(c.borradorPedido)),waiting().borradorPedido);
  assert.equal(e.sent.length,1);assert.match(e.sent[0].text.body,/Tu resumen sigue pendiente/);assert.doesNotMatch(e.sent[0].text.body,/¿Deseas atención/);assert.ok(e.calls.every(c=>c.max_output_tokens===512));
  const count=e.calls.length;for(let i=0;i<3;i++)await e.message('lo estoy revisando',{provider:'ycloud'});assert.equal(e.sent.length,1);assert.equal(e.calls.length,count);
  const restart=runtime({sheets:e.sheets,respond:async()=>assert.fail('No repetir clasificador fallido')});await restart.message('lo estoy revisando',{provider:'ycloud'});assert.equal(restart.sent.length,0);
  await restart.message('confirmo los datos del pedido',{provider:'ycloud'});await assertConfirmed(restart);assert.equal(restart.calls.length,0);
});
test('mensaje verdaderamente ambiguo conserva LOW con presupuesto ampliado',async()=>{
  const e=await fixture({respond:async args=>({status:'completed',output_text:args.instructions.startsWith('Clasifica únicamente intención')?'NO_SOLICITA':'ACEPTA'})});await e.message('dale adelante con eso',{provider:'ycloud'});await assertConfirmed(e);assert.equal(e.calls.length,2);assert.ok(e.calls.every(c=>c.max_output_tokens===512));
});
test('respuesta incomplete con texto ACEPTA tampoco confirma',async()=>{
  const e=await fixture({respond:async args=>args.instructions.startsWith('Clasifica únicamente intención')?{status:'completed',output_text:'NO_SOLICITA'}:{...incomplete,output_text:'ACEPTA'}});await e.message('dale con eso',{provider:'ycloud'});assert.ok(!(await e.load()).pedido);assert.equal((await e.load()).estado,'esperando_confirmacion');
});
test('audio transcrito confirmo los datos del pedido confirma sin otra llamada de modelo',async()=>{
  const b=Buffer.alloc(47);b.write('OggS');b[26]=1;b[27]=19;b.write('OpusHead',28);b.writeUInt16LE(312,38);b.writeBigUInt64LE(BigInt(48000*10+312),6);
  const e=await fixture({env:{MODEL_TRANSCRIPTION:'fixture',YCLOUD_API_KEY:'fixture'},fetchMedia:async()=>new Response(b,{headers:{'content-type':'audio/ogg'}}),transcribe:async()=>({text:'confirmo los datos del pedido'}),respond:async()=>assert.fail('No modelo después de transcribir confirmación explícita')});
  await e.message('',{type:'audio',provider:'ycloud',audio:{link:'https://api.ycloud.com/v2/whatsapp/media/download/123'}});await assertConfirmed(e);assert.equal(e.control.audio,1);assert.equal(e.calls.length,0);
});
