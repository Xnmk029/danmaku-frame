/**
 * AMLL 播放状态聚合器（传输无关，供 WS 客户端/服务端共用）
 *
 * 解析 AMLL WebSocket 协议 V2 的 state 更新（amll-dev/ws-protocol）：
 *   setMusic / setCover(uri|data) / progress / paused / resumed
 * 输出 playback 快照事件。
 */
import { EventEmitter } from 'events';

export class PlaybackAggregator extends EventEmitter {
  constructor() {
    super();
    this.state = {
      song: null,      // { id, name, albumId, albumName, artists:[{id,name}], duration }
      cover: null,     // { kind:'uri', url } | { kind:'data', id, mime, data }
      status: 'stopped', // playing | paused | stopped
      progress: 0,
    };
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
      progress,
      updatedAt: Date.now(),
    };
  }

  /** 获取 data 型封面原始数据（供 HTTP 端点使用） */
  getCoverData(id) {
    const c = this.state.cover;
    return c && c.kind === 'data' && c.id === id ? c : null;
  }

  /** 处理一条 V2 state 消息的 value；内容变化时发出 playback 事件 */
  handleStateUpdate(value) {
    if (!value || typeof value !== 'object') return;
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
        // 新歌默认视为播放中，等待 paused/resumed 修正
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
          this.state.cover = {
            kind: 'data',
            id: `c${Date.now().toString(36)}`,
            mime: value.image.mimeType || 'image/jpeg',
            data: String(value.image.data),
          };
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

    if (changed) this.emit('playback', this.snapshot());
  }
}
