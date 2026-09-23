// Isolated renderer smoke test. Does not connect to live danmaku or call Fish API.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
app.setPath('userData', path.join(app.getPath('temp'), 'danmaku-voice-card-test'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    await win.loadURL('http://127.0.0.1:7788/index.html?autoconnect=false&hidebar=true');
    await js(`renderNcm({ song:{name:'后台歌曲',artists:['测试歌手'],duration:180000},playing:true,progress:1000,updatedAt:Date.now() }); voiceCard.update({type:'voice.selection',id:1,user:'测试观众',query:'派大星',phase:'searching',expiresAt:Date.now()+12000,serverNow:Date.now()});`);
    await wait(600);
    await js(`voiceCard.update({type:'voice.selection',id:1,user:'测试观众',query:'派大星',phase:'candidates',items:[{title:'派大星',author:'心如止水 宁静致远'},{title:'派大星 · 海绵宝宝',author:'作者二'},{title:'<img src=x onerror=alert(1)>',author:'特别长的作者名称用于检查截断显示而不挤压候选行'}],startsAt:Date.now()+1000,expiresAt:Date.now()+21000,serverNow:Date.now()});`);
    await wait(1200);
    const layout = await js(`(() => { const p=document.querySelector('.voice-panel'); const r=p.getBoundingClientRect(); return { rows:p.querySelectorAll('.voice-option').length, overflow:p.scrollHeight>p.clientHeight+1, images:p.querySelectorAll('img').length, bottom:r.bottom, rootBottom:document.getElementById('ncmNow').getBoundingClientRect().bottom }; })()`);
    console.log(JSON.stringify(layout)); console.log(await js(`JSON.stringify({root:document.getElementById('ncmNow').outerHTML.slice(0,300), phase:voiceCard.state.phase, opacity:getComputedStyle(voiceCard.panel).opacity,height:getComputedStyle(voiceCard.root).height, panelHeight:voiceCard.panel.clientHeight, panelScroll:voiceCard.panel.scrollHeight})`));
    fs.mkdirSync(path.resolve('tmp/voice-card'), { recursive: true });
    fs.writeFileSync(path.resolve('tmp/voice-card/candidates.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(layout.rows, 3); assert.equal(layout.overflow, false); assert.equal(layout.images, 0);
    await js(`renderNcm({ song:{name:'选择期间切换的新歌',artists:['新歌手'],duration:200000},playing:true,progress:5000,updatedAt:Date.now() }); voiceCard.update({...voiceCard.state,phase:'success',selected:2,message:'已绑定 · 派大星',expiresAt:Date.now()+2200,serverNow:Date.now()});`);
    await wait(600);
    assert.equal(await js(`document.querySelectorAll('.voice-option.chosen').length`), 1);
    fs.writeFileSync(path.resolve('tmp/voice-card/success.png'), (await win.webContents.capturePage()).toPNG());
    await js(`voiceCard.update({phase:'idle'});`); await wait(600);
    assert.equal(await js(`document.getElementById('ncmTitle').textContent`), '选择期间切换的新歌');
    assert.equal(await js(`document.querySelector('.voice-music').hidden`), false);
    await js(`renderNcm(null); voiceCard.update({id:2,user:'测试',phase:'empty',message:'没有找到音色',expiresAt:Date.now()+400,serverNow:Date.now()});`);
    await wait(1500);
    assert.equal(await js(`document.getElementById('ncmNow').hidden`), true);
    // Resource failures must be visible to the test runner.
    assert.deepEqual(errors, []);
    console.log('PASS: candidates layout, safe titles, selection highlight, latest-song restoration, no-song expiry');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
