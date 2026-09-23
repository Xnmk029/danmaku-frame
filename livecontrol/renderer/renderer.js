// 直播控制台 - renderer（MD3 组件 UI 逻辑）
// 打包入口：esbuild 会把 @material/web 全部内联为单文件（file:// 下模块 import 受限）
import '@material/web/all.js';
import { initInteraction } from './interaction.js';
import { initLiveInfo } from './liveinfo.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const api = window.lc;

// ---------------- 状态 ----------------
const svcMap = new Map();   // id -> { ...snapshot, logEl }
const config = { theme: 'dark', logsExpanded: true };
let selectedId = null;
let streamBusy = false;
let logRenderTimer = null;
let iaApi = null;           // 直播互动面板句柄（initInteraction 返回）
let liApi = null;           // 直播信息页句柄（initLiveInfo 返回）

const STATE_COLOR = {
  running: 'var(--md-lc-success)',
  degraded: 'var(--md-lc-warning)',
  error: 'var(--md-sys-color-error)',
  starting: 'var(--md-sys-color-tertiary)',
  stopping: 'var(--md-sys-color-tertiary)',
  stopped: 'var(--md-sys-color-on-surface-variant)',
};

// ---------------- 服务列表渲染 ----------------
function renderService(svc) {
  const item = document.createElement('md-list-item');
  item.id = `svc-${svc.id}`;
  item.dataset.id = svc.id;

  const headline = document.createElement('div');
  headline.className = 'headline-row';
  headline.innerHTML = `
    <span class="svc-name">${escapeHtml(svc.name)}</span>
    <span class="state-dot" style="background:${STATE_COLOR[svc.state]}"></span>
    <span class="state-label">${escapeHtml(svc.stateLabel)}</span>`;

  const supporting = document.createElement('div');
  supporting.textContent = svc.desc;

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  let extra = '';
  if (svc.id === 'facetrack') {
    extra = `<md-text-button data-act="face-settings">设置</md-text-button>`;
  } else if (svc.id === 'avatar') {
    extra = `<md-text-button data-act="l2d-panel">面板</md-text-button>`;
  }
  actions.innerHTML = `
    <md-text-button data-act="start">启动</md-text-button>
    <md-filled-tonal-button data-act="stop" class="stop-btn">停止</md-filled-tonal-button>
    <md-text-button data-act="restart">重启</md-text-button>
    <md-text-button data-act="log">日志</md-text-button>
    ${extra}`;

  const icon = document.createElement('md-icon');
  icon.slot = 'start';
  icon.className = 'svc-icon';
  icon.textContent = svc.icon;

  headline.slot = 'headline';
  supporting.slot = 'supporting-text';
  actions.slot = 'end';

  item.append(icon, headline, supporting, actions);
  svcMap.set(svc.id, { ...svc, el: item });
  $('serviceList').append(item);
}

function updateService(p) {
  const s = svcMap.get(p.id);
  if (!s) return;
  Object.assign(s, p);
  const dot = s.el.querySelector('.state-dot');
  dot.style.background = STATE_COLOR[p.state] || 'var(--md-sys-color-on-surface-variant)';
  s.el.querySelector('.state-label').textContent = p.stateLabel;
}

// ---------------- 日志 ----------------
function selectService(id) {
  selectedId = id;
  api.setSelected(id);
  const s = svcMap.get(id);
  if (!s) return;
  $('logTitle').textContent = `日志 — ${s.name}`;
  const body = $('logBody');
  body.textContent = '';
  if (s.logs) {
    for (const line of s.logs) body.append(makeLogLine(line));
  }
  body.scrollTop = body.scrollHeight;
  $$('.service-list md-list-item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
}

function makeLogLine(text) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = text;
  return div;
}

function appendLog(p) {
  const s = svcMap.get(p.id);
  if (!s) return;
  s.logs = s.logs || [];
  s.logs.push(p.line);
  if (s.logs.length > 5000) s.logs.splice(0, s.logs.length - 5000);
  if (p.id !== selectedId) return;
  const body = $('logBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  body.append(makeLogLine(p.line));
  if (atBottom) body.scrollTop = body.scrollHeight;
}

// ---------------- 主题 ----------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('btnTheme').querySelector('md-icon');
  icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

// ---------------- 工具 ----------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- 待机页倒计时（快速调整） ----------------
const standby = { duration: 120, mode: 'countdown', scene: '' };

const STANDBY_BASE = 'http://127.0.0.1:7788/standby.html';

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} 秒`;
}

function standbyUrl() {
  const p = new URLSearchParams({ duration: String(standby.duration), mode: standby.mode });
  if (standby.scene) p.set('obsScene', standby.scene);
  return `${STANDBY_BASE}?${p.toString()}`;
}

function renderStandby() {
  $('standbyUrl').textContent = standbyUrl();
  $('standbyUrl').title = standbyUrl();
  $('standbySeconds').value = String(standby.duration);
  $('standbyModeSet').querySelectorAll('md-filter-chip').forEach((chip) => {
    chip.selected = chip.dataset.mode === standby.mode;
  });
}

function bindStandby() {
  // 快捷时长
  $('standbyChips').addEventListener('click', async (e) => {
    const btn = e.target.closest('md-text-button[data-sec]');
    if (!btn) return;
    standby.duration = Number(btn.dataset.sec);
    api.setStandbyDuration(standby.duration);
    renderStandby();
  });

  // 精确秒数 + 应用
  $('btnStandbyApply').addEventListener('click', async () => {
    const sec = Math.min(3600, Math.max(10, parseInt($('standbySeconds').value, 10) || 120));
    standby.duration = sec;
    api.setStandbyDuration(sec);
    renderStandby();
  });
  $('standbySeconds').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btnStandbyApply').click();
  });

  // 模式切换（md-filter-chip 无 value 属性，用 data-mode；不派发 change，只有 redispatch 的 click）
  $('standbyModeSet').addEventListener('click', async (e) => {
    const chip = e.target.closest('md-filter-chip');
    if (!chip || !chip.selected) return;
    standby.mode = chip.dataset.mode;
    api.setStandbyMode(standby.mode);
    renderStandby();
  });

  // 复制 URL
  $('btnStandbyCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(standbyUrl());
      $('btnStandbyCopy').label = '已复制';
      setTimeout(() => { $('btnStandbyCopy').label = '复制 URL'; }, 1500);
    } catch { /* 剪贴板不可用 */ }
  });

  // 预览（浏览器打开）
  $('btnStandbyPreview').addEventListener('click', () => api.openExternal(standbyUrl()));

  // 应用到 OBS（更新浏览器源 URL + 刷新）
  $('btnStandbyApply').addEventListener('click', async () => {
    const btn = $('btnStandbyApply');
    btn.label = '应用中…';
    btn.disabled = true;
    try {
      const res = await api.applyStandbyToObs();
      if (res.ok) showToast(`已应用到 OBS 源「${res.inputName}」`);
      else showToast('应用失败：' + (res.error || '未知错误'));
    } finally {
      btn.label = '应用到 OBS';
      btn.disabled = false;
    }
  });
}

// ---------------- 弹幕朗读（Edge TTS） ----------------
// 直接调用弹幕姬 HTTP API（回环）；服务端已对回环请求放行 CORS。
const TTS_BASE = 'http://127.0.0.1:7788';
// 音色列表 = Edge Read Aloud 真实支持集（经 getVoices() 核验；列表外音色会合成断连）
const TTS_VOICES = [
  ['zh-CN-XiaoxiaoNeural', '晓晓 Xiaoxiao · 女声 · 通用'],
  ['zh-CN-XiaoyiNeural', '晓伊 Xiaoyi · 女声 · 活力'],
  ['zh-CN-YunxiNeural', '云希 Yunxi · 男声 · 少年'],
  ['zh-CN-YunjianNeural', '云健 Yunjian · 男声 · 沉稳'],
  ['zh-CN-YunyangNeural', '云扬 Yunyang · 男声 · 新闻'],
  ['zh-CN-YunxiaNeural', '云夏 Yunxia · 男声 · 阳光'],
  ['zh-CN-liaoning-XiaobeiNeural', '晓北 Xiaobei · 女声 · 东北话'],
  ['zh-CN-shaanxi-XiaoniNeural', '晓妮 Xiaoni · 女声 · 陕西话'],
  ['zh-HK-HiuGaaiNeural', '晓佳 HiuGaai · 粤语 · 女声'],
  ['zh-HK-HiuMaanNeural', '晓曼 HiuMaan · 粤语 · 女声'],
  ['zh-HK-WanLungNeural', '云龙 WanLung · 粤语 · 男声'],
  ['zh-TW-HsiaoChenNeural', '曉臻 HsiaoChen · 台湾 · 女声'],
  ['zh-TW-YunJheNeural', '雲哲 YunJhe · 台湾 · 男声'],
  ['zh-TW-HsiaoYuNeural', '曉雨 HsiaoYu · 台湾 · 女声'],
  ['en-US-AriaNeural', 'Aria · 英语 · 女声'],
  ['en-US-JennyNeural', 'Jenny · 英语 · 女声'],
  ['en-US-GuyNeural', 'Guy · 英语 · 男声'],
  ['en-US-BrianNeural', 'Brian · 英语 · 男声'],
  ['en-US-EmmaNeural', 'Emma · 英语 · 女声'],
  ['en-US-AndrewNeural', 'Andrew · 英语 · 男声'],
  ['ja-JP-NanamiNeural', 'Nanami · 日语 · 女声'],
  ['ja-JP-KeitaNeural', 'Keita · 日语 · 男声'],
];

const tts = {
  online: false,
  enabled: false,
  provider: 'edge',
  voice: 'zh-CN-XiaoxiaoNeural',
  mimoVoice: 'mimo_default',
  fishVoice: '',
  fishAvailable: false,
  fishModel: '',
  noPrefixForMedalGuard: false,
  rate: 0,
  pitch: 0,
  playerVolume: 100,
  gain: 100,
  playing: null,
  queueCount: 0,
  spokenCount: 0,
  skippedCount: 0,
  lastError: '',
  designs: [],
  designsEnabled: false,
};

const ttsFmtRate = (v) => `${v >= 0 ? '+' : ''}${v}%`;
const ttsFmtPitch = (v) => `${v >= 0 ? '+' : ''}${v}Hz`;

async function ttsApi(path, options = {}) {
  const res = await fetch(TTS_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload.error) detail = payload.error;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

// MIMO（小米 MiMo-TTS v2.5）音色
const MIMO_VOICES = [
  ['mimo_default', '默认音色 · 中文（冰糖）'],
  ['冰糖', '冰糖 · 中文女声'],
  ['茉莉', '茉莉 · 中文女声'],
  ['苏打', '苏打 · 中文男声'],
  ['白桦', '白桦 · 中文男声'],
  ['Mia', 'Mia · 英文女声'],
  ['Chloe', 'Chloe · 英文女声'],
  ['Milo', 'Milo · 英文男声'],
  ['Dean', 'Dean · 英文男声'],
];

const PROVIDER_LABEL = { edge: 'EDGE', mimo: 'MIMO', hybrid: 'HYBRID', fish: 'FISH AUDIO' };

function fillTtsVoices() {
  // 双音色空间：ttsVoice = Edge 列表，ttsMimoVoice = MIMO 列表（一次填充，不随 provider 重建）
  for (const [selectId, list] of [['ttsVoice', TTS_VOICES], ['ttsMimoVoice', MIMO_VOICES]]) {
    const select = $(selectId);
    select.innerHTML = '';
    for (const [id, label] of list) {
      const opt = document.createElement('md-select-option');
      opt.value = id;
      opt.textContent = label;
      select.append(opt);
    }
  }
}

/** provider 驱动的可见性：edge→仅 Edge 音色；mimo→仅 MIMO 音色；hybrid→两者 */
function applyProviderUI() {
  $('ttsVoiceEdgeField').style.display = ['edge', 'hybrid'].includes(tts.provider) ? '' : 'none';
  $('ttsVoiceMimoField').style.display = ['mimo', 'hybrid'].includes(tts.provider) ? '' : 'none';
  $('ttsVoiceFishField').style.display = tts.provider === 'fish' ? '' : 'none';
  $('ttsFishHint').textContent = tts.provider === 'fish'
    ? `Fish Audio · ${tts.fishModel} · ${tts.fishAvailable ? 'API Key 已配置' : '请在服务端配置 FISH_AUDIO_API_KEY'}。支持语速与播放音量；音调、增益和 MIMO 音色设计不适用。`
    : (tts.fishAvailable ? '' : 'Fish Audio：配置服务端 FISH_AUDIO_API_KEY 后可切换，音色使用 Fish Audio reference_id。');
  const providerEl = $('ttsProvider');
  if (providerEl) providerEl.textContent = PROVIDER_LABEL[tts.provider] || 'EDGE';
}

function ttsSetEnabled(enabled) {
  for (const id of ['swTts', 'ttsVoice', 'ttsMimoVoice', 'ttsFishVoice', 'ttsRate', 'ttsPitch', 'ttsVol', 'ttsGain', 'btnTtsPlay', 'btnTtsSkip', 'swTtsNoPrefix']) {
    $(id).disabled = !enabled;
  }
  // 纯 MIMO 引擎不支持语速/音调/增益（合成参数），禁用对应滑块；hybrid 下 Edge 通道仍生效
  if (enabled && tts.provider === 'mimo') {
    for (const id of ['ttsRate', 'ttsPitch', 'ttsGain']) $(id).disabled = true;
  }
  if (enabled && tts.provider === 'fish') {
    for (const id of ['ttsPitch', 'ttsGain']) $(id).disabled = true;
  }
}
function renderTts() {
  const online = tts.online;
  const badge = $('ttsOnline');
  badge.textContent = online ? 'ONLINE' : 'OFFLINE';
  badge.classList.toggle('online', online);
  // provider 徽章 + 音色字段可见性
  applyProviderUI();
  ttsSetEnabled(online);

  /** 防抖期间避免把用户正在拖动的滑块值覆盖回去 */
  if (!tts._uiDirty) {
    $('swTts').checked = online && tts.enabled;
    $('swTtsNoPrefix').checked = tts.noPrefixForMedalGuard;
    const edgeOk = TTS_VOICES.some(([id]) => id === tts.voice);
    $('ttsVoice').value = edgeOk ? tts.voice : TTS_VOICES[0][0];
    const mimoOk = MIMO_VOICES.some(([id]) => id === tts.mimoVoice);
    $('ttsMimoVoice').value = mimoOk ? tts.mimoVoice : MIMO_VOICES[0][0];
    if (document.activeElement !== $('ttsFishVoice')) $('ttsFishVoice').value = tts.fishVoice;
    $('ttsRate').value = tts.rate;
    $('ttsPitch').value = tts.pitch;
    $('ttsVol').value = tts.playerVolume;
    $('ttsGain').value = tts.gain;
  }
  $('ttsRateVal').textContent = ttsFmtRate(tts.rate);
  $('ttsPitchVal').textContent = ttsFmtPitch(tts.pitch);
  $('ttsVolVal').textContent = tts.playerVolume;
  $('ttsGainVal').textContent = `${tts.gain}%`;

  let status = '未在朗读';
  if (tts.playing) {
    status = `正在朗读 <span class="tts-now-user">${escapeHtml(tts.playing.user)}</span>：${escapeHtml(tts.playing.text)}`;
  } else if (tts.queueCount > 0) {
    status = `队列 ${tts.queueCount} 条待朗读`;
  }
  if (tts.lastError) status += ` · 错误: ${escapeHtml(tts.lastError)}`;
  if (tts.spokenCount || tts.skippedCount) {
    status += ` · 已朗读 ${tts.spokenCount} / 跳过 ${tts.skippedCount}`;
  }
  $('ttsStatus').innerHTML = status;

  // 最近处理记录列表
  const recentEl = $('ttsRecent');
  if (recentEl) {
    recentEl.innerHTML = '';
    if (!(tts.recent || []).length) {
      recentEl.innerHTML = '<div class="rec" style="opacity:.6">尚无弹幕记录</div>';
    } else {
      for (const rec of tts.recent) {
        const row = document.createElement('div');
        row.className = 'rec';
        const read = rec.action === 'read';
        row.innerHTML =
          `<span class="rec-act ${read ? 'read' : 'skipped'}">${read ? '朗读' : '跳过'}</span>` +
          `<span class="rec-user">${escapeHtml(rec.user)}</span>` +
          `<span class="rec-text">${escapeHtml(rec.text)}</span>` +
          (rec.engine ? `<span class="rec-reason">${rec.engine.toUpperCase()}</span>` : '') +
          (rec.reason ? `<span class="rec-reason">${escapeHtml(rec.reason)}</span>` : '');
        recentEl.append(row);
      }
    }
  }

  // 音色注册表
  const designCountEl = $('ttsDesignCount');
  if (designCountEl) designCountEl.textContent = tts.designs.length;
  const designsEl = $('ttsDesigns');
  if (designsEl) {
    designsEl.innerHTML = '';
    if (!tts.designsEnabled) {
      designsEl.innerHTML = '<div class="design-empty">音色注册功能未开启</div>';
    } else if (!(tts.designs || []).length) {
      designsEl.innerHTML = '<div class="design-empty">暂无观众注册音色</div>';
    } else {
      for (const d of tts.designs) {
        const row = document.createElement('div');
        row.className = 'design-row';
        const date = new Date(d.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        row.innerHTML =
          `<span class="design-user">${escapeHtml(d.user)}</span>` +
          `<span class="design-uid">${d.uid}</span>` +
          `<span class="design-prompt"${d.rawPrompt ? ` title="细化后：${escapeHtml(d.prompt)}"` : ''}>${escapeHtml(d.rawPrompt || d.prompt)}</span>` +
          `<span class="design-time">${date}</span>` +
          `<span class="design-acts">` +
            `<md-icon-button class="btn-design-test" data-uid="${d.uid}" title="试听"><md-icon>play_arrow</md-icon></md-icon-button>` +
            `<md-icon-button class="btn-design-delete" data-uid="${d.uid}" title="删除"><md-icon>delete</md-icon></md-icon-button>` +
          `</span>`;
        designsEl.append(row);
      }
      // 试听 / 删除
      for (const btn of designsEl.querySelectorAll('.btn-design-test')) {
        btn.addEventListener('click', async () => {
          try {
            await ttsApi('/api/tts/voice-designs/test', {
              method: 'POST',
              body: JSON.stringify({ uid: btn.dataset.uid, text: '欢迎来到直播间，这是音色设计试听。' }),
            });
            showToast('试听已加入队列');
          } catch (error) { showToast('试听失败: ' + error.message); }
        });
      }
      for (const btn of designsEl.querySelectorAll('.btn-design-delete')) {
        btn.addEventListener('click', async () => {
          try {
            await ttsApi('/api/tts/voice-designs/delete', {
              method: 'POST',
              body: JSON.stringify({ uid: btn.dataset.uid }),
            });
            showToast('已删除');
            await loadTtsDesigns();
          } catch (error) { showToast('删除失败: ' + error.message); }
        });
      }
    }
  }
}

async function loadTtsDesigns() {
  try {
    const d = await ttsApi('/api/tts/voice-designs');
    tts.designsEnabled = d.enabled;
    tts.designs = (d.users || []).slice(0, 100);
  } catch {
    tts.designsEnabled = false;
    tts.designs = [];
  }
}

async function loadTts() {
  try {
    const [s, d] = await Promise.all([ttsApi('/api/tts/state'), ttsApi('/api/tts/voice-designs')]);
    tts.online = true;
    tts.enabled = Boolean(s.enabled);
    tts.provider = s.provider || 'edge';
    tts.fishAvailable = Boolean(s.fishAvailable);
    tts.fishModel = s.fishModel || 's2.1-pro';
    // 引擎选择器同步
    const providerSelect = $('ttsProviderSelect');
    if (providerSelect && providerSelect.value !== tts.provider) providerSelect.value = tts.provider;
    // 参数仅在非编辑状态下回填（编辑期以控件/DOM 为准，
    // 避免 3s 轮询把用户刚调的值回写覆盖，导致保存请求发出旧值）
    if (!tts._uiDirty) {
      const set = s.settings || {};
      tts.voice = set.voice || TTS_VOICES[0][0];
      tts.mimoVoice = set.mimoVoice || MIMO_VOICES[0][0];
      tts.fishVoice = set.fishVoice || '';
      tts.noPrefixForMedalGuard = Boolean(set.noPrefixForMedalGuard);
      tts.rate = parseInt(/^([+-]?\d+)/.exec(set.rate || '')?.[1] || 0, 10);
      tts.pitch = parseInt(/^([+-]?\d+)/.exec(set.pitch || '')?.[1] || 0, 10);
      tts.playerVolume = typeof set.playerVolume === 'number' ? set.playerVolume : 100;
      tts.gain = typeof set.gain === 'number' ? set.gain : 100;
    }
    tts.playing = s.playing || null;
    tts.queueCount = s.queueCount || 0;
    tts.spokenCount = s.spokenCount || 0;
    tts.skippedCount = s.skippedCount || 0;
    tts.lastError = s.lastError || '';
    tts.recent = (s.recent || []).slice(0, 8);
    tts.voiceDesign = s.voiceDesign || { enabled: false, count: 0 };
    tts.designsEnabled = d.enabled;
    tts.designs = (d.users || []).slice(0, 100);
    // 音色列表只在首次或需要时填充一次（固定双列表）
    if (!$('ttsVoice').options.length) fillTtsVoices();
  } catch {
    tts.online = false;
  }
  renderTts();
}

function bindTts() {
  fillTtsVoices();

  // 主标签页切换（服务管理 / 弹幕朗读）——事件 + 轮询双保险
  let lastTabIdx = 0;
  const applyTab = (idx) => {
    $('svcView').style.display = idx === 0 ? '' : 'none';
    $('ttsPanel').style.display = idx === 1 ? '' : 'none';
    $('interactPanel').style.display = idx === 2 ? '' : 'none';
    $('liveView').style.display = idx === 3 ? '' : 'none';
    if (idx === 1) {
      // 强制重排（组件在隐藏容器中初始化后布局可能异常）
      void $('ttsPanel').offsetHeight;
      setTimeout(() => { void $('ttsPanel').offsetHeight; }, 120);
      loadTts(); // 进入 TTS 页时立即刷新内容
    }
    if (idx === 2) {
      void $('interactPanel').offsetHeight;
      setTimeout(() => { void $('interactPanel').offsetHeight; }, 120);
      iaApi?.activate();
    }
    if (idx === 3) {
      void $('liveView').offsetHeight;
      setTimeout(() => { void $('liveView').offsetHeight; }, 120);
      liApi?.activate();
    }
  };
  $('mainTabs').addEventListener('change', () => {
    lastTabIdx = $('mainTabs').activeTabIndex;
    applyTab(lastTabIdx);
  });
  setInterval(() => {
    const idx = $('mainTabs').activeTabIndex;
    if (idx !== lastTabIdx) {
      lastTabIdx = idx;
      applyTab(idx);
    }
  }, 500);

  // 引擎切换（Edge / MIMO / Hybrid）
  $('ttsProviderSelect').addEventListener('change', async () => {
    const provider = $('ttsProviderSelect').value;
    try {
      await ttsApi('/api/tts/provider', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      const msg = { edge: '已切换 Edge TTS（全功能）', mimo: '已切换 MIMO TTS（小米）', hybrid: '已切换混合路由（粉丝牌→MIMO）', fish: '已切换 Fish Audio，请设置音色 ID 后试听' };
      showToast(msg[provider] || `已切换 ${provider}`);
      loadTts();
    } catch (error) {
      showToast('引擎切换失败: ' + error.message);
      loadTts();
    }
  });

  // 朗读主开关
  $('swTts').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    // 立即同步本地状态并进入编辑态：防止 3s 轮询把开关弹回旧值（视觉回弹）
    tts.enabled = enabled;
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1500);
    renderTts();
    try {
      await ttsApi('/api/tts/enabled', { method: 'POST', body: JSON.stringify({ enabled }) });
      showToast(enabled ? '弹幕朗读已开启' : '弹幕朗读已关闭');
    } catch (error) {
      showToast('朗读开关失败: ' + error.message);
      tts.enabled = !enabled;
      renderTts();
    }
  });

  // 粉丝牌/舰长不读前缀开关
  $('swTtsNoPrefix').addEventListener('change', () => {
    tts.noPrefixForMedalGuard = $('swTtsNoPrefix').checked;
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1500);
    saveTtsSettings();
  });

  // 音色选择（双空间：Edge / MIMO）
  $('ttsVoice').addEventListener('change', () => {
    tts.voice = $('ttsVoice').value || TTS_VOICES[0][0];
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1500);
    saveTtsSettings();
  });
  $('ttsMimoVoice').addEventListener('change', () => {
    tts.mimoVoice = $('ttsMimoVoice').value || MIMO_VOICES[0][0];
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1500);
    saveTtsSettings();
  });
  // 刷新音色注册表
  $('ttsFishVoice').addEventListener('change', () => {
    tts.fishVoice = $('ttsFishVoice').value.trim();
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1500);
    saveTtsSettings();
  });
  $('btnTtsDesignsRefresh').addEventListener('click', async () => {
    await loadTtsDesigns();
    renderTts();
  });

  // 滑块：实时更新数值显示并防抖保存。
  // md-slider（非 range）不 redispatch input 事件（shadow DOM 不透传），
  // 因此采用「150ms 轮询 value + change 兜底」，不依赖 input 事件。
  const TTS_SLIDERS = [
    { id: 'ttsRate', key: 'rate', fmt: v => ttsFmtRate(v) },
    { id: 'ttsPitch', key: 'pitch', fmt: v => ttsFmtPitch(v) },
    { id: 'ttsVol', key: 'playerVolume', fmt: v => String(v) },
    { id: 'ttsGain', key: 'gain', fmt: v => `${v}%` },
  ];
  const sliderShadow = {};
  const ttsApplySlider = (spec, v) => {
    tts[spec.key] = v;
    if (spec.fmt) $(`${spec.id}Val`).textContent = spec.fmt(v);
    tts._uiDirty = true;
    clearTimeout(tts._uiDirtyTimer);
    tts._uiDirtyTimer = setTimeout(() => { tts._uiDirty = false; }, 1000);
    saveTtsSettings();
  };

  for (const spec of TTS_SLIDERS) {
    sliderShadow[spec.key] = Number($(spec.id).value);
    // change（松手/键盘）一定 redispatch，作为轮询之外的事件兜底
    $(spec.id).addEventListener('change', () => {
      const v = Number($(spec.id).value);
      sliderShadow[spec.key] = v;
      ttsApplySlider(spec, v);
    });
  }
  // 轮询：md-slider 拖动期间 value 属性实时更新，input 事件却不可用
  setInterval(() => {
    for (const spec of TTS_SLIDERS) {
      const v = Number($(spec.id).value);
      if (v !== sliderShadow[spec.key]) {
        sliderShadow[spec.key] = v;
        ttsApplySlider(spec, v);
      }
    }
  }, 150);

  // 试听 / 跳过
  $('btnTtsPlay').addEventListener('click', async () => {
    try {
      await ttsApi('/api/tts/test', {
        method: 'POST',
        body: JSON.stringify({ text: '欢迎来到直播间，这是当前音色的试听效果。' }),
      });
      showToast('试听已进入播放队列');
      loadTts();
    } catch (error) { showToast('试听失败: ' + error.message); }
  });
  $('btnTtsSkip').addEventListener('click', async () => {
    try {
      await ttsApi('/api/tts/skip', { method: 'POST' });
    } catch (error) { showToast('跳过失败: ' + error.message); }
  });
}

let ttsSaveTimer = null;
function saveTtsSettings() {
  clearTimeout(ttsSaveTimer);
  ttsSaveTimer = setTimeout(async () => {
    try {
      // 直接读 DOM 当前值发送（绝不依赖 tts.* 变量：它们可能被 3s 轮询回写污染）
      await ttsApi('/api/tts/settings', {
        method: 'POST',
        body: JSON.stringify({
          voice: $('ttsVoice').value || TTS_VOICES[0][0],
          mimoVoice: $('ttsMimoVoice').value || MIMO_VOICES[0][0],
          fishVoice: $('ttsFishVoice').value.trim(),
          noPrefixForMedalGuard: $('swTtsNoPrefix').checked,
          rate: ttsFmtRate(Number($('ttsRate').value)),
          pitch: ttsFmtPitch(Number($('ttsPitch').value)),
          playerVolume: Number($('ttsVol').value),
          gain: Number($('ttsGain').value),
        }),
      });
      showToast('朗读音色/语速/音调已更新');
      loadTts();
    } catch (error) {
      showToast('调音保存失败: ' + error.message);
    }
  }, 350);
}

// ---------------- 面捕设置弹窗 ----------------
const faceState = { capture: '0', fps: 24, model: 3, visualize: true };

function openFaceDialog() {
  $('faceCapture').value = faceState.capture;
  $('faceModel').value = String(faceState.model);
  $('faceFps').value = String(faceState.fps);
  $('faceVisualize').selected = faceState.visualize;
  $('faceDialog').show();
}

function bindFaceDialog() {
  $('btnFaceCancel').addEventListener('click', () => $('faceDialog').close());
  $('btnFaceSave').addEventListener('click', async () => {
    faceState.capture = $('faceCapture').value || '0';
    faceState.model = parseInt($('faceModel').value, 10) || 3;
    faceState.fps = Math.min(60, Math.max(1, parseInt($('faceFps').value, 10) || 24));
    faceState.visualize = $('faceVisualize').selected;
    await api.setFace(faceState);
    $('faceDialog').close();
    // 若面捕正在运行，提示重启生效
    const rt = svcMap.get('facetrack');
    if (rt && (rt.state === 'running' || rt.state === 'degraded')) {
      showToast('面捕设置已保存，重启面捕后生效');
    }
  });
  // 摄像头探测
  $('btnScanCam').addEventListener('click', async () => {
    const btn = $('btnScanCam');
    btn.label = '探测中…';
    btn.disabled = true;
    try {
      const res = await api.listCameras();
      const select = $('faceCapture');
      select.innerHTML = '';
      if (!res.ok) {
        select.innerHTML = `<md-select-option value="0">摄像头 0</md-select-option>`;
        showToast('探测失败：' + (res.error || '未知'));
        return;
      }
      // facetracker --list-cameras 输出：'0: 名称' 或 'Index: name'
      const cams = [];
      for (const line of res.lines) {
        const m = line.match(/^(\d+)\s*[:：]?\s*(.*)$/);
        if (m) cams.push({ id: m[1], name: m[2] || ('摄像头 ' + m[1]) });
      }
      if (!cams.length) {
        // 回退：常见 0~3
        for (let i = 0; i < 4; i++) cams.push({ id: String(i), name: '摄像头 ' + i });
      }
      for (const c of cams) {
        const opt = document.createElement('md-select-option');
        opt.value = c.id;
        opt.textContent = `${c.id}: ${c.name}`;
        select.append(opt);
      }
      select.value = faceState.capture;
      if (!select.value) select.value = cams[0].id;
    } finally {
      btn.label = '探测';
      btn.disabled = false;
    }
  });
}

// L2D 控制面板恢复
async function showL2DPanel() {
  const res = await api.showL2DPanel();
  if (!res.ok) showToast(res.error || '无法打开控制面板');
}

// 简易 Toast
let toastTimer = null;
function showToast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
  $('btnStreamStart').addEventListener('click', () => api.streamStart());
  $('btnStreamStop').addEventListener('click', () => api.streamStop());

  $('btnTheme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    config.theme = next;
    applyTheme(next);
    api.setTheme(next);
  });

  $('btnMinimize').addEventListener('click', () => api.winMinimize());
  $('btnClose').addEventListener('click', () => api.winClose());
  $('btnFloatOpen').addEventListener('click', () => api.floatOpen());

  $('swAutoStart').addEventListener('change', async (e) => {
    const v = await api.toggleAutoStart();
    e.target.checked = v;
  });

  $('btnClearLog').addEventListener('click', () => {
    api.clearLog(selectedId);
    $('logBody').textContent = '';
  });

  $('btnToggleLog').addEventListener('click', () => {
    const panel = $('logPanel');
    panel.classList.toggle('hidden');
    config.logsExpanded = !panel.classList.contains('hidden');
    api.setLogsExpanded(config.logsExpanded);
  });

  // 服务操作（事件委托）
  $('serviceList').addEventListener('click', (e) => {
    const btn = e.target.closest('md-text-button, md-filled-tonal-button');
    if (!btn) return;
    const item = btn.closest('md-list-item');
    const id = item?.dataset.id;
    if (!id) return;
    const act = btn.dataset.act;
    if (act === 'start') api.start(id);
    else if (act === 'stop') api.stop(id);
    else if (act === 'restart') api.restart(id);
    else if (act === 'log') selectService(id);
    else if (act === 'face-settings') openFaceDialog();
    else if (act === 'l2d-panel') showL2DPanel();
  });

  // 点击列表项选择日志
  $('serviceList').addEventListener('click', (e) => {
    const item = e.target.closest('md-list-item');
    if (item && !e.target.closest('md-text-button, md-filled-tonal-button')) {
      selectService(item.dataset.id);
    }
  });

  // 推送
  api.onState((p) => updateService(p));
  api.onLog((p) => appendLog(p));
  api.onStreamStep((text) => { $('streamStatus').textContent = text; streamBusy = true; });
  api.onStreamFinished(() => { streamBusy = false; $('streamStatus').textContent = ''; });
}

// ---------------- 初始化 ----------------
async function loadBiliLogin() {
  try {
    const response = await fetch('http://127.0.0.1:7788/api/bili-auth/state', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('offline');
    const state = await response.json();
    const labels = { valid: 'B站已登录', expired: 'B站登录已失效 · 请扫码', missing: 'B站未登录 · 请扫码', checking: '正在校验登录', network_error: '登录校验网络异常 · 自动重试' };
    $('biliLoginStatus').textContent = labels[state.status] || '请检查B站登录';
    $('biliLoginStatus').title = state.message || '';
    $('biliLoginStatus').style.color = state.status === 'valid' ? 'var(--md-lc-success)' : 'var(--md-lc-warning)';
  } catch { $('biliLoginStatus').textContent = '弹幕服务未启动或需要更新'; }
}

(async function init() {
  $('btnBiliLogin').addEventListener('click', () => api.openExternal('http://127.0.0.1:7788/public/bili-auth/'));
  void loadBiliLogin();
  setInterval(loadBiliLogin, 10_000);
  bindEvents();
  bindStandby();
  bindFaceDialog();
  bindTts();
  // 初始切到服务管理 tab（ttsPanel / interactPanel 初始可见以让组件正常初始化，此处隐藏）
  $('svcView').style.display = '';
  $('ttsPanel').style.display = 'none';
  $('interactPanel').style.display = 'none';
  iaApi = initInteraction();
  liApi = initLiveInfo();
  loadTts();
  setInterval(loadTts, 3000); // 跟随健康轮询同步刷新朗读状态
  const data = await api.init();
  Object.assign(config, data.config);
  applyTheme(config.theme);
  $('swAutoStart').checked = config.autoStart;
  if (!config.logsExpanded) $('logPanel').classList.add('hidden');

  if (data.standby) Object.assign(standby, data.standby);
  if (data.face) Object.assign(faceState, data.face);
  renderStandby();

  for (const svc of data.services) renderService(svc);
  const first = data.services.find((s) => s.id === config.selectedServiceId) || data.services[0];
  if (first) selectService(first.id);
})();
