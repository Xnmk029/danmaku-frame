/* Data/control adapter. The reference canvas compositor owns all visual design. */
(() => {
  'use strict';
  async function attach() {
    const api = window.phaseLive;
    if (!api || api.integration) return;
    const q = new URLSearchParams(location.search);
    const preview = q.get('preview') === 'true';
    const editor = q.get('editor') === '1';
    const clockMode = q.get('mode') === 'clock';
    const model = { status: preview ? 'PREVIEW' : 'CONNECTING', chat: [], music: null, switchState: '', preview };
    api.integration = model;
    let socket, reconnect, disposed = false, switched = false, lastElapsed = 0;
    let audio = null;
    const scene = api.scene;
    const clientId = crypto.randomUUID();
    let revision = '', restartId = '', initialized = false, pollTimer;
    let pendingRevision = '', pendingRestart = '';
    let statusLine, saveButton, restartButton;
    const request = async (url, body) => {
      const response = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(5000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
      const data = await response.json().catch(()=>({}));
      if(!response.ok || data.ok!==true)throw new Error(data.error || '配置服务未就绪，请更新并重启弹幕姬服务');
      return data;
    };
    if(editor) {
      const section=document.createElement('section');section.className='control';
      section.innerHTML='<h3>应用到 OBS <small>08 / LIVE OUTPUT</small></h3><button class="full primary" id="standbyPublish">保存并应用到 OBS</button><button class="full slim" id="standbyRestart">重新开始倒计时</button><button class="full slim" id="standbyCopyOutput">复制 OBS 页面地址</button><p class="hint" id="standbyPublishStatus" role="status">正在读取已保存配置…</p><p class="hint">保存只更新画面，保留输出页倒计时进度。新时长在重新开始时生效。OBS 浏览器源需使用本服务的 standby.html，不能带 editor 或 preview 参数。此操作不添加或切换 OBS 场景。</p>';
      document.querySelector('.panel').prepend(section);
      const mediaNote=document.createElement('p');mediaNote.className='hint';mediaNote.textContent='保存包含画面参数与人物播放方式；临时导入的动画文件不会上传，OBS 继续使用已部署的人物素材。';section.append(mediaNote);
      statusLine=document.getElementById('standbyPublishStatus');saveButton=document.getElementById('standbyPublish');restartButton=document.getElementById('standbyRestart');
      saveButton.disabled=restartButton.disabled=true;
      saveButton.onclick=async()=>{
        saveButton.disabled=true;
        try {
          const payload={...api.getConfig(),playback:{retime:scene.character.retime,loopMode:scene.character.loopMode}};
          const result=await request('/api/standby/config',payload);
          revision=result.revision;pendingRevision=result.revision;
          statusLine.textContent='已保存，等待输出页面接收…';
        } catch(error){statusLine.textContent=error.message;}
        finally{saveButton.disabled=false;}
      };
      restartButton.onclick=async()=>{
        restartButton.disabled=true;
        try {const result=await request('/api/standby/restart',{});pendingRestart=result.restart.id;statusLine.textContent='重启指令已发送，等待输出页面确认…';}
        catch(error){statusLine.textContent=error.message;}
        finally{restartButton.disabled=false;}
      };
      document.getElementById('standbyCopyOutput').onclick=async()=>{
        const url=new URL('/standby.html',location.href);
        for(const key of ['obsScene','room','bgm','autoSwitch'])if(q.has(key))url.searchParams.set(key,q.get(key));
        try{await navigator.clipboard.writeText(url.href);statusLine.textContent='已复制 OBS 浏览器源地址';}
        catch{statusLine.textContent=url.href;}
      };
    }
    async function syncConfig() {
      try {
        const data=await request('/api/standby/config');
        if(data.saved && data.revision!==revision && (!editor || !initialized)) {
          const {duration,...appearance}=data.saved.config;
          if(clockMode){appearance.endMode='hold';appearance.progress=false;}
          if(editor)api.setConfig({...appearance,duration:data.saved.duration});
          else {
            scene.setConfig(appearance);
            if(!initialized && !q.has('duration'))api.setDuration(data.saved.duration);
          }
          scene.character.retime=data.saved.playback.retime;scene.character.loopMode=data.saved.playback.loopMode;
          if(editor){document.getElementById('repair').checked=scene.character.retime;document.getElementById('loopMode').value=scene.character.loopMode;}
          revision=data.revision;
        }
        const incomingRestart=data.restart?.id || '';
        // First connection adopts the current command ID: old commands never replay on reload.
        if(initialized && !editor && !preview && incomingRestart && incomingRestart!==restartId && !clockMode) {
          api.setDuration(data.restart.duration,{autostart:true});switched=false;model.switchState='';lastElapsed=0;
        }
        restartId=incomingRestart;
        if(editor) {
          if(!initialized)statusLine.textContent=data.saved?'已读取保存的画面参数':'尚未保存，调整后点击“保存并应用到 OBS”';
          saveButton.disabled=false;restartButton.disabled=!data.saved;
          if(pendingRevision){const received=data.clients.filter(c=>c.revision===pendingRevision).length;statusLine.textContent=received?`已保存并应用：${received} 个输出页面已确认（倒计时未重置）`:'配置已保存；未收到输出页面确认，请确认 OBS 地址并刷新浏览器源一次。';if(received)pendingRevision='';}
          if(pendingRestart){const received=data.clients.filter(c=>c.restartId===pendingRestart).length;statusLine.textContent=received?`已重新开始：${received} 个输出页面已确认`:'重启指令已发送，暂未收到输出页面确认。';if(received)pendingRestart='';}
        } else if(!preview) {
          await request('/api/standby/ack',{clientId,revision,restartId:clockMode?'':restartId});
        }
        initialized=true;
      } catch(error) {if(editor)statusLine.textContent=error.message;}
      finally{if(!disposed)pollTimer=setTimeout(syncConfig,1000);}
    }
    const originalRender = scene.renderAt.bind(scene);
    const shorten = (ctx, text, width) => {
      let value = String(text || '');
      if (ctx.measureText(value).width <= width) return value;
      while (value && ctx.measureText(value + '…').width > width) value = value.slice(0, -1);
      return value + '…';
    };
    const originalDecor = scene.decor.bind(scene);
    scene.decor = function(ctx, state, dark) {
      originalDecor(ctx, state, dark);
      ctx.save();ctx.font='15px ui-monospace,Consolas,"Microsoft YaHei",monospace';
      ctx.fillStyle=dark?'#929aaa':'#72778b';ctx.textAlign='left';
      const now = Date.now();
      const chat = model.chat.filter(item => now - item.at < 20000).slice(-2);
      if(q.get('chat') !== 'false') chat.forEach((item,i) => ctx.fillText(shorten(ctx,item.text,920),240,1040+i*21));
      ctx.textAlign='right';
      if(model.music?.playing && q.get('music') !== 'false') {
        const p=model.music;const elapsed=Math.min(p.song.duration||Infinity,(p.progress||0)+now-(p.updatedAt||now));
        const sec=Math.max(0,Math.floor(elapsed/1000));
        ctx.fillText(shorten(ctx,`${p.song.name} / ${(p.song.artists||[]).join(' · ')}  ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`,430),1680,1040);
      }
      const status = model.switchState || (preview ? 'PREVIEW / NO OBS CONTROL' : model.status==='LIVE' ? '' : model.status);
      if(status)ctx.fillText(shorten(ctx,status,450),1680,1061);
      ctx.restore();
    };
    scene.renderAt = function(elapsed, options={}) {
      if(clockMode) {
        const d=new Date();const value=d.getHours()*60+d.getMinutes();
        const state=originalRender(0,{...options,duration:value});
        state.label=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        return state;
      }
      const result=originalRender(elapsed,options);
      if(elapsed<lastElapsed-.1){switched=false;model.switchState='';}
      lastElapsed=elapsed;
      // Preserve the reference's 0.5s zero hold and 0.9s handoff before leaving.
      if(!preview && !editor && q.get('autoSwitch')!=='false' && api.clock.running && api.clock.hasStarted && elapsed>=api.clock.duration+1.4 && !switched) {
        switched=true;model.switchState='OBS / SWITCHING';
        fetch('/api/obs/switch-scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:q.get('obsScene')||''}),signal:AbortSignal.timeout(6000)})
          .then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'请求失败');model.switchState='OBS / '+data.scene;})
          .catch(error=>{model.switchState='OBS / '+error.message;});
      }
      return result;
    };
    if(clockMode) {
      scene.setConfig({endMode:'hold',progress:false});
      const decorate=scene.decor.bind(scene);
      scene.decor=function(ctx,state,dark){
        // Retain reference labels/layout, replacing countdown terminology only.
        const fill=ctx.fillText;
        ctx.fillText=function(text,...args){return fill.call(this,String(text).replace(/^STARTS IN\s+/, 'LOCAL TIME  ').replace('M I N U T E S   :   S E C O N D S','H O U R S   :   M I N U T E S'),...args);};
        try{decorate(ctx,state,dark);}finally{ctx.fillText=fill;}
      };
    }
    function connect() {
      if(disposed) return;
      socket = new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.hostname||'127.0.0.1'}:7789`);
      socket.onopen=()=>{
        socket.send(JSON.stringify({action:'subscribe',roomId:q.get('room')||undefined}));
        socket.send(JSON.stringify({action:'ncm.subscribe'}));
      };
      socket.onmessage=event=>{
        let data;try{data=JSON.parse(event.data);}catch{return;}
        if(data.type==='status')model.status=data.connected?'LIVE':'OFFLINE';
        if(['danmaku','gift','sc'].includes(data.type)){
          model.chat.push({text:`${data.user||'观众'} / ${data.text || (data.bigEmote?'[大表情]':'')}`,at:Date.now()});
          model.chat=model.chat.slice(-2);
        }
        if(data.type==='ncm.playback')model.music=data.song?data:null;
        if(data.type==='ncm.offline')model.music=null;
      };
      socket.onclose=()=>{model.status='OFFLINE';if(!disposed)reconnect=setTimeout(connect,3000);};
      socket.onerror=()=>socket.close();
    }
    if(!preview && !editor)connect();
    if(!preview && !editor && q.get('bgm')) {
      audio=new Audio(q.get('bgm'));audio.loop=true;
      audio.play().catch(()=>{model.status='BGM / CLICK TO PLAY';document.addEventListener('click',()=>audio.play().catch(()=>{}),{once:true});});
    }
    addEventListener('pagehide',()=>{disposed=true;clearTimeout(reconnect);clearTimeout(pollTimer);socket?.close();audio?.pause();},{once:true});
    await syncConfig();
    if(!editor) {
      api.clean(true);
      document.getElementById('exitClean').hidden=true;
      // The controller remains accessible explicitly via editor=1.
      const style=document.createElement('style');style.textContent='body.clean #exitClean{display:none!important}';document.head.append(style);
      if(!clockMode && q.get('autostart')!=='0' && !q.has('render'))api.start();
    }
  }
  addEventListener('phase-ready',attach,{once:true});
  if(window.phaseLive)attach();
})();
