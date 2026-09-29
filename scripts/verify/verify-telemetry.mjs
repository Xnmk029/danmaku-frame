import assert from 'node:assert/strict';
import {PhaseTelemetry} from '../../src/transport/phase-telemetry.mjs';
import {createHttpServer} from '../../src/transport/http-server.mjs';
const root=process.cwd(),telemetry=new PhaseTelemetry({root});
telemetry.configure({device:'Instinct apac',heartEnabled:true,audioEnabled:true});
const http=createHttpServer({root,host:'127.0.0.1',port:0,telemetry});
try {
 await http.start();const base=`http://127.0.0.1:${http.server.address().port}`;
 const state=await(await fetch(base+'/api/telemetry/state')).json();assert.equal(state.config.device,'Instinct apac');
 const seen=new Set();const values={};telemetry.on('event',e=>{if(['heart.rate','audio.spectrum'].includes(e.type)){seen.add(e.type);values[e.type]=e.type==='heart.rate'?e.bpm:e.bands.length;}});
 telemetry.start();
 const end=Date.now()+45000;while(Date.now()<end&&seen.size<2)await new Promise(r=>setTimeout(r,250));
 assert.deepEqual([...seen].sort(),['audio.spectrum','heart.rate']);
 console.log('PASS: HTTP state, real Garmin BLE BPM, default desktop loopback spectrum',values);
} finally {telemetry.stop();await http.stop();}
