/** Fish Audio cloud API: JSON in, MP3 bytes out. No SDK or client-side API key. */
import { execFileSync } from 'node:child_process';
import { ProxyAgent } from 'undici';

function windowsProxyValue(name) {
  try {
    const output = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 2000 });
    return output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi'))?.[1]?.trim() || '';
  } catch { return ''; }
}

export function systemFishProxyUrl() {
  if (process.env.FISH_AUDIO_PROXY_URL === 'direct') return '';
  const explicit = process.env.FISH_AUDIO_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy;
  if (explicit) return explicit;
  if (process.platform !== 'win32' || windowsProxyValue('ProxyEnable') !== '0x1') return '';
  const value = windowsProxyValue('ProxyServer');
  const https = value.split(';').find(part => /^https=/i.test(part))?.replace(/^https=/i, '');
  const address = https || (value.includes('=') ? '' : value);
  return address ? (/^https?:\/\//i.test(address) ? address : `http://${address}`) : '';
}

export const FISH_MODELS = ['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free', 'drama-3-preview'];
export function normalizeFishVoice(value) {
  const id = String(value || '').trim();
  return /^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(id) ? id.replaceAll('-', '').toLowerCase() : '';
}
export function validFishVoice(value) { return Boolean(normalizeFishVoice(value)); }

export class FishTtsEngine {
  constructor({ apiKey = '', baseUrl = 'https://api.fish.audio', model = 's2.1-pro', referenceId = '', timeoutMs = 30_000, proxyUrl = systemFishProxyUrl(), fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    if (!FISH_MODELS.includes(model)) throw new Error('FISH_AUDIO_MODEL 无效，请使用 Fish Audio 支持的模型名称');
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('FISH_AUDIO_BASE_URL 必须是 HTTPS API 地址');
    Object.assign(this, { apiKey, model, referenceId, timeoutMs, fetchImpl, sleep });
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    this.dispatcher = proxyUrl && proxyUrl !== 'direct' ? new ProxyAgent(proxyUrl) : null;
    this.speed = 1;
    this.closed = false;
    this.controllers = new Set();
  }
  get available() { return Boolean(this.apiKey) && !this.closed; }
  get connected() { return this.available; }
  isVoiceSupported(voice) { return validFishVoice(voice); }
  setParameters({ voice, rate } = {}) {
    if (voice !== undefined) {
      if (voice && !validFishVoice(voice)) throw new Error('Fish 音色 ID 应为 32 位十六进制 reference_id');
      this.referenceId = normalizeFishVoice(voice);
    }
    if (typeof rate === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(rate)) this.speed = Math.min(2, Math.max(0.5, 1 + parseFloat(rate) / 100));
  }
  async searchVoices(query) {
    if (!this.available) throw new Error('Fish Audio API Key 未配置');
    if (!String(query).trim() || String(query).length > 60) throw new Error('音色名称长度需为 1～60 字');
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL(this.baseUrl + '/model');
      url.search = new URLSearchParams({ title: String(query).trim(), page_size: '10', self: 'false' });
      const response = await this.fetchImpl(url.toString(), { headers: { Authorization: 'Bearer ' + this.apiKey }, signal: controller.signal, redirect: 'error', ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Fish 音色搜索 HTTP ' + response.status); }
      const data = await response.json();
      const seen = new Set();
      return (Array.isArray(data.items) ? data.items : []).filter(x => {
        const id = normalizeFishVoice(x._id);
        if (!id || !x.title || x.dmca_taken_down || seen.has(id)) return false;
        seen.add(id); return true;
      }).slice(0, 3).map(x => ({ id: normalizeFishVoice(x._id), title: String(x.title).slice(0, 60), author: String(x.author?.nickname || '未知作者').slice(0, 40) }));
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  async synthesize(text, { voice } = {}) {
    if (!String(text || '').trim()) throw new Error('朗读文本为空');
    if (this.closed) throw new Error('Fish Audio 引擎已关闭');
    if (!this.apiKey) throw new Error('请在服务端 .env 配置 FISH_AUDIO_API_KEY 后重启弹幕服务');
    const referenceId = normalizeFishVoice(voice || this.referenceId);
    if (!validFishVoice(referenceId)) throw new Error('请设置 Fish Audio 音色 ID（FISH_AUDIO_REFERENCE_ID）');
    for (let attempt = 0; ; attempt++) {
      try { return await this.requestOnce(String(text), referenceId); }
      catch (error) {
        // Authentication, balance and invalid voice errors must not incur repeated calls.
        if (!error.retryable || attempt >= 1 || this.closed) throw error;
        await this.sleep(750);
      }
    }
  }
  async requestOnce(text, referenceId) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/tts`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', model: this.model, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, reference_id: referenceId, format: 'mp3', mp3_bitrate: 128, latency: 'normal', normalize: true, prosody: { speed: this.speed, volume: 0 } }),
      });
      if (!response.ok) {
        let message = '';
        if (response.status === 400) {
          try { message = (await response.json())?.message || ''; } catch { /* generic hint below */ }
        } else await response.body?.cancel();
        const hints = { 400: /Reference not found/i.test(message) ? '音色不存在或不可用，请更换 Fish 音色 ID' : '请求参数或音色不可用', 401: 'API Key 无效', 402: '账户余额或套餐不足', 403: '无权使用此音色或模型', 404: '音色或接口不存在', 422: '请检查音色 ID 与模型参数', 429: '请求限流' };
        const error = new Error(`Fish Audio HTTP ${response.status}：${hints[response.status] || '服务暂不可用'}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const mime = (response.headers.get('content-type') || '').split(';')[0];
      if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(mime)) {
        await response.body?.cancel();
        throw new Error('Fish Audio 未返回 MP3 音频');
      }
      const chunks = [];
      let size = 0;
      if (!response.body) throw new Error('Fish Audio 返回空音频');
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Fish Audio 音频超过大小限制'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      if (!size) throw new Error('Fish Audio 返回空音频');
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(this.closed ? 'Fish Audio 合成已取消' : 'Fish Audio 请求超时');
      if (error instanceof TypeError) throw new Error('Fish Audio 网络请求失败，请检查网络与 API 地址');
      throw error;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await this.dispatcher?.close();
  }
}
