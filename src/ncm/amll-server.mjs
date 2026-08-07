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
import { parseV1Body, v1ToStateUpdate } from './amll-v1.mjs';

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
      console.log(`[AMLL] 新连接（当前 ${this.connections.size} 个）`);
      socket.on('message', data => this.handleRawMessage(data, socket));
      socket.on('close', () => {
        this.connections.delete(socket);
        console.log(`[AMLL] 连接断开（剩余 ${this.connections.size} 个）`);
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

  handleRawMessage(data, socket) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // 先尝试 V2 JSON
    let payload = null;
    try { payload = JSON.parse(buf.toString()); } catch { /* 非 JSON */ }
    if (payload && typeof payload === 'object') {
      if (payload.type === 'state') {
        const v = payload.value;
        const summary = v?.update === 'setMusic'
          ? `setMusic name=${v.musicName}`
          : v?.update === 'setCover' ? `setCover ${v.source}`
            : String(v?.update || 'unknown');
        console.log(`[AMLL] 收到 state: ${summary}`);
        this.handleStateUpdate(payload.value);
      } else if (payload.type === 'initialize') {
        console.log('[AMLL] 客户端已初始化连接');
      } else if (payload.type === 'ping') {
        socket?.send(JSON.stringify({ type: 'pong' }));
      } else {
        console.log(`[AMLL] 收到其他 JSON: ${buf.toString().slice(0, 100)}`);
      }
      return;
    }

    // V1 二进制协议（AMLL-WS-Connector 旧版：SetMusicInfo/封面/进度/暂停恢复 + 高频音频）
    const v1 = parseV1Body(buf);
    const stateUpdate = v1ToStateUpdate(v1);
    if (stateUpdate) {
      const summary = stateUpdate.update === 'setMusic'
        ? `setMusic name=${stateUpdate.musicName}`
        : stateUpdate.update === 'setCover' ? `setCover ${stateUpdate.source}`
          : String(stateUpdate.update);
      console.log(`[AMLL] 收到 V1: ${summary}`);
      this.handleStateUpdate(stateUpdate);
    } else if (v1.type === 'ping') {
      socket?.send(Buffer.from([1, 0])); // Pong magic=1
    } else if (v1.type === 'unknown' && buf.length > 2) {
      // 高频音频/歌词等按需记录（debug 用）
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
