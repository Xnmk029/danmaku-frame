/** Server owns queue/deadlines so every OBS browser sees the same selection. */
export class FishSelection {
  constructor({ search, publish, bind, now = Date.now, duration = 20000, intro = 1000, hold = 2200 }) {
    Object.assign(this, { search, publish, bind, now, duration, intro, hold });
    this.queue = [];
    this.active = null;
    this.serial = 0;
  }
  snapshot() { return { type: 'voice.selection', phase: 'idle', ...this.active, serverNow: this.now() }; }
  emit() { this.publish(this.snapshot()); }
  request(uid, user, query) {
    if (this.closed) return '音色搜索已停止';
    if (this.active?.uid === uid || this.queue.some(x => x.uid === uid)) return '你的音色搜索正在处理，请先完成选择';
    if (this.queue.length >= 5) return '音色搜索排队已满，请稍后再试';
    this.queue.push({ uid, user: String(user).slice(0, 40), query });
    if (!this.active) void this.next();
    return '音色搜索已加入队列';
  }
  async next() {
    if (this.closed) return;
    const item = this.queue.shift();
    if (!item) { this.active = null; this.emit(); return; }
    const current = this.active = { ...item, id: ++this.serial, phase: 'searching', expiresAt: this.now() + 12000 };
    this.emit();
    try {
      const items = await this.search(item.query);
      if (this.closed || this.active !== current) return;
      if (!items.length) { this.finish('empty', '没有找到音色，请换一个名称'); return; }
      Object.assign(current, { phase: 'candidates', items: items.slice(0, 3), startsAt: this.now() + this.intro, expiresAt: this.now() + this.intro + this.duration });
      this.emit();
      this.timer = setTimeout(() => this.finish('timeout', '选择已超时'), this.intro + this.duration);
      this.timer.unref?.();
    } catch {
      if (!this.closed && this.active === current) this.finish('error', '搜索暂不可用，请稍后再试');
    }
  }
  select(uid, index) {
    const a = this.active;
    if (!a || a.uid !== uid || a.phase !== 'candidates') return '你当前没有可选择的音色';
    if (this.now() >= a.expiresAt) return '选择已超时，请重新搜索';
    const item = a.items[index - 1];
    if (!item) return '请选择列表中的编号';
    try { this.bind(uid, item.id); }
    catch { this.finish('error', '绑定失败，请稍后重试'); return '绑定失败'; }
    a.selected = index;
    this.finish('success', '已绑定 · ' + item.title);
    return 'Fish 音色已绑定：' + item.title;
  }
  finish(phase, message) {
    clearTimeout(this.timer);
    if (!this.active || this.closed) return;
    Object.assign(this.active, { phase, message, expiresAt: this.now() + this.hold });
    this.emit();
    this.timer = setTimeout(() => void this.next(), this.hold);
    this.timer.unref?.();
  }
  stop() { this.closed = true; clearTimeout(this.timer); this.queue = []; this.active = null; }
}
