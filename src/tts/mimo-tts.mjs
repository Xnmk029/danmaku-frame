/**
 * MIMO TTS 引擎（小米 MiMo-TTS v2.5，OpenAI 兼容接口）。
 * 接口与 EdgeTtsEngine 对齐：synthesize(text, {voice}) → Buffer(mp3)。
 * 注意：MIMO 无 rate/pitch/volume 参数（面板滑块仅对 Edge 生效）。
 */
const MIMO_VOICES = [
  { id: 'mimo_default', label: '默认音色 · 中文（冰糖）' },
  { id: '冰糖', label: '冰糖 · 中文女声' },
  { id: '茉莉', label: '茉莉 · 中文女声' },
  { id: '苏打', label: '苏打 · 中文男声' },
  { id: '白桦', label: '白桦 · 中文男声' },
  { id: 'Mia', label: 'Mia · 英文女声' },
  { id: 'Chloe', label: 'Chloe · 英文女声' },
  { id: 'Milo', label: 'Milo · 英文男声' },
  { id: 'Dean', label: 'Dean · 英文男声' },
];

export class MimoTtsEngine {
  constructor({
    apiKey = '',
    baseUrl = 'https://api.xiaomimimo.com/v1',
    voice = 'mimo_default',
    model = 'mimo-v2.5-tts',
    timeoutMs = 30_000,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.voice = voice;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.connected = true; // 无长连接概念
    this.connectedAt = Date.now();
    this.closed = false;
  }

  /** 音色热更新（与 Edge 引擎接口对齐；MIMO 无连接重建概念）。 */
  setParameters({ voice, rate, pitch, volume } = {}) {
    if (voice) this.voice = voice;
    // rate/pitch/volume 在 MIMO 中不支持，忽略
  }

  /** 支持音色列表（面板用）。 */
  getSupportedVoices() {
    return Promise.resolve(new Set(MIMO_VOICES.map(v => v.id)));
  }

  isVoiceSupported(voice) {
    return MIMO_VOICES.some(v => v.id === voice);
  }

  /**
   * 合成一条语音（失败自动重试 2 次，对齐 Edge 引擎的容错）。
   * @param {string} text 朗读文本
   * @param {{voice?: string}} options 可选音色覆盖
   * @returns {Promise<Buffer>} mp3 音频数据
   */
  async synthesize(text, { voice } = {}) {
    if (!String(text).trim()) throw new Error('朗读文本为空');
    if (!this.apiKey) throw new Error('MIMO_API_KEY 未配置');
    const targetVoice = voice || this.voice;

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.requestOnce(text, targetVoice);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  async requestOnce(text, targetVoice) {
    const body = {
      model: this.model,
      messages: [
        { role: 'user', content: '请用自然、清晰、流畅的语气朗读以下内容。' },
        { role: 'assistant', content: String(text) },
      ],
      audio: { format: 'mp3', voice: targetVoice },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`MIMO TTS HTTP ${response.status}: ${payload?.error?.message || payload?.message || '未知错误'}`);
      }
      const audioData = payload?.choices?.[0]?.message?.audio?.data;
      if (!audioData) throw new Error('MIMO TTS 响应缺少音频数据');
      return Buffer.from(audioData, 'base64');
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('MIMO TTS 请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    this.closed = true;
  }
}

export { MIMO_VOICES };