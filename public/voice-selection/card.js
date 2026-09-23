/* Shared by the OBS overlay and local preview; never inserts API strings as HTML. */
class VoiceSelectionCard {
  constructor(root, { decode, restore }) {
    Object.assign(this, { root, decode, restore });
    this.music = document.createElement('div');
    this.music.className = 'voice-music';
    this.music.append(...root.childNodes);
    root.append(this.music);
    this.panel = document.createElement('div');
    this.panel.className = 'voice-panel'; this.panel.hidden = true;
    root.append(this.panel);
    this.revision = 0;
  }
  node(tag, className, text = '') {
    const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
  }
  text(el, value) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.textContent = value;
    else this.decode(el, value);
  }
  update(state) {
    if (state.phase === 'idle' && !this.active) { this.restore(); return; }
    this.state = state;
    this.clockOffset = (state.serverNow || Date.now()) - Date.now();
    const revision = ++this.revision;
    clearTimeout(this.transition); cancelAnimationFrame(this.raf);
    this.active = state.phase !== 'idle';
    this.root.hidden = false;
    // Keep the rows on screen when confirming a selection.
    if (state.phase === 'success' && this.panel.dataset.id === String(state.id) && this.panel.querySelector('.voice-option')) {
      this.panel.querySelectorAll('.voice-option').forEach((el, i) => {
        el.classList.toggle('chosen', i + 1 === state.selected);
        el.classList.toggle('unselected', i + 1 !== state.selected);
      });
      this.text(this.panel.querySelector('.voice-query'), state.message);
      this.panel.querySelector('.voice-hint').textContent = '音色已保存';
      this.tick(); return;
    }
    this.music.classList.add('voice-fading'); this.panel.classList.add('voice-fading');
    this.transition = setTimeout(() => {
      if (revision !== this.revision) return;
      this.panel.querySelectorAll('*').forEach(el => clearInterval(el._scrambleTimer));
      this.panel.replaceChildren();
      this.root.classList.toggle('voice-active', this.active);
      this.root.parentElement.classList.toggle('voice-selecting', this.active);
      this.music.hidden = this.active; this.panel.hidden = !this.active;
      if (!this.active) { this.music.classList.remove('voice-fading'); this.restore(); return; }
      this.panel.dataset.id = String(state.id);
      const heading = this.node('div', 'voice-heading', '音色搜索 · ' + state.user);
      const query = this.node('div', 'voice-query');
      const results = this.node('div', 'voice-results');
      const footer = this.node('div', 'voice-footer');
      const hint = this.node('span', 'voice-hint', state.phase === 'candidates' ? '发送「选择音色 一 / 二 / 三」' : '');
      this.time = this.node('span', 'voice-seconds'); footer.append(hint, this.time);
      this.fill = this.node('div', 'voice-countdown');
      const track = this.node('div', 'voice-track'); track.append(this.fill);
      this.panel.append(heading, query, results, footer, track);
      this.text(query, state.phase === 'candidates' ? '“' + state.query + '”' : state.phase === 'searching' ? '正在搜索音色…' : state.message);
      if (state.phase === 'candidates') {
        state.items.forEach((item, i) => {
          const row = this.node('div', 'voice-option'); row.style.setProperty('--delay', `${i * 80}ms`);
          const name = this.node('div', 'voice-name'); const author = this.node('div', 'voice-author', item.author);
          row.append(this.node('span', 'voice-number', ['一','二','三'][i]), name, author); results.append(row);
          setTimeout(() => { if (revision === this.revision) this.text(name, item.title); }, i * 80);
        });
      } else results.append(this.node('div', 'voice-message', state.phase === 'searching' ? '正在检索 Fish Audio 社区音色' : state.phase === 'success' ? '后续弹幕将使用此音色（Fish Audio / 混合模式）' : '稍后恢复歌曲显示'));
      this.panel.classList.remove('voice-fading'); this.tick();
    }, 200);
  }
  tick() {
    const state = this.state;
    if (!this.active) return;
    const now = Date.now() + this.clockOffset;
    const remaining = Math.max(0, state.expiresAt - now);
    // If the socket disappears mid-selection, never cover the song indefinitely.
    if (now >= state.expiresAt + 500) { this.update({ phase: 'idle' }); return; }
    if (this.fill) {
      const ratio = state.phase === 'candidates' ? Math.min(1, remaining / (state.expiresAt - state.startsAt)) : state.phase === 'searching' ? 1 : 0;
      this.fill.style.transform = `scaleX(${ratio})`;
      this.fill.classList.toggle('urgent', state.phase === 'candidates' && remaining <= 5000);
      this.time.textContent = state.phase === 'candidates' ? Math.ceil(Math.min(20000, remaining) / 1000) + 's' : '';
    }
    this.raf = requestAnimationFrame(() => this.tick());
  }
}
window.VoiceSelectionCard = VoiceSelectionCard;
