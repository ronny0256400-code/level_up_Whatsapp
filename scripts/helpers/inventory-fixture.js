'use strict';
const { memorySheets } = require('../../lib/v2-storage');
const HEADERS = ['ID-PRODUCTO','PRODUCTO','CAPACIDAD','COLOR','STOCK','PRECIO','INFORMACION DEL PRODUCTO'];
const PRODUCTS = [
  ['EQUIPO','Equipo de prueba','32 GB','plateado',20,100,'Equipo de prueba'],
  ['IPADAIR1-32-PLA','iPad Air 1','32 GB','plateado',20,100,'Para lectura; incluye cable'],
  ['A','A','N/A','blanco',20,50,'Producto A'],['B','B','N/A','negro',20,75,'Producto B']
];
function seedInventory(sheets, products = PRODUCTS) {
  // memorySheets applies updates synchronously and returns fulfilled promises.
  const updates = [
    sheets.spreadsheets.values.update({range:'DATOS!L2:R',requestBody:{values:products}}),
    sheets.spreadsheets.values.update({range:"'PAGINA DE STOCK'!A2:G",requestBody:{values:[HEADERS,...products,...Array.from({length:Math.max(0,100-products.length)},()=>Array(7).fill(''))]}}),
    sheets.spreadsheets.values.update({range:"'REGISTRO DE VENTAS'!A5:W24",requestBody:{values:Array.from({length:20},(_,i)=>Array.from({length:23},(_,col)=>[15,16,17,19,20,22].includes(col)?`=FORMULA_${col}(${i+5})`:''))}})
  ];
  return Promise.all(updates);
}
function inventoryFixture() { const sheets=memorySheets();const ready=seedInventory(sheets);return {sheets,ready}; }
module.exports={HEADERS,PRODUCTS,seedInventory,inventoryFixture};
