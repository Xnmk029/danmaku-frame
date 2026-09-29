const {chromium,screenshots}=require('./runtime.cjs');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
(async()=>{
 const {createFrameStore}=await import('../../src/transport/frame-store.mjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'frame-browser-')),store=createFrameStore(path.join(tmp,'config.json'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),errors=[];
 let telemetryReady=true;
 await context.route('http://localhost:18788/**',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.pathname==='/api/telemetry/state')return route.fulfill({json:{ok:true,config:{device:'Instinct apac',heartEnabled:true,audioEnabled:true},heart:{status:'connected',bpm:72},audio:{status:'connected',name:'Default speaker'}}});
 if(u.pathname==='/api/telemetry/scan')return telemetryReady?route.fulfill({json:{ok:true,devices:[{name:'Other',address:'other',heartService:false},{name:'Instinct apac',address:'watch',heartService:true}]}}):route.fulfill({status:404,body:'404 Not Found'});
 if(u.pathname.startsWith('/api/frame/')){try{return route.fulfill({json:req.method()==='GET'?store.read():u.pathname.endsWith('/config')?store.save(req.postDataJSON()):store.ack(req.postDataJSON())});}catch(e){return route.fulfill({status:400,json:{ok:false,error:e.message}});}}
 const p=path.join(__dirname,'../..',u.pathname);if(!fs.existsSync(p))return route.fulfill({status:404,body:''});
 return route.fulfill({body:fs.readFileSync(p),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream'});
 });
 await context.addInitScript(()=>{window.sent=[];window.sockets=0;window.WebSocket=class{constructor(){window.sockets++;this.readyState=1;setTimeout(()=>this.onopen?.(),0)}send(s){window.sent.push(JSON.parse(s))}close(){}}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:18788/phase-frame.html');await page.waitForFunction(()=>window.phaseFrame);assert.equal(await page.evaluate(()=>sockets),0);
 await page.waitForFunction(()=>document.querySelector('#frameTelemetryStatus').textContent.includes('心率 已连接'));
 await page.locator('#frameScan').click();await page.waitForFunction(()=>document.querySelectorAll('#frameDeviceList option').length===2);assert.equal(await page.locator('#frameDevice').inputValue(),'Instinct apac');
 telemetryReady=false;await page.locator('#frameScan').click();await page.waitForFunction(()=>document.querySelector('#frameTelemetryStatus').textContent.includes('采集接口尚未加载'));telemetryReady=true;
 await page.locator('#frameTest').click();
 for(const scene of ['A','B','C']){
 await page.evaluate(s=>phaseStudio.setScene(s,{animate:false}),scene);
 await page.locator('#frame_next').fill('接下来：AI 模型演示');await page.locator('#frame_next').dispatchEvent('change');
 await page.locator('#frame_model').fill('GPT-6');await page.locator('#frame_model').dispatchEvent('change');
 await page.locator('#framePublish').click();await page.waitForTimeout(150);
 assert.ok(store.read().layouts[scene]);
 await page.screenshot({path:path.join(screenshots,`frame-editor-${scene}.png`)});
 }
 const front=await context.newPage(),back=await context.newPage();for(const p of [front,back])p.on('pageerror',e=>errors.push(e.message));
 await front.goto('http://localhost:18788/phase-frame.html?view=program&scene=A&layer=front&clock=wall');
 await back.goto('http://localhost:18788/phase-frame.html?view=program&scene=A&layer=back&clock=wall');
 await front.waitForFunction(()=>window.phaseFrame&&sent.length===2);await back.waitForFunction(()=>window.phaseFrame);
 assert.equal(await back.evaluate(()=>sockets),0);assert.equal(await back.locator('#frameLive').isVisible(),false);
 await page.evaluate(()=>phaseStudio.setScene('A',{animate:false}));await page.evaluate(()=>phaseStudio.setConfig({topic:'实时同步测试'}));await page.locator('#framePublish').click();
 await front.waitForFunction(()=>phaseStudio.engine.config.topic==='实时同步测试');await back.waitForFunction(()=>phaseStudio.engine.config.topic==='实时同步测试');
 assert.equal(await front.evaluate(()=>sockets),1);
 await front.evaluate(()=>{phaseFrame.receive({type:'status',connected:true});phaseFrame.receive({type:'danmaku',user:'<img src=x>',text:'真实弹幕测试',medal:{name:'奶鲸',lv:20},guard:3});phaseFrame.receive({type:'sc',user:'观众',text:'谢谢今天的分享'});phaseFrame.receive({type:'ncm.playback',playing:true,song:{name:'海风与信号',artists:['示例歌手'],duration:180000},progress:45000,updatedAt:Date.now()});});
 assert.ok((await front.locator('.live-chat').innerText()).includes('<img src=x>'));
 for(const scene of ['A','B','C']){
 if(scene!=='A'){await front.goto(`http://localhost:18788/phase-frame.html?view=program&scene=${scene}&layer=composite&clock=wall`);await front.waitForFunction(()=>window.phaseFrame?.getState().revision);}
 await front.evaluate(()=>{for(let i=0;i<12;i++)phaseFrame.receive({type:'danmaku',user:`观众${i}`,text:`这是第 ${i+1} 条弹幕，用于检查多条消息的排版。`});phaseFrame.receive({type:'heart.rate',bpm:72,at:Date.now()});phaseFrame.receive({type:'audio.spectrum',bands:Array.from({length:24},(_,i)=>.15+.5*Math.pow(Math.sin(i*.55),2)),at:Date.now()});phaseFrame.receive({type:'ncm.playback',playing:true,song:{name:'海风与信号',artists:['示例歌手'],duration:180000},progress:45000,updatedAt:Date.now()});phaseStudio.engine.setConfig({layer:'composite',showCharacter:true});});
 await front.waitForTimeout(250);assert.equal(await front.locator('.live-heart').isVisible(),true);assert.equal(await front.locator('.live-spectrum').isVisible(),true);
 const heartPosition=await front.locator('.live-heart').boundingBox();assert.ok(heartPosition.y<110,`${scene} heart is not in top rail`);
 assert.ok((await front.locator('.live-heart-icon').evaluate(el=>getComputedStyle(el).maskImage)).includes('heart.svg'));
 assert.equal(await front.locator('.live-spectrum i').count(),24);
 const count=await front.locator('.live-chat .live-row').count();assert.ok(count>=(scene==='C'?5:3),`${scene} rows: ${count}`);
 await front.screenshot({path:path.join(screenshots,`frame-live-${scene}.png`)});
 await front.evaluate(()=>phaseFrame.receive({type:'voice.selection',phase:'candidates',id:'test',user:'测试观众',items:[{title:'候选音色一',author:'作者 A'},{title:'候选音色二',author:'作者 B'},{title:'候选音色三',author:'作者 C'}],expiresAt:Date.now()+900,serverNow:Date.now()}));
 await front.waitForTimeout(380);
 await front.screenshot({path:path.join(screenshots,`frame-voice-${scene}.png`)});assert.equal(await front.locator('.live-voice').isVisible(),true);
 await front.waitForFunction(()=>document.querySelector('.live-voice').hidden);assert.equal(await front.locator('.live-voice').isVisible(),false);
 }
 await front.evaluate(()=>phaseFrame.receive({type:'voice.design',phase:'searching',id:'registration',user:'观众甲',expiresAt:Date.now()+2000,serverNow:Date.now()}));assert.equal(await front.locator('.live-voice').isVisible(),true);
 await front.evaluate(()=>phaseFrame.receive({type:'voice.design',phase:'success',id:'registration',user:'观众甲',message:'音色注册成功',expiresAt:Date.now()+450,serverNow:Date.now()}));
 await front.waitForFunction(()=>document.querySelector('.live-voice').hidden);
 await front.emulateMedia({reducedMotion:'reduce'});await front.evaluate(()=>phaseFrame.receive({type:'heart.rate',bpm:72,at:Date.now()}));
 assert.equal(await front.locator('.live-heart-icon').evaluate(el=>getComputedStyle(el).animationName),'none');
 await front.setViewportSize({width:1280,height:720});await front.waitForFunction(()=>document.querySelector('.live-heart').getBoundingClientRect().height<60);const smallHeart=await front.locator('.live-heart').boundingBox();assert.ok(smallHeart.y>=0&&smallHeart.y<75&&smallHeart.x+smallHeart.width<1280,JSON.stringify(smallHeart));
 await front.screenshot({path:path.join(screenshots,'frame-live-C-720p.png')});
 assert.deepEqual(errors,[]);console.log('PASS: telemetry scan and diagnostics, top heart and pixel spectrum, reduced motion, 720p fit, scene persistence, front/back sync and voice expiry');
 }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
