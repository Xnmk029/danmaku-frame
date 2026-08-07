/**
 * AMLL WebSocket 服务端 —— 接收 AMLL-WS-Connector（BetterNCM 插件）推送的播放信息。
 *
 * 角色：网易云客户端内的 AMLL-WS-Connector 是 WS 客户端（发送方），
 * 连接配置的地址（默认 ws://localhost:11444）。本模块监听该端口作为接收方，
 * 无需运行 AMLL Player 即可获得网易云当前播放信息。
 *
 * 与 AmllBridge（客户端模式）接口一致：
 *   start() / stop() / active / snapshot() / getCoverData(id)
 *   事件：playback / online（首个连接）/ offline（全部断开）/ warning
 */
import { WebSocketServer, WebSocket } from 'ws';
import { PlaybackAggregator } from './amll-core.mjs';

export class AmllServer extends PlaybackAggregator {
  constructor({ port = 11444, host = '127.0.0.1' } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.server = null;
    this.connections = new Set();
    this.ready = null;
    this.stopped = false;
  }

  get active() {
    return this.connections.size > 0;
  }

  start() {
    if (this.server) return this.ready;
    this.stopped = false;
    this.server = new WebSocketServer({ host: this.host, port: this.port });
    this.ready = new Promise((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });

    this.server.on('connection', socket => {
      this.connections.add(socket);
      socket.on('message', data => this.handleRawMessage(data));
      socket.on('close', () => {
        this.connections.delete(socket);
        if (this.connections.size === 0) this.emit('offline');
      });
      socket.on('error', error => this.emit('warning', new Error(`AMLL 连接异常: ${error.message}`)));
      if (this.connections.size === 1) this.emit('online');
    });

    this.server.on('error', error => {
      // EADDRINUSE：端口被 AMLL Player 等占用时告警但不崩溃
      this.emit('warning', new Error(`AMLL 监听 ${this.host}:${this.port} 失败: ${error.message}`));
    });

    return this.ready;
  }

  handleRawMessage(data) {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return; // 二进制扩展通道等非 JSON 消息忽略
    }
    // 协议：连接方发送 initialize 后持续推送 state
    if (payload?.type === 'state') {
      this.handleStateUpdate(payload.value);
    }
  }

  stop() {
    this.stopped = true;
    for (const socket of this.connections) {
      try { socket.close(1001, 'Server shutdown'); } catch { /* ignore */ }
    }
    this.connections.clear();
    if (this.server) {
      const old = this.server;
      this.server = null;
      try { old.close(); } catch { /* ignore */ }
    }
  }
}

export { WebSocket };
