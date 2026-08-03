import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { parseSongCommand } from '../danmaku/command-parser.mjs';

const HELP_TEXT = '点歌格式：点歌 歌名；其他命令：取消点歌、我的点歌、歌单';

function publicTrack(item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.track.title,
    artist: item.track.artist,
    sourceUrl: item.track.sourceUrl,
    coverUrl: item.track.coverUrl || '',
    durationSeconds: Number(item.track.durationSeconds || 0),
    provider: item.track.provider,
    requestedBy: item.requestedBy,
    requestedAt: item.requestedAt,
    status: item.status,
  };
}

export class SongRequestService extends EventEmitter {
  constructor({ config, repository, providers, now = () => Date.now() }) {
    super();
    this.config = config;
    this.repository = repository;
    this.providers = providers;
    this.now = now;
    this.cooldowns = new Map();
    this.state = repository.load();
    this.state.enabled = this.state.enabled !== false && config.enabled;

    if (this.state.current) {
      this.state.history.unshift({
        ...this.state.current,
        status: 'interrupted',
        finishedAt: this.now(),
      });
      this.state.current = null;
      this.state.history = this.state.history.slice(0, 200);
      this.persist();
    }
  }

  snapshot() {
    return {
      type: 'song.state',
      enabled: this.state.enabled,
      current: publicTrack(this.state.current),
      queue: this.state.queue.map(publicTrack),
      history: this.state.history.slice(0, 20).map(publicTrack),
      updatedAt: this.now(),
    };
  }

  broadcastState(extraEvent) {
    if (extraEvent) this.emit('broadcast', extraEvent);
    this.emit('broadcast', this.snapshot());
  }

  persist() {
    this.repository.save({
      version: 1,
      enabled: this.state.enabled,
      current: this.state.current,
      queue: this.state.queue,
      history: this.state.history.slice(0, 200),
    });
  }

  feedback(text, target = {}) {
    this.emit('broadcast', {
      type: 'song.feedback',
      user: '点歌姬',
      text,
      targetUid: target.uid || '',
      receivedAt: this.now(),
    });
  }

  isModerator(event) {
    const uid = String(event.uid || '');
    return Boolean(
      event.admin
      || (uid && uid === String(this.config.ownerUid || ''))
      || this.config.adminUids.has(uid),
    );
  }

  countUserRequests(uid) {
    const normalized = String(uid || '');
    return [this.state.current, ...this.state.queue]
      .filter(Boolean)
      .filter(item => String(item.requestedBy.uid || '') === normalized)
      .length;
  }

  estimateWaitSeconds(position) {
    const fallbackDuration = Math.min(this.config.maxDurationSeconds, 240);
    const before = [
      ...(this.state.current ? [this.state.current] : []),
      ...this.state.queue.slice(0, Math.max(0, position - 1)),
    ];
    return before.reduce(
      (total, item) => total + (Number(item.track.durationSeconds) || fallbackDuration),
      0,
    );
  }

  async submitRequest(event, query) {
    if (!this.state.enabled) throw new Error('点歌功能当前已关闭');
    if (this.state.queue.length >= this.config.maxQueueLength) throw new Error('点歌队列已满');

    const uid = String(event.uid || event.user || 'anonymous');
    const rawUid = String(event.uid || '');
    if (rawUid && this.config.blockedUids?.has(rawUid)) {
      throw new Error('你当前没有点歌权限');
    }
    if (this.config.allowedUids?.size > 0
      && !this.config.allowedUids.has(rawUid)
      && !this.isModerator(event)) {
      throw new Error('当前仅允许白名单用户点歌');
    }
    const normalizedQuery = query.toLocaleLowerCase('zh-CN');
    if (this.config.blockedKeywords?.some(keyword => normalizedQuery.includes(keyword))) {
      throw new Error('歌曲关键词不符合点歌规则');
    }
    const lastRequestAt = this.cooldowns.get(uid) || 0;
    if (this.now() - lastRequestAt < this.config.cooldownMs) {
      const remaining = Math.ceil((this.config.cooldownMs - (this.now() - lastRequestAt)) / 1000);
      throw new Error(`点歌过于频繁，请 ${remaining} 秒后再试`);
    }
    if (this.countUserRequests(uid) >= this.config.maxPerUser) {
      throw new Error(`每位观众最多同时排队 ${this.config.maxPerUser} 首`);
    }

    const track = await this.providers.resolve(query);
    if (track.durationSeconds > this.config.maxDurationSeconds) {
      throw new Error(`歌曲时长超过 ${this.config.maxDurationSeconds} 秒限制`);
    }

    const duplicate = [this.state.current, ...this.state.queue]
      .filter(Boolean)
      .some(item => item.track.sourceUrl === track.sourceUrl);
    if (duplicate) throw new Error('该歌曲已在播放或队列中');

    const item = {
      id: randomUUID(),
      track,
      query,
      requestedBy: {
        uid: String(event.uid || ''),
        name: event.user || '匿名用户',
      },
      requestedAt: this.now(),
      status: 'queued',
    };
    this.cooldowns.set(uid, this.now());
    this.state.queue.push(item);

    let position = this.state.queue.length;
    const waitSeconds = this.estimateWaitSeconds(position);
    if (!this.state.current) {
      this.advance();
      position = 0;
    } else {
      this.persist();
      this.broadcastState({ type: 'song.queued', item: publicTrack(item), position });
    }

    return {
      item,
      position,
      waitSeconds: position === 0 ? 0 : waitSeconds,
    };
  }

  advance(result = 'completed') {
    if (this.state.current) {
      this.state.history.unshift({
        ...this.state.current,
        status: result,
        finishedAt: this.now(),
      });
      this.state.history = this.state.history.slice(0, 200);
    }

    const next = this.state.queue.shift() || null;
    this.state.current = next ? { ...next, status: 'playing', startedAt: this.now() } : null;
    this.persist();
    this.broadcastState(this.state.current
      ? { type: 'song.started', item: publicTrack(this.state.current) }
      : { type: 'song.queue_empty' });
    return this.state.current;
  }

  cancelOwn(event) {
    const uid = String(event.uid || '');
    const reverseIndex = [...this.state.queue]
      .map(item => String(item.requestedBy.uid || ''))
      .lastIndexOf(uid);
    if (reverseIndex < 0) throw new Error('你没有等待中的点歌');
    const [removed] = this.state.queue.splice(reverseIndex, 1);
    removed.status = 'cancelled';
    removed.finishedAt = this.now();
    this.state.history.unshift(removed);
    this.persist();
    this.broadcastState({ type: 'song.cancelled', item: publicTrack(removed) });
    return removed;
  }

  clearQueue() {
    const removed = this.state.queue.splice(0);
    this.state.history.unshift(...removed.map(item => ({
      ...item,
      status: 'cancelled',
      finishedAt: this.now(),
    })));
    this.persist();
    this.broadcastState({ type: 'song.queue_cleared', count: removed.length });
    return removed.length;
  }

  async handleDanmaku(event) {
    const command = parseSongCommand(event.text);
    if (!command) return false;

    try {
      switch (command.type) {
        case 'request': {
          const result = await this.submitRequest(event, command.query);
          const suffix = result.position === 0
            ? '，已开始播放'
            : `，当前第 ${result.position} 位，预计等待约 ${Math.ceil(result.waitSeconds / 60)} 分钟`;
          this.feedback(`已添加《${result.item.track.title}》${suffix}`, event);
          break;
        }
        case 'cancel-own': {
          const removed = this.cancelOwn(event);
          this.feedback(`已取消《${removed.track.title}》`, event);
          break;
        }
        case 'list-own': {
          const names = this.state.queue
            .filter(item => String(item.requestedBy.uid || '') === String(event.uid || ''))
            .map(item => item.track.title);
          this.feedback(names.length ? `你的排队歌曲：${names.join('、')}` : '你当前没有排队歌曲', event);
          break;
        }
        case 'list': {
          const names = this.state.queue.slice(0, 5).map(item => item.track.title);
          this.feedback(names.length ? `当前歌单：${names.join(' → ')}` : '当前歌单为空', event);
          break;
        }
        case 'help':
          this.feedback(HELP_TEXT, event);
          break;
        case 'skip':
          this.requireModerator(event);
          this.advance('skipped');
          if (this.config.legacyMediaKeys) this.emit('media-key', 'next');
          this.feedback('已切换到下一首', event);
          break;
        case 'pause':
          this.requireModerator(event);
          this.emit('broadcast', { type: 'song.player_command', action: 'pause' });
          break;
        case 'resume':
          this.requireModerator(event);
          this.emit('broadcast', { type: 'song.player_command', action: 'resume' });
          break;
        case 'clear': {
          this.requireModerator(event);
          const count = this.clearQueue();
          this.feedback(`已清空 ${count} 首等待歌曲`, event);
          break;
        }
        case 'enable':
        case 'disable':
          this.requireModerator(event);
          this.state.enabled = command.type === 'enable';
          this.persist();
          this.broadcastState();
          this.feedback(`点歌功能已${this.state.enabled ? '开启' : '关闭'}`, event);
          break;
        default:
          return false;
      }
    } catch (error) {
      this.feedback(`点歌失败：${error.message}`, event);
    }

    return true;
  }

  requireModerator(event) {
    if (!this.isModerator(event)) throw new Error('该命令仅主播或房管可用');
  }

  handlePlayerEvent(action) {
    if (action === 'ended') this.advance('completed');
    else if (action === 'error') this.advance('failed');
  }
}

export { HELP_TEXT, publicTrack };
