// 直播互动面板 — MD3 风格的弹幕/礼物/SC/上舰/进场统一互动流
// 数据源：danmaku-frame WS 中继 ws://127.0.0.1:7789（实时事件）+ HTTP /api/interaction/state（历史快照）
// 发送：POST /api/danmaku/send（服务端持 Cookie 代发 B站 msg/send，回环免 token）

const API = 'http://127.0.0.1:7788';
const WS_URL = 'ws://127.0.0.1:7789';
const MAX_FEED = 300;          // DOM 中保留的最大消息数
const SEND_MAX_LEN = 40;       // B站弹幕字数上限
const STATE_REFRESH_MS = 15000; // 登录态/统计兜底刷新

const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' };
const FEED_TYPES = new Set(['danmaku', 'gift', 'sc', 'guard', 'entry']);

const ia = {
  connected: false,
  canSend: false,
  roomId: '',
  ownerUid: '',
  paused: false,     // 用户上翻时暂停吸附
  sending: false,
  mention: null,     // {uid, uname} @提及（对应 msg/send 的 reply_mid/reply_uname）
};

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- 徽标 ----------------
function badgesHtml(ev) {
  let h = '';
  if (ev.medal?.name) h += `<span class="ia-medal">${escapeHtml(ev.medal.name)} ${ev.medal.lv}</span>`;
  if (ev.isOwner) h += '<span class="ia-tag ia-tag-owner">主播</span>';
  if (ev.admin) h += '<span class="ia-tag ia-tag-admin">房管</span>';
  const guard = ev.guard || ev.guardLevel || 0;
  if (guard > 0) h += `<span class="ia-tag ia-tag-guard">${GUARD_NAMES[guard] || '大航海'}</span>`;
  return h;
}

/** 把 [表情名] 占位符替换为表情 img；其余文本转义输出 */
function appendRichText(container, text, emots) {
  if (!emots?.length) {
    container.textContent = text;
    return;
  }
  const byKey = new Map(emots.map((e) => [e.key, e]));
  const re = new RegExp(`(${emots.map((e) => e.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) container.append(document.createTextNode(text.slice(last, m.index)));
    const e = byKey.get(m[0]);
    const img = document.createElement('img');
    img.src = e.url;
    img.className = `ia-emot ia-emot-${String(e.size || 'S').toLowerCase()}`;
    img.alt = e.key;
    img.title = e.key;
    img.referrerPolicy = 'no-referrer';
    container.append(img);
    last = m.index + m[0].length;
  }
  if (last < text.length) container.append(document.createTextNode(text.slice(last)));
}

// ---------------- 消息节点 ----------------
function makeMsgNode(ev) {
  const row = document.createElement('div');
  row.className = `ia-msg ia-${ev.type}`;
  row.dataset.ftype = ev.type;
  row.dataset.uid = ev.uid || '';
  row.dataset.uname = ev.user || '';
  const name = `<span class="ia-uname">${escapeHtml(ev.user || '匿名用户')}</span>`;

  switch (ev.type) {
    case 'gift':
      row.innerHTML = `<md-icon class="ia-msg-icon">card_giftcard</md-icon><span class="ia-body">${badgesHtml(ev)}${name}<span class="ia-dim"> 赠送了 </span><b>${escapeHtml(ev.giftName)}</b><span class="ia-dim"> ×${ev.giftCount || 1}</span></span>`;
      break;
    case 'sc':
      row.innerHTML = `<span class="ia-body">${badgesHtml(ev)}${name}<span class="ia-sc-price">¥${ev.price || 0}</span><span class="ia-sc-text"></span></span>`;
      row.querySelector('.ia-sc-text').textContent = ev.message || '';
      break;
    case 'guard':
      row.innerHTML = `<md-icon class="ia-msg-icon">workspace_premium</md-icon><span class="ia-body">${name}<span class="ia-dim"> ${escapeHtml(ev.text || '开通了大航海')}</span></span>`;
      break;
    case 'entry':
      row.innerHTML = `<span class="ia-body">${badgesHtml(ev)}<span class="ia-uname ia-uname-dim">${escapeHtml(ev.user || '访客')}</span><span class="ia-dim"> ${escapeHtml(ev.text || '进入直播间')}</span></span>`;
      break;
    default: { // danmaku
      const body = document.createElement('span');
      body.className = 'ia-body';
      body.innerHTML = `${badgesHtml(ev)}${name}<span class="ia-dim">: </span>`;
      if (ev.bigEmote?.url) {
        const img = document.createElement('img');
        img.src = ev.bigEmote.url;
        img.className = 'ia-bigemote';
        img.alt = '大表情';
        img.referrerPolicy = 'no-referrer';
        body.append(img);
      } else {
        const text = document.createElement('span');
        text.className = 'ia-text';
        appendRichText(text, ev.text || '', ev.emots);
        body.append(text);
      }
      row.append(body);
    }
  }
  return row;
}

// ---------------- Feed ----------------
function feedEl() { return $('iaFeed'); }

function updateEmpty() {
  const feed = feedEl();
  $('iaEmpty').style.display = feed.childElementCount ? 'none' : '';
}

function appendFeed(ev, { animate = true } = {}) {
  const feed = feedEl();
  const node = makeMsgNode(ev);
  if (animate) node.classList.add('ia-enter');
  feed.append(node);
  while (feed.childElementCount > MAX_FEED) feed.firstElementChild.remove();
  updateEmpty();
  if (!ia.paused) feed.scrollTop = feed.scrollHeight;
  else $('iaToBottom').style.display = '';
}

function renderSnapshot(recent) {
  const feed = feedEl();
  feed.textContent = '';
  for (const ev of recent || []) feed.append(makeMsgNode(ev));
  updateEmpty();
  requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
}

// ---------------- 数据栏 / 状态 ----------------
function renderStats(stats) {
  if (!stats) return;
  $('iaPop').textContent = stats.popularity > 0 ? String(stats.popularity) : '–';
  $('iaWatched').textContent = stats.watchedText || (stats.watched > 0 ? String(stats.watched) : '–');
  $('iaLikes').textContent = stats.likes > 0 ? String(stats.likes) : '–';
}

function renderConnection(connected, message) {
  const badge = $('iaOnline');
  badge.textContent = connected ? 'ONLINE' : 'OFFLINE';
  badge.classList.toggle('online', connected);
  $('iaRoom').textContent = ia.roomId ? `房间 ${ia.roomId}` : '';
  if (!connected && message) $('iaRoom').textContent = message;
}

function renderSendGate() {
  const input = $('iaInput');
  const btn = $('iaSend');
  const hint = $('iaHint');
  const usable = ia.connected && ia.canSend && !ia.sending;
  input.disabled = !usable;
  btn.disabled = !usable || !input.value.trim();
  if (!ia.connected) hint.textContent = '弹幕服务未连接（先启动弹幕姬）';
  else if (!ia.canSend) hint.textContent = '发送弹幕需 B站登录：点顶部「B站扫码登录」';
  else hint.textContent = '';
}

// ---------------- 快照 / 实时 ----------------
async function loadInteractionState() {
  try {
    const res = await fetch(`${API}/api/interaction/state`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    ia.connected = Boolean(s.connected);
    ia.canSend = Boolean(s.canSend);
    ia.roomId = s.roomId || '';
    ia.ownerUid = s.ownerUid || '';
    renderStats(s.stats);
    renderConnection(ia.connected, s.statusMessage);
    renderSendGate();
    return s;
  } catch {
    ia.connected = false;
    renderConnection(false, '');
    renderSendGate();
    return null;
  }
}

function connectWs() {
  let ws;
  try { ws = new WebSocket(WS_URL); } catch { return; }

  ws.onopen = () => {
    // 空 roomId → 服务端默认房间（BILIBILI_ROOM_ID），骑乘现有连接
    ws.send(JSON.stringify({ action: 'subscribe' }));
  };

  ws.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.type === 'status') {
      ia.connected = Boolean(d.connected);
      renderConnection(ia.connected, d.message);
      renderSendGate();
    } else if (d.type === 'popularity') {
      $('iaPop').textContent = String(d.value || 0);
    } else if (d.type === 'watched' || d.type === 'like') {
      // 统计事件：顺手刷新一次快照兜底（低频，服务端聚合格式权威）
      loadInteractionState();
    } else if (FEED_TYPES.has(d.type)) {
      appendFeed(d);
    }
  };

  ws.onclose = () => {
    if (ia.connected) {
      ia.connected = false;
      renderConnection(false, 'OFFLINE');
      renderSendGate();
    }
    setTimeout(connectWs, 3000); // 自动重连（同 index.html 中继客户端）
  };
  ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
}

// ---------------- 发送 ----------------
function renderMention() {
  const chip = $('iaMention');
  if (!chip) return;
  chip.hidden = !ia.mention;
  if (ia.mention) chip.querySelector('.ia-mention-name').textContent = `@${ia.mention.uname}`;
  updateCounter();
}

async function sendDanmaku() {
  const input = $('iaInput');
  const text = [...input.value.trim()].slice(0, SEND_MAX_LEN).join('');
  if (!text || ia.sending) return;
  const mention = ia.mention;
  ia.sending = true;
  renderSendGate();
  try {
    const res = await fetch(`${API}/api/danmaku/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        replyMid: mention?.uid || '',
        replyUname: mention?.uname || '',
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${res.status}`);
    input.value = '';
    ia.mention = null;
    renderMention();
    updateCounter();
  } catch (error) {
    $('iaHint').textContent = `发送失败：${error.message}`;
    setTimeout(renderSendGate, 4000);
  } finally {
    ia.sending = false;
    renderSendGate();
    // 保持输入状态：焦点/光标留在输入框内，发送后可立即打下一条（连发）
    if (!input.disabled) input.focus();
  }
}

function updateCounter() {
  // @提及的 "@昵称 " 前缀计入 40 字上限（服务端按完整 msg 计长）
  const n = $('iaInput').value.length + (ia.mention ? ia.mention.uname.length + 2 : 0);
  const el = $('iaCount');
  el.textContent = `${n}/${SEND_MAX_LEN}`;
  el.classList.toggle('over', n >= SEND_MAX_LEN);
  renderSendGate();
}

// ---------------- 右键菜单（仿官方直播间：去TA空间 / @TA） ----------------
let ctxMenu = null;

function closeCtxMenu() {
  ctxMenu?.remove();
  ctxMenu = null;
}

function openCtxMenu(x, y, { uid, uname }) {
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ia-ctx';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button class="ia-ctx-item" data-act="space" ${uid ? '' : 'disabled'}><md-icon>open_in_new</md-icon>去 TA 的个人空间</button>
    <button class="ia-ctx-item" data-act="at" ${uname ? '' : 'disabled'}><md-icon>alternate_email</md-icon>@TA</button>`;
  document.body.append(menu);
  ctxMenu = menu;
  // 定位并收进视口
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ia-ctx-item');
    if (!item || item.disabled) return;
    if (item.dataset.act === 'space') {
      window.lc?.openExternal(`https://space.bilibili.com/${uid}`);
    } else {
      // @TA：官方协议式提及——uid/uname 作为元数据，发送时带 reply_mid/reply_uname
      ia.mention = { uid, uname };
      renderMention();
      $('iaInput').focus();
    }
    closeCtxMenu();
  });
}

// ---------------- 绑定 ----------------
export function initInteraction() {
  // 类型筛选 chip：data-hide 存放被隐藏的类型集合，CSS 按 data-ftype 隐藏行
  $('iaFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('md-filter-chip');
    if (!chip) return;
    const hidden = new Set((feedEl().dataset.hide || '').split(' ').filter(Boolean));
    if (chip.selected) hidden.delete(chip.dataset.ftype);
    else hidden.add(chip.dataset.ftype);
    feedEl().dataset.hide = [...hidden].join(' ');
  });

  // 滚动吸附：上翻暂停、回底恢复
  const feed = feedEl();
  feed.addEventListener('scroll', () => {
    closeCtxMenu();
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    ia.paused = !atBottom;
    if (atBottom) $('iaToBottom').style.display = 'none';
  });
  feed.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.ia-msg');
    if (!row || (!row.dataset.uid && !row.dataset.uname)) return;
    e.preventDefault();
    openCtxMenu(e.clientX, e.clientY, { uid: row.dataset.uid, uname: row.dataset.uname });
  });
  document.addEventListener('click', (e) => { if (ctxMenu && !e.target.closest('.ia-ctx')) closeCtxMenu(); });
  document.addEventListener('contextmenu', (e) => { if (ctxMenu && !e.target.closest('.ia-ctx,.ia-msg')) closeCtxMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
  window.addEventListener('blur', closeCtxMenu);
  $('iaToBottom').addEventListener('click', () => {
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    ia.paused = false;
    $('iaToBottom').style.display = 'none';
  });

  // 输入栏
  $('iaInput').addEventListener('input', updateCounter);
  $('iaInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendDanmaku(); }
  });
  $('iaSend').addEventListener('click', sendDanmaku);
  $('iaMention')?.querySelector('.ia-mention-x')?.addEventListener('click', () => {
    ia.mention = null;
    renderMention();
    $('iaInput').focus();
  });

  // 初始快照（历史回放）+ WS 实时 + 兜底轮询
  loadInteractionState().then((s) => { if (s) renderSnapshot(s.recent); });
  connectWs();
  setInterval(loadInteractionState, STATE_REFRESH_MS);
  renderSendGate();

  // tab 切入回调：隐藏容器内组件需强制重排 + 回滚到底
  return {
    activate() {
      loadInteractionState();
      requestAnimationFrame(() => { feedEl().scrollTop = feedEl().scrollHeight; });
    },
  };
}
