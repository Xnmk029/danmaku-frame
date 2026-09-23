// 直播信息页 —— 直播中心（link.bilibili.com）内的信息编辑 + 开播/关播（B站侧登记 + 取推流参数）
// 数据面：danmaku-frame HTTP 127.0.0.1:7788 /api/live/*（服务端持 Cookie 代调 B站接口）

const API = 'http://127.0.0.1:7788';
const STATUS_POLL_MS = 60_000; // 顶栏开播状态兜底轮询

const $ = (id) => document.getElementById(id);

const li = {
  info: null,        // getLiveRoomInfo 快照
  areas: [],         // 分区树
  busy: false,       // 开播/关播进行中
  stopArmTimer: null,
};

function hint(msg, isErr = false) {
  const el = $('liHint');
  el.textContent = msg || '';
  el.style.color = isErr ? 'var(--md-sys-color-error)' : '';
}

async function call(path, body) {
  const opts = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(`${API}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload;
}

// ---------------- 顶栏开播开关 ----------------
function renderLiveToggle() {
  const btn = $('btnLiveToggle');
  const label = $('liveToggleLabel');
  if (!btn) return;
  const live = li.info?.liveStatus === 1;
  btn.classList.toggle('is-live', live);
  label.textContent = live ? '直播中' : '开播';
  btn.title = live ? '点击关闭推流（需二次确认）' : '开启推流（B站登记开播并取推流参数）';
}

async function doStart(areaId) {
  const r = await call('/api/live/start', { areaId });
  li.info = { ...(li.info || {}), liveStatus: 1 };
  renderLiveToggle();
  // 展示推流参数（key 每次开播会换）
  if (r.rtmpAddr || r.rtmpCode) {
    $('liRtmp').hidden = false;
    $('liRtmpAddr').textContent = r.rtmpAddr || '–';
    $('liRtmpCode').textContent = r.rtmpCode || '–';
  }
  hint('已开播：推流参数如下，请在 OBS 中确认推流密钥');
}

async function doStop() {
  await call('/api/live/stop', {});
  li.info = { ...(li.info || {}), liveStatus: 0 };
  renderLiveToggle();
  hint('已关闭推流');
}

async function toggleLive() {
  if (li.busy) return;
  const live = li.info?.liveStatus === 1;
  // 关播二次确认（顶栏误点代价高）
  if (live && li.stopArmed !== true) {
    li.stopArmed = true;
    $('liveToggleLabel').textContent = '确认下播?';
    clearTimeout(li.stopArmTimer);
    li.stopArmTimer = setTimeout(() => { li.stopArmed = false; renderLiveToggle(); }, 3000);
    return;
  }
  li.stopArmed = false;
  clearTimeout(li.stopArmTimer);
  li.busy = true;
  try {
    if (live) await doStop();
    else {
      const areaId = li.info?.areaId || Number($('liAreaChild')?.value) || 0;
      if (!areaId) {
        hint('未获取到当前分区，请在「直播信息」页选择分区后开播', true);
        return;
      }
      await doStart(areaId);
    }
  } catch (e) {
    hint(e.message, true);
  } finally {
    li.busy = false;
    renderLiveToggle();
  }
}

// ---------------- 信息加载/渲染 ----------------
function fillInfo(info) {
  li.info = info;
  $('liStatus').textContent = info.liveStatus === 1 ? 'LIVE' : info.liveStatus === 2 ? '轮播' : '未开播';
  $('liStatus').classList.toggle('online', info.liveStatus === 1);
  $('liRoom').textContent = info.roomId ? `房间 ${info.roomId}` : '';
  $('liTitle').value = info.title || '';
  $('liNews').value = info.news || '';
  const img = $('liCoverImg');
  if (info.cover) { img.src = info.cover; img.hidden = false; $('liCoverEmpty').hidden = true; }
  else { img.hidden = true; $('liCoverEmpty').hidden = false; }
  renderLiveToggle();
  // 分区回填
  if (li.areas.length && info.areaId) {
    const parent = li.areas.find((p) => p.list.some((c) => c.id === info.areaId));
    if (parent) {
      $('liAreaParent').value = String(parent.id);
      fillChildAreas(parent.id);
      $('liAreaChild').value = String(info.areaId);
    }
  }
}

function fillChildAreas(parentId) {
  const p = li.areas.find((x) => x.id === Number(parentId));
  const sel = $('liAreaChild');
  sel.innerHTML = '';
  for (const c of p?.list || []) {
    const opt = document.createElement('md-select-option');
    opt.value = String(c.id);
    opt.innerHTML = `<div slot="headline">${c.name}</div>`;
    sel.append(opt);
  }
}

async function loadAll() {
  try {
    const [info, areas] = await Promise.all([
      call('/api/live/info'),
      li.areas.length ? Promise.resolve({ list: li.areas }) : call('/api/live/areas'),
    ]);
    if (!li.areas.length && areas.list?.length) {
      li.areas = areas.list;
      const sel = $('liAreaParent');
      sel.innerHTML = '';
      for (const p of li.areas) {
        const opt = document.createElement('md-select-option');
        opt.value = String(p.id);
        opt.innerHTML = `<div slot="headline">${p.name}</div>`;
        sel.append(opt);
      }
    }
    fillInfo(info);
    hint('');
  } catch (e) {
    hint(e.message, true);
  }
}

// 轻量刷新：只更新顶栏开播状态
async function refreshStatusLite() {
  try {
    const info = await call('/api/live/info');
    li.info = info;
    renderLiveToggle();
    if (info.liveStatus === 1) {
      $('liStatus').textContent = 'LIVE';
      $('liStatus').classList.add('online');
    }
  } catch { /* 弹幕服务未启动时静默 */ }
}

// ---------------- 绑定 ----------------
export function initLiveInfo() {
  // 顶栏开播开关
  $('btnLiveToggle')?.addEventListener('click', toggleLive);

  // 刷新 / 标题 / 公告
  $('liRefresh').addEventListener('click', loadAll);
  $('liTitleSave').addEventListener('click', async () => {
    try {
      const r = await call('/api/live/update', { title: $('liTitle').value });
      const reason = r?.audit?.audit_title_reason;
      hint(reason ? `标题已提交（${reason}）` : '标题已更新');
      loadAll();
    } catch (e) { hint(e.message, true); }
  });
  $('liNewsSave').addEventListener('click', async () => {
    try {
      await call('/api/live/news', { content: $('liNews').value });
      hint('公告已更新');
      loadAll();
    } catch (e) { hint(e.message, true); }
  });

  // 分区级联
  $('liAreaParent').addEventListener('change', () => fillChildAreas($('liAreaParent').value));
  $('liAreaSave').addEventListener('click', async () => {
    const areaId = Number($('liAreaChild').value) || 0;
    if (!areaId) { hint('请先选择二级分区', true); return; }
    try {
      await call('/api/live/update', { areaId });
      hint('分区已更新');
      loadAll();
    } catch (e) { hint(e.message, true); }
  });

  // 封面：file → dataURL → 服务端 upload_bfs → UpdatePreLiveInfo
  $('liCoverBtn').addEventListener('click', () => $('liCoverFile').click());
  $('liCoverFile').addEventListener('change', async () => {
    const file = $('liCoverFile').files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        hint('封面上传中…');
        const r = await call('/api/live/cover', { dataUrl: reader.result });
        $('liCoverImg').src = r.cover;
        $('liCoverImg').hidden = false;
        $('liCoverEmpty').hidden = true;
        hint('封面已更新（审核中可能延迟生效）');
      } catch (e) { hint(e.message, true); }
      $('liCoverFile').value = '';
    };
    reader.readAsDataURL(file);
  });

  // 页内开播/关播（与顶栏同一逻辑）
  $('liStart').addEventListener('click', toggleLive);
  $('liStop').addEventListener('click', toggleLive);

  // 推流参数复制
  const copy = async (id) => {
    try { await navigator.clipboard.writeText($(id).textContent); hint('已复制'); }
    catch { hint('复制失败', true); }
  };
  $('liCopyAddr').addEventListener('click', () => copy('liRtmpAddr'));
  $('liCopyCode').addEventListener('click', () => copy('liRtmpCode'));

  loadAll();
  setInterval(refreshStatusLite, STATUS_POLL_MS);

  return {
    activate() {
      loadAll();
      requestAnimationFrame(() => { void $('liveView').offsetHeight; });
    },
  };
}
