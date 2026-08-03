/**
 * OBS WebSocket 代理 — 供开场待机页归零时切换场景。
 *
 * 设计要点：
 * - 懒加载：仅在首次 switchScene 时才 import obs-websocket-js 并连接，
 *   不启动时不产生任何 OBS 依赖与连接。
 * - 幂等：同一场景连续切换只调用一次 OBS。
 * - 可测试：connectImpl 可注入假客户端（单元测试不触碰真实 OBS）。
 * - 静默降级：连接失败/超时抛出可读错误，由调用方决定是否展示。
 */

const CONNECT_TIMEOUT_MS = 5_000;

export class ObsProxy {
  constructor({ url = '', password = '', connectImpl = null, now = () => Date.now() } = {}) {
    this.url = String(url || '').trim();
    this.password = String(password || '');
    this.connectImpl = connectImpl; // (OBSWebSocketCtor) => client，测试注入
    this.now = now;
    this.client = null;
    this.connecting = null;
    this.lastScene = '';
    this.lastSwitchAt = 0;
  }

  get configured() {
    return Boolean(this.url);
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      if (!this.url) throw new Error('OBS_WEBSOCKET_URL 未配置，无法联动 OBS');
      const { default: OBSWebSocket } = await import('obs-websocket-js');
      const client = this.connectImpl
        ? this.connectImpl(OBSWebSocket)
        : new OBSWebSocket();
      await withTimeout(
        client.connect(this.url, this.password),
        CONNECT_TIMEOUT_MS,
        '连接 OBS 超时（请确认 OBS 已启动且 WebSocket 服务已开启）',
      );
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } catch (error) {
      this.client = null;
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * 切换到指定场景。返回 { ok, scene, skipped? }。
   * 场景名空白时抛错；未配置 URL 时抛错。
   */
  async switchScene(sceneName) {
    const name = String(sceneName || '').trim();
    if (!name) throw new Error('场景名不能为空');
    if (!this.url) throw new Error('OBS_WEBSOCKET_URL 未配置，无法联动 OBS');

    // 幂等：同一场景在 5 秒内不重复切换（避免待机页重复请求刷屏）
    if (this.client && name === this.lastScene && this.now() - this.lastSwitchAt < 5_000) {
      return { ok: true, skipped: true, scene: name };
    }

    const client = await this.connect();
    await client.call('SetCurrentProgramScene', { sceneName: name });
    this.lastScene = name;
    this.lastSwitchAt = this.now();
    return { ok: true, scene: name };
  }

  async disconnect() {
    if (this.connecting) {
      try { await this.connecting; } catch { /* 忽略连接失败 */ }
    }
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (client) {
      try { await client.disconnect(); } catch { /* 已断开 */ }
    }
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    }),
  ]);
}

export { withTimeout };
