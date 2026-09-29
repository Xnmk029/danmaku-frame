const {chromium,screenshots}=require('./runtime.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../..'),browser=await chromium.launch({channel:'msedge',headless:true});
 let mode='live',hardwareRequests=0;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.pathname==='/api/frame/config'?{ok:true,layouts:{},clients:[],room:'',roomRevision:'test'}:{ok:true}));return;}
  const file=path.join(root,u.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(18788,'127.0.0.1',resolve));
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}}),errors=[];
  await context.route('http://127.0.0.1:7790/state',async route=>{
   hardwareRequests++;
   if(mode==='live')return route.continue();
   if(mode==='offline')return route.abort();
   return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{ok:true,at:mode==='stale'?Date.now()-15000:Date.now(),cpu:{usage:0,temperature:null},memory:{usage:100,availableGB:0},gpu:{usage:73,temperature:68,name:'Test GPU'}}});
  });
  await context.addInitScript(()=>{window.WebSocket=class{constructor(){this.readyState=1;setTimeout(()=>this.onopen?.(),0)}send(){}close(){}}});
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  page.on('requestfailed',r=>console.error(r.url(),r.failure()?.errorText));
  const boxesOverlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  for(const scene of ['A','B','C']){
   await page.goto(`http://127.0.0.1:18788/phase-frame.html?view=program&scene=${scene}&layer=composite`);
   await page.waitForSelector('.live-hardware[data-status=connected]');
   await page.evaluate(()=>{phaseStudio.engine.setConfig({showCharacter:true});phaseFrame.receive({type:'heart.rate',bpm:128,at:Date.now()});});
   await page.waitForTimeout(350);
   assert.equal(await page.locator('.live-hardware-item').count(),3);
   assert.notEqual(await page.locator('.live-hardware-item[data-kind=gpu] strong').innerText(),'—');
   const hardware=await page.locator('.live-hardware').boundingBox();
   assert.ok(hardware.y>=0&&hardware.y+hardware.height<110&&hardware.x+hardware.width<=1920);
   for(const selector of ['.live-heart','.live-chat'])assert.ok(!boxesOverlap(hardware,await page.locator(selector).boundingBox()),`${scene} overlaps ${selector}`);
   const clipping=await page.locator('.live-hardware').evaluate(el=>[el,...el.querySelectorAll('*')].filter(e=>getComputedStyle(e).display!=='inline'&&(e.scrollWidth>e.clientWidth||e.scrollHeight>e.clientHeight)).map(e=>({cls:e.className,w:[e.scrollWidth,e.clientWidth],h:[e.scrollHeight,e.clientHeight]})));
   assert.deepEqual(clipping,[],`${scene} clipping`);
   await page.screenshot({path:path.join(screenshots,`hardware-${scene}.png`)});
  }
  await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(150);
  await page.screenshot({path:path.join(screenshots,'hardware-C-720.png')});
  mode='mock';await page.waitForFunction(()=>document.querySelector('[data-kind=cpu] strong').textContent==='0');
  assert.equal(await page.locator('[data-kind=memory] strong').innerText(),'100');
  assert.equal(await page.locator('[data-kind=memory] .live-hardware-temp').innerText(),'可用 0.0 GB');
  assert.equal(await page.locator('[data-kind=cpu] .live-hardware-temp').innerText(),'— °C');
  mode='stale';await page.waitForFunction(()=>document.querySelector('.live-hardware').dataset.status==='offline');
  assert.equal(await page.locator('[data-kind=gpu] strong').innerText(),'—');
  assert.equal(await page.locator('[data-kind=memory] .live-hardware-temp').innerText(),'可用 — GB');
  mode='mock';await page.waitForSelector('.live-hardware[data-status=connected]');
  mode='offline';await page.waitForSelector('.live-hardware[data-status=offline]');
  mode='live';await page.waitForSelector('.live-hardware[data-status=connected]');
  await page.goto('http://127.0.0.1:18788/phase-frame.html?view=program&scene=A&layer=back');
  await page.waitForFunction(()=>window.phaseFrame);const count=hardwareRequests;
  await page.waitForTimeout(2300);assert.equal(hardwareRequests,count,'Back layer must not poll');
  await page.goto('http://127.0.0.1:18788/phase-frame.html');
  await page.waitForFunction(()=>document.querySelector('#frameHardwareStatus')?.textContent.includes('硬件采集已连接'));
  assert.deepEqual(errors,[]);
  console.log('PASS: real collector -> A/B/C, no clipping or heart/chat overlap, 720p, zero vs missing, stale, disconnect, recovery, back-layer isolation, editor status');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
