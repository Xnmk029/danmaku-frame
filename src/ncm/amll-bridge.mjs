/**
 * AMLL WebSocket 客户端（AMLL WebSocket 协议 V2，amll-dev/ws-protocol）
 *
 * 连接网易云插件广播端（默认 ws://127.0.0.1:11444），聚合播放状态：
 *   setMusic  → 歌曲元数据（名称/歌手/专辑/时长）
 *   setCover  → 封面（URI 或 Base64 数据）
 *   progress  → 播放进度（毫秒）
 *   paused/resumed → 播放状态
 *
 * 事件流（EventEmitter）：
 *   'playback'  { song, status, progress, duration, updatedAt, cover: {kind:'uri',url}|{kind:'data',mime,data} }
 *   'offline'   AMLL 端不可达（连接失败/断开）
 */
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

const RECONNECT_DELAY_MS = 3000;

export class AmllBridge extends EventEmitter {
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
    this.state = {
      song: null,      // { id, name, albumId, albumName, artists: [{id,name}], duration }
      cover: null,     // { kind:'uri', url } | { kind:'data', mime, data }
      status: 'stopped', // playing | paused | stopped
      progress: 0,
    };
  }

  get active() {
    return this.connected;
  }

  /** 当前聚合快照（前端渲染所需最小集） */
  snapshot() {
    const { song, cover, status, progress } = this.state;
    return {
      type: 'ncm.playback',
      playing: status === 'playing',
      paused: status === 'paused',
      song: song ? {
        id: song.id,
        name: song.name,
        albumName: song.albumName,
        artists: (song.artists || []).map(a => a.name),
        duration: song.duration,
      } : null,
      cover: cover ? {
        kind: cover.kind,
        // data 型封面不随广播下发（体积大），由服务端封面端点按 id 取
        id: cover.kind === 'data' ? cover.id : undefined,
        url: cover.kind === 'uri' ? cover.url : undefined,
      } : null,
      progress: progress,
      updatedAt: Date.now(),
    };
  }

  /** 获取 data 型封面原始数据（供 HTTP 端点使用） */
  getCoverData(id) {
    const c = this.state.cover;
    return c && c.kind === 'data' && c.id === id ? c : null;
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
      old.removeAllListeners();
      try { old.close(); } catch { /* 已关闭 */ }
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
        this.handleMessage(payload);
      } catch {
        // 非 JSON（如二进制扩展通道）忽略
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

  handleMessage(payload) {
    if (payload?.type !== 'state' || !payload.value) return;
    const value = payload.value;
    let changed = false;

    switch (value.update) {
      case 'setMusic': {
        const song = {
          id: String(value.musicId ?? ''),
          name: String(value.musicName ?? '未知歌曲'),
          albumId: String(value.albumId ?? ''),
          albumName: String(value.albumName ?? ''),
          artists: Array.isArray(value.artists) ? value.artists : [],
          duration: Number(value.duration) || 0,
        };
        if (JSON.stringify(song) !== JSON.stringify(this.state.song)) {
          this.state.song = song;
          this.state.progress = 0;
          changed = true;
        }
        // 切歌时恢复播放态（新歌默认视为播放中，等待 paused/resumed 修正）
        this.state.status = 'playing';
        break;
      }
      case 'setCover': {
        if (value.source === 'uri' && value.url) {
          const cover = { kind: 'uri', url: String(value.url) };
          if (!this.state.cover || this.state.cover.kind !== 'uri' || this.state.cover.url !== cover.url) {
            this.state.cover = cover;
            changed = true;
          }
        } else if (value.source === 'data' && value.image?.data) {
          const cover = {
            kind: 'data',
            id: `c${Date.now().toString(36)}`,
            mime: value.image.mimeType || 'image/jpeg',
            data: String(value.image.data),
          };
          this.state.cover = cover;
          changed = true;
        }
        break;
      }
      case 'progress': {
        const progress = Number(value.progress) || 0;
        if (Math.abs(progress - this.state.progress) >= 500) {
          this.state.progress = progress;
          changed = true;
        }
        break;
      }
      case 'paused':
        if (this.state.status !== 'paused') { this.state.status = 'paused'; changed = true; }
        break;
      case 'resumed':
        if (this.state.status !== 'playing') { this.state.status = 'playing'; changed = true; }
        break;
      default:
        return; // modeChanged / setLyric / volume 等暂不处理
    }

    if (changed) {
      this.emit('playback', this.snapshot());
    }
  }
}

export { RECONNECT_DELAY_MS };
