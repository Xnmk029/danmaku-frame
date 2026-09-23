import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { getCookieValue } from '../config/env.mjs';

const NAV = 'https://api.bilibili.com/x/web-interface/nav';
const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
export const BILI_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function requestBili(url, cookie = '', fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': BILI_USER_AGENT, Referer: 'https://www.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`B站接口暂不可用（HTTP ${response.status}），将重试`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('B站响应格式异常，将重试'); }
  return { response, payload };
}

// Preserve '=' in values and do not split Expires dates on commas.
export function cookiesFromHeaders(headers) {
  const lines = headers.getSetCookie?.() || (headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/);
  const cookies = new Map();
  for (const line of lines) {
    const pair = line.split(';', 1)[0].trim();
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
}

export class BiliAuthService extends EventEmitter {
  constructor({ file, cookie = '', fetchImpl = fetch, intervalMs = 60_000 }) {
    super();
    this.file = file;
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.credentials = { cookie, refreshToken: '' };
    this.state = { status: cookie ? 'checking' : 'missing', message: cookie ? '正在校验登录状态' : '请扫码登录，游客昵称可能被打码', checkedAt: null };
    this.version = 0;
    this.qr = null;
    this.inflight = null;
    this.polling = null;
    this.generating = null;
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!getCookieValue(saved.cookie, 'SESSDATA')) throw new Error('invalid credentials');
        this.credentials = saved;
        this.state = { ...this.state, status: 'checking', message: '正在校验已保存的登录状态' };
      }
    } catch {
      this.state.message = '登录文件读取失败，使用环境配置；请检查或重新扫码';
    }
  }

  get cookie() { return this.credentials.cookie; }
  snapshot() { return { ...this.state }; }
  publish(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.snapshot());
    return this.snapshot();
  }

  async validate(cookie) {
    const { payload } = await requestBili(NAV, cookie, this.fetchImpl);
    if (payload.code === -101 || (payload.code === 0 && payload.data?.isLogin === false)) return null;
    if (payload.code !== 0 || payload.data?.isLogin !== true || !payload.data.mid) {
      throw new Error(`登录校验暂不可用（code=${Number(payload.code)}），将重试`);
    }
    return { uid: payload.data.mid, name: payload.data.uname || '', wbi: payload.data.wbi_img };
  }

  check() {
    if (this.inflight) return this.inflight;
    const version = this.version;
    this.inflight = (async () => {
      if (!this.cookie) return this.publish({ status: 'missing', message: '请扫码登录，游客昵称可能被打码', uid: null, name: '', checkedAt: Date.now() });
      try {
        const account = await this.validate(this.cookie);
        if (version !== this.version) return this.snapshot();
        return this.publish(account
          ? { status: 'valid', message: '登录有效', uid: account.uid, name: account.name, checkedAt: Date.now() }
          : { status: 'expired', message: 'B站登录已失效，请重新扫码；当前昵称可能被打码', uid: null, name: '', checkedAt: Date.now() });
      } catch {
        if (version !== this.version) return this.snapshot();
        return this.publish({ status: 'network_error', message: '暂时无法校验登录，已保留凭证，将自动重试', checkedAt: Date.now() });
      }
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  start() {
    this.stop();
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  generate() {
    if (this.generating) return this.generating;
    this.generating = (async () => {
      if (this.polling) await this.polling;
      const { payload } = await requestBili(`${PASSPORT}generate`, '', this.fetchImpl);
      if (payload.code !== 0 || !payload.data?.qrcode_key || !payload.data?.url) throw new Error('二维码生成失败，请稍后重试');
      const qr = { id: randomUUID(), key: payload.data.qrcode_key, expiresAt: Date.now() + 180_000, nextPollAt: 0 };
      const image = await QRCode.toDataURL(payload.data.url, { width: 256, margin: 4, errorCorrectionLevel: 'M' });
      this.qr = qr;
      return { id: qr.id, image, expiresAt: qr.expiresAt };
    })().finally(() => { this.generating = null; });
    return this.generating;
  }

  poll(id) {
    const qr = this.qr;
    if (!qr || id !== qr.id) return Promise.resolve({ status: 'expired', message: '二维码已更新，请重新生成' });
    if (qr.result) return Promise.resolve(qr.result);
    if (Date.now() > qr.expiresAt) return Promise.resolve({ status: 'expired', message: '二维码已过期，请重新生成' });
    if (this.polling) return this.polling;
    if (Date.now() < qr.nextPollAt) return Promise.resolve({ status: 'waiting', message: '等待扫码或手机确认' });
    qr.nextPollAt = Date.now() + 2000;
    this.polling = (async () => {
      // After a successful poll retain the pending credential if validation or disk write fails.
      if (!qr.pending) {
        const { response, payload } = await requestBili(`${PASSPORT}poll?qrcode_key=${encodeURIComponent(qr.key)}`, '', this.fetchImpl);
        if (payload.code !== 0) throw new Error('扫码状态获取失败，请稍后重试');
        const code = payload.data?.code;
        if (code === 86101) return { status: 'waiting', message: '请使用哔哩哔哩 APP 扫码' };
        if (code === 86090) return { status: 'scanned', message: '已扫码，请在手机上确认登录' };
        if (code === 86038) return (qr.result = { status: 'expired', message: '二维码已过期，请重新生成' });
        if (code !== 0) throw new Error(`扫码未完成（code=${Number(code)}），请重新生成二维码`);
        const cookie = cookiesFromHeaders(response.headers);
        if (!getCookieValue(cookie, 'SESSDATA')) throw new Error('登录响应缺少凭证，请重新扫码');
        qr.pending = { cookie, refreshToken: payload.data.refresh_token || '', savedAt: Date.now() };
      }
      const account = await this.validate(qr.pending.cookie);
      if (!account) throw new Error('新登录凭证未通过校验，请重新扫码');
      const saved = { ...qr.pending, uid: account.uid };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 });
        fs.renameSync(temporary, this.file);
      } catch {
        throw new Error('登录凭证保存失败，请检查登录文件目录的写入权限后重试');
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      this.credentials = saved;
      this.version++;
      this.publish({ status: 'valid', message: '登录有效，凭证已保存', uid: account.uid, name: account.name, checkedAt: Date.now() });
      this.emit('credentials', { cookie: saved.cookie, uid: account.uid });
      qr.pending = null;
      qr.key = '';
      return (qr.result = { status: 'success', message: '登录成功，凭证已保存，弹幕连接正在重新鉴权' });
    })().finally(() => { this.polling = null; });
    return this.polling;
  }
}
