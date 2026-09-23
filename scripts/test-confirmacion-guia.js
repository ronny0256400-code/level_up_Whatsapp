'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime}=require('./helpers/v2-runtime');
const {seedInventory}=require('./helpers/inventory-fixture');
const CLIENT='000000000002',ADMIN='000000000001',SKU='IPADAIR1-32-PLA';
const data=()=>({agencia:{id:'fixture-agency',nombre:'Agencia sintética',direccion:'Dirección sintética'},nombre:'Persona sintética',cedula:'0012345678',telefono:CLIENT,provincia:'Guayas',ciudad:'Guayaquil',producto:'IPAD AIR 1',variante:'32 GB plateado',cantidad:1,precio:110,lineas:[{id_producto:SKU,producto:'IPAD AIR 1',capacidad:'32 GB',color:'plateado',cantidad:1,precio_unitario:110}]});
async function setup(options={}) {
  const e=runtime(options);await e.inventoryReady;
  await seedInventory(e.sheets,[[SKU,'IPAD AIR 1','32 GB','plateado',3,110,'']]);
  // Test-owned spreadsheet formulas, never backend stock/price mutations.
  const read=e.sheets.spreadsheets.values.get,write=e.sheets.spreadsheets.values.update,batch=e.sheets.spreadsheets.batchUpdate,append=e.sheets.spreadsheets.values.append,writes=[];
  const ledger=async()=> (await read({range:"'REGISTRO DE VENTAS'!A5:W"})).data.values;
  e.sheets.spreadsheets.values.get=async args=>{
    const result=await read(args);
    if(args.range==="'PAGINA DE STOCK'!A3:G"){
      const sales=await ledger();result.data.values=result.data.values.map(row=>{const value=[...row];if(value[0]===SKU)value[4]=3-sales.filter(r=>r[14]===SKU&&['enviado','en agencia','retirado','cancelado','pagado'].includes(r[5])).reduce((n,r)=>n+Number(r[18]),0);return value;});
    }
    if(args.range==="'REGISTRO DE VENTAS'!A5:W"&&args.valueRenderOption!=='FORMULA'){
      result.data.values=result.data.values.map(row=>{const value=[...row];if(value[14]===SKU){value[15]='IPAD AIR 1';value[16]='32 GB';value[17]='plateado';value[19]=110;value[20]=Number(value[18])*value[19];}return value;});
    }
    return result;
  };
  e.sheets.spreadsheets.values.update=async args=>{writes.push({range:args.range});return write(args);};
  e.sheets.spreadsheets.values.append=async args=>{writes.push({range:args.range});return append(args);};
  e.sheets.spreadsheets.batchUpdate=async args=>{writes.push({batch:args.requestBody});return batch(args);};
  return Object.assign(e,{writes,ledger,available:async()=> (await e.api.inventarioFinal().catalog()).available.get(SKU).stock});
}
test('caso real 110: resumen -> confirmar sin venta/stock -> reinicio -> GUIA -> stock calculado 3 a 2',async()=>{
  const e=await setup();e.control.data=data();assert.equal(await e.message('Quiero el IPAD AIR 1 de 32 GB plateado',{provider:'ycloud'}),200);
  await e.message('Guayaquil Guayas',{provider:'ycloud'});await e.message('sí',{provider:'ycloud'});await e.message('Mis datos personales sintéticos',{provider:'ycloud'});
  assert.equal((await e.load()).estado,'esperando_confirmacion');assert.equal(await e.available(),3);
  const before=e.writes.length;assert.equal(await e.message('sí confirmo',{provider:'ycloud'}),200);
  const c=await e.load();assert.equal(c.estado,'confirmado');assert.equal(c.pedido.estado,'confirmado');assert.match(c.pedido.id,/^LU\d+$/);assert.equal(c.pedido.total,110);
  assert.deepEqual(JSON.parse(JSON.stringify(c.datosCliente)),{nombre:'Persona sintética',cedula:'0012345678',telefono:CLIENT,provincia:'Guayas',ciudad:'Guayaquil',agencia:JSON.parse(JSON.stringify(c.datosCliente.agencia))});
  assert.deepEqual(JSON.parse(JSON.stringify(c.pedido.lineas)),[{...data().lineas[0],subtotal:110}]);
  const memory=(await e.sheets.spreadsheets.values.get({range:'MEMORIA!A2:C'})).data.values;
  assert.equal(JSON.parse(memory.find(r=>r[0]===CLIENT)[1]).pedido.id,c.pedido.id);
  assert.equal(await e.available(),3);assert.equal((await e.ledger()).filter(r=>r[2]).length,0);
  assert.ok(e.writes.slice(before).every(w=>w.batch
    ? w.batch.requests.every(r=>r.addSheet?.properties.title==='APRENDIZAJE')
    : !/DATOS|PAGINA DE STOCK|REGISTRO DE VENTAS/.test(w.range))); 
  const notice=e.sent.find(m=>m.to===ADMIN&&m.text.body.includes('NUEVO PEDIDO CONFIRMADO'));
  assert.ok(notice);assert.ok(notice.text.body.includes(`🆔 Pedido: ${c.pedido.id}`));
  assert.equal(notice.provider,'ycloud');assert.equal(c.pedido.avisoConfirmacion.estado,'enviada');
  const restart=runtime({sheets:e.sheets});assert.notEqual(await restart.api.generarIdPedido(),c.pedido.id);
  const formulas=(await e.sheets.spreadsheets.values.get({range:"'REGISTRO DE VENTAS'!A5:W",valueRenderOption:'FORMULA'})).data.values;
  assert.equal(await restart.message(`GUIA (${c.pedido.id_chat}) (GUIA-110)`,{from:ADMIN}),200);
  const rows=(await e.sheets.spreadsheets.values.get({range:"'REGISTRO DE VENTAS'!A5:W"})).data.values.filter(r=>r[2]);assert.equal(rows.length,1);
  assert.equal(rows[0][2],c.pedido.id);assert.equal(rows[0][4],'GUIA-110');assert.equal(rows[0][5],'enviado');assert.equal(rows[0][14],SKU);assert.equal(rows[0][18],1);assert.equal(rows[0][19],110);assert.equal(rows[0][20],110);
  assert.equal(await e.available(),2);assert.equal((await restart.load()).pedido.estado,'enviado');
  const raw=(await e.sheets.spreadsheets.values.get({range:"'REGISTRO DE VENTAS'!A5:W",valueRenderOption:'FORMULA'})).data.values;
  for(const col of [15,16,17,19,20,22])assert.equal(raw[0][col],formulas[0][col]);
  await restart.message(`GUIA (${c.pedido.id_chat}) (GUIA-110)`,{from:ADMIN});assert.equal((await e.ledger()).filter(r=>r[2]).length,1);assert.equal(await e.available(),2);
});
test('fallo administrativo conserva pedido y aviso pendiente durable',async()=>{
  const e=await setup({ycloudError:Object.assign(new Error('YCloud HTTP 429'),{status:429}),ycloudErrorTo:ADMIN});await e.seed({estado:'esperando_confirmacion',esperandoConfirmacionPedido:true,borradorPedido:data(),historial:[]});assert.equal(await e.message('sí confirmo',{provider:'ycloud'}),200);
  const c=await e.load();assert.equal(c.pedido.estado,'confirmado');assert.match(c.pedido.id,/^LU\d+$/);assert.equal(e.sent.filter(m=>m.to===ADMIN).length,0);
  assert.ok(e.logs.some(row=>row[1]?.event==='admin_notice_retry'));assert.equal(c.pedido.avisoConfirmacion.estado,'pendiente');assert.equal(await e.available(),3);
});
