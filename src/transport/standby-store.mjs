import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ranges = {duration:[0,5999],characterWidth:[460,1040],travel:[0,180],travelPeriod:[16,60],avatarCycle:[4,16],grid:[4,12],warp:[0,28],bounce:[0,50]};
const enums = {material:['procedural','reference','hybrid'],motion:['standard','energetic','reduced'],tickStyle:['jump','rebuild','quiet'],invertScope:['character','artwork','all'],endMode:['xomk']};
enums.endMode.push('hold');
const bools = new Set(['progress','reduced','weave','protectFace','markers','labels','sourceStamp','milestoneGlitch']);
export function validateStandby(payload) {
  if(payload?.schemaVersion!==1 || payload.design!=='phase-hold' || !payload.config || Array.isArray(payload.config))throw new Error('需要 PHASE / HOLD 配置');
  const config={};
  for(const [key,value] of Object.entries(payload.config)) {
    if(ranges[key]) {
      const [min,max]=ranges[key];
      if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`无效参数 ${key}`);
      if(key==='duration'&&!Number.isInteger(value))throw new Error('时长必须为整数');
      if(key==='grid'&&![4,6,8,12].includes(value))throw new Error('无效网格');
    } else if(enums[key]) {if(!enums[key].includes(value))throw new Error(`无效参数 ${key}`);}
    else if(bools.has(key)){if(typeof value!=='boolean')throw new Error(`无效参数 ${key}`);}
    else throw new Error(`未知参数 ${key}`);
    config[key]=value;
  }
  const duration=payload.duration;
  if(!Number.isInteger(duration)||duration<0||duration>5999)throw new Error('时长须为0–5999秒');
  config.duration=duration;
  const playback=payload.playback || {retime:false,loopMode:'circular'};
  if(typeof playback.retime!=='boolean'||!['pingpong','circular'].includes(playback.loopMode))throw new Error('无效人物播放设置');
  return {schemaVersion:1,design:'phase-hold',duration,config,playback:{retime:playback.retime,loopMode:playback.loopMode}};
}
export function createStandbyStore(file) {
  let state={revision:'',saved:null,restart:null};
  if(fs.existsSync(file)){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));state={...state,...value,saved:validateStandby(value.saved)};}catch{/* Preserve invalid file until an explicit save. */}}
  const clients=new Map();
  const persist=next=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,file);state=next;};
  return {
    read:()=>({...state,clients:[...clients.values()].filter(c=>Date.now()-c.seenAt<5000)}),
    save:payload=>{const saved=validateStandby(payload);persist({...state,saved,revision:randomUUID()});return {ok:true,...state};},
    restart:()=>{if(!state.saved)throw new Error('请先保存画面配置');persist({...state,restart:{id:randomUUID(),duration:state.saved.duration,issuedAt:Date.now()}});return {ok:true,...state};},
    ack:body=>{if(typeof body.clientId!=='string'||body.clientId.length>80)throw new Error('无效客户端');
      for(const [id,c] of clients)if(Date.now()-c.seenAt>10000)clients.delete(id);
      if(clients.size>=100&&!clients.has(body.clientId))throw new Error('输出页面过多');
      clients.set(body.clientId,{clientId:body.clientId,revision:String(body.revision||'').slice(0,80),restartId:String(body.restartId||'').slice(0,80),seenAt:Date.now()});return {ok:true};}
  };
}
