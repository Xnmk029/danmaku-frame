// 直播控制台 - Electron 主进程
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { SERVICE_DEFS, ServiceRuntime } = require('./services');
const { HealthMonitor } = require('./health');
const { Orchestrator } = require('./orchestrator');
const configStore = require('./config');

const isSelfTest = process.argv.includes('--selftest');

let win = null;
let floatWin = null;
let tray = null;
let runtimes = [];
let health = null;
let orchestrator = null;
let config = configStore.load();

// 面捕参数注入 services.js
if (!config.face) config.face = { capture: '0', fps: 24, model: 3, visualize: true, maxThreads: 4 };
global.__faceConfig = config.face;

// 互动悬浮窗配置
if (!config.float) config.float = { opacity: 0.92, locked: false, bounds: null, fontSize: 13, detailsCollapsed: false };
if (config.float.fontSize == null) config.float.fontSize = 13;
if (config.float.detailsCollapsed == null) config.float.detailsCollapsed = false;

// OBS 默认连接：首次无配置时从 G:/产品/OBS/.env 读取
if (!config.obs || (!config.obs.password && !config.obs.url)) {
  const envObs = configStore.loadObsFromEnv();
  if (envObs) {
    config.obs = { url: envObs.url || 'ws://127.0.0.1:4455', password: envObs.password || '', browserSource: '' };
    configStore.save(config);
  }
}

// ---------------- 托盘图标（SVG → nativeImage） ----------------
function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect x="2" y="2" width="28" height="28" rx="7" fill="#4F52A2"/>
    <path d="M12.5 9.5 L23 16 L12.5 22.5 Z" fill="#E3E1FF"/>
  </svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

// ---------------- 推送 renderer ----------------
function push(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushState(rt) {
  push('svc:state', { id: rt.def.id, state: rt.state, stateLabel: rt.snapshot().stateLabel, healthy: rt.healthy, pid: rt.snapshot().pid });
}

function pushAllStates() {
  for (const rt of runtimes) pushState(rt);
}

// ---------------- 窗口 ----------------
function createWindow() {
  win = new BrowserWindow({
    width: config.windowWidth,
    height: config.windowHeight,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    backgroundColor: '#121318',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // 渲染进程 console 转发到主进程 stdout（诊断用）
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[RENDERER:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[RENDERER-GONE] ${details.reason}`);
  });

  // 临时 DOM 诊断：加载后 + 模拟点击 TTS tab 后输出布局状态（写文件，绕过 stdout 重定向）
  if (process.env.LC_DIAG_DOM) {
    const fs = require('fs');
    const diagFile = path.join(__dirname, 'lc-dom-diag.json');
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      const dump = async (label) => {
        const state = await win.webContents.executeJavaScript(`(() => {
          const g = (id) => { const el = document.getElementById(id); return el ? { display: getComputedStyle(el).display, h: el.offsetHeight, w: el.offsetWidth, flex: getComputedStyle(el).flex } : null; };
          const tabs = document.getElementById('mainTabs');
          const children = [...document.body.children].map(el => ({ tag: el.tagName, id: el.id, cls: el.className?.toString().slice(0, 20), display: getComputedStyle(el).display, h: el.offsetHeight, flex: getComputedStyle(el).flex }));
          return {
            mainTabs: tabs ? { idx: tabs.activeTabIndex, h: tabs.offsetHeight } : null,
            svcView: g('svcView'),
            ttsPanel: g('ttsPanel'),
            bodyChildren: children,
            bodyH: document.body.offsetHeight,
          };
        })()`);
        fs.appendFileSync(diagFile, `[${label}] ${JSON.stringify(state)}\n`);
      };
      await dump('initial');
      await win.webContents.executeJavaScript(`(() => {
        const tabs = document.getElementById('mainTabs');
        tabs.activeTabIndex = 1;
        tabs.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return tabs.activeTabIndex;
      })()`);
      await new Promise((r) => setTimeout(r, 800));
      await dump('after-tts-tab');
    });
  }

  if (process.env.LC_DUMP_CSS) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const dump = await win.webContents.executeJavaScript(`
          (() => {
            const overflow = [];
            document.querySelectorAll('*').forEach((el) => {
              if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
                const r = el.getBoundingClientRect();
                overflow.push({
                  tag: el.tagName, cls: String(el.className || '').slice(0, 40),
                  text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
                  sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
                  x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                });
              }
            });
            return JSON.stringify({ overflow: overflow.slice(0, 30) });
          })()
        `);
        require('fs').writeFileSync(path.join(__dirname, 'overflow-dump.json'), dump, 'utf8');
        console.log('OVERFLOW_DUMP_SAVED');
        app.exit(0);
      } catch (err) {
        console.error('DUMP_FAIL', err.message);
        app.exit(1);
      }
    });
  }

  win.on('close', (e) => {
    if (config.closeToTray && !app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// ---------------- 互动悬浮窗 ----------------
function floatBoundsOnScreen(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x >= a.x - 16 && b.y >= a.y - 16 && b.x < a.x + a.width && b.y < a.y + a.height;
  });
}

function applyFloatLock() {
  if (!floatWin || floatWin.isDestroyed()) return;
  // forward:true —— 穿透时仍派发 mousemove，页面可保留 hover/滚轮样式反馈（点击被吞）
  floatWin.setIgnoreMouseEvents(!!config.float.locked, { forward: true });
}

function pushFloatState() {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.webContents.send('float:state', {
      opacity: config.float.opacity,
      locked: config.float.locked,
      fontSize: config.float.fontSize,
      detailsCollapsed: config.float.detailsCollapsed,
    });
  }
}

function setFloatLocked(locked) {
  config.float.locked = Boolean(locked);
  configStore.save(config);
  applyFloatLock();
  pushFloatState();
  refreshTray();
}

function createFloatWindow() {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.show();
    floatWin.focus();
    refreshTray();
    return;
  }
  const b = floatBoundsOnScreen(config.float?.bounds) ? config.float.bounds : null;
  floatWin = new BrowserWindow({
    width: b?.width || 360,
    height: b?.height || 640,
    x: b?.x,
    y: b?.y,
    minWidth: 300,
    minHeight: 420,
    maxWidth: 560,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  floatWin.loadFile(path.join(__dirname, 'renderer', 'float.html'));
  floatWin.once('ready-to-show', () => floatWin.show());
  floatWin.setOpacity(config.float.opacity ?? 0.92);
  applyFloatLock();

  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (floatWin && !floatWin.isDestroyed() && !floatWin.isMinimized()) {
        config.float.bounds = floatWin.getBounds();
        configStore.save(config);
      }
    }, 500);
  };
  floatWin.on('moved', saveBounds);
  floatWin.on('resized', saveBounds);
  floatWin.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); floatWin.hide(); }
  });
  floatWin.on('closed', () => { floatWin = null; });
  floatWin.on('hide', refreshTray);
  floatWin.on('show', refreshTray);
}

// ---------------- 托盘 ----------------
function buildTrayTemplate() {
  const floatVisible = floatWin && !floatWin.isDestroyed() && floatWin.isVisible();
  return [
    { label: '显示 / 隐藏面板', click: () => toggleWindow() },
    { type: 'separator' },
    ...runtimes.map((rt) => ({
      label: `${rt.def.icon} ${rt.def.name}`,
      click: () => (rt.alive ? rt.stop() : rt.start()),
    })),
    { type: 'separator' },
    {
      label: '💬 互动悬浮窗',
      type: 'checkbox',
      checked: !!floatVisible,
      click: (item) => (item.checked ? createFloatWindow() : floatWin?.hide()),
    },
    {
      label: '悬浮窗鼠标穿透',
      type: 'checkbox',
      checked: !!config.float?.locked,
      click: (item) => setFloatLocked(item.checked),
    },
    { type: 'separator' },
    { label: '▶ 一键开播', click: () => orchestrator.startStream() },
    { label: '■ 一键下播', click: () => orchestrator.stopStream() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ];
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayTemplate()));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('直播控制台');
  refreshTray();
  tray.on('click', () => toggleWindow());
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

// ---------------- 自检模式 ----------------
async function runSelfTest() {
  const lines = [];
  const out = (s) => lines.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${s}`);
  out('自检开始');
  const rt = runtimes.find((r) => r.def.id === 'danmaku');
  rt.on('log', (_, line) => lines.push(line));
  out('启动弹幕姬...');
  rt.start();
  const deadline = Date.now() + 25000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (rt.healthy) { healthy = true; break; }
    await new Promise((r) => setTimeout(r, 800));
  }
  out(healthy ? '健康检查通过 [OK]' : '健康检查超时 [TIMEOUT]');
  out('停止弹幕姬...');
  rt.stop();
  await new Promise((r) => setTimeout(r, 1500));
  out(`停止后进程存活: ${rt.alive}`);
  out('自检结束');
  require('fs').writeFileSync(path.join(__dirname, 'selftest.log'), lines.join('\n') + '\n', 'utf8');
  app.exit(0);
}

// ---------------- IPC ----------------
const { execFile } = require('child_process');

let obsClient = null;

// obs-websocket v5：更新待机页浏览器源 URL 并刷新
async function applyStandbyToObs() {
  const url = (() => {
    const p = new URLSearchParams({ duration: String(config.standby?.duration || 120), mode: config.standby?.mode || 'countdown' });
    if (config.standby?.scene) p.set('obsScene', config.standby.scene);
    return 'http://127.0.0.1:7788/standby.html?' + p.toString();
  })();
  const { OBSWebSocket } = require('obs-websocket-js');
  if (!obsClient) obsClient = new OBSWebSocket();
  const target = obsClient;
  const cfg = { url: config.obs?.url || 'ws://127.0.0.1:4455', password: config.obs?.password || '' };
  if (obsClient.identified) {
    // 已连接，直接复用
  } else {
    await target.connect(cfg.url, cfg.password);
  }
  // 查找 standby 浏览器源：优先按 URL 匹配，再按名字，最后回退第一个浏览器源
  let inputName = config.obs?.browserSource;
  if (!inputName) {
    const { inputs } = await target.call('GetInputList');
    const browsers = inputs.filter((i) => i.inputKind === 'browser_source');
    const byName = browsers.find((i) => (i.inputName || '').toLowerCase().includes('standby'));
    if (byName) {
      inputName = byName.inputName;
    } else {
      // 逐个检查 URL 是否已指向 standby.html
      for (const b of browsers) {
        try {
          const s = await target.call('GetInputSettings', { inputName: b.inputName });
          const url = String(s.inputSettings?.url || '');
          if (url.includes('standby.html')) { inputName = b.inputName; break; }
        } catch { /* 忽略单个源查询失败 */ }
      }
      inputName = inputName || browsers[0]?.inputName;
      if (!inputName) throw new Error('OBS 中未找到浏览器源');
    }
  }
  await target.call('SetInputSettings', { inputName, inputSettings: { url }, overlay: true });
  // OBS 5.x 无 RefreshBrowserSource 请求；obs-browser 在 inputSettings 变化时自动重载页面
  await target.disconnect();
  obsClient = null;
  return { ok: true, inputName, url };
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    config: { theme: config.theme, closeToTray: config.closeToTray, autoStart: config.autoStart, logsExpanded: config.logsExpanded },
    services: runtimes.map((rt) => rt.snapshot()),
    standby: config.standby || { duration: 120, mode: 'countdown', scene: '' },
    face: config.face || { capture: '0', fps: 24, model: 3, visualize: true, maxThreads: 4 },
    obs: config.obs || { url: 'ws://127.0.0.1:4455', password: '', browserSource: '' },
    float: {
      opacity: config.float?.opacity ?? 0.92,
      locked: !!config.float?.locked,
      fontSize: config.float?.fontSize ?? 13,
      detailsCollapsed: !!config.float?.detailsCollapsed,
    },
  }));

  ipcMain.handle('svc:start', (_e, id) => { const rt = findRt(id); rt?.start(); });
  ipcMain.handle('svc:stop', (_e, id) => { const rt = findRt(id); rt?.stop(); });
  ipcMain.handle('svc:restart', async (_e, id) => {
    const rt = findRt(id);
    if (!rt) return;
    rt.stop();
    await new Promise((r) => setTimeout(r, 1200));
    rt.start();
  });
  ipcMain.handle('svc:clearLog', (_e, id) => { const rt = findRt(id); rt?.clearLog(); });

  ipcMain.handle('stream:start', () => orchestrator.startStream());
  ipcMain.handle('stream:stop', () => orchestrator.stopStream());

  ipcMain.handle('config:setTheme', (_e, theme) => { config.theme = theme; configStore.save(config); });
  ipcMain.handle('config:setCloseToTray', (_e, v) => { config.closeToTray = v; configStore.save(config); });
  ipcMain.handle('config:toggleAutoStart', () => {
    config.autoStart = !config.autoStart;
    app.setLoginItemSettings({ openAtLogin: config.autoStart, path: process.execPath });
    configStore.save(config);
    return config.autoStart;
  });
  ipcMain.handle('config:setLogsExpanded', (_e, v) => { config.logsExpanded = v; configStore.save(config); });
  ipcMain.handle('standby:setDuration', (_e, sec) => {
    const s = Math.min(3600, Math.max(10, Math.round(Number(sec) || 120)));
    config.standby = { ...(config.standby || {}), duration: s };
    configStore.save(config);
    return config.standby;
  });
  ipcMain.handle('standby:setMode', (_e, mode) => {
    const m = mode === 'clock' ? 'clock' : 'countdown';
    config.standby = { ...(config.standby || {}), mode: m };
    configStore.save(config);
    return config.standby;
  });
  ipcMain.handle('standby:setScene', (_e, scene) => {
    config.standby = { ...(config.standby || {}), scene: String(scene || '') };
    configStore.save(config);
    return config.standby;
  });
  ipcMain.handle('standby:applyToObs', async () => {
    try {
      return await applyStandbyToObs();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 面捕参数
  ipcMain.handle('face:set', (_e, face) => {
    config.face = {
      capture: String(face?.capture ?? '0'),
      fps: Math.min(60, Math.max(1, parseInt(face?.fps, 10) || 24)),
      model: Math.min(4, Math.max(0, parseInt(face?.model, 10) || 3)),
      visualize: face?.visualize !== false,
      maxThreads: Math.min(8, Math.max(1, parseInt(face?.maxThreads, 10) || 4)),
    };
    global.__faceConfig = config.face; // 供 services.js 组装启动参数
    configStore.save(config);
    return config.face;
  });
  ipcMain.handle('face:listCameras', () => new Promise((resolve) => {
    const def = runtimes.find((rt) => rt.def.id === 'facetrack');
    const exe = def?.def.file;
    if (!exe) return resolve({ ok: false, error: '面捕未配置' });
    execFile(exe, ['--list-cameras', '1'], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve({ ok: true, lines });
    });
  }));

  // L2D 控制面板恢复（支持 asar 环境：读取脚本写至 temp 再调用 powershell）
  ipcMain.handle('panel:showL2D', async () => {
    try {
      const scriptPath = path.join(__dirname, 'scripts', 'show-l2d-panel.ps1');
      const tempPath = path.join(app.getPath('temp'), 'lc-show-l2d-panel.ps1');
      let scriptContent = fs.readFileSync(scriptPath, 'utf8');
      if (!scriptContent.startsWith('\uFEFF')) {
        scriptContent = '\uFEFF' + scriptContent;
      }
      fs.writeFileSync(tempPath, scriptContent, 'utf8');

      return await new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempPath], { timeout: 8000, windowsHide: true }, (err, stdout) => {
          if (err) return resolve({ ok: false, error: err.message });
          const out = String(stdout).trim();
          resolve(out === 'OK' ? { ok: true } : { ok: false, error: '未找到控制面板窗口（播放器未运行或已完全关闭）' });
        });
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('config:setObs', (_e, obs) => {
    config.obs = { url: obs?.url || 'ws://127.0.0.1:4455', password: obs?.password || '', browserSource: obs?.browserSource || '' };
    configStore.save(config);
    return config.obs;
  });
  ipcMain.handle('config:setSelected', (_e, id) => { config.selectedServiceId = id; configStore.save(config); });
  ipcMain.handle('app:openExternal', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url); });

  // 互动悬浮窗
  ipcMain.handle('float:open', () => createFloatWindow());
  ipcMain.handle('float:hide', () => { floatWin?.hide(); refreshTray(); });
  ipcMain.handle('float:setOpacity', (_e, v) => {
    const o = Math.min(1, Math.max(0.3, Number(v) || 0.92));
    config.float.opacity = o;
    if (floatWin && !floatWin.isDestroyed()) floatWin.setOpacity(o);
    configStore.save(config);
    pushFloatState();
  });
  ipcMain.handle('float:setLocked', (_e, v) => setFloatLocked(v));
  ipcMain.handle('float:setFontSize', (_e, v) => {
    config.float.fontSize = Math.min(18, Math.max(11, Math.round(Number(v)) || 13));
    configStore.save(config);
    pushFloatState();
  });
  ipcMain.handle('float:setDetails', (_e, v) => {
    config.float.detailsCollapsed = Boolean(v);
    configStore.save(config);
    pushFloatState();
  });

  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:hide', () => win?.hide());
  ipcMain.handle('win:close', () => { if (config.closeToTray) win?.hide(); else { app.isQuitting = true; app.quit(); } });
}

function findRt(id) { return runtimes.find((rt) => rt.def.id === id); }

// ---------------- 启动 ----------------
// 开发版独立 userData，避免与打包版/残留孤儿锁冲突
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'LiveControl-dev'));
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  app.whenReady().then(() => {
    try {
    app.setAppUserModelId('com.livecontrol.app');

    runtimes = SERVICE_DEFS.map((def) => new ServiceRuntime(def));
    health = new HealthMonitor(runtimes);
    orchestrator = new Orchestrator(runtimes, health);

    for (const rt of runtimes) {
      rt.on('state', () => pushState(rt));
      rt.on('log', (rt2, line) => push('svc:log', { id: rt2.def.id, line }));
    }
    orchestrator.on('step', (text) => push('stream:step', text));
    orchestrator.on('finished', () => push('stream:finished', {}));

    registerIpc();

    if (isSelfTest) {
      health.start();
      setTimeout(() => runSelfTest(), 500);
      return;
    }

    createWindow();
    createTray();
    health.start();
    } catch (err) { console.error('[LiveControl] 启动异常:', err); }

    app.on('activate', () => { if (win === null) createWindow(); });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    // 退出时【不】清理服务子进程：控制台只是管理面板，关闭它不应连带停止正在直播的服务
    // （停止服务请用「一键下播」或服务行「停止」按钮）
    health?.stop();
  });

  app.on('window-all-closed', () => { /* 保持托盘驻留 */ });
}
