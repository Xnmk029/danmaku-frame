import { EventEmitter } from 'node:events';

/** A single ncm.playback stream for all overlays. AMLL preferred, SMTC fallback. */
export class NowPlaying extends EventEmitter {
  constructor({ amll = null, smtc = null, source = 'auto' } = {}) {
    super();
    this.sources = { amll, smtc };
    this.mode = source;
    this.running = false;
    this.selected = null;
    this.received = new Set();
    for (const [name, adapter] of Object.entries(this.sources)) {
      if (!adapter) continue;
      adapter.on('playback', () => { this.received.add(name); this.refresh(); });
      adapter.on('online', () => this.refresh());
      adapter.on('offline', () => { this.received.delete(name); this.refresh(); });
      adapter.on('warning', error => this.emit('warning', new Error(`${name}: ${error.message}`)));
    }
  }
  choose() {
    if (!this.running) return null;
    const order = this.mode === 'auto' ? ['amll', 'smtc'] : [this.mode];
    return order.find(name => this.received.has(name) && this.sources[name]?.active && this.sources[name].snapshot().song) || null;
  }
  get active() { return Boolean(this.choose()); }
  snapshot() {
    const source = this.choose();
    return source ? { ...this.sources[source].snapshot(), source } : { type: 'ncm.playback', song: null, playing: false, paused: false, progress: 0, cover: null, source: null };
  }
  getCoverData(id) {
    const source = this.choose();
    return source ? this.sources[source].getCoverData(id) : null;
  }
  refresh() {
    const next = this.choose();
    const old = this.selected;
    this.selected = next;
    if (next) {
      if (!old) this.emit('online');
      this.emit('playback', this.snapshot());
    } else if (old) this.emit('offline');
  }
  diagnostics() {
    return { enabled: this.running, mode: this.mode, source: this.choose(), smtc: this.sources.smtc?.diagnostic || null };
  }
  async start() {
    if (this.running) return;
    this.running = true;
    const names = this.mode === 'auto' ? ['amll', 'smtc'] : [this.mode];
    await Promise.all(names.map(async name => {
      try { await this.sources[name]?.start(); }
      catch (error) { this.emit('warning', new Error(`${name} 启动失败: ${error.message}`)); }
    }));
    this.refresh();
  }
  stop() {
    this.running = false;
    this.received.clear();
    for (const adapter of Object.values(this.sources)) adapter?.stop();
    this.refresh();
  }
}
