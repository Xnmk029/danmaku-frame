import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** 转义用户文本，防止 SSML 注入。 */
export function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, ch => XML_ESCAPES[ch]);
}

/**
 * Edge TTS 在线合成引擎（微软 Edge 朗读在线服务，无需 API Key）。
 * 内部复用 MsEdgeTTS 实例与 WebSocket 连接；合成失败时自动重连重试一次。
 */
export class EdgeTtsEngine {
  constructor({
    voice = 'zh-CN-XiaoxiaoNeural',
    rate = '+0%',
    pitch = '+0Hz',
    volume = '+0%',
  } = {}) {
    this.voice = voice;
    this.rate = rate;
    this.pitch = pitch;
    this.volume = volume;
    this.client = new MsEdgeTTS();
    this.connected = false;
    this.connectedAt = 0;
    this.closed = false;
  }

  /** Edge 连接 token（Sec-MS-GEC）有效期 5 分钟：连接使用超过 4 分钟主动重建，防合成中断开（借鉴 rany2/edge-tts TokenManager 思路）。 */
  static CONNECTION_TTL_MS = 4 * 60 * 1000;

  /** Edge 真实可用音色缓存（拉取失败时为 null，不阻塞使用）。 */
  voicesCache = null;
  voicesFetchedAt = 0;
  static VOICES_CACHE_TTL_MS = 60 * 60 * 1000;

  /**
   * 拉取 Edge Read Aloud 真实支持的音色列表（缓存 1 小时）。
   * Edge 只支持固定音色集，列表外的音色合成时会被服务端断连。
   * @returns {Promise<Set<string>|null>} ShortName 集合；失败返回 null
   */
  async getSupportedVoices() {
    if (this.voicesCache && Date.now() - this.voicesFetchedAt < EdgeTtsEngine.VOICES_CACHE_TTL_MS) {
      return this.voicesCache;
    }
    try {
      const voices = await this.client.getVoices();
      const names = new Set((Array.isArray(voices) ? voices : []).map(v => v.ShortName || v.Name).filter(Boolean));
      this.voicesCache = names;
      this.voicesFetchedAt = Date.now();
      return names;
    } catch (error) {
      console.warn(`[EdgeTts] 音色列表拉取失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 同步查询音色是否在缓存列表中（列表未就绪时放行）。
   */
  isVoiceSupported(voice) {
    if (!this.voicesCache) return true;
    return this.voicesCache.has(voice);
  }

  /** 建立/重建 WebSocket 连接（setMetadata 内部会 _initClient）。 */
  async ensureConnected() {
    if (this.closed) throw new Error('EdgeTtsEngine 已关闭');
    if (this.connected) return;
    try {
      // 注意：必须传第三个参数（空对象）。msedge-tts 的 setMetadata 在重复调用
      // 且 metadataOptions 为 undefined 时会访问 metadataOptions.voiceLocale 崩溃（库 bug）。
      await this.client.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {});
      this.connected = true;
      this.connectedAt = Date.now();
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  /**
   * 运行时热更新合成参数（直播控制台调音用）。
   * 音色变化需要重建连接（setMetadata 下次合成时执行）。
   */
  setParameters({ voice, rate, pitch, volume } = {}) {
    if (voice && voice !== this.voice) {
      this.voice = voice;
      this.connected = false;
    }
    if (rate !== undefined) this.rate = rate;
    if (pitch !== undefined) this.pitch = pitch;
    if (volume !== undefined) this.volume = volume;
  }

  /**
   * 合成一条语音。最多尝试 3 次（Edge 服务端对部分音色存在偶发断连）。
   * @param {string} text 朗读文本
   * @param {{voice?: string}} options 可选：本条约定的音色（软切换——仅更新 SSML voice，
   *   复用现有 WS 连接，避免每条弹幕都重建连接造成延迟；实测同连接交替音色零握手开销）
   * @returns {Promise<Buffer>} mp3 音频数据
   */
  async synthesize(text, { voice } = {}) {
    if (!String(text).trim()) throw new Error('朗读文本为空');

    // 软切换：仅更新库内部的 voice/voiceLocale（SSML 每 turn 自带 voice 名，无需重建连接）
    if (voice && voice !== this.voice) {
      this.voice = voice;
      if (this.client) {
        this.client._voice = voice;
        this.client._metadataOptions.voiceLocale = /^\w{2,3}-\w{2,3}/.exec(voice)?.[0] || 'zh-CN';
      }
    }

    // token 预刷新：连接使用超过 4 分钟强制重建（Sec-MS-GEC 5 分钟有效期）
    if (this.connected && this.connectedAt && Date.now() - this.connectedAt > EdgeTtsEngine.CONNECTION_TTL_MS) {
      this.connected = false;
      try {
        this.client?._ws?.close();
      } catch {
        // ignore
      }
    }

    let lastError = null;
    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      try {
        await this.ensureConnected();
        const { audioStream } = this.client.toStream(escapeXml(text), {
          rate: this.rate,
          pitch: this.pitch,
          volume: this.volume,
        });
        return await this.collectStream(audioStream);
      } catch (error) {
        lastError = error;
        // 连接可能已失效：断开旧连接（处理半开状态）后全新重连，逐次加长等待
        this.connected = false;
        try {
          this.client?._ws?.close();
        } catch {
          // ignore
        }
        if (attemptIndex < 2) {
          await new Promise(resolve => setTimeout(resolve, 600 * (attemptIndex + 1)));
        }
      }
    }
    throw lastError;
  }

  collectStream(audioStream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      audioStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      audioStream.on('error', error => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      audioStream.on('close', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      audioStream.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      // 超时保护（在线服务偶发挂起）
      setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Edge TTS 合成超时'));
      }, 30_000).unref?.();
    });
  }

  async close() {
    this.closed = true;
    try {
      this.client?._ws?.close();
    } catch {
      // ignore
    }
  }
}