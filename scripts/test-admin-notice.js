'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./helpers/v2-runtime');
const CLIENT='000000000002',ADMIN='000000000099';
const draft=()=>({agencia:{id:'fixture-agency',nombre:'Agencia sintética',direccion:'Dirección sintética'},nombre:'Cliente sintético',cedula:'0012345678',telefono:CLIENT,provincia:'Guayas',ciudad:'Guayaquil',lineas:[{id_producto:'EQUIPO',producto:'Equipo de prueba',capacidad:'32 GB',color:'plateado',cantidad:1,precio_unitario:100}],cantidad:1,precio:100});
async function fixture(options={}){const e=runtime({...options,env:{...options.env,ASESOR_WHATSAPP:ADMIN}});await e.inventoryReady;await e.seed({estado:'esperando_confirmacion',esperandoConfirmacionPedido:true,borradorPedido:draft(),historial:[]});return e;}
const notices=e=>e.sent.filter(m=>m.to===ADMIN&&m.text.body.includes('NUEVO PEDIDO CONFIRMADO'));
for(const provider of ['ycloud','meta'])test(`${provider}: aviso usa canal de origen, destino configurado y datos persistidos`,async()=>{
  const e=await fixture();await e.message('sí confirmo',{provider});const c=await e.load(),sent=notices(e);assert.equal(sent.length,1);
  assert.equal(provider==='ycloud'?sent[0].provider:sent[0].messaging_product,provider==='ycloud'?'ycloud':'whatsapp');
  assert.equal(sent[0].to,ADMIN);for(const text of [c.pedido.id,'Cliente sintético',CLIENT,'Equipo de prueba','Cantidad: 1','Total: $100.00','EQUIPO'])assert.ok(sent[0].text.body.includes(text));
  assert.equal(c.pedido.avisoConfirmacion.estado,'enviada');assert.equal(c.pedido.avisoConfirmacion.provider,provider);
  assert.doesNotMatch(JSON.stringify(e.logs),/Cliente sintético|0012345678|000000000002|000000000099/);
});
test('mismo pedido, webhook duplicado y scheduler concurrente no duplican aviso',async()=>{
  const e=await fixture();await Promise.all([e.message('sí confirmo',{id:'same',provider:'ycloud'}),e.message('sí confirmo',{id:'same',provider:'ycloud'})]);const id=(await e.load()).pedido.id;
  await e.message('sí confirmo',{provider:'ycloud'});await Promise.all([e.api.revisarSeguimientos(),e.api.revisarSeguimientos()]);
  assert.equal(notices(e).length,1);assert.equal((await e.load()).pedido.id,id);
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,0);
});
test('rechazo temporal 429 persiste pendiente y reintenta tras reinicio por el canal original',async()=>{
  const e=await fixture({ycloudError:Object.assign(new Error('YCloud HTTP 429'),{status:429}),ycloudErrorTo:ADMIN});await e.message('sí confirmo',{provider:'ycloud'});
  const c=await e.load();assert.equal(c.pedido.estado,'confirmado');assert.equal(c.pedido.avisoConfirmacion.estado,'pendiente');assert.equal(notices(e).length,0);assert.equal(c.pedido.avisoConfirmacion.intentos,1);
  c.provider='meta';c.human_takeover=true;await e.seed(c);
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,0);
  restart.control.time+=60000;await Promise.all([restart.api.revisarSeguimientos(),restart.api.revisarSeguimientos()]);
  assert.equal(notices(restart).length,1);assert.equal(notices(restart)[0].provider,'ycloud');assert.equal((await restart.load()).pedido.avisoConfirmacion.intentos,2);assert.equal((await restart.load()).pedido.avisoConfirmacion.estado,'enviada');
  restart.control.time+=3600000;await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,1);
});
test('TEST_MODE persiste simulación y nunca llama al transporte',async()=>{
  const e=await fixture({testModeSharedSheets:true,env:{TEST_MODE:'true'},ycloudError:Error('no llamar'),ycloudErrorTo:ADMIN});await e.message('sí confirmo',{provider:'ycloud'});assert.equal(e.sent.length,0);const aviso=(await e.load()).pedido.avisoConfirmacion;assert.equal(aviso.estado,'enviada');assert.equal(aviso.simulated,true);
});
test('timeout incierto conserva aviso sin reenvío ciego tras reinicio',async()=>{
  const e=await fixture({ycloudError:Error('timeout secret-token'),ycloudErrorTo:ADMIN});await e.message('sí confirmo',{provider:'ycloud'});const aviso=(await e.load()).pedido.avisoConfirmacion;assert.equal(aviso.estado,'incierta');assert.ok(aviso.texto.includes('NUEVO PEDIDO CONFIRMADO'));
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});restart.control.time+=3600000;await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,0);assert.doesNotMatch(JSON.stringify(e.logs),/secret-token/);
});
test('aceptación seguida de fallo en MEMORIA no reenvía el aviso al reiniciar',async()=>{
  const e=await fixture(),update=e.sheets.spreadsheets.values.update;let once=true;
  e.sheets.spreadsheets.values.update=async args=>{if(once&&args.range.startsWith('MEMORIA')&&JSON.parse(args.requestBody.values[0][1]).pedido?.avisoConfirmacion?.estado==='enviada'){once=false;throw Error('storage unavailable');}return update(args);};
  await e.message('sí confirmo',{provider:'ycloud'});assert.equal(notices(e).length,1);
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});restart.control.time+=3600000;await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,0);assert.equal((await restart.load()).pedido.avisoConfirmacion.estado,'incierta');
});
test('aviso guardado antes del primer envío sobrevive a caída y se recupera',async()=>{
  const e=await fixture(),update=e.sheets.spreadsheets.values.update;let once=true;
  e.sheets.spreadsheets.values.update=async args=>{if(once&&args.range.startsWith('MEMORIA')&&JSON.parse(args.requestBody.values[0][1]).pedido?.avisoConfirmacion?.estado==='enviando'){once=false;throw Error('before send');}return update(args);};
  await e.message('sí confirmo',{provider:'ycloud'});assert.equal(notices(e).length,0);
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,1);assert.equal((await restart.load()).pedido.avisoConfirmacion.estado,'enviada');
});
test('pedido histórico sin outbox no genera avisos retroactivos',async()=>{const e=await fixture();await e.seed({estado:'confirmado',pedido:{id_chat:'CH000001',id:'LU0001',estado:'confirmado'},historial:[]});await e.api.revisarSeguimientos();assert.equal(notices(e).length,0);});
test('Meta rechazado temporalmente reintenta por Meta y no YCloud',async()=>{
  const e=await fixture({failSendTo:ADMIN,failSendStatus:429});await e.message('sí confirmo',{provider:'meta'});assert.equal((await e.load()).pedido.avisoConfirmacion.estado,'pendiente');
  const restart=runtime({sheets:e.sheets,env:{ASESOR_WHATSAPP:ADMIN}});restart.control.time+=60000;await restart.api.revisarSeguimientos();assert.equal(notices(restart).length,1);assert.equal(notices(restart)[0].messaging_product,'whatsapp');assert.equal(notices(restart)[0].provider,undefined);
});
test('aviso multilínea usa cantidades y total del pedido interno',async()=>{
  const e=await fixture();const d=draft();d.lineas.push({id_producto:'A',producto:'A',capacidad:'N/A',color:'blanco',cantidad:2,precio_unitario:50});
  await e.seed({estado:'esperando_confirmacion',esperandoConfirmacionPedido:true,borradorPedido:d,historial:[]});await e.message('sí confirmo',{provider:'ycloud'});const body=notices(e)[0].text.body;
  assert.match(body,/SKU: EQUIPO\nCantidad: 1/);assert.match(body,/SKU: A\nCantidad: 2/);assert.match(body,/Total: \$200\.00/);
});
