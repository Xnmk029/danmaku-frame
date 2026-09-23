const $ = id => document.getElementById(id);
let currentQr = null;
let pollTimer;
let stateTimer;
let generation = 0;
const labels = { valid: '已登录', expired: '登录已失效', missing: '未登录', checking: '检测中', network_error: '网络异常' };

async function request(action, body) {
  const response = await fetch(`/api/bili-auth/${action}`, body === undefined
    ? { signal: AbortSignal.timeout(15_000) }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bili-Control': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请重试');
  return result;
}

async function readState() {
  clearTimeout(stateTimer);
  try {
    const state = await request('state');
    $('badge').textContent = labels[state.status] || '检测中';
    $('badge').className = `badge ${state.status}`;
    $('account').textContent = state.status === 'valid' ? `${state.name || 'B站账号'} · UID ${state.uid}` : 'B站账号';
    $('status').textContent = state.message;
    $('checked').textContent = state.checkedAt ? `上次检测：${new Date(state.checkedAt).toLocaleString()}` : '';
    const connection = state.connection;
    $('connection').textContent = connection?.connected
      ? (connection.authMode === 'login' ? '弹幕连接：已通过登录鉴权' : '弹幕连接：游客模式，昵称可能被打码')
      : '弹幕连接：尚未连接或正在重试；OBS 弹幕页面打开后自动连接';
  } catch {
    $('badge').textContent = '服务不可用';
    $('badge').className = 'badge expired';
    $('status').textContent = '无法连接弹幕服务，请确认服务已启动';
    $('connection').textContent = '';
  }
  stateTimer = setTimeout(readState, 5000);
}

async function poll(qr, version) {
  if (version !== generation) return;
  if (Date.now() >= qr.expiresAt) {
    $('qrStatus').textContent = '二维码已过期，请重新生成';
    $('qr').hidden = true;
    return;
  }
  try {
    const result = await request('poll', { id: qr.id });
    if (version !== generation) return;
    $('qrStatus').textContent = result.message;
    if (result.status === 'success' || result.status === 'expired') {
      $('qr').hidden = true;
      currentQr = null;
      await readState();
      return;
    }
  } catch (error) {
    if (version !== generation) return;
    $('qrStatus').textContent = `${error.message}，正在重试`;
  }
  pollTimer = setTimeout(() => poll(qr, version), 2500);
}

$('generate').addEventListener('click', async () => {
  const version = ++generation;
  clearTimeout(pollTimer);
  $('generate').disabled = true;
  $('qr').hidden = true;
  $('qrStatus').textContent = '正在生成二维码…';
  try {
    currentQr = await request('qr', {});
    $('qr').src = currentQr.image;
    $('qr').hidden = false;
    $('qrPlaceholder').hidden = true;
    $('qrStatus').textContent = '请使用哔哩哔哩 APP 扫码';
    $('generate').textContent = '重新生成二维码';
    pollTimer = setTimeout(() => poll(currentQr, version), 2500);
  } catch (error) { $('qrStatus').textContent = error.message; }
  finally { $('generate').disabled = false; }
});
$('check').addEventListener('click', async () => {
  $('check').disabled = true;
  try { await request('check', {}); await readState(); }
  catch (error) { $('status').textContent = error.message; }
  finally { $('check').disabled = false; }
});
window.addEventListener('pagehide', () => { generation++; clearTimeout(pollTimer); clearTimeout(stateTimer); });
void readState();
