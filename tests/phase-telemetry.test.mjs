import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PhaseTelemetry} from '../src/transport/phase-telemetry.mjs';
import {createHttpServer} from '../src/transport/http-server.mjs';
import {createApplication} from '../src/app.mjs';

test('telemetry config persists and rejects invalid values; only valid samples publish',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase-telemetry-'));
 try{
  const service=new PhaseTelemetry({root});let events=0;service.on('event',()=>events++);
  assert.equal(service.configure({heartEnabled:true,device:'Instinct apac',audioEnabled:false}).config.device,'Instinct apac');
  assert.equal(new PhaseTelemetry({root}).read().config.heartEnabled,true);
  assert.throws(()=>service.configure({device:''}));assert.throws(()=>service.configure({audioEnabled:'yes'}));
  service.update({type:'heart.rate',bpm:72,at:Date.now()});
  service.update({type:'heart.rate',bpm:999,at:Date.now()});
  service.update({type:'audio.spectrum',bands:Array(24).fill(.2),at:Date.now()});
  service.update({type:'audio.spectrum',bands:[2],at:Date.now()});
  assert.equal(events,2);assert.equal(service.read().heart.bpm,72);assert.equal(service.read().spectrum.bands.length,24);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('telemetry HTTP status and configuration API',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase-telemetry-http-'));
 const telemetry=new PhaseTelemetry({root});const http=createHttpServer({root,host:'127.0.0.1',port:0,telemetry});
 try{await http.start();const base=`http://127.0.0.1:${http.server.address().port}`;
  const post=b=>fetch(base+'/api/telemetry/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await post({device:'Instinct apac',heartEnabled:true})).status,200);
  assert.equal((await(await fetch(base+'/api/telemetry/state')).json()).config.heartEnabled,true);
  assert.equal((await post({device:''})).status,400);
 }finally{telemetry.stop();await http.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('application wires its telemetry service into HTTP status and scan routes',async()=>{
 const app=createApplication({...process.env,PORT:'0',NCM_ENABLED:'false'});
 app.telemetry.scan=async()=>({ok:true,devices:[{name:'Instinct apac',address:'test-device',heartService:true}]});
 app.telemetry.configure=body=>({ok:true,config:body,heart:{status:'disabled'},audio:{status:'disabled'}});
 try{await app.http.start();const base=`http://127.0.0.1:${app.http.server.address().port}`;
  const state=await fetch(base+'/api/telemetry/state');
  assert.equal(state.status,200);assert.equal((await state.json()).ok,true);
  const scan=await fetch(base+'/api/telemetry/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(scan.status,200);assert.equal((await scan.json()).devices[0].name,'Instinct apac');
  const config=await fetch(base+'/api/telemetry/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:'Instinct apac',heartEnabled:true})});
  assert.equal(config.status,200);assert.equal((await config.json()).config.device,'Instinct apac');
 }finally{await app.http.stop();}
});
