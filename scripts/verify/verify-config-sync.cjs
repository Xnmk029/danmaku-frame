const {chromium,screenshots}=require('./runtime.cjs');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
(async()=>{
const {createStandbyStore}=await import('../../src/transport/standby-store.mjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'standby-browser-'));const store=createStandbyStore(path.join(tmp,'config.json'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const context=await browser.newContext();const errors=[];
await context.route('http://localhost:18788/**',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.pathname.startsWith('/api/standby/')) {
  let result;if(req.method()==='GET')result={ok:true,...store.read()};
  else if(u.pathname.endsWith('/config'))result=store.save(req.postDataJSON());
  else if(u.pathname.endsWith('/restart'))result=store.restart();
  else result=store.ack(req.postDataJSON());
  return route.fulfill({json:result});
 }
 const p=path.join(__dirname,'../..',u.pathname);if(!fs.existsSync(p))return route.fulfill({status:404,body:''});
 return route.fulfill({body:fs.readFileSync(p),contentType:({'.html':'text/html','.js':'text/javascript','.gif':'image/gif'})[path.extname(p)]||'application/octet-stream'});
});
await context.addInitScript(()=>{window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),0)}send(){}close(){}}});
const editor=await context.newPage(),output=await context.newPage();
for(const p of [editor,output])p.on('pageerror',e=>errors.push(e.message));
await editor.goto('http://localhost:18788/standby.html?editor=1');
await editor.waitForFunction(()=>!document.getElementById('standbyPublish')?.disabled);
await output.goto('http://localhost:18788/standby.html?duration=120&autoSwitch=false');
await output.waitForFunction(()=>window.phaseLive?.clock.running);
await output.evaluate(()=>{phaseLive.clock.base=35;phaseLive.clock.anchor=Date.now()});
await editor.evaluate(()=>{phaseLive.setConfig({characterWidth:740,warp:9});phaseLive.setDuration(90)});
await editor.locator('#standbyPublish').click();
await output.waitForFunction(()=>phaseLive.scene.config.characterWidth===740);
assert.ok(await output.evaluate(()=>phaseLive.clock.elapsedAt()>=35));
assert.equal(await output.evaluate(()=>phaseLive.clock.duration),120);
await editor.waitForFunction(()=>document.getElementById('standbyPublishStatus').textContent.includes('已确认'));
await editor.locator('#standbyRestart').click();
await output.waitForFunction(()=>phaseLive.clock.duration===90 && phaseLive.clock.elapsedAt()<10);
assert.ok(await output.evaluate(()=>phaseLive.clock.running));
await output.reload();await output.waitForFunction(()=>window.phaseLive?.clock.running);
assert.equal(await output.evaluate(()=>phaseLive.clock.duration),120); // explicit URL duration wins on fresh load
await editor.screenshot({path:path.join(screenshots,'config-sync-editor.png'),fullPage:true});
assert.deepEqual(errors,[]);console.log('PASS: editor save, output acknowledgement, appearance preserves time, explicit restart uses new duration, reload does not replay restart');
}finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
