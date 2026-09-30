const {chromium,screenshots}=require('./runtime.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),assert=require('node:assert/strict');
(async()=>{
 const {createFrameStore}=await import('../../src/transport/frame-store.mjs');
 const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'phase-model-')),store=createFrameStore(path.join(tmp,'config.json'));
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname.startsWith('/api/')){
   let body='';for await(const chunk of req)body+=chunk;
   let data={ok:true};if(u.pathname==='/api/frame/config')data=req.method==='GET'?store.read():store.save(JSON.parse(body));
   if(u.pathname==='/api/frame/ack')data=store.ack(JSON.parse(body));
   if(u.pathname==='/api/telemetry/state')data={ok:true,config:{device:'Instinct',heartEnabled:false,audioEnabled:true},heart:{status:'disabled'},audio:{status:'connected'}};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
  }
  const file=path.join(root,u.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}}),errors=[];
  await context.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=1;setTimeout(()=>this.onopen?.(),0)}send(){}close(){}}});
  const editor=await context.newPage();editor.on('pageerror',e=>errors.push(e.message));
  await editor.goto(base+'/phase-frame.html');await editor.waitForFunction(()=>window.phaseFrame);
  for(const scene of ['A','B','C']){
   await editor.evaluate(s=>phaseStudio.setScene(s,{animate:false}),scene);
   await editor.locator('#frame_model').fill('Astra Opus5.5');await editor.locator('#frame_model').dispatchEvent('change');
   await editor.locator('#frame_chatLimit').fill(String({A:5,B:4,C:8}[scene]));await editor.locator('#frame_chatLimit').dispatchEvent('change');
   await editor.locator('#framePublish').click();await editor.waitForTimeout(120);
   assert.equal(store.read().layouts[scene].broadcast.model,'Astra Opus5.5');
  }
  for(const scene of ['A','B','C']){
   const output=await context.newPage();output.on('pageerror',e=>errors.push(e.message));
   await output.goto(base+`/phase-frame.html?view=program&scene=${scene}&layer=composite`);
   await output.waitForFunction(()=>phaseFrame?.getState().modelMark.icon==='claude');
   await output.evaluate(()=>{phaseStudio.engine.setConfig({showCharacter:true});for(let i=0;i<5;i++)phaseFrame.receive({type:'danmaku',user:'观众'+i,text:'测试两行弹幕完整显示，模型版本缩小后，文字应该保持清楚并且和下方图标错开摆放'});});
   await output.waitForTimeout(350);
   assert.equal(await output.evaluate(()=>phaseFrame.getState().modelMark.version),'5.5');
   assert.equal(await output.locator('.live-model').count(),0);
   const chat=await output.evaluate(()=>{const c=document.querySelector('.live-chat');return {height:c.clientHeight,scroll:c.scrollHeight,rows:[...c.querySelectorAll('.live-row')].map(r=>({height:r.offsetHeight,line:parseFloat(getComputedStyle(r).lineHeight)})),bottom:parseFloat(c.style.top)+c.clientHeight,scene:phaseStudio.engine.config.scene};});
   assert.equal(chat.rows.length,{A:5,B:4,C:5}[scene],'All configured two-line messages must fit');
   assert.ok(chat.scroll<=chat.height,'Chat must fit its reserved area');
   for(const row of chat.rows)assert.ok(row.height>=row.line*2-.5,'The second line must not be clipped');
   if(scene!=='C')assert.ok(chat.bottom<await output.evaluate(()=>PhaseModelMark.layouts[phaseStudio.engine.config.scene].icon.y),'The icon must stay below chat');
   const animation=await output.evaluate(()=>{
    const e=phaseStudio.engine,s=e.config.scene,r=PhaseModelMark.layouts[s].icon,canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d'),previous={reduced:e.config.reduced,material:e.config.material};
    const pixels=t=>{ctx.clearRect(0,0,1920,1080);e.drawModelMark(ctx,s,e.theme(s),t);return ctx.getImageData(r.x,r.y,r.size,r.size).data;};
    const differs=(a,b)=>a.some((v,i)=>v!==b[i]);
    try{e.setConfig({reduced:false,material:'hybrid'});const a=pixels(0),b=pixels(3);e.setConfig({material:'reference'});const c=pixels(0),d=pixels(3);e.setConfig({reduced:true});const f=pixels(0),g=pixels(3);
     e.renderAt(0,{scene:s,layer:'front',noTransition:true});const front=e.ctx.getImageData(r.x,r.y,r.size,r.size).data;
     return {visible:a.some((v,i)=>i%4===3&&v>0),flow:differs(a,b),referenceFlow:differs(c,d),calm:!differs(f,g),frontEmpty:!front.some((v,i)=>i%4===3&&v>0)};
    }finally{e.setConfig(previous);}
   });
   assert.deepEqual(animation,{visible:true,flow:true,referenceFlow:true,calm:true,frontEmpty:true},'Icons must flow inside their shape, freeze with reduced motion and appear once across layers');
   await output.screenshot({path:path.join(screenshots,`model-mark-${scene}.png`)});
   if(scene==='C'){await output.setViewportSize({width:1280,height:720});await output.waitForTimeout(200);await output.screenshot({path:path.join(screenshots,'model-mark-C-720.png')});}
   await output.close();
  }
  const front=await context.newPage(),back=await context.newPage();for(const page of [front,back])page.on('pageerror',e=>errors.push(e.message));
  await front.goto(base+'/phase-frame.html?view=program&scene=A&layer=front');await back.goto(base+'/phase-frame.html?view=program&scene=A&layer=back');
  await Promise.all([front.waitForFunction(()=>phaseFrame?.getState().modelMark.version==='5.5'),back.waitForFunction(()=>phaseFrame?.getState().modelMark.version==='5.5')]);
  await editor.evaluate(()=>phaseStudio.setScene('A',{animate:false}));await editor.locator('#frame_model').fill('DeepSeek V3.2');await editor.locator('#frame_model').dispatchEvent('change');await editor.locator('#framePublish').click();
  await Promise.all([front.waitForFunction(()=>phaseFrame.getState().modelMark.icon==='deepseek'),back.waitForFunction(()=>phaseFrame.getState().modelMark.icon==='deepseek')]);
  assert.equal(await back.locator('#frameLive').isVisible(),false);
  await editor.locator('#frame_model').fill('Unknown Model');await editor.locator('#frame_model').dispatchEvent('change');
  assert.equal(await editor.evaluate(()=>phaseFrame.getState().modelMark.icon),null);assert.equal(await editor.evaluate(()=>phaseFrame.getState().modelMark.version),'—');
  await editor.locator('#frame_model').fill('');await editor.locator('#frame_model').dispatchEvent('change');
  assert.equal(await editor.evaluate(()=>phaseStudio.engine.mask('A').coords.filter(([x,y])=>y>40).length),0,'Empty model must not restore meaningless O/8');
  assert.deepEqual(errors,[]);console.log('PASS: model ID parsing, A/B/C composition, full ID, icon flow/reference/reduced motion, no duplicate layer icons, 720p, front/back revision sync, unknown/empty fallback');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
