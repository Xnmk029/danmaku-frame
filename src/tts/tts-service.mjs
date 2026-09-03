import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const MAX_QUEUE_LENGTH = 8;
const MAX_RECENT = 12; // 最近处理记录条数

/** 从持久化数据中提取合法的设置字段。 */
function pickSettings(saved) {
  const result = {};
  if (typeof saved.voice === 'string' && saved.voice.trim()) result.voice = saved.voice.trim();
  if (typeof saved.rate === 'string') result.rate = saved.rate;
  if (typeof saved.pitch === 'string') result.pitch = saved.pitch;
  if (typeof saved.volume === 'string') result.volume = saved.volume;
  if (typeof saved.playerVolume === 'number') result.playerVolume = saved.playerVolume;
  if (typeof saved.gain === 'number') result.gain = saved.gain;
  return result;
}

/** 弹幕系统自己的控制命令（主播/房管发，直接执行不朗读）。 */
const TTS_CONTROL_COMMANDS = [
  '朗读开', '朗读开开', '开启朗读', '打开朗读',
  '朗读关', '朗读关闭', '关闭朗读', '关朗读',
  '朗读跳过', '跳过朗读', '朗读下一句',
  '朗读暂停', '暂停朗读',
  '朗读继续', '继续朗读', '恢复朗读',
];

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;
const CONTROL_PATTERN = /[\u{0000}-\u{0008}\u{000B}\u{000C}\u{000E}-\u{001F}\u{007F}-\u{009F}\u{2028}\u{2029}]/gu;

/** 清洗朗读文本：去 emoji / 控制符 / 折叠空白。 */
export function cleanupTtsText(raw) {
  const text = String(raw || '')
    .replace(EMOJI_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/**
 * 弹幕朗读服务：订阅 B站弹幕事件 → 过滤（开关/命令/黑名单/去重/冷却）→
 * 串行队列 → Edge TTS 合成 → Windows 播放器朗读。
 */
export class DanmakuTtsService extends EventEmitter {
  constructor({
    engine,
    player,
    config = {},
    ownerUid = '',
    adminUids = new Set(),
    now = () => Date.now(),
  }) {
    super();
    this.engine = engine;
    this.player = player;
    this.config = config;
    this.ownerUid = String(ownerUid || '');
    this.adminUids = new Set([...adminUids].map(String));
    this.now = now;

    this.state = {
      enabled: Boolean(config.enabled),
      playing: null, // { user, text }
      queueCount: 0,
      lastError: '',
      voice: config.voice || 'zh-CN-XiaoxiaoNeural',
      skippedCount: 0,
      spokenCount: 0,
      settings: {
        voice: config.voice || 'zh-CN-XiaoxiaoNeural',
        rate: config.rate ?? '+0%',
        pitch: config.pitch ?? '+0Hz',
        volume: config.volume ?? '+0%',
        playerVolume: typeof config.playerVolume === 'number' ? config.playerVolume : 100,
        gain: typeof config.gainPercent === 'number' ? config.gainPercent : 100,
      },
    };

    // 默认增益同步到引擎（gain 100-150% → Edge volume +0%~+50%）
    this.applySettingsToDevices();

    // 弹幕处理统计（可观测性：定位弹幕被哪个环节拦截）
    this.stats = {
      danmakuReceived: 0,
      notDanmaku: 0,
      emptyText: 0,
      controlCommand: 0,
      disabled: 0,
      commandSkipped: 0,
      tooLong: 0,
      blockedUid: 0,
      blockedKeyword: 0,
      dedupeSkipped: 0,
      cooldownSkipped: 0,
      queued: 0,
    };

    // 最近处理记录（面板展示：每条弹幕 朗读/跳过 + 原因）
    this.recent = [];

    // 当前合成音色（弹幕级音色绑定用），初始 = 全局音色
    this.currentVoice = this.state.settings.voice;

    this.queue = [];
    this.busy = false;
    this.lastTextByUser = new Map(); // uid -> { text, at }
    this.lastSpokenText = '';
    this.lastSpokenTextCount = 0;

    // 开关与调音参数持久化（可选）：HTTP/弹幕命令/控制台的变更跨重启保留
    this.stateFile = config.stateFile || '';
    if (this.stateFile) {
      try {
        if (fs.existsSync(this.stateFile)) {
          const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
          if (typeof saved.enabled === 'boolean') this.state.enabled = saved.enabled;
          if (saved.settings && typeof saved.settings === 'object') {
            this.state.settings = {
              ...this.state.settings,
              ...pickSettings(saved.settings),
            };
            // 音色校验：持久化的音色不属于当前引擎（如 MIMO 模式下残留 Edge 音色）→ 用配置默认
            if (this.engine?.isVoiceSupported && !this.engine.isVoiceSupported(this.state.settings.voice)) {
              this.state.settings.voice = config.voice;
            }
            this.applySettingsToDevices();
          }
        }
      } catch (error) {
        console.error('[TtsService] 读取状态失败:', error.message);
      }
    }
  }

  persistState() {
    if (!this.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({
        enabled: this.state.enabled,
        settings: this.state.settings,
      }, null, 2));
    } catch (error) {
      console.error('[TtsService] 保存状态失败:', error.message);
    }
  }

  /** 将当前 settings 同步到合成引擎与播放器。
   * 增益（gain 100-150%）映射为 Edge SSML volume：+0% ~ +50%。 */
  applySettingsToDevices() {
    const s = this.state.settings;
    this.state.voice = s.voice;
    this.currentVoice = s.voice;
    const gainVolume = s.gain && s.gain > 100 ? `+${s.gain - 100}%` : '+0%';
    try {
      this.engine?.setParameters?.({ voice: s.voice, rate: s.rate, pitch: s.pitch, volume: gainVolume });
    } catch (error) {
      console.error('[TtsService] 引擎参数更新失败:', error.message);
    }
    try {
      this.player?.setVolume?.(typeof s.playerVolume === 'number' ? s.playerVolume / 100 : 1);
    } catch (error) {
      console.error('[TtsService] 播放器音量更新失败:', error.message);
    }
  }

  /**
   * 校验当前音色是否 Edge 真实支持；不支持则回退晓晓并广播提示。
   */
  async verifyVoice() {
    try {
      const supported = await this.engine?.getSupportedVoices?.();
      if (!supported || !supported.size) return; // 列表不可用，跳过校验
      const current = this.state.settings.voice;
      if (!supported.has(current)) {
        const fallback = 'zh-CN-XiaoxiaoNeural';
        console.warn(`[TtsService] 音色 ${current} 不在 Edge 支持列表，回退为 ${fallback}`);
        this.state.settings.voice = fallback;
        this.applySettingsToDevices();
        this.persistState();
        this.broadcastState({ type: 'tts.feedback', text: `音色 ${current} Edge 不支持，已回退为晓晓` });
      }
    } catch (error) {
      console.warn(`[TtsService] 音色校验失败: ${error.message}`);
    }
  }

  /**
   * 直播控制台调音：更新音色/语速/音调/音量并持久化。
   * @param {{voice?:string, rate?:string, pitch?:string, playerVolume?:number}} partial
   */
  setSettings(partial = {}, { persist = true } = {}) {
    const s = this.state.settings;
    if (typeof partial.voice === 'string' && partial.voice.trim()) s.voice = partial.voice.trim();
    if (typeof partial.rate === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(partial.rate)) s.rate = partial.rate;
    if (typeof partial.pitch === 'string' && /^[+-]?\d+(\.\d+)?Hz$/.test(partial.pitch)) s.pitch = partial.pitch;
    if (typeof partial.volume === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(partial.volume)) s.volume = partial.volume;
    if (typeof partial.playerVolume === 'number') {
      s.playerVolume = Math.min(100, Math.max(0, Math.round(partial.playerVolume)));
    }
    if (typeof partial.gain === 'number') {
      s.gain = Math.min(150, Math.max(100, Math.round(partial.gain)));
    }
    this.applySettingsToDevices();
    if (persist) this.persistState();
    this.broadcastState({ type: 'tts.feedback', text: '朗读音色/语速/音调已更新' });
    // 异步校验音色（Edge 真实支持集），不支持则回退
    if (partial.voice) {
      setTimeout(() => this.verifyVoice().catch(() => { /* ignore */ }), 800);
    }
  }

  /** 试听：优先朗读最新收到的一条真实弹幕（无弹幕时用默认文案）。 */
  speakTest(text) {
    let sample = cleanupTtsText(text);
    if (!sample) {
      // 取最近一条真实弹幕作为试听样本（避免每次试听都是同一句固定文案）
      const lastRead = this.recent.find(entry => entry.action === 'read' && entry.text);
      sample = lastRead ? lastRead.text : '欢迎来到直播间，弹幕朗读测试。';
    }
    this.enqueue({ uid: 'tts-test', user: '系统试听', text: sample });
    this.broadcastState({ type: 'tts.feedback', text: `试听已加入队列：${sample.slice(0, 20)}` });
  }

  /** 黑盒诊断：引擎连接状态 + 单次真实合成（调试用）。 */
  async diag() {
    const engineInfo = {
      connected: this.engine?.connected,
      closed: this.engine?.closed,
      voice: this.engine?.voice,
      hasClient: Boolean(this.engine?.client),
      wsReadyState: this.engine?.client?._ws?.readyState ?? null,
      wsBuffered: this.engine?.client?._ws?.bufferedAmount ?? null,
      wsUrlHost: this.engine?.client?._ws?.url?.slice(0, 60) ?? null,
      playerAvailable: this.player?.available ?? null,
    };
    let synth = null;
    try {
      const buf = await this.engine.synthesize('诊断测试');
      synth = { ok: true, bytes: buf.length };
    } catch (error) {
      synth = { ok: false, error: error.message };
    }
    return { engineInfo, synth };
  }

  /** 记录一条弹幕的处理结果（面板可观测）。 */
  recordDanmaku(entry) {
    this.recent.unshift(entry);
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
  }

  snapshot() {
    return {
      type: 'tts.state',
      enabled: this.state.enabled,
      provider: this.config.provider || 'edge',
      playing: this.state.playing,
      queueCount: this.queue.length,
      lastError: this.state.lastError,
      voice: this.state.voice,
      skippedCount: this.state.skippedCount,
      spokenCount: this.state.spokenCount,
      settings: { ...this.state.settings },
      stats: { ...this.stats },
      recent: this.recent.map(entry => ({ ...entry })),
      updatedAt: this.now(),
    };
  }

  broadcastState(extra) {
    if (extra) this.emit('state', extra);
    this.emit('state', this.snapshot());
  }

  setEnabled(enabled, { persist = false } = {}) {
    const next = Boolean(enabled);
    if (next === this.state.enabled) return;
    this.state.enabled = next;
    if (!next) {
      // 关闭时清空队列并跳过当前播放
      this.queue.length = 0;
      this.state.playing = null;
      try { this.player.stop(); } catch { /* ignore */ }
    }
    this.broadcastState({ type: 'tts.feedback', text: next ? '弹幕朗读已开启' : '弹幕朗读已关闭' });
    if (persist && this.persistState) this.persistState();
  }

  /** 主播/房管判定。 */
  isController(uid) {
    const uidStr = String(uid || '');
    return Boolean(uidStr && (uidStr === this.ownerUid || this.adminUids.has(uidStr)));
  }

  /**
   * 处理弹幕命令（朗读开/关/跳过等）。返回 true 表示消费了该弹幕（不再朗读）。
   */
  handleControlCommand(text, uid) {
    const normalized = String(text || '').trim().replace(/\s+/g, '');
    if (!TTS_CONTROL_COMMANDS.includes(normalized)) return false;
    if (!this.isController(uid)) return true; // 非受控用户：不执行也不朗读
    if (normalized.includes('开')) this.setEnabled(true);
    else if (normalized.includes('关')) this.setEnabled(false);
    else if (normalized.includes('跳')) {
      try { this.player.stop(); } catch { /* ignore */ }
      this.broadcastState({ type: 'tts.feedback', text: '已跳过当前朗读' });
    } else if (normalized.includes('暂停')) {
      this.state.enabled = false;
    } else if (normalized.includes('继续') || normalized.includes('恢复')) {
      this.state.enabled = true;
    }
    this.broadcastState();
    return true;
  }

  /**
   * 弹幕事件入口（由网关调用）。
   * @param {{type:string, uid:string, user:string, text:string}} event
   */
  handleDanmaku(event) {
    if (!event || event.type !== 'danmaku') {
      this.stats.notDanmaku += 1;
      return;
    }
    this.stats.danmakuReceived += 1;
    const baseEntry = { at: this.now(), user: event.user || '观众', text: String(event.text || '').slice(0, 60) };

    const text = cleanupTtsText(event.text);
    if (!text) {
      this.stats.emptyText += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '纯表情/无文本' });
      return;
    }

    const uid = String(event.uid || '');
    if (this.handleControlCommand(text, uid)) {
      this.stats.controlCommand += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '控制命令' });
      return;
    }

    // 朗读前缀：舰长 → "舰长"；有粉丝牌 → 用户名；都没有 → 无前缀
    // （仅影响朗读文本，过滤/去重仍基于原文）
    const readText = this.buildReadText(text, event);

    if (!this.state.enabled) {
      this.stats.disabled += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '朗读关闭' });
      return;
    }

    const config = this.config;

    // 命令弹幕不朗读（点歌等，避免暴露歌名/刷屏）
    if (config.skipCommands && typeof config.isCommandText === 'function' && config.isCommandText(text)) {
      this.stats.commandSkipped += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '点歌等命令' });
      return;
    }

    // 长度限制
    if (config.maxTextLength && text.length > config.maxTextLength) {
      this.stats.tooLong += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: `超长(>${config.maxTextLength}字)` });
      return;
    }

    // 用户黑名单 / 关键词黑名单
    if (config.blockedUids?.has(uid)) {
      this.stats.blockedUid += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '用户黑名单' });
      return;
    }
    const lower = text.toLocaleLowerCase('zh-CN');
    if (config.blockedKeywords?.some(keyword => lower.includes(keyword))) {
      this.stats.blockedKeyword += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '关键词黑名单' });
      return;
    }

    const now = this.now();

    // 同一文本连续刷屏去重（同一用户 10s 内相同文本；全局连续 3 次相同文本跳过）
    const prev = this.lastTextByUser.get(uid);
    if (prev && prev.text === text && now - prev.at < (config.dedupeWindowMs || 10_000)) {
      this.stats.dedupeSkipped += 1;
      this.state.skippedCount += 1;
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '同用户同文本去重' });
      return;
    }
    this.lastTextByUser.set(uid, { text, at: now });
    if (this.lastTextByUser.size > 500) {
      for (const [key, value] of this.lastTextByUser) {
        if (now - value.at >= 60_000) this.lastTextByUser.delete(key);
      }
    }

    // 全局连续重复
    if (text === this.lastSpokenText) {
      this.lastSpokenTextCount += 1;
      if (this.lastSpokenTextCount >= 3) {
        this.stats.dedupeSkipped += 1;
        this.state.skippedCount += 1;
        this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '全局连续重复' });
        return;
      }
    } else {
      this.lastSpokenText = text;
      this.lastSpokenTextCount = 1;
    }

    // 用户级冷却（同一用户连续弹幕合并）
    if (config.cooldownMs) {
      this.userCooldowns = this.userCooldowns || new Map();
      const cooldownAt = this.userCooldowns.get(uid) || 0;
      if (now - cooldownAt < config.cooldownMs && uid) {
        this.stats.cooldownSkipped += 1;
        this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '用户冷却' });
        return;
      }
      if (uid) this.userCooldowns.set(uid, now);
    }

    this.stats.queued += 1;
    const voice = this.resolveVoice(event);
    this.recordDanmaku({ ...baseEntry, action: 'read', text: readText, voice: voice || undefined });
    this.enqueue({ uid, user: event.user, text: readText, voice });
  }

  /**
   * 构造朗读文本（带前缀规则）：
   * - 舰长（guard 1/2/3）→ 前缀「舰长（用户名）：」
   * - 有粉丝牌（medal）→ 前缀用户名
   * - 都没有 → 无前缀
   */
  buildReadText(text, event) {
    if (this.config.readPrefix === false) return text;
    const guard = Number(event?.guard || 0);
    const medal = event?.medal;
    const user = String(event?.user || '');
    if (guard >= 1) return `舰长（${user}）：${text}`;
    if (medal && user && user !== '匿名用户') return `${user}，${text}`;
    return text;
  }

  /**
   * 音色绑定（优先级从高到低）：
   * 1. 用户级预设（UID 或原始用户名匹配）
   * 2. 舰长（guard≥1）→ voiceGuard
   * 3. 粉丝牌等级区间命中
   * 4. null（全局默认）
   */
  resolveVoice(event) {
    const uid = String(event?.uid || '');
    const name = String(event?.rawUser || event?.user || '');
    let voice = null;
    for (const preset of this.config.voiceUsers || []) {
      if (preset.uid && preset.uid === uid) { voice = preset.voice; break; }
      if (preset.name && preset.name === name) { voice = preset.voice; break; }
    }
    if (!voice) {
      const guard = Number(event?.guard || 0);
      if (guard >= 1 && this.config.voiceGuard) voice = this.config.voiceGuard;
    }
    if (!voice) {
      const lv = Number(event?.medal?.lv || 0);
      const tier = (this.config.voiceTiers || []).find(t => lv >= t.min && lv <= t.max);
      voice = tier?.voice || null;
    }
    // 引擎音色校验：绑定音色不属于当前引擎（如 MIMO 模式下配置了 Edge 音色）→ 回退全局
    if (voice && this.engine?.isVoiceSupported && !this.engine.isVoiceSupported(voice)) {
      return null;
    }
    return voice;
  }

  /** 切换到目标音色（面板全局音色变更使用；弹幕级绑定走 synthesize 软切换，不再走这里）。 */
  switchVoice(voice) {
    if (voice === this.currentVoice) return;
    this.currentVoice = voice;
    try {
      this.engine?.setParameters?.({ voice });
    } catch (error) {
      console.error('[TtsService] 音色切换失败:', error.message);
    }
  }

  enqueue(item) {
    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      this.queue.shift(); // 队满丢弃最旧
    }
    this.queue.push(item);
    this.broadcastState();
    this.pump().catch(error => {
      console.error('[TtsService] 朗读队列处理异常:', error.message);
    });
  }

  async pump() {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) return;
    this.busy = true;
    this.state.playing = { user: item.user, text: item.text };
    this.broadcastState();

    try {
      // 音色绑定：每条弹幕指定音色（预设/舰长/区间）→ 软切换（同连接零重建）；未指定 → 全局默认
      const targetVoice = item.voice || this.state.settings.voice;
      const audio = await this.engine.synthesize(item.text, { voice: targetVoice });
      // 音频指纹（诊断：确认每条弹幕合成的是不同内容）
      const hash = createHash('sha1').update(audio).digest('hex').slice(0, 12);
      const rec = this.recent.find(entry => entry.action === 'read' && entry.text === item.text.slice(0, 60));
      if (rec) rec.audioHash = hash;
      if (!this.state.enabled && !this.state.playing) {
        return; // 播放期间被关闭
      }
      await this.player.play(audio);
      this.state.spokenCount += 1;
      this.state.lastError = '';
    } catch (error) {
      this.state.lastError = error.message;
      console.error(`[TtsService] 朗读失败: ${error.message}\n${error.stack}`);
      this.broadcastState({ type: 'tts.feedback', text: `朗读失败: ${error.message.slice(0, 60)}` });
    } finally {
      this.state.playing = null;
      this.busy = false;
      this.broadcastState();
      this.pump().catch(error => {
        console.error('[TtsService] 朗读队列处理异常:', error.message);
      });
    }
  }

  async skip() {
    try {
      this.player.stop();
    } catch { /* ignore */ }
    this.state.playing = null;
    this.broadcastState({ type: 'tts.feedback', text: '已跳过当前朗读' });
  }

  async start() {
    try {
      await this.player.start();
    } catch (error) {
      console.error('[TtsService] 播放器启动失败（朗读功能不可用）:', error.message);
      this.state.lastError = `播放器启动失败: ${error.message}`;
    }
    // 启动后校验持久化的音色是否 Edge 真实支持
    setTimeout(() => this.verifyVoice().catch(() => { /* ignore */ }), 1500);
  }

  async stop() {
    try {
      await this.player.close();
    } catch (error) {
      console.error('[TtsService] 播放器关闭失败:', error.message);
    }
    this.queue.length = 0;
    this.state.playing = null;
    this.busy = false;
  }
}