'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {runtime}=require('./helpers/v2-runtime');
const {transcribeYCloudAudio,mediaURL}=require('../lib/ycloud-audio');
const {seedInventory}=require('./helpers/inventory-fixture');
const LINK='https://api.ycloud.com/v2/whatsapp/media/download/123?sig=private-signature';
const CLIENT='000000000002',ADMIN='000000000001';
function ogg(seconds=10){const b=Buffer.alloc(47);b.write('OggS');b[26]=1;b[27]=19;b.write('OpusHead',28);b.writeUInt16LE(312,38);b.writeBigUInt64LE(BigInt(seconds*48000+312),6);return b;}
const response=(seconds=10)=>new Response(ogg(seconds),{headers:{'content-type':'audio/ogg'}});
function fixture({text='consulta sintética',seconds=10,...options}={}){
  const downloads=[],files=[];
  const e=runtime({env:{MODEL_TRANSCRIPTION:'fixture-transcriber',YCLOUD_API_KEY:'secret-fixture'},fetchMedia:async(url,args)=>{downloads.push({url,args});return response(seconds);},transcribe:async args=>{files.push(args.file.path);assert.equal(args.model,'fixture-transcriber');assert.ok(fs.existsSync(args.file.path));return{text,usage:{input_tokens:7,output_tokens:2}};},...options});
  return Object.assign(e,{downloads,files,audio:(opts={})=>e.message('',{type:'audio',provider:'ycloud',audio:{link:LINK,mime_type:'audio/ogg'},...opts})});
}
const draft=()=>({nombre:'Persona sintética',cedula:'0012345678',telefono:CLIENT,provincia:'Guayas',ciudad:'Guayaquil',producto:'IPAD AIR 1',variante:'32 GB plateado',cantidad:1,precio:110,lineas:[{id_producto:'IPADAIR1-32-PLA',producto:'IPAD AIR 1',capacidad:'32 GB',color:'plateado',cantidad:1,precio_unitario:110}]});
async function stock(e){await e.inventoryReady;await seedInventory(e.sheets,[['IPADAIR1-32-PLA','IPAD AIR 1','32 GB','plateado',3,110,'']]);}
test('audio YCloud válido descarga, transcribe, limpia archivo y entra al router comercial',async()=>{
  const e=fixture();assert.equal(await e.audio(),200);assert.equal(e.control.audio,1);assert.equal(e.downloads.length,1);
  assert.equal(e.downloads[0].args.headers['X-API-Key'],'secret-fixture');assert.equal(e.downloads[0].args.redirect,'error');assert.ok(e.downloads[0].args.signal);
  assert.ok(e.files.every(file=>!fs.existsSync(file)));assert.ok(e.logs.some(row=>row[1]?.event==='router'&&row[1].rule==='comercial'));
  assert.ok(e.logs.some(row=>row[1]?.event==='transcription'&&row[1].seconds===10));assert.equal((await e.load()).metrics.by_model['fixture-transcriber'].calls,1);
  assert.doesNotMatch(JSON.stringify(e.logs),/private-signature|secret-fixture|consulta sintética/);
});
test('audio durante captura de datos conserva contexto y produce resumen',async()=>{
  const e=fixture();await stock(e);await e.seed({estado:'recopilando_datos',historial:[{role:'user',content:'contexto previo'}]});e.control.data=draft();await e.audio();
  const c=await e.load();assert.equal(c.estado,'esperando_confirmacion');assert.equal(c.borradorPedido.lineas[0].id_producto,'IPADAIR1-32-PLA');assert.ok(c.historial.some(m=>m.content==='contexto previo'));
});
test('audio de confirmación usa el mismo flujo y persiste pedido confirmado',async()=>{
  const e=fixture({text:'sí confirmo'});await stock(e);await e.seed({estado:'esperando_confirmacion',esperandoConfirmacionPedido:true,borradorPedido:draft(),historial:[]});await e.audio();
  const c=await e.load();assert.equal(c.pedido.estado,'confirmado');assert.match(c.pedido.id,/^LU\d+$/);assert.equal(c.pedido.total,110);
});
for(const source of ['metadata','bytes'])test(`audio mayor a tres minutos según ${source} nunca se transcribe`,async()=>{
  const e=fixture({seconds:181});await e.audio(source==='metadata'?{audio:{link:LINK,duration:181}}:{});assert.equal(e.control.audio,0);assert.equal(e.downloads.length,source==='metadata'?0:1);assert.ok(e.sent.some(m=>m.text.body.includes('máximo 3 minutos')));
});
test('audio exactamente tres minutos se acepta',async()=>{const e=fixture({seconds:180});await e.audio();assert.equal(e.control.audio,1);});
test('fallo de descarga produce fallback sin transcripción ni URL en logs',async()=>{
  const e=fixture({fetchMedia:async()=>{throw Error(LINK);}});await e.audio();assert.equal(e.control.audio,0);assert.ok(e.sent.some(m=>m.text.body==='Por favor escribe tu consulta para poder ayudarte.'));assert.doesNotMatch(JSON.stringify(e.logs),/private-signature/);
});
test('fallo de transcripción produce fallback y elimina el archivo',async()=>{
  const files=[];const e=fixture({transcribe:async args=>{files.push(args.file.path);throw Error('private-client-text');}});await e.audio();assert.equal(e.control.audio,1);assert.ok(files.every(file=>!fs.existsSync(file)));assert.ok(e.sent.some(m=>m.text.body==='Por favor escribe tu consulta para poder ayudarte.'));assert.doesNotMatch(JSON.stringify(e.logs),/private-client-text/);
});
test('webhook de audio duplicado respeta buffer y solo transcribe una vez',async()=>{
  const e=fixture();await e.inventoryReady;const m={id:'duplicate-audio',from:CLIENT,provider:'ycloud',type:'audio',audio:{link:LINK}};
  await Promise.all([e.api.entradaV2.accept(m),e.api.entradaV2.accept(m)]);await e.api.entradaV2.recover();assert.equal(e.control.audio,0);e.control.time+=5000;await e.api.entradaV2.recover();assert.equal(e.control.audio,1);assert.equal(await e.api.entradaV2.accept(m),'duplicate');
});
test('reinicio tras fallo posterior reutiliza transcripción persistida',async()=>{
  const e=fixture({ycloudError:Object.assign(new Error('YCloud HTTP 503'),{status:503})});assert.equal(await e.audio({id:'retry-audio'}),500);assert.equal(e.control.audio,1);
  const restart=fixture({sheets:e.sheets});assert.equal(await restart.audio({id:'retry-audio'}),200);assert.equal(restart.control.audio,0);assert.equal(restart.downloads.length,0);
});
test('TEST_MODE no descarga ni llama transcripción real',async()=>{
  const e=fixture({env:{TEST_MODE:'true',MODEL_TRANSCRIPTION:'fixture-transcriber',YCLOUD_API_KEY:'secret-fixture'}});await e.audio();assert.equal(e.downloads.length,0);assert.equal(e.control.audio,0);
});
test('takeover bloquea descarga/transcripción y respuesta',async()=>{const e=fixture();await e.seed({human_takeover:true,estado:'human_takeover'});await e.audio();assert.equal(e.control.audio,0);assert.equal(e.downloads.length,0);assert.equal(e.sent.length,0);});
for(const link of ['http://api.ycloud.com/v2/whatsapp/media/download/123','https://127.0.0.1/media','https://api.ycloud.com.evil.test/v2/whatsapp/media/download/123','https://user:secret@api.ycloud.com/v2/whatsapp/media/download/123','https://api.ycloud.com/v2/balance'])test('URL de medios no permitida se rechaza antes de enviar credenciales',()=>assert.throws(()=>mediaURL(link)));
test('descarga mayor al límite sin content-length no llega al modelo',async()=>{
  let calls=0;const result=await transcribeYCloudAudio({link:LINK},{env:{MODEL_TRANSCRIPTION:'fixture',YCLOUD_API_KEY:'fixture'},models:{transcribe:async()=>calls++},fetchMedia:async()=>new Response(Buffer.alloc(16*1024*1024+1),{headers:{'content-type':'audio/ogg'}})});assert.equal(result,null);assert.equal(calls,0);
});
test('redirección, MIME no audio y duración no verificable dan fallback',async()=>{
  for(const fetchMedia of [async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1'}}),async()=>new Response('private',{headers:{'content-type':'text/html'}}),async()=>new Response('OggS',{headers:{'content-type':'audio/ogg'}})]){
    const e=fixture({fetchMedia});await e.audio();assert.equal(e.control.audio,0);assert.ok(e.sent.some(m=>m.text.body==='Por favor escribe tu consulta para poder ayudarte.'));
  }
});
test('binario application/octet-stream usa el mime autenticado del evento',async()=>{const e=fixture({fetchMedia:async()=>new Response(ogg(),{headers:{'content-type':'application/octet-stream'}})});await e.audio();assert.equal(e.control.audio,1);});
test('MODEL_TRANSCRIPTION ausente evita descargas y pide texto',async()=>{const e=fixture({env:{YCLOUD_API_KEY:'fixture'}});await e.audio();assert.equal(e.control.audio,0);assert.equal(e.downloads.length,0);assert.ok(e.sent.some(m=>m.text.body==='Por favor escribe tu consulta para poder ayudarte.'));});
