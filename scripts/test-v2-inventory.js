'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memorySheets } = require('../lib/v2-storage');
const { createInventory, parseCatalog, scarcity, catalogText, dateSerial } = require('../lib/v2-inventory');
const { HEADERS } = require('./helpers/inventory-fixture');
const NOW = new Date('2026-09-17T02:00:00Z'); // Still September 16 in Guayaquil.
const products = () => [['IPADAIR1-16-BLA','iPad Air 1','16 GB','blanco',5,100,'Ficha blanca'],['IPADAIR1-32-PLA','iPad Air 1','32 GB','plateado',3,90,'Ficha plateada']];
const order = (multiple = false) => ({ id:'LU0001', lineas: [{id_producto:'IPADAIR1-16-BLA',producto:'iPad Air 1',capacidad:'16 GB',color:'blanco',cantidad:2,precio_unitario:100},...(multiple?[{id_producto:'IPADAIR1-32-PLA',producto:'iPad Air 1',capacidad:'32 GB',color:'plateado',cantidad:1,precio_unitario:90}]:[])] });
async function fixture(stock=products()) {
  const sheets=memorySheets(), writes=[];
  const put=(range,values)=>sheets.spreadsheets.values.update({range,requestBody:{values}});
  await put('DATOS!B2:G2',[['manual-date','manual-product','manual-capacity','manual-color',100,'manual-id']]);
  await put('DATOS!L2:R',products());
  await put("'PAGINA DE STOCK'!A2:G",[HEADERS,...stock]);
  const rows=Array.from({length:20},()=>Array(23).fill(''));
  rows.forEach((row,i)=>{for(const col of [15,16,17,19,20,22])row[col]=`=FORMULA_${col}(${i+5})`;});
  await put("'REGISTRO DE VENTAS'!A5:W24",rows);
  const original=sheets.spreadsheets.batchUpdate;
  sheets.spreadsheets.batchUpdate=async args=>{writes.push(structuredClone(args));return original(args);};
  const inventory=createInventory({sheets,spreadsheetId:'fixture',now:()=>NOW});
  const register=o=>inventory.register({order:o||order(),guide:'001234',customer:{nombre:'Cliente prueba',cedula:'0012345678',provincia:'P',ciudad:'C'},phone:'000000000002'});
  const sales=async()=> (await sheets.spreadsheets.values.get({range:"'REGISTRO DE VENTAS'!A5:W"})).data.values;
  return{sheets,writes,inventory,register,sales,put};
}
test('lee estructura final con color, precio e información exactos desde la página de stock',async()=>{const e=await fixture(),c=await e.inventory.catalog();assert.equal(c.available.get('IPADAIR1-16-BLA').color,'blanco');assert.equal(c.available.get('IPADAIR1-16-BLA').precio,100);assert.equal(c.available.get('IPADAIR1-16-BLA').stock,5);assert.equal(c.master.size,2);assert.match(catalogText([...c.available.values()]),/Ficha blanca/);});
test('stock cero y IDs ausentes no se ofrecen',async()=>{const rows=products();rows[0][4]=0;const e=await fixture(rows.slice(0,1)),c=await e.inventory.catalog();assert.equal(c.available.size,0);assert.equal(c.master.size,1);await assert.rejects(e.register(),{code:'STOCK_INSUFICIENTE'});assert.equal(e.writes.length,0);});
test('ID duplicado se excluye sin invalidar otras variantes',()=>{const rows=products();rows.push(rows[0]);const c=parseCatalog(rows);assert.equal(c.size,1);assert.ok(!c.has(rows[0][0]));});
test('color combinado aislado se excluye sin invalidar otra variante',()=>{const rows=products();rows[0][3]='blanco, plateado';assert.equal(parseCatalog(rows).size,1);});
test('dos filas con el mismo ID y sin otra variante válida fallan',()=>{const rows=products();rows[1][0]=rows[0][0];assert.throws(()=>parseCatalog(rows),{code:'CATALOGO_INVALIDO'});});
test('ID es clave principal aun si dos IDs comparten descripción',()=>{const rows=products();rows[1]=['OTRO',...rows[0].slice(1)];assert.equal(parseCatalog(rows).size,2);});
test('GUIA única registra una fila enviada con fechas locales y ceros de identificación',async()=>{const e=await fixture();const r=await e.register();assert.deepEqual(r.rows,[5]);const row=(await e.sales())[0];assert.equal(row[1],dateSerial('2026-09-16'));assert.equal(row[6],row[1]);assert.equal(row[2],'LU0001');assert.equal(row[3],'CONTRAENTREGA');assert.equal(row[4],'001234');assert.equal(row[5],'enviado');assert.equal(row[10],'0012345678');assert.equal(row[14],'IPADAIR1-16-BLA');assert.equal(row[18],2);assert.equal(e.writes.length,1);});
test('GUIA multiproducto registra N filas consecutivas con IDs/capacidades/colores distintos',async()=>{const e=await fixture();const r=await e.register(order(true));assert.deepEqual(r.rows,[5,6]);const rows=await e.sales();assert.equal(rows[0][14],'IPADAIR1-16-BLA');assert.equal(rows[1][14],'IPADAIR1-32-PLA');assert.equal(rows[0][18],2);assert.equal(rows[1][18],1);assert.equal(rows[0][2],rows[1][2]);assert.equal(e.writes.length,1);});
test('stock insuficiente en segunda línea crea cero filas',async()=>{const rows=products();rows[1][4]=0;const e=await fixture(rows);await assert.rejects(e.register(order(true)),{code:'STOCK_INSUFICIENTE'});assert.equal(e.writes.length,0);assert.ok((await e.sales()).every(r=>!r[2]));});
test('cantidades repetidas de un mismo ID se validan sumadas',async()=>{const e=await fixture();const o=order();o.lineas=[{...o.lineas[0],cantidad:3},{...o.lineas[0],cantidad:3}];await assert.rejects(e.register(o),{code:'STOCK_INSUFICIENTE'});assert.equal(e.writes.length,0);});
test('idempotencia persiste aunque Sheets ya no ofrezca stock y se reinicie backend',async()=>{const e=await fixture();await e.register();await e.put("'PAGINA DE STOCK'!A3:G",products().map(r=>r.map((v,i)=>i===4?0:v)));const restarted=createInventory({sheets:e.sheets,spreadsheetId:'fixture'});const r=await restarted.register({order:order(),guide:'001234'});assert.equal(r.repeated,true);assert.equal(e.writes.length,1);});
test('misma orden con guía diferente no escribe; ni permite reutilizar guía en otra orden',async()=>{const e=await fixture();await e.register();await assert.rejects(e.inventory.register({order:order(),guide:'otra'}),{code:'GUIA_CONFLICTIVA'});await assert.rejects(e.inventory.register({order:{...order(),id:'LU0002'},guide:'001234'}),{code:'GUIA_CONFLICTIVA'});assert.equal(e.writes.length,1);});
test('nunca modifica RE-STOCK, DATOS!P ni fórmulas P/Q/R/T/U/W',async()=>{const e=await fixture();const before=(await e.sheets.spreadsheets.values.get({range:'DATOS!A1:R'})).data.values;const formulas=(await e.sales()).map(r=>[15,16,17,19,20,22].map(i=>r[i]));await e.register(order(true));assert.deepEqual((await e.sheets.spreadsheets.values.get({range:'DATOS!A1:R'})).data.values,before);assert.deepEqual((await e.sales()).map(r=>[15,16,17,19,20,22].map(i=>r[i])),formulas);for(const request of e.writes[0].requestBody.requests)assert.ok(![15,16,17,19,20,22].includes(request.updateCells.start.columnIndex));});
for(const state of ['en agencia','retirado','cancelado'])test(`${state} actualiza únicamente estado y retiro cuando corresponde`,async()=>{const e=await fixture();await e.register(order(true));const result=await e.inventory.updateState({orderId:'LU0001'},state,NOW);assert.equal(result.rows.length,2);const cols=e.writes.at(-1).requestBody.requests.map(r=>r.updateCells.start.columnIndex);assert.ok(cols.every(c=>c===5||(state==='retirado'&&c===7)));assert.ok((await e.sales()).slice(0,2).every(r=>r[5]===state));if(state==='retirado')assert.equal((await e.sales())[0][7],dateSerial('2026-09-16'));});
test('actualización por GUIA no vuelve a escribir DIA RETIRO existente',async()=>{const e=await fixture();await e.register();await e.inventory.updateState({guide:'001234'},'retirado',NOW);const count=e.writes.length;await e.inventory.updateState({guide:'001234'},'retirado',new Date('2026-09-20T12:00Z'));assert.equal(e.writes.length,count);assert.equal((await e.sales())[0][7],dateSerial('2026-09-16'));await assert.rejects(e.inventory.updateState({guide:'001234'},'devuelto'),{code:'ESTADO_INVALIDO'});assert.equal(e.writes.length,count);});
test('busca bloque libre sin append ciego e ignora fórmulas prellenadas',async()=>{const e=await fixture();await e.put("'REGISTRO DE VENTAS'!I5",[['ocupada']]);await e.put("'REGISTRO DE VENTAS'!S7",[[1]]);const r=await e.register(order(true));assert.deepEqual(r.rows,[8,9]);});
test('stock 1 muestra última unidad; 2–5 muy pocas, sin cantidades',()=>{assert.equal(scarcity(1),'Nos queda la última unidad disponible');for(const q of [2,3,4,5]){assert.equal(scarcity(q),'Nos quedan muy pocas unidades disponibles');assert.doesNotMatch(scarcity(q),/\d/);}assert.equal(scarcity(0),'');assert.equal(scarcity(6),'');});
test('fallo de batch atómico no produce filas parciales',async()=>{const e=await fixture();e.sheets.spreadsheets.batchUpdate=async()=>{throw Error('fallo simulado');};await assert.rejects(e.register(order(true)));assert.ok((await e.sales()).every(r=>!r[2]));});
test('fallo incierto después de aplicar se recupera leyendo ventas, sin duplicar',async()=>{const e=await fixture(),write=e.sheets.spreadsheets.batchUpdate;let first=true;e.sheets.spreadsheets.batchUpdate=async a=>{await write(a);if(first){first=false;throw Error('conexión perdida');}};await assert.rejects(e.register());assert.equal((await e.register()).repeated,true);assert.equal(e.writes.length,1);});
test('GUIDAs concurrentes distintos nunca ocupan las mismas filas',async()=>{const e=await fixture();const results=await Promise.all([e.register(),e.inventory.register({order:{...order(),id:'LU0002'},guide:'G2'})]);assert.deepEqual(results.map(r=>r.rows[0]),[5,6]);});
test('sin ID o precio distinto al confirmado bloquea antes de escribir',async()=>{const e=await fixture(),o=order();delete o.lineas[0].id_producto;await assert.rejects(e.register(o),{code:'ID_PRODUCTO_REQUERIDO'});const changed=order();changed.lineas[0].precio_unitario=99;await assert.rejects(e.register(changed),{code:'PRECIO_CAMBIADO'});assert.equal(e.writes.length,0);});

test('catálogo válido con una fila usa A3:G y encabezados de fila 2; nunca consulta DATOS',async()=>{
  const e=await fixture(products().slice(0,1)),calls=[],read=e.sheets.spreadsheets.values.get;
  e.sheets.spreadsheets.values.get=async args=>{calls.push(args);assert.ok(!args.range.startsWith('DATOS'));return read(args);};
  const c=await e.inventory.catalog();assert.equal(c.available.size,1);
  assert.deepEqual(calls.map(c=>c.range).sort(),["'PAGINA DE STOCK'!A2:G2","'PAGINA DE STOCK'!A3:G"]);
  assert.ok(calls.every(c=>c.valueRenderOption==='UNFORMATTED_VALUE'));
});
test('varias variantes del mismo producto conservan capacidad y color de cada ID',async()=>{
  const e=await fixture(),c=await e.inventory.catalog();assert.equal(c.available.size,2);
  assert.deepEqual([...c.available.values()].map(p=>[p.id_producto,p.capacidad,p.color]),[['IPADAIR1-16-BLA','16 GB','blanco'],['IPADAIR1-32-PLA','32 GB','plateado']]);
});
test('mismo producto y capacidad con colores distintos siguen siendo variantes distintas',async()=>{
  const rows=[['IPADAIR1-32-PLA','IPAD AIR 1','32 GB','plateado',3,100,'información'],['IPADAIR1-32-BLA','IPAD AIR 1','32 GB','blanco',2,100,'información']];
  const e=await fixture(rows),c=await e.inventory.catalog();assert.equal(c.available.size,2);assert.equal(c.available.get(rows[1][0]).color,'blanco');
});
test('fila stock 0 se excluye de disponibles y conserva otras variantes',async()=>{
  const rows=products();rows[0][4]=0;const e=await fixture(rows),c=await e.inventory.catalog();assert.equal(c.available.size,1);assert.ok(!c.available.has(rows[0][0]));
});
test('filas totalmente vacías no invalidan ni desplazan los datos de otras filas',async()=>{
  const e=await fixture([[],Array(7).fill(''),...products(),['  ',null]]);assert.equal((await e.inventory.catalog()).available.size,2);
});
test('información de producto vacía o celda final omitida permite la variante',async()=>{
  const rows=products();rows[0][6]='';rows[1].pop();const e=await fixture(rows),c=await e.inventory.catalog();assert.equal(c.available.size,2);assert.ok([...c.available.values()].every(p=>p.informacion===''));
});
test('precio numérico con decimales mantiene su valor monetario',async()=>{
  const rows=products();rows[0][5]=100.25;const e=await fixture(rows);assert.equal((await e.inventory.catalog()).available.get(rows[0][0]).precio,100.25);
});
test('stock calculado por fórmula y precio con formato monetario se leen como valores evaluados',async()=>{
  const e=await fixture(),read=e.sheets.spreadsheets.values.get;
  e.sheets.spreadsheets.values.get=async args=>{
    if(args.range==="'PAGINA DE STOCK'!A3:G") {
      // Google returns a formula result/currency number under UNFORMATTED_VALUE,
      // not '=SUM(...)' or a localized currency string.
      assert.equal(args.valueRenderOption,'UNFORMATTED_VALUE');return{data:{values:[['FORMULA','Equipo','32 GB','blanco',3,100.5,'']]}};
    }
    return read(args);
  };
  const item=(await e.inventory.catalog()).available.get('FORMULA');assert.equal(item.stock,3);assert.equal(item.precio,100.5);
});
test('encabezados correctos en fila 2 no se interpretan como datos',async()=>{
  const e=await fixture();await e.put("'PAGINA DE STOCK'!A1:G1",[['Título sin estructura']]);assert.equal((await e.inventory.catalog()).available.size,2);
});
test('ninguna fila válida produce CATALOGO_INVALIDO, sin contenido en el error',async()=>{
  const e=await fixture([['private-id','private-product','32 GB','blanco','#REF!','private-price','private-info']]);
  await assert.rejects(e.inventory.catalog(),error=>{assert.equal(error.code,'CATALOGO_INVALIDO');assert.doesNotMatch(error.message,/private/);return true;});
});
test('catálogo totalmente vacío produce CATALOGO_INVALIDO',async()=>{
  const e=await fixture([]);await assert.rejects(e.inventory.catalog(),{code:'CATALOGO_INVALIDO'});
});
test('cada columna esencial ausente en encabezados produce CATALOGO_INVALIDO',async()=>{
  for(let column=0;column<6;column++){const e=await fixture(),headers=[...HEADERS];headers[column]='';await e.put("'PAGINA DE STOCK'!A2:G2",[headers]);await assert.rejects(e.inventory.catalog(),{code:'CATALOGO_INVALIDO'});}
});
test('fila inválida aislada no bloquea variantes válidas',async()=>{
  const rows=products();const e=await fixture([['invalid','Equipo','32 GB','blanco','#VALUE!',100,''],...rows]);const c=await e.inventory.catalog();assert.equal(c.available.size,2);assert.ok(!c.available.has('invalid'));
});
test('campos esenciales de una fila no se completan con datos de otra',async()=>{
  for(let column=0;column<6;column++){const rows=products();rows[0][column]='';const e=await fixture(rows),c=await e.inventory.catalog();assert.equal(c.available.size,1);assert.ok(c.available.has(rows[1][0]));}
});
test('DATOS inconsistente no determina disponibilidad ni precio de la página final',async()=>{
  const e=await fixture();await e.put('DATOS!L2:R',[['ID-ANTIGUO','producto antiguo','','',0,999,'']]);const c=await e.inventory.catalog();assert.equal(c.available.size,2);assert.equal(c.available.get(products()[0][0]).precio,100);
});
test('auxiliares H:I y Ultima actualización no forman parte del catálogo',async()=>{
  const e=await fixture(),before=await e.inventory.catalog();
  await e.put("'PAGINA DE STOCK'!H2:I4",[['auxiliar','Ultima actualización'],['#REF!','2026-09-17'],['=FILTER(...)','dato auxiliar']]);
  await e.put("'PAGINA DE STOCK'!I100",[['Ultima actualización']]);
  assert.deepEqual(await e.inventory.catalog(),before);
  const rows=products().map(row=>[...row,'#REF!','Ultima actualización']);
  rows.push([...Array(7).fill(''),'auxiliar','fecha']);
  assert.deepEqual(parseCatalog(rows),parseCatalog(products()));
});
test('tabla generada por FILTER usa exclusivamente resultados evaluados de Sheets',async()=>{
  const e=await fixture(),read=e.sheets.spreadsheets.values.get;
  await e.put("'PAGINA DE STOCK'!A3",[['=FILTER(DATOS!L3:R,DATOS!P3:P>0)']]);
  e.sheets.spreadsheets.values.get=async args=>{
    if(args.range==="'PAGINA DE STOCK'!A3:G"){
      assert.equal(args.valueRenderOption,'UNFORMATTED_VALUE');
      // API mock supplies the spilled, evaluated rows, including empty info/tail.
      return {data:{values:[...products().map(row=>row.slice(0,6)),[],Array(7).fill('')]}};
    }
    assert.ok(!args.range.startsWith('DATOS'));return read(args);
  };
  const c=await e.inventory.catalog();assert.equal(c.available.size,2);
  assert.equal(c.available.get(products()[0][0]).producto,'iPad Air 1');
  assert.equal(c.available.get(products()[0][0]).informacion,'');
});
test('ventas lee B5:W y excluye los encabezados de fila 4',async()=>{
  const e=await fixture(),read=e.sheets.spreadsheets.values.get,calls=[];
  await e.put("'REGISTRO DE VENTAS'!B4:W4",[['FECHA','ID PEDIDO','METODO','GUIA','ESTADO']]);
  e.sheets.spreadsheets.values.get=async args=>{calls.push(args.range);return read(args);};
  assert.deepEqual(await e.inventory.findSale({orderId:'ID PEDIDO'}),[]);
  assert.deepEqual(calls,["'REGISTRO DE VENTAS'!B5:W"]);
});
