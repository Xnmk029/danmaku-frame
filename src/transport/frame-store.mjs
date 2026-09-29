import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const choices={theme:['auto','light','negative'],material:['hybrid','procedural','reference'],grid:[4,6,8,12],cycle:[8,12,16,24],fit:['contain','cover']};
const ranges={warp:[0,28],op:[.1,.6],avatarScale:[.8,1.15]};
const flags=new Set(['markers','scars','reduced','weave','showCharacter','negativeCharacter','guides','showChat','showTopic','sync']);
export function validateFrame(body){
 if(!['A','B','C'].includes(body?.scene))throw new Error('无效布局');
 if(!body.config||typeof body.config!=='object'||Array.isArray(body.config))throw new Error('无效画面配置');
 const config={};
 for(const [k,v] of Object.entries(body.config)){
  if(['scene','layer'].includes(k))continue;
  if(choices[k]){if(!choices[k].includes(v))throw new Error(`无效 ${k}`);}
  else if(ranges[k]){if(typeof v!=='number'||!Number.isFinite(v)||v<ranges[k][0]||v>ranges[k][1])throw new Error(`无效 ${k}`);}
  else if(flags.has(k)){if(typeof v!=='boolean')throw new Error(`无效 ${k}`);}
  else if(['topic','subtitle'].includes(k)){if(typeof v!=='string'||v.length>(k==='topic'?45:72))throw new Error(`无效 ${k}`);}
  else throw new Error(`未知配置 ${k}`);
  config[k]=v;
 }
 const b=body.broadcast||{};
 const broadcast={};
 for(const k of ['next','model']){if(typeof (b[k]??'')!=='string'||(b[k]||'').length>80)throw new Error('文案过长');broadcast[k]=b[k]||'';}
 if(!Number.isInteger(b.fontSize)||b.fontSize<14||b.fontSize>30)throw new Error('字号须为14–30');
 if(!['sans','mono'].includes(b.font))throw new Error('无效字体');
 for(const k of ['music','focusAlerts'])if(typeof b[k]!=='boolean')throw new Error(`无效 ${k}`);
 for(const k of ['heart','spectrum'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw new Error(`无效 ${k}`);
 const limits={A:[1,5,4],B:[1,4,3],C:[1,10,8]};
 const [minimum,maximum,fallback]=limits[body.scene];
 if(b.chatLimit!==undefined&&(!Number.isInteger(b.chatLimit)||b.chatLimit<minimum||b.chatLimit>maximum))throw new Error(`弹幕条数须为${minimum}–${maximum}`);
 Object.assign(broadcast,{fontSize:b.fontSize,font:b.font,music:b.music,focusAlerts:b.focusAlerts,
  heart:b.heart??true,spectrum:b.spectrum??true,chatLimit:b.chatLimit??fallback});
 const room=String(body.room||'').trim();if(room&&!/^\d{1,16}$/.test(room))throw new Error('直播间须为数字');
 return {scene:body.scene,config,broadcast,room};
}
export function createFrameStore(file){
 let layouts={},room='',roomRevision='';const clients=new Map();
 try{const data=JSON.parse(fs.readFileSync(file,'utf8'));for(const [key,item]of Object.entries(data.layouts||{})){const clean=validateFrame({...item,room:data.room||''});layouts[key]={...clean,revision:item.revision};}room=data.room||'';roomRevision=data.roomRevision||'';}catch{}
 return {
  read:()=>({ok:true,layouts,room,roomRevision,clients:[...clients.values()].filter(c=>Date.now()-c.at<5000)}),
  save:body=>{const clean=validateFrame(body);const entry={...clean,revision:randomUUID()};const next={...layouts,[clean.scene]:entry};const rr=room!==clean.room?randomUUID():roomRevision;
   fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({layouts:next,room:clean.room,roomRevision:rr},null,2));fs.renameSync(file+'.tmp',file);
   layouts=next;room=clean.room;roomRevision=rr;return {ok:true,...entry};},
  ack:body=>{if(typeof body.clientId!=='string'||body.clientId.length>80||!['A','B','C'].includes(body.scene)||!['front','back','composite'].includes(body.layer))throw new Error('无效输出标识');
   for(const [k,v]of clients)if(Date.now()-v.at>10000)clients.delete(k);
   if(clients.size>=100&&!clients.has(body.clientId))throw new Error('输出过多');
   clients.set(body.clientId,{clientId:body.clientId,scene:body.scene,layer:body.layer,revision:String(body.revision||'').slice(0,80),at:Date.now()});return {ok:true};}
 };
}
