/**
 * SenseNova LLM 客户端（商汤日日新，OpenAI 兼容 Chat Completions）。
 * 用途：音色设计提示词细化 / 弹幕情绪修正等"规划层"任务。
 * 默认模型 sensenova-6.8-flash-lite（轻量智能体，毫秒级响应）。
 */
export class SenseNovaClient {
  constructor({
    apiKey = '',
    baseUrl = 'https://token.sensenova.cn/v1',
    model = 'sensenova-6.8-flash-lite',
    timeoutMs = 8000,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  /**
   * 一次对话调用，返回文本内容。
   * @param {Array<{role:string, content:string}>} messages
   * @param {{maxTokens?: number, temperature?: number}} options
   */
  async chat(messages, { maxTokens = 300, temperature } = {}) {
    if (!this.apiKey) throw new Error('SENSENOVA_API_KEY 未配置');
    // 6.8-flash-lite 是 reasoning 模型：默认关闭 thinking，低延迟 + 不吃 max_tokens 预算
    const body = { model: this.model, max_tokens: maxTokens, messages, thinking: { type: 'disabled' } };
    if (temperature !== undefined) body.temperature = temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${payload?.error?.message || payload?.message || '未知错误'}`);
      }
      const text = payload?.choices?.[0]?.message?.content;
      if (!text || !String(text).trim()) throw new Error('LLM 响应为空');
      return String(text).trim();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('LLM 请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
