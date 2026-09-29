import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStandbyStore} from '../src/transport/standby-store.mjs';
import {createHttpServer} from '../src/transport/http-server.mjs';

const payload={schemaVersion:1,design:'phase-hold',duration:120,config:{duration:120,characterWidth:820,grid:4,weave:true},playback:{retime:false,loopMode:'circular'}};
test('configuration persists; save does not restart; restart IDs are unique and survive reload',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standby-'));
 try{
  const file=path.join(root,'state.json');const store=createStandbyStore(file);
  assert.throws(()=>store.restart());const first=store.save(payload);
  assert.equal(first.restart,null);assert.equal(createStandbyStore(file).read().saved.duration,120);
  const a=store.restart();const b=store.restart();assert.notEqual(a.restart.id,b.restart.id);
  store.save({...payload,duration:180});assert.equal(store.read().restart.id,b.restart.id);
  const before=store.read().revision;
  assert.throws(()=>store.save({...payload,config:{grid:5}}));
  assert.equal(store.read().revision,before);
  assert.throws(()=>store.save({...payload,config:{bad:'anything'}}));
  store.ack({clientId:'output',revision:before,restartId:b.restart.id});assert.equal(store.read().clients.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('HTTP routes save, fetch, acknowledge and restart with validated errors',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'standby-http-'));
 const server=createHttpServer({root,host:'127.0.0.1',port:0});
 try{
  await server.start();const base=`http://127.0.0.1:${server.server.address().port}`;
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await post('/api/standby/config',payload)).status,200);
  const saved=await (await fetch(base+'/api/standby/config')).json();assert.equal(saved.saved.duration,120);
  assert.equal((await post('/api/standby/config',{...payload,duration:-1})).status,400);
  assert.equal((await post('/api/standby/ack',{clientId:'test',revision:saved.revision})).status,200);
  assert.equal((await post('/api/standby/restart',{})).status,200);
 }finally{await server.stop();fs.rmSync(root,{recursive:true,force:true});}
});
