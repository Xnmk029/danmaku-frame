/**
 * AMLL WebSocket 客户端（连接 AMLL Player 等 WS 服务端）
 *
 * 备用接入方式：若使用 AMLL Player 作为服务端，本客户端连接其 11444 端口。
 * 默认推荐 AmllServer（服务端模式，接收 AMLL-WS-Connector 推送），二选一。
 */
import { WebSocket } from 'ws';
import { PlaybackAggregator } from './amll-core.mjs';
import { parseV1Body, v1ToStateUpdate } from './amll-v1.mjs';

const RECONNECT_DELAY_MS = 3000;

export class AmllBridge extends PlaybackAggregator {
  constructor({ url = 'ws://127.0.0.1:11444', WebSocketImpl = WebSocket, reconnectDelayMs = RECONNECT_DELAY_MS } = {}) {
    super();
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectDelayMs = reconnectDelayMs;
    this.socket = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.stopped = false;
    this.sequence = 0;
  }

  get active() {
    return this.connected;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.sequence += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      const old = this.socket;
      this.socket = null;
      // CONNECTING 状态的 socket close() 会触发 error 事件（ws v8 无监听时抛未捕获异常）
      old.on('error', () => { /* 吞掉关闭过程中的连接错误 */ });
      try { old.close(1001); } catch { /* 已关闭 */ }
      setTimeout(() => {
        try { old.removeAllListeners(); } catch { /* ignore */ }
      }, 100).unref?.();
    }
    this.connected = false;
  }

  connect() {
    if (this.stopped) return;
    const sequence = ++this.sequence;
    let socket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch (error) {
      this.scheduleReconnect(sequence, error);
      return;
    }
    this.socket = socket;
    const connectedAt = Date.now();

    socket.on('open', () => {
      if (sequence !== this.sequence) { try { socket.close(); } catch { /* ignore */ } return; }
      this.connected = true;
      this.emit('online');
      // 协议要求：连接后发送 initialize
      socket.send(JSON.stringify({ type: 'initialize' }));
    });

    socket.on('message', data => {
      if (sequence !== this.sequence) return;
      try {
        const payload = JSON.parse(data.toString());
        if (payload?.type === 'state') this.handleStateUpdate(payload.value);
        else if (payload?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // V1 二进制协议
        const v1 = parseV1Body(Buffer.isBuffer(data) ? data : Buffer.from(data));
        const update = v1ToStateUpdate(v1);
        if (update) this.handleStateUpdate(update);
        else if (v1.type === 'ping') socket.send(Buffer.from([1, 0]));
      }
    });

    socket.on('error', error => {
      if (sequence === this.sequence && Date.now() - connectedAt > 1500) {
        this.emit('warning', new Error(`AMLL 连接异常: ${error.message}`));
      }
    });

    socket.on('close', () => {
      if (sequence !== this.sequence) return;
      this.connected = false;
      this.emit('offline');
      this.scheduleReconnect(sequence);
    });
  }

  scheduleReconnect(sequence, error) {
    if (this.stopped || sequence !== this.sequence) return;
    if (error) this.emit('warning', new Error(`AMLL 连接失败: ${error.message}`));
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
  }
}

export { RECONNECT_DELAY_MS };
