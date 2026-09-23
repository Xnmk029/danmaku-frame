// 互动面板服务：聚合弹幕/礼物/SC/上舰/进场事件流 + 数据栏统计
// 供 LiveControl「直播互动」标签页消费：GET /api/interaction/state 拉快照，WS 7789 收实时事件。
import { EventEmitter } from 'events';

const FEED_TYPES = new Set(['danmaku', 'gift', 'sc', 'guard', 'entry']);

export class InteractionService extends EventEmitter {
  /**
   * @param {object} deps
   * @param {import('../bili/client.mjs').BiliLiveClient} deps.biliClient 事件源（event/status）
   * @param {string} deps.ownerUid 主播 UID（渲染「主播」徽标）
   * @param {() => object} [deps.authProvider] 登录状态快照提供者（BiliAuthService.snapshot）
   * @param {number} [deps.capacity] 历史缓冲条数
   */
  constructor({ biliClient, ownerUid = '', authProvider = null, capacity = 200 }) {
    super();
    this.biliClient = biliClient;
    this.ownerUid = String(ownerUid || '');
    this.authProvider = authProvider;
    this.capacity = capacity;
    this.recent = [];               // 环形缓冲：仅 feed 类事件
    this.stats = { popularity: 0, watched: 0, watchedText: '', likes: 0 };
    this.status = { connected: false, message: 'OFFLINE' };

    biliClient.on('event', (event) => this.ingest(event));
    biliClient.on('status', (status) => {
      this.status = status;
      this.emit('status', status);
    });
  }

  ingest(event) {
    if (!event || !event.type) return;
    switch (event.type) {
      case 'popularity':
        this.stats.popularity = Number(event.value || 0);
        return;
      case 'watched':
        this.stats.watched = Number(event.count || 0);
        this.stats.watchedText = String(event.text || '');
        return;
      case 'like':
        this.stats.likes = Number(event.count || 0);
        return;
      default:
        break;
    }
    if (!FEED_TYPES.has(event.type)) return;
    // 标注主播身份，前端直接渲染徽标，无需自行比对
    if (this.ownerUid && String(event.uid) === this.ownerUid) event.isOwner = true;
    this.recent.push(event);
    if (this.recent.length > this.capacity) {
      this.recent.splice(0, this.recent.length - this.capacity);
    }
    this.emit('feed', event);
  }

  snapshot() {
    const auth = this.authProvider ? this.authProvider() : {};
    return {
      type: 'interaction.state',
      connected: Boolean(this.biliClient?.connected),
      statusMessage: this.status.message || '',
      roomId: this.biliClient?.roomId || '',
      authMode: this.biliClient?.authMode || 'disconnected',
      ownerUid: this.ownerUid,
      canSend: auth.status === 'valid',
      auth: { status: auth.status || 'missing', message: auth.message || '', name: auth.name || '' },
      stats: { ...this.stats },
      recent: this.recent.slice(-this.capacity),
    };
  }
}
