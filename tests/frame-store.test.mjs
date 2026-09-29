import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createFrameStore,validateFrame} from '../src/transport/frame-store.mjs';
import {createHttpServer} from '../src/transport/http-server.mjs';
const payload={scene:'A',config:{theme:'auto',warp:14,showChat:true,topic:'测试'},broadcast:{next:'下一项',model:'模型',fontSize:20,font:'sans',music:true,focusAlerts:true},room:'123'};
test('legacy layouts gain density and signal defaults; scene bounds reject overflow',()=>{
 assert.equal(validateFrame(payload).broadcast.chatLimit,4);
 assert.equal(validateFrame({...payload,scene:'B'}).broadcast.chatLimit,3);
 assert.equal(validateFrame({...payload,scene:'C'}).broadcast.chatLimit,8);
 assert.throws(()=>validateFrame({...payload,scene:'B',broadcast:{...payload.broadcast,chatLimit:8}}));
 assert.equal(validateFrame({...payload,broadcast:{...payload.broadcast,heart:false,spectrum:false,chatLimit:5}}).broadcast.heart,false);
});
test('frame scenes persist independently, room is shared, invalid saves preserve state',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frame-'));
 try{const file=path.join(root,'state.json'),s=createFrameStore(file);const a=s.save(payload);s.save({...payload,scene:'B',room:'456'});assert.equal(s.read().layouts.A.revision,a.revision);assert.equal(s.read().room,'456');assert.equal(createFrameStore(file).read().layouts.B.scene,'B');assert.throws(()=>s.save({...payload,config:{warp:99}}));assert.equal(s.read().layouts.A.revision,a.revision);s.ack({clientId:'front',scene:'A',layer:'front',revision:a.revision});assert.equal(s.read().clients[0].revision,a.revision);assert.throws(()=>s.ack({clientId:'bad',scene:'Z',layer:'front'}));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('frame HTTP config and acknowledgement routes validate inputs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frame-http-')),s=createHttpServer({root,host:'127.0.0.1',port:0});
 try{await s.start();const base=`http://127.0.0.1:${s.server.address().port}`;const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal((await post('/api/frame/config',payload)).status,200);const d=await(await fetch(base+'/api/frame/config')).json();assert.equal(d.layouts.A.config.topic,'测试');assert.equal((await post('/api/frame/config',{...payload,room:'bad'})).status,400);assert.equal((await post('/api/frame/ack',{clientId:'test',scene:'A',layer:'back',revision:d.layouts.A.revision})).status,200);}finally{await s.stop();fs.rmSync(root,{recursive:true,force:true});}
});
