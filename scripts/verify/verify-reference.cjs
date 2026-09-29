const {chromium,screenshots}=require('./runtime.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));let switches=0;
await page.route('http://localhost:18788/**',route=>{
 const u=new URL(route.request().url());if(u.pathname==='/api/obs/switch-scene'){switches++;return route.fulfill({json:{ok:true,scene:'Live'}});}
 const p=path.join(__dirname,'../..',u.pathname);
 if(!fs.existsSync(p))return route.fulfill({status:404,body:''});
 return route.fulfill({body:fs.readFileSync(p),contentType:({'.html':'text/html','.js':'text/javascript','.gif':'image/gif'})[path.extname(p)]||'application/octet-stream'});
});
await page.addInitScript(()=>{window.sent=[];window.WebSocket=class{constructor(){window.mockSocket=this;setTimeout(()=>this.onopen?.(),0)}send(v){sent.push(JSON.parse(v))}close(){}};});
async function open(query){await page.goto('http://localhost:18788/standby.html?'+query);await page.waitForFunction(()=>window.phaseLive?.integration,{},{timeout:60000});}
await open('duration=180&preview=true&render=1');
assert.equal(await page.evaluate(()=>phaseLive.scene.character.mode),'frames');
assert.equal(await page.evaluate(()=>phaseLive.scene.character.report.originalFrames),108);
assert.deepEqual(await page.evaluate(()=>sent),[]);
await page.evaluate(()=>phaseLive.renderAt(172,{sceneTime:7.12}));
await page.screenshot({path:path.join(screenshots,'reference-countdown.png')});
await page.evaluate(()=>phaseLive.renderAt(183,{sceneTime:18}));
await page.screenshot({path:path.join(screenshots,'reference-xomk.png')});
assert.equal(switches,0);
await open('duration=10&obsScene=Live&autostart=0');
await page.waitForFunction(()=>sent.length===2);
await page.evaluate(()=>{
 for(const data of [{type:'status',connected:true},{type:'danmaku',user:'鲸友',text:'保持参考构图'}, {type:'ncm.playback',playing:true,song:{name:'测试歌曲',artists:['演唱者'],duration:180000},progress:0,updatedAt:Date.now()}])mockSocket.onmessage({data:JSON.stringify(data)});
 phaseLive.start();phaseLive.scene.renderAt(11.39);
});
assert.equal(switches,0);
await page.evaluate(()=>{phaseLive.scene.renderAt(11.5);phaseLive.scene.renderAt(12);});
await page.waitForFunction(()=>phaseLive.integration.switchState==='OBS / Live');assert.equal(switches,1);
assert.equal(await page.evaluate(()=>phaseLive.integration.chat.length),1);
await page.evaluate(()=>phaseLive.renderAt(2));
await page.screenshot({path:path.join(screenshots,'reference-live-data.png')});
await open('mode=clock&preview=true');
await page.waitForFunction(()=>phaseLive.getState()?.label===new Date().toTimeString().slice(0,5));
await page.setViewportSize({width:1280,height:720});await page.screenshot({path:path.join(screenshots,'reference-clock-720.png')});
assert.equal(switches,1);assert.equal(errors.length,0,errors.join('\n'));
console.log('PASS: original 108-frame GIF, reference countdown/XOMK, preview isolation, delayed single OBS request, live text/music, clock 720p; no script errors');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
