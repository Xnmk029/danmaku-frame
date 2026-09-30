(() => {
 'use strict';
 const boot=()=>{if(!window.phaseStudio){setTimeout(boot,50);return;}start();};
 function start(){
 const api=window.phaseStudio,engine=api.engine,q=new URLSearchParams(location.search);
 const production=q.get('view')==='program'&&q.get('preview')!=='true';
 const fixedScene=['A','B','C'].includes(q.get('scene'))?q.get('scene'):engine.config.scene;
 const fixedLayer=['front','back','composite'].includes(q.get('layer'))?q.get('layer'):engine.config.layer;
 const defaults={next:'',model:'',fontSize:20,font:'sans',music:true,focusAlerts:true,heart:true,spectrum:true,chatLimit:4};
 const defaultsFor=s=>({...defaults,chatLimit:{A:4,B:3,C:8}[s]});
 let settings=defaultsFor(fixedScene),room='',revision='',roomRevision='',saved={},socket,reconnect,pollTimer,disposed=false,pending='';
 const drafts={};
 const modelMark=window.PhaseModelMark.install(engine,s=>s===engine.config.scene?settings.model:(drafts[s]?.broadcast.model??saved[s]?.broadcast.model??''));
 let messages=[],music=null,voice=null,heart=null,spectrum=null,status=production?'CONNECTING':'DEMO',popularity=0;
 let lastLayout='',voiceSignature='',clients=[],designTimer=null,voiceStartedAt=0;
 const uid=crypto.randomUUID();
 const $=id=>document.getElementById(id);
 const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const overlay=node('div','frame-live');overlay.id='frameLive';
 const chat=node('section','live-chat'),media=node('section','live-music'),voiceBox=node('section','live-voice'),extra=node('div','live-extra'),heartBox=node('div','live-heart'),spectrumBox=node('div','live-spectrum');
 const hardwareBox=node('section','live-hardware');hardwareBox.setAttribute('aria-label','电脑硬件状态');
 let hardware=null,hardwareTimer,hardwareRequest;
 overlay.append(chat,media,voiceBox,extra,heartBox,spectrumBox,hardwareBox);$('stageHolder').append(overlay);
 const originalTopic=engine.drawTopic.bind(engine);
 engine.drawChat=()=>{};
 const voiceActive=()=>voice&&voice.phase!=='idle'&&Date.now()+(voice.offset||0)<voice.expiresAt+500;
 engine.drawTopic=(ctx,scene,theme)=>{if(!(voiceActive()&&scene!=='C'))originalTopic(ctx,scene,theme);};
 const tracked=(ctx,text,x,y,size,color,spacing)=>{ctx.font=`${size}px Consolas,"Liberation Mono",monospace`;ctx.fillStyle=color;ctx.textAlign='left';for(const ch of text){ctx.fillText(ch,x,y);x+=ctx.measureText(ch).width+spacing;}};
 engine.header=(ctx,s,t)=>{
  tracked(ctx,'FLOAT STUDY',324,43,10,t.muted,1.3);tracked(ctx,'PIXEL OP-ART',324,62,10,t.muted,1.3);tracked(ctx,'SAME SIGNAL.',324,81,10,t.muted,1.3);
  const x=s==='C'?1312:1468;
  tracked(ctx,'PHASE // HOLD',x,s==='C'?128:58,s==='C'?22:15,t.ink,s==='C'?3:2);
  tracked(ctx,production?(status==='LIVE'?'LIVE SIGNAL':'SIGNAL OFFLINE'):'LOCAL PREVIEW / 004',x,s==='C'?163:82,11,t.muted,1.4);
  if(s!=='B')tracked(ctx,'XOMK / '+window.PhaseBroadcast.SCENES[s].name,84,1046,10,t.muted,1.5);
 };
 function box(el,r){Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});}
 function fit(){const r=$('stage').getBoundingClientRect();const scale=Math.min(r.width/1920,r.height/1080);overlay.style.transform=`translate(-50%,-50%) scale(${scale})`;}
 addEventListener('resize',fit);
 function layout(){
  const c=engine.config,s=c.scene,t=engine.theme(s),l=api.getLayout(s);
  overlay.dataset.reduced=String(c.reduced);
  overlay.hidden=c.layer==='back';overlay.style.setProperty('--live-ink',t.ink);overlay.style.setProperty('--live-accent',t.accent);overlay.style.setProperty('--live-muted',t.muted);overlay.style.setProperty('--live-line',t.line);
  box(chat,s==='A'?{x:1468,y:130,w:354,h:282}:s==='B'?{x:1624,y:142,w:234,h:256}:l.chat);chat.dataset.scene=s;chat.style.fontSize=(s==='A'?Math.min(settings.fontSize,20):s==='B'?Math.min(settings.fontSize,17):settings.fontSize)+'px';chat.style.fontFamily=settings.font==='mono'?'Consolas,"Microsoft YaHei",monospace':'"Microsoft YaHei",Arial,sans-serif';
  const v=s==='C'?l.chat:s==='A'?{x:216,y:912,w:1200,h:111}:{x:156,y:1006,w:1436,h:71};
  box(voiceBox,v);voiceBox.dataset.scene=s;
  box(media,s==='C'?{x:1312,y:671,w:490,h:61}:s==='A'?{x:840,y:1005,w:565,h:57}:{x:930,y:1008,w:520,h:53});
  media.dataset.scene=s;
  box(extra,s==='C'?{x:1312,y:971,w:490,h:50}:s==='A'?{x:216,y:1009,w:590,h:52}:{x:1624,y:97,w:234,h:43});
  extra.dataset.scene=s;
  extra.replaceChildren();if(settings.next)extra.append(node('div','live-next',`NEXT / ${settings.next}`));
  box(heartBox,s==='C'?{x:1312,y:31,w:216,h:65}:{x:1112,y:31,w:300,h:65});
  box(hardwareBox,s==='C'?{x:1548,y:31,w:254,h:65}:{x:544,y:31,w:336,h:65});
  box(spectrumBox,s==='C'?{x:1312,y:733,w:490,h:16}:s==='A'?{x:840,y:938,w:565,h:16}:{x:1624,y:404,w:234,h:16});
  extra.hidden=!c.showTopic||!!voiceActive();fit();renderChat();renderMusic();renderVoice(true);renderHeart();renderSpectrum();renderHardware();
  const modelStatus=$('frameModelStatus');if(modelStatus){const mark=modelMark.description(s);modelStatus.textContent=mark.text?`${mark.brand?'图标：'+mark.brand:'图标：通用校准标记'} · 版本：${mark.version}；ID 以独立侧注显示。`:'填写完整模型 ID，将自动匹配图标与版本；例如 Claude Opus 5.5。';}
 }
 function safeImage(url,cls,alt){
  const img=node('img',cls);img.alt=alt||'';img.referrerPolicy='no-referrer';
  try{const u=new URL(url,location.href);if(!['http:','https:','data:'].includes(u.protocol))throw 0;img.src=u.href;}catch{return document.createTextNode(alt||'');}
  img.onerror=()=>img.replaceWith(document.createTextNode(alt||''));return img;
 }
 function richText(el,m){
  if(m.bigEmote){el.append(safeImage(m.bigEmote.url,'live-big','[大表情]'));return;}
  const emots=new Map((m.emots||[]).map(e=>[e.key,e]));const text=String(m.text||'');let at=0;
  for(const match of text.matchAll(/\[[^\]]{1,24}\]/g)){el.append(document.createTextNode(text.slice(at,match.index)));const e=emots.get(match[0]);el.append(e?safeImage(e.url,'live-emoji',e.key):document.createTextNode(match[0]));at=match.index+match[0].length;}
  el.append(document.createTextNode(text.slice(at)));
 }
 function renderChat(){
  const c=engine.config,s=c.scene;chat.replaceChildren();chat.hidden=!c.showChat||(s==='C'&&!!voiceActive());
  const header=node('div','live-chat-head','CHAT');header.append(node('small','',production?`${status}${popularity?' / '+popularity:''}`:'DEMO'));chat.append(header);
  const limit=Math.max(1,Math.min({A:5,B:4,C:10}[s],Number(settings.chatLimit)||defaultsFor(s).chatLimit));
  let rows=messages.filter(m=>s!=='B'||settings.focusAlerts||m.type==='danmaku').slice(-limit);
  if(!rows.length){chat.append(node('span','live-user',s==='B'?'FOCUS MODE':production?'等待消息…':'无聊天样例'));return;}
  for(const m of rows){
   const row=node('div','live-row '+(m.type||'danmaku'));
   if(m.medal)row.append(node('span','live-badge',`${m.medal.name} ${m.medal.lv}`));
   if(m.guard)row.append(node('span','live-badge',({1:'总督',2:'提督',3:'舰长'})[m.guard]||''));
   row.append(node('span','live-user',m.user||m.name||'观众'));richText(row,m);chat.append(row);
  }
  while(chat.scrollHeight>chat.clientHeight&&chat.querySelectorAll('.live-row').length>1)chat.querySelector('.live-row').remove();
 }
 function renderMusic(){
  media.replaceChildren();media.hidden=!settings.music||!music?.song||(!music.playing&&!music.paused)||!!voiceActive();
  if(media.hidden)return;
  if(music.cover){const url=music.cover.kind==='uri'?music.cover.url:'/api/ncm/cover?id='+encodeURIComponent(music.cover.id);media.append(safeImage(url,'live-cover',''));}
  const body=node('div','live-song');body.append(node('div','live-song-title',music.song.name));const meta=node('div','live-song-meta',(music.song.artists||[]).join(' / '));body.append(meta);
  meta.append(node('span','live-time'));const track=node('div','live-track');track.append(node('div','live-fill'));body.append(track);media.append(body);updateProgress();
 }
 function updateProgress(){if(media.hidden||!music)return;const total=Number(music.song.duration)||0;const elapsed=Math.min(total||Infinity,Math.max(0,(music.progress||0)+(music.playing?Date.now()-(music.updatedAt||Date.now()):0)));const fill=media.querySelector('.live-fill');if(fill)fill.style.width=(total?Math.min(100,elapsed/total*100):0)+'%';const fmt=n=>`${Math.floor(n/60000)}:${String(Math.floor(n/1000)%60).padStart(2,'0')}`;const time=media.querySelector('.live-time');if(time)time.textContent=` · ${music.paused?'暂停 · ':''}${fmt(elapsed)} / ${fmt(total)}`;}
 function renderHeart(){
  const fresh=heart?.bpm&&heart?.at&&Date.now()-heart.at<8000;
  heartBox.hidden=!settings.heart||!fresh;
  if(heartBox.hidden)return;
  if(!heartBox.querySelector('strong'))heartBox.replaceChildren(node('span','live-heart-icon'),node('strong','',String(heart.bpm)),node('small','','BPM'));
  if(heartBox.dataset.bpm!==String(heart.bpm)){heartBox.dataset.bpm=String(heart.bpm);heartBox.querySelector('strong').textContent=String(heart.bpm);}
  heartBox.style.setProperty('--beat',`${60/Math.max(25,heart.bpm)}s`);
 }
 function renderSpectrum(){
  const fresh=spectrum?.at&&Date.now()-spectrum.at<2500&&Array.isArray(spectrum.bands);
  spectrumBox.hidden=!settings.spectrum||!fresh;
  if(spectrumBox.hidden){for(const bar of spectrumBox.children)bar.dataset.level='0';return;}
  if(spectrumBox.children.length!==24)spectrumBox.replaceChildren(...Array.from({length:24},()=>node('i','')));
  for(let i=0;i<24;i++){
   const bar=spectrumBox.children[i],source=Math.max(0,Math.min(1,Number(spectrum.bands[i])||0)),previous=Number(bar.dataset.level)||0;
   const level=previous+(source-previous)*(source>previous?.55:.2),step=Math.min(3,Math.round(level*3.5));
   bar.dataset.level=String(level);bar.style.height=`${2+step*3}px`;bar.classList.toggle('is-accent',step>=2&&source>.45&&i%7===2);
  }
 }
 function renderHardware(){
  const fresh=hardware?.ok&&hardware.at>0&&Date.now()-hardware.at>=-5000&&Date.now()-hardware.at<8000;
  hardwareBox.dataset.status=fresh?'connected':'offline';
  if(!hardwareBox.children.length){for(const [key,label]of [['cpu','CPU'],['memory','RAM'],['gpu','GPU']]){
   const item=node('div','live-hardware-item');item.dataset.kind=key;
   const reading=node('div','live-hardware-reading');reading.append(node('strong','','—'),node('small','','%'));
   item.append(node('span','live-hardware-label',label),reading,node('span','live-hardware-temp',key==='memory'?'可用 — GB':'— °C'));hardwareBox.append(item);
  }}
  const valid=(v,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
  for(const item of hardwareBox.children){
   const metric=fresh?hardware[item.dataset.kind]:null,usage=valid(metric?.usage,100)?metric.usage:null,temp=valid(metric?.temperature,150)?metric.temperature:null;
   item.querySelector('strong').textContent=usage===null?'—':String(Math.round(usage));
   const detail=item.querySelector('.live-hardware-temp');
   if(item.dataset.kind==='memory'){
    // Accept the prior sampler schema until the independent process reloads.
    const free=metric?.availableGB??(valid(metric?.totalGiB,65536)&&valid(metric?.usedGiB,65536)&&metric.usedGiB<=metric.totalGiB?(metric.totalGiB-metric.usedGiB)*2**30/1e9:null);
    detail.textContent='可用 '+(valid(free,65536)?free.toFixed(1):'—')+' GB';
   }else detail.textContent=(temp===null?'—':Math.round(temp))+' °C';
   item.style.setProperty('--load',usage===null?'0%':usage+'%');
  }
  const info=$('frameHardwareStatus');if(info){
   const missing=['cpu','gpu'].filter(k=>!valid(hardware?.[k]?.temperature,150)).map(k=>({cpu:'CPU',gpu:'GPU'})[k]);
   info.textContent=fresh?`硬件采集已连接 · ${hardware.gpu?.name||'GPU 暂不可用'}${hardware.memory?.totalGiB?' · 内存 '+hardware.memory.usedGiB+' / '+hardware.memory.totalGiB+' GiB':''}${missing.length?'；'+missing.join('、')+' 温度数据尚未取得，显示 —。':''}`:'硬件采集未连接或数据已过期；请在 LiveControl 启动「硬件状态」。';
  }
 }
 async function pollHardware(){
  if(disposed||production&&fixedLayer==='back')return;
  hardwareRequest=new AbortController();const timeout=setTimeout(()=>hardwareRequest?.abort(),1800);
  try{
   const response=await fetch('http://127.0.0.1:7790/state',{cache:'no-store',signal:hardwareRequest.signal});
   if(!response.ok)throw new Error('hardware offline');
   const data=await response.json();if(!data.ok||typeof data.at!=='number')throw new Error('invalid hardware state');
   if(!disposed)hardware=data;
  }catch{hardware=null;}finally{clearTimeout(timeout);hardwareRequest=null;if(!disposed){renderHardware();hardwareTimer=setTimeout(pollHardware,2000);}}
 }
 function renderVoice(force=false){
  const active=!!voiceActive();
  const signature=JSON.stringify([active,voice?.id,voice?.phase,voice?.selected,voice?.message,voice?.items,engine.config.scene]);
  if(!force&&signature===voiceSignature)return;voiceSignature=signature;voiceBox.replaceChildren();
  if(!active){voiceBox.classList.remove('voice-in');voiceBox.classList.add('voice-out');clearTimeout(renderVoice.exitTimer);renderVoice.exitTimer=setTimeout(()=>{if(!voiceActive())voiceBox.hidden=true;},320);return;}
  clearTimeout(renderVoice.exitTimer);voiceBox.hidden=false;voiceBox.classList.remove('voice-out');void voiceBox.offsetWidth;voiceBox.classList.add('voice-in');
  voiceBox.append(node('div','live-voice-heading',`${voice.user||'观众'} / ${voice.phase==='searching'?'正在设计音色…':voice.message||voice.query||'音色选择'}`));
  const options=node('div','live-options');
  for(const [i,item]of (voice.items||[]).slice(0,3).entries()){
   const option=node('div','live-option'+(voice.phase==='success'?(voice.selected===i+1?' chosen':' dim'):''));option.append(node('strong','',`${['一','二','三'][i]} / ${item.title}`),node('small','',item.author||''));options.append(option);
  }
  voiceBox.append(options);const foot=node('div','live-voice-foot',voice.phase==='candidates'?'弹幕发送「选择音色 一 / 二 / 三」':voice.phase==='success'?'音色已保存':'稍后恢复直播信息');foot.append(node('span','voice-time'));voiceBox.append(foot);
 }
 function receive(data){
  if(data.type==='status'){status=data.connected?'LIVE':'OFFLINE';renderChat();}
  if(data.type==='popularity'){popularity=Number(data.value)>10000?(Number(data.value)/10000).toFixed(1)+'万':data.value;renderChat();}
  if(['danmaku','gift','sc'].includes(data.type)){messages.push({...data,arrivedAt:Date.now()});messages=messages.slice(-50);renderChat();}
  if(data.type==='ncm.playback'){music=data.song?data:null;renderMusic();}
  if(data.type==='ncm.offline'){music=null;renderMusic();}
  if(data.type==='voice.selection'){voice={...data,offset:(data.serverNow||Date.now())-Date.now()};layout();}
  if(data.type==='voice.design'){
   const applyDesign=()=>{voice={...data,offset:(data.serverNow||Date.now())-Date.now()};layout();};
   clearTimeout(designTimer);
   if(data.phase==='searching'){voiceStartedAt=Date.now();applyDesign();}
   else if(voice?.id===data.id&&voice.phase==='searching'&&Date.now()-voiceStartedAt<320)designTimer=setTimeout(applyDesign,320-(Date.now()-voiceStartedAt));
   else applyDesign();
  }
  if(data.type==='heart.rate'){heart={...data};renderHeart();}
  if(data.type==='heart.status'&&data.status!=='connected'){heart=null;renderHeart();}
  if(data.type==='audio.spectrum'){spectrum=data;renderSpectrum();}
  if(data.type==='audio.status'&&data.status!=='connected'){spectrum=null;renderSpectrum();}
 }
 function connect(){
  if(disposed||!production||fixedLayer==='back')return;
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:7789`);
  socket.onopen=()=>{socket.send(JSON.stringify({action:'subscribe',roomId:room||undefined}));socket.send(JSON.stringify({action:'ncm.subscribe'}));};
  socket.onmessage=e=>{try{receive(JSON.parse(e.data));}catch{}};
  socket.onclose=()=>{status='OFFLINE';renderChat();if(!disposed)reconnect=setTimeout(connect,3000);};socket.onerror=()=>socket.close();
 }
 const request=async(url,body,timeoutMs=5000)=>{
  let r;
  try{r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});}
  catch(e){throw new Error(e.name==='TimeoutError'?'本机服务响应超时，请重试。':'无法连接本机服务，请确认直播服务正在运行。');}
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok){if(r.status===404&&url.startsWith('/api/telemetry/'))throw new Error('本机采集接口尚未加载，请在直播结束后重启服务。');throw new Error(d.error||`配置服务请求失败 (${r.status})`);}
  return d;
 };
 let info;
 function apply(entry){if(!entry)return;const layer=engine.config.layer;engine.setConfig({...entry.config,scene:entry.scene,layer,sync:false,...(production?{showCharacter:false,guides:false}:{})});settings={...defaultsFor(entry.scene),...entry.broadcast};revision=entry.revision;layout();if(!production)fillFields();}
 function fillFields(){if(!$('frameRoom'))return;for(const k of ['next','model','fontSize','font','chatLimit'])$('frame_'+k).value=settings[k];for(const k of ['music','focusAlerts','heart','spectrum'])$('frame_'+k).checked=settings[k];$('frameRoom').value=room;for(const [k,v]of Object.entries(engine.config)){const el=$(k);if(el&&document.activeElement!==el){if(el.type==='checkbox')el.checked=v;else if('value'in el)el.value=v;}}}
 async function poll(){try{
  const d=await request('/api/frame/config');saved=d.layouts;clients=d.clients;
  if(production){const entry=saved[fixedScene];if(entry&&entry.revision!==revision)apply(entry);if(d.roomRevision!==roomRevision){room=d.room;roomRevision=d.roomRevision;if(socket?.readyState===1)socket.send(JSON.stringify({action:'subscribe',roomId:room||undefined}));}room=d.room;if(!socket)connect();await request('/api/frame/ack',{clientId:uid,scene:fixedScene,layer:fixedLayer,revision});}
  else if(!poll.initial){room=d.room;apply(saved[engine.config.scene]);fillFields();poll.initial=true;info.textContent='配置服务已连接；编辑仅影响本地预览。';}
  if(!production&&pending){const layers=new Set(clients.filter(c=>c.scene===engine.config.scene&&c.revision===pending).map(c=>c.layer));const complete=layers.has('composite')||(layers.has('front')&&layers.has('back'));info.textContent=layers.size?'输出已确认：'+[...layers].join('、')+(complete?'':'；等待其他分层输出。'):'已保存，等待该布局的输出页确认。';if(complete)pending='';}
 }catch(e){if(info)info.textContent=e.message;}finally{if(!disposed)pollTimer=setTimeout(poll,1000);}}
 if(!production){
  const control=node('section','control frame-control');control.innerHTML='<h2>直播接入 <small>LIVE DATA</small></h2><label class="field">直播间（所有布局共用）<input id="frameRoom" placeholder="留空使用后台默认房间"></label><label class="field">下一项<input id="frame_next" maxlength="80"></label><label class="field">当前模型<input id="frame_model" maxlength="80"></label><label class="field">弹幕字号<input id="frame_fontSize" type="number" min="14" max="30" value="20"></label><label class="select">弹幕字体<select id="frame_font"><option value="sans">无衬线</option><option value="mono">等宽</option></select></label><label class="check">歌曲信息<input id="frame_music" type="checkbox" checked></label><label class="check">专注布局临时提示<input id="frame_focusAlerts" type="checkbox" checked></label><button class="wide" id="framePublish">保存并应用当前布局</button><div class="button-pair"><button id="frameBack">复制后景地址</button><button id="frameFront">复制前景地址</button></div><div class="button-pair"><button id="frameTest">测试富弹幕</button><button id="frameVoice">测试音色选择</button><button id="frameClear">清空预览消息</button></div><p class="hint" id="frameStatus">正在连接配置服务…</p><p class="hint">测试仅在本页。每个布局分别保存；房间配置全局共用。自定义图片/视频不随配置上传。PNG/WebM仅导出Canvas视觉层，完整画面使用OBS录制。</p>';
  document.querySelector('.controls').prepend(control);info=$('frameStatus');
  $('frame_model').parentElement.firstChild.textContent='今日测试模型 ID';$('frame_model').placeholder='例如 Claude Opus 5.5 / Qwen3.2';
  const modelStatus=node('p','hint');modelStatus.id='frameModelStatus';$('frame_model').parentElement.after(modelStatus);
  control.insertAdjacentHTML('beforeend','<label class="field">弹幕条数<input id="frame_chatLimit" type="number" min="1" max="10" value="4"></label><label class="check">心率显示<input id="frame_heart" type="checkbox" checked></label><label class="check">桌面音频频谱<input id="frame_spectrum" type="checkbox" checked></label><h3>本机采集</h3><label class="field">佳明心率设备名称或地址<input id="frameDevice" value="instinct" placeholder="instinct apac"></label><div class="button-pair"><button id="frameScan">扫描蓝牙设备</button><button id="frameTelemetrySave">保存采集设置</button></div><label class="check">启用手表心率接收<input id="frameHeartCapture" type="checkbox"></label><label class="check">启用桌面音频采集<input id="frameAudioCapture" type="checkbox" checked></label><p class="hint" id="frameTelemetryStatus">采集服务待连接</p><button id="frameSignalTest">测试心率与频谱（仅预览）</button>');
  control.insertAdjacentHTML('beforeend','<h3>电脑硬件状态</h3><p class="hint" id="frameHardwareStatus">正在连接硬件采集…</p><p class="hint">每 2 秒更新一次；GPU 为 NVIDIA 独立显卡，RAM 下方为系统可用物理内存（GB）。CPU 温度需要本机传感器来源，未提供时显示 —。</p>');
  const devicePicker=node('label','select','扫描结果'),deviceList=node('select','');deviceList.id='frameDeviceList';devicePicker.append(deviceList);devicePicker.hidden=true;$('frameScan').closest('.button-pair').after(devicePicker);
  control.insertAdjacentHTML('beforeend','<p class="hint">心形图标：<a href="https://pixeliconlibrary.com/" target="_blank" rel="noopener noreferrer">Pixel Icon Library</a> by HackerNoon · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>；图标轮廓未修改，配色与心跳动效由本项目实现。</p>');
  fillFields();
  for(const k of ['next','model','fontSize','font','music','focusAlerts','heart','spectrum','chatLimit'])$('frame_'+k).onchange=()=>{const el=$('frame_'+k);settings[k]=el.type==='checkbox'?el.checked:k==='fontSize'?Math.max(14,Math.min(30,Number(el.value)||20)):k==='chatLimit'?Math.max(1,Math.min({A:5,B:4,C:10}[engine.config.scene],Number(el.value)||defaultsFor(engine.config.scene).chatLimit)):el.value;layout();};
  const telemetryStatus=$('frameTelemetryStatus');
  let telemetryInitialized=false,telemetryBusy=false;
  const statusName={disabled:'未启用',scanning:'正在搜索',not_found:'未发现设备',connected:'已连接',disconnected:'已断开',stale:'数据中断',error:'出错',device_changed:'设备已切换'};
  const updateTelemetry=async()=>{if(telemetryBusy)return;try{const d=await request('/api/telemetry/state');if(!telemetryInitialized){$('frameDevice').value=d.config.device;$('frameHeartCapture').checked=d.config.heartEnabled;$('frameAudioCapture').checked=d.config.audioEnabled;telemetryInitialized=true;}telemetryStatus.textContent=`心率 ${statusName[d.heart.status]||d.heart.status}${d.heart.bpm?' / '+d.heart.bpm+' BPM':''}${d.heart.message?' / '+d.heart.message:''} · 音频 ${statusName[d.audio.status]||d.audio.status}${d.audio.name?' / '+d.audio.name:''}${d.audio.message?' / '+d.audio.message:''}`;}catch(e){telemetryStatus.textContent=e.message;}};
  updateTelemetry();
  const telemetryStatusTimer=setInterval(updateTelemetry,5000);addEventListener('pagehide',()=>clearInterval(telemetryStatusTimer),{once:true});
  $('frameScan').onclick=async()=>{const button=$('frameScan');telemetryBusy=true;button.disabled=true;devicePicker.hidden=true;telemetryStatus.textContent='正在扫描蓝牙设备，请先开启手表心率广播…';try{
   const d=await request('/api/telemetry/scan',{},20000),devices=d.devices||[];deviceList.replaceChildren();
   for(const device of devices){const option=node('option','',`${device.name||'未命名'}${device.heartService?' / HR':''} · ${device.address}`);option.value=device.name||device.address;deviceList.append(option);}
   if(devices.length){const candidate=devices.find(x=>/instinct/i.test(x.name)&&x.heartService)||devices.find(x=>/instinct/i.test(x.name))||devices.find(x=>x.heartService)||devices[0];deviceList.value=candidate.name||candidate.address;$('frameDevice').value=deviceList.value;devicePicker.hidden=false;telemetryStatus.textContent=`发现 ${devices.length} 台设备，已选 ${candidate.name||candidate.address}；保存采集设置以连接。`;}
   else telemetryStatus.textContent='未发现设备；请确认手表正在广播心率，并靠近电脑后重试。';
  }catch(e){telemetryStatus.textContent=e.message;}finally{button.disabled=false;telemetryBusy=false;}};
  deviceList.onchange=()=>{$('frameDevice').value=deviceList.value;};
  $('frameTelemetrySave').onclick=async()=>{try{const d=await request('/api/telemetry/config',{device:$('frameDevice').value.trim(),heartEnabled:$('frameHeartCapture').checked,audioEnabled:$('frameAudioCapture').checked});telemetryStatus.textContent=`已保存；心率 ${d.heart.status} · 音频 ${d.audio.status}`;}catch(e){telemetryStatus.textContent=e.message;}};
  $('frameSignalTest').onclick=()=>{receive({type:'heart.rate',bpm:78,at:Date.now()});receive({type:'audio.spectrum',bands:Array.from({length:24},(_,i)=>.14+.5*Math.pow(Math.sin(i*.55),2)),at:Date.now()});};
  $('framePublish').onclick=async()=>{const button=$('framePublish');button.disabled=true;try{room=$('frameRoom').value.trim();const result=await request('/api/frame/config',{scene:engine.config.scene,config:engine.config,broadcast:settings,room});revision=result.revision;pending=result.revision;drafts[engine.config.scene]={config:{...engine.config},broadcast:{...settings}};info.textContent='已保存，等待输出确认…';}catch(e){info.textContent=e.message;}finally{button.disabled=false;}};
  const outputURL=layer=>{const url=new URL('/phase-frame.html',location.href);url.search=new URLSearchParams({view:'program',scene:engine.config.scene,layer,clock:'wall'}).toString();return url.href;};
  for(const [id,layer]of [['frameBack','back'],['frameFront','front'],['copyBack','back'],['copyFront','front']])$(id).onclick=async()=>{try{await navigator.clipboard.writeText(outputURL(layer));info.textContent='已复制 '+layer+' 地址；OBS尺寸设为1920×1080。';}catch{info.textContent=outputURL(layer);}};
  $('frameClear').onclick=()=>{messages=[];voice=null;layout();};
  $('frameTest').onclick=()=>{for(const m of [{user:'鲸友',text:'粉丝牌与舰长消息',medal:{name:'奶鲸',lv:20},guard:3,type:'danmaku'},{user:'观众',text:'赠送礼物 × 3',type:'gift'},{user:'支持者',text:'SC / 支持今天的创作',type:'sc'}])receive(m);};
  $('frameVoice').onclick=()=>receive({type:'voice.selection',id:Date.now(),phase:'candidates',user:'测试观众',query:'温柔声线',items:[{title:'音色候选一',author:'创作者 A'},{title:'音色候选二',author:'创作者 B'},{title:'音色候选三',author:'创作者 C'}],startsAt:Date.now(),expiresAt:Date.now()+20000,serverNow:Date.now()});
  const originalSetChat=engine.setChat.bind(engine);engine.setChat=(data,options)=>{const r=originalSetChat(data,options);messages=r.map(m=>({...m,user:m.name,type:'danmaku'}));renderChat();return r;};
  messages=engine.chat.map(m=>({...m,user:m.name,type:'danmaku'}));
  const setScene=engine.setScene.bind(engine);engine.setScene=(s,o)=>{drafts[engine.config.scene]={config:{...engine.config},broadcast:{...settings}};const result=setScene(s,o);const entry=drafts[s]||saved[s];if(entry)apply({...entry,scene:s});else settings=defaultsFor(s);layout();fillFields();return result;};
  $('pngButton').title='仅导出Canvas视觉，不含富弹幕和音色组件';$('recordButton').title='仅录制Canvas视觉，完整画面请使用OBS';
 }
 const interval=setInterval(()=>{
  const signature=JSON.stringify([engine.config,settings,!!voiceActive()]);if(signature!==lastLayout){lastLayout=signature;layout();}
  renderVoice();const time=voiceBox.querySelector('.voice-time');if(time&&voice)time.textContent=Math.max(0,Math.ceil((voice.expiresAt-Date.now()-(voice.offset||0))/1000))+'s';updateProgress();renderHeart();renderSpectrum();
 },200);
 if(production){engine.setConfig({scene:fixedScene,layer:fixedLayer,showCharacter:false,guides:false,sync:false});$('exitProgram').hidden=true;}
 // Never accept BroadcastChannel sync for production; backend revisions are authoritative.
 if(production)$('sync').checked=false;
 layout();poll();pollHardware();
 window.phaseFrame={receive,clear:()=>{messages=[];layout();},getState:()=>({settings:{...settings},room,revision,status,messageCount:messages.length,modelMark:modelMark.description(engine.config.scene)})};
 addEventListener('pagehide',()=>{disposed=true;clearTimeout(reconnect);clearTimeout(pollTimer);clearTimeout(designTimer);clearTimeout(renderVoice.exitTimer);clearTimeout(hardwareTimer);hardwareRequest?.abort();clearInterval(interval);socket?.close();},{once:true});
 }
 boot();
})();
