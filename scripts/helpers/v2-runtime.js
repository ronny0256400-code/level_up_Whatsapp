'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memorySheets } = require('../../lib/v2-storage');
const { seedInventory } = require('./inventory-fixture');
const { createIngress } = require('../../lib/v2-ingress');
function runtime(options = {}) {
  const sheets = options.sheets || memorySheets(), sent = [], logs = [], calls = [], routes = {}, timers = [];
  const inventoryReady = options.sheets ? Promise.resolve() : seedInventory(sheets);
  const control = { time: Date.parse('2026-09-16T15:00:00Z'), data: null, failSend: false, audio: 0, tts: 0 };
  const env = { AGENCIES_ROOT:path.join(__dirname,'../fixtures/agencias'),OPENAI_TTS_ENABLED:'false',PRODUCT_MEDIA_ROOT:'/tmp/level-up-empty-test-media', OPENAI_API_KEY:'fixture',VERIFY_TOKEN:'fixture',PHONE_NUMBER_ID:'fixture',WHATSAPP_TOKEN:'fixture',GOOGLE_SERVICE_ACCOUNT_JSON:'{}',STOCK_SPREADSHEET_ID:'stock-fixture',MEMORIA_SPREADSHEET_ID:'memory-fixture',ASESOR_WHATSAPP:'000000000001',WHATSAPP_APP_SECRET:'fixture',MODEL_LOW:'fixture-low',MODEL_NORMAL:'fixture-normal',MODEL_HIGH:'fixture-high', ...options.env };
  const app = { use() {}, get(route,fn) { routes['GET '+route]=fn; },post(route,fn) { routes[route]=fn; },listen(){return{on(){}};} };
  function express(){return app;} express.json=()=>()=>{};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[control.time]));} static now(){return control.time;} }
  const context=vm.createContext({ __dirname:path.join(__dirname,'../..'), FormData, Blob, Buffer, Date:Clock, process:{env}, console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
    setInterval(){return{unref(){}};},
    require(name){
      if(name==='express')return express;
      if(name==='googleapis')return{google:{auth:{GoogleAuth:class{}},sheets:()=>sheets}};
      if(name==='openai')return class{constructor(){this.responses={create:async args=>{calls.push(args);if(options.respond)return options.respond(args);return{output_text:args.text?JSON.stringify(control.data):args.instructions.startsWith('Clasifica únicamente intención')?'NO_SOLICITA':args.instructions.startsWith('Clasifica únicamente retiro')?'AMBIGUO':'Respuesta sintética',usage:{input_tokens:10,output_tokens:3}};}};this.audio={speech:{create:async args=>{control.tts++;if(options.speech)return options.speech(args);return{arrayBuffer:async()=>Buffer.from('synthetic-audio')};}},transcriptions:{create:async args=>{control.audio++;if(options.transcribe)return options.transcribe(args);throw Error('No transcribir');}}};}};
      if(name==='./lib/v2-storage' && options.testModeSharedSheets)return{...require('../../lib/v2-storage'),memorySheets:()=>sheets};
      if(name==='./lib/v2-ingress')return{...require('../../lib/v2-ingress'),createIngress:opts=>createIngress({...opts,now:()=>control.time,delay:(fn,ms)=>{timers.push({fn,ms});return{};}})};
      if(name==='./lib/ycloud-client')return{uploadMedia:async()=>({id:'fixture-media'}),send:async(to,content,{canSend})=>{if(!await canSend(to))return false;if(options.mediaError)throw options.mediaError;sent.push({to,...content,provider:'ycloud'});return{};},enviarMensajeYCloud:async(to,text,{canSend})=>{if(!await canSend(to))return false;if(control.failSend)throw Object.assign(Error('YCloud HTTP 500'),{status:options.failSendStatus||500});if(options.ycloudError && (!options.ycloudErrorTo || options.ycloudErrorTo===to))throw options.ycloudError;sent.push({to,text:{body:text},provider:'ycloud'});return{};}};
      if(name.startsWith('./lib/'))return require('../../'+name.slice(2));
      if(name.startsWith('node:')||['fs','path','os'].includes(name))return require(name);
      throw Error('Dependencia no simulada');
    }, fetch:async(url,args)=>{if(!url.endsWith('/messages')){if(options.fetchMedia)return options.fetchMedia(url,args);throw Error('Red de medios prohibida');}if(control.failSend || options.failSendTo===JSON.parse(args.body).to)return{ok:false,status:options.failSendStatus||500,text:async()=>'{"error":{"code":1}}'};sent.push(JSON.parse(args.body));return{ok:true,text:async()=>'{}'};}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../server.js'),'utf8')+'\nthis.api={procesarMensajeV2,entradaV2,obtenerConversacion,guardarConversacion,revisarSeguimientos,enviarMensajeWhatsApp,confirmarPedidoSiCorresponde,generarResumenPedido,generarIdPedido,contextosPedido,inventarioFinal,obtenerStock,actualizarGuiaPedido};',context);
  let seq=0;
  async function message(text,opts={}) {
    await inventoryReady;
    const msg={id:opts.id||`fixture-${++seq}`,from:opts.from||'000000000002',type:'text',text:{body:text},...opts};
    let status;
    await context.api.procesarMensajeV2({body:{entry:[{changes:[{value:{messages:[msg]}}]}]}},{sendStatus(n){status=n;},status(n){status=n;return this;},json(){}});
    return status;
  }
  return{api:context.api,inventoryReady,env,control,sent,logs,calls,routes,timers,sheets,message,
    seed:(c,n='000000000002')=>context.api.guardarConversacion(n,c),
    load:(n='000000000002')=>context.api.obtenerConversacion(n,true)};
}
module.exports={runtime};
