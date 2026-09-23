// 互动悬浮窗 —— 打包入口：复用 interaction.js 全部互动逻辑 + 浮窗自身 chrome（折叠/锁定/透明度/字号/隐藏）
import '@material/web/all.js';
import { initInteraction } from './interaction.js';

const $ = (id) => document.getElementById(id);
const api = window.lc;

const FONT_MIN = 11, FONT_MAX = 18;
let fontSize = 13;

// 互动数据流（WS 订阅 + 快照 + 发送），与主窗口 tab 完全同一套逻辑
initInteraction();

// ---------------- 浮窗 chrome ----------------
function applyLockUI(locked) {
  $('fLock').querySelector('md-icon').textContent = locked ? 'lock' : 'lock_open';
  document.body.classList.toggle('float-locked', locked);
  if (locked) $('iaHint').textContent = '已锁定穿透 · 托盘菜单「悬浮窗鼠标穿透」可解锁';
}

function applyDetailsUI(collapsed) {
  document.body.classList.toggle('float-compact', collapsed);
  $('fDetails').querySelector('md-icon').textContent = collapsed ? 'unfold_more' : 'unfold_less';
  $('fDetails').setAttribute('title', collapsed ? '展开 设置与统计' : '收起 设置与统计');
}

function applyFontSize(px) {
  fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
  document.body.style.setProperty('--ia-font-size', `${fontSize}px`);
}

(async function init() {
  const data = await api.init();
  const f = data.float || {};
  const pct = Math.round((f.opacity ?? 0.92) * 100);
  $('fOpacity').value = pct;
  $('fOpacityVal').textContent = `${pct}%`;
  applyFontSize(f.fontSize ?? 13);
  applyLockUI(!!f.locked);
  applyDetailsUI(!!f.detailsCollapsed);

  // 不透明度滑块：md-slider 不透传 input 事件，用 150ms 轮询 value + change 兜底（同 TTS 滑块约定）
  let last = pct;
  const applyOpacity = (v) => {
    last = v;
    $('fOpacityVal').textContent = `${v}%`;
    api.floatSetOpacity(v / 100);
  };
  $('fOpacity').addEventListener('change', () => applyOpacity(Number($('fOpacity').value)));
  setInterval(() => {
    const v = Number($('fOpacity').value);
    if (v !== last) applyOpacity(v);
  }, 150);

  // 字号 A-/A+（持久化）
  $('fFontMinus').addEventListener('click', () => { applyFontSize(fontSize - 1); api.floatSetFontSize(fontSize); });
  $('fFontPlus').addEventListener('click', () => { applyFontSize(fontSize + 1); api.floatSetFontSize(fontSize); });

  // 折叠低频 UI（统计/筛选/设置行）
  $('fDetails').addEventListener('click', () =>
    api.floatSetDetails(!document.body.classList.contains('float-compact')));

  // 锁定 = 鼠标穿透；解锁走托盘菜单（穿透后窗内不可点击）
  $('fLock').addEventListener('click', () => api.floatSetLocked(true));
  $('fHide').addEventListener('click', () => api.floatHide());

  // 主进程侧状态回推（如托盘解锁）
  api.onFloatState?.((s) => {
    applyLockUI(!!s.locked);
    if (typeof s.detailsCollapsed === 'boolean') applyDetailsUI(s.detailsCollapsed);
    if (typeof s.fontSize === 'number' && s.fontSize !== fontSize) applyFontSize(s.fontSize);
    if (typeof s.opacity === 'number') {
      const v = Math.round(s.opacity * 100);
      if (v !== last) { last = v; $('fOpacity').value = v; $('fOpacityVal').textContent = `${v}%`; }
    }
  });
})();
