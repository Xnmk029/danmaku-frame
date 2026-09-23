import { FishSelection } from './fish-selection.mjs';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parseVoiceCommand } from '../danmaku/voice-commands.mjs';
import { refineVoicePrompt } from '../llm/voice-prompts.mjs';
import { validFishVoice, normalizeFishVoice } from './fish-tts.mjs';

const MAX_QUEUE_LENGTH = 8;
const MAX_RECENT = 12; // 最近处理记录条数
const TTS_PROVIDERS = ['edge', 'mimo', 'hybrid', 'fish'];

/** 从持久化数据中提取合法的设置字段。 */
function pickSettings(saved) {
  const result = {};
  if (typeof saved.voice === 'string' && saved.voice.trim()) result.voice = saved.voice.trim();
  if (typeof saved.mimoVoice === 'string' && saved.mimoVoice.trim()) result.mimoVoice = saved.mimoVoice.trim();
  if (typeof saved.fishVoice === 'string' && (!saved.fishVoice || validFishVoice(saved.fishVoice))) result.fishVoice = saved.fishVoice;
  if (typeof saved.noPrefixForMedalGuard === 'boolean') result.noPrefixForMedalGuard = saved.noPrefixForMedalGuard;
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
    engines = null,
    player,
    config = {},
    registry = null,
    ownerUid = '',
    adminUids = new Set(),
    now = () => Date.now(),
    llm = null,
  }) {
    super();
    this.engine = engine;
    // 双引擎路由：engines.edge / engines.mimo（hybrid 模式按用户分层选择）；engine 为兜底
    this.engines = engines || { edge: engine };
    this.player = player;
    this.config = config;
    this.registry = registry; // 音色设计注册表（VoiceDesignRegistry）
    this.llm = llm; // 外挂 LLM（SenseNova）：注册提示词细化；无/失败时回退原文
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
        mimoVoice: config.mimoVoice || 'mimo_default',
        fishVoice: normalizeFishVoice(config.fishVoice),
        rate: config.rate ?? '+0%',
        pitch: config.pitch ?? '+0Hz',
        volume: config.volume ?? '+0%',
        playerVolume: typeof config.playerVolume === 'number' ? config.playerVolume : 100,
        gain: typeof config.gainPercent === 'number' ? config.gainPercent : 100,
        noPrefixForMedalGuard: Boolean(config.noPrefixForMedalGuard),
      },
    };

    if (config.fishVoice && !validFishVoice(config.fishVoice)) {
      console.warn('[TtsService] FISH_AUDIO_REFERENCE_ID 无效，已忽略；请配置社区音色 ID。弹幕服务继续启动。');
    }

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
      voiceCommand: 0, // 音色设计指令（注册/删除/查询）
    };

    // 最近处理记录（面板展示：每条弹幕 朗读/跳过 + 原因）
    this.recent = [];

    // 当前合成音色（弹幕级音色绑定用），初始 = 全局音色
    this.currentVoice = this.state.settings.voice;

    this.queue = [];
    this.synthConcurrency = Math.max(1, Math.min(6, Math.floor(Number(config.synthConcurrency) || 3)));
    this.synthActive = 0;
    this.synthByEngine = new Map();
    this.busy = false;
    this.lastTextByUser = new Map(); // uid -> { text, at }
    this.lastSpokenText = '';
    this.lastSpokenTextCount = 0;

    // 开关与调音参数持久化（可选）：HTTP/弹幕命令/控制台的变更跨重启保留
    this.fishBindings = new Map();
    this.fishSelection = new FishSelection({
      now: this.now,
      search: async query => (await this.engines.fish.searchVoices(query)).filter(item => !this.isFishVoiceBlocked(item.id)),
      publish: state => this.emit('state', state),
      bind: (uid, voice) => {
        if (this.isFishVoiceBlocked(voice)) throw new Error('该 Fish 音色已被主播拉黑');
        if (!this.fishBindings.has(uid) && this.fishBindings.size >= 10000) throw new Error('绑定数量已满');
        this.fishBindings.set(uid, voice);
        this.persistState();
      },
    });
    this.stateFile = config.stateFile || '';
    if (this.stateFile) {
      try {
        if (fs.existsSync(this.stateFile)) {
          const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
          for (const [uid, voice] of Object.entries(saved.fishBindings || {}).slice(0, 10000)) {
            if (this.isFishVoiceBlocked(voice)) { this.prunedFishBindings = true; continue; }
            if (/^[1-9]\d{0,19}$/.test(uid) && validFishVoice(voice)) this.fishBindings.set(uid, normalizeFishVoice(voice));
          }
          if (typeof saved.enabled === 'boolean') this.state.enabled = saved.enabled;
          if (TTS_PROVIDERS.includes(saved.provider)) this.config.provider = saved.provider;
          if (saved.settings && typeof saved.settings === 'object') {
            this.state.settings = {
              ...this.state.settings,
              ...pickSettings(saved.settings),
            };
            // 音色校验：持久化的音色不属于对应引擎音色空间 → 用配置默认
            const edgeEngine = this.engines?.edge || this.engine;
            if (edgeEngine?.isVoiceSupported && !edgeEngine.isVoiceSupported(this.state.settings.voice)) {
              this.state.settings.voice = config.voice;
            }
            if (this.engines?.mimo?.isVoiceSupported && !this.engines.mimo.isVoiceSupported(this.state.settings.mimoVoice)) {
              this.state.settings.mimoVoice = config.mimoVoice || 'mimo_default';
            }
            this.applySettingsToDevices();
          }
        }
      } catch (error) {
        console.error('[TtsService] 读取状态失败:', error.message);
      }
    }
    if (this.prunedFishBindings) this.persistState();
  }

  isFishVoiceBlocked(voice) {
    const id = normalizeFishVoice(voice);
    return Boolean(id && (this.config.fishBlockedVoices || []).some(value => normalizeFishVoice(value) === id));
  }

  /** 引擎路由切换：edge（全 Edge）/ mimo（全 MIMO）/ hybrid（粉丝牌·白名单→MIMO，其余→Edge）。 */
  setProvider(provider) {
    if (!TTS_PROVIDERS.includes(provider)) throw new Error('provider 仅支持 edge / mimo / hybrid / fish');
    if (provider === 'fish' && !this.engines?.fish?.available) throw new Error('请先在服务端 .env 配置 FISH_AUDIO_API_KEY 并重启弹幕服务');
    this.config.provider = provider;
    this.persistState();
    this.broadcastState({ type: 'tts.feedback', text: `朗读引擎已切换：${provider}` });
    return {
      provider,
      voice: this.state.settings.voice,
      mimoVoice: this.state.settings.mimoVoice,
      mimoAvailable: Boolean(this.engines?.mimo),
      fishAvailable: Boolean(this.engines?.fish?.available),
    };
  }

  persistState() {
    if (!this.stateFile) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({
        enabled: this.state.enabled,
        provider: this.config.provider || 'edge',
        settings: this.state.settings,
        fishBindings: Object.fromEntries(this.fishBindings),
      }, null, 2));
    } catch (error) {
      console.error('[TtsService] 保存状态失败:', error.message);
    }
  }

  /** 将当前 settings 同步到合成引擎与播放器。
   * 增益（gain 100-150%）映射为 Edge SSML volume：+0% ~ +50%。
   * settings.voice = Edge 音色空间；settings.mimoVoice = MIMO 音色空间。 */
  applySettingsToDevices() {
    const s = this.state.settings;
    this.state.voice = s.voice;
    this.currentVoice = s.voice;
    const gainVolume = s.gain && s.gain > 100 ? `+${s.gain - 100}%` : '+0%';
    try {
      (this.engines?.edge || this.engine)?.setParameters?.({ voice: s.voice, rate: s.rate, pitch: s.pitch, volume: gainVolume });
    } catch (error) {
      console.error('[TtsService] 引擎参数更新失败:', error.message);
    }
    try {
      this.engines?.mimo?.setParameters?.({ voice: s.mimoVoice });
    } catch (error) {
      console.error('[TtsService] MIMO 引擎参数更新失败:', error.message);
    }
    try {
      this.player?.setVolume?.(typeof s.playerVolume === 'number' ? s.playerVolume / 100 : 1);
    } catch (error) {
      console.error('[TtsService] 播放器音量更新失败:', error.message);
    }
    try {
      this.engines?.fish?.setParameters?.({ voice: s.fishVoice, rate: s.rate });
    } catch (error) {
      console.error('[TtsService] Fish 引擎参数更新失败:', error.message);
    }
  }

  /**
   * 校验当前音色是否被对应引擎真实支持；不支持则回退默认并广播提示。
   */
  async verifyVoice() {
    try {
      const edgeEngine = this.engines?.edge || this.engine;
      const supported = await edgeEngine?.getSupportedVoices?.();
      if (supported && supported.size) {
        const current = this.state.settings.voice;
        if (!supported.has(current)) {
          const fallback = 'zh-CN-XiaoxiaoNeural';
          console.warn(`[TtsService] 音色 ${current} 不在 Edge 支持列表，回退为 ${fallback}`);
          this.state.settings.voice = fallback;
          this.applySettingsToDevices();
          this.persistState();
          this.broadcastState({ type: 'tts.feedback', text: `音色 ${current} Edge 不支持，已回退为晓晓` });
        }
      }
    } catch (error) {
      console.warn(`[TtsService] 音色校验失败: ${error.message}`);
    }
    try {
      const mimoEngine = this.engines?.mimo;
      const current = this.state.settings.mimoVoice;
      if (mimoEngine?.isVoiceSupported && current && !mimoEngine.isVoiceSupported(current)) {
        console.warn(`[TtsService] 音色 ${current} MIMO 不支持，回退为 mimo_default`);
        this.state.settings.mimoVoice = 'mimo_default';
        this.applySettingsToDevices();
        this.persistState();
      }
    } catch (error) {
      console.warn(`[TtsService] MIMO 音色校验失败: ${error.message}`);
    }
  }

  /**
   * 直播控制台调音：更新音色/语速/音调/音量并持久化。
   * @param {{voice?:string, rate?:string, pitch?:string, playerVolume?:number}} partial
   */
  setSettings(partial = {}, { persist = true } = {}) {
    const s = this.state.settings;
    if (typeof partial.fishVoice === 'string') {
      const value = partial.fishVoice.trim();
      if (value && !validFishVoice(value)) throw new Error('Fish 音色 ID 应为 32 位十六进制 reference_id');
      if (this.isFishVoiceBlocked(value)) throw new Error('该 Fish 音色已被主播拉黑');
      s.fishVoice = normalizeFishVoice(value);
    }
    if (typeof partial.voice === 'string' && partial.voice.trim()) s.voice = partial.voice.trim();
    if (typeof partial.mimoVoice === 'string' && partial.mimoVoice.trim()) s.mimoVoice = partial.mimoVoice.trim();
    if (typeof partial.rate === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(partial.rate)) s.rate = partial.rate;
    if (typeof partial.pitch === 'string' && /^[+-]?\d+(\.\d+)?Hz$/.test(partial.pitch)) s.pitch = partial.pitch;
    if (typeof partial.volume === 'string' && /^[+-]?\d+(\.\d+)?%$/.test(partial.volume)) s.volume = partial.volume;
    if (typeof partial.playerVolume === 'number') {
      s.playerVolume = Math.min(100, Math.max(0, Math.round(partial.playerVolume)));
    }
    if (typeof partial.gain === 'number') {
      s.gain = Math.min(150, Math.max(100, Math.round(partial.gain)));
    }
    if (typeof partial.noPrefixForMedalGuard === 'boolean') {
      s.noPrefixForMedalGuard = partial.noPrefixForMedalGuard;
    }
    // MIMO 音色同步校验（静态列表），非法回退默认
    if (partial.mimoVoice && this.engines?.mimo?.isVoiceSupported
        && !this.engines.mimo.isVoiceSupported(s.mimoVoice)) {
      s.mimoVoice = 'mimo_default';
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
  speakTest(text, profile = null) {
    let sample = cleanupTtsText(text);
    if (!sample) {
      // 取最近一条真实弹幕作为试听样本（避免每次试听都是同一句固定文案）
      const lastRead = this.recent.find(entry => entry.action === 'read' && entry.text);
      sample = lastRead ? lastRead.text : '欢迎来到直播间，弹幕朗读测试。';
    }
    this.enqueue({ uid: 'tts-test', user: '系统试听', text: sample, ...this.resolveVoiceProfile({ uid: 'tts-test' }), ...(profile || {}) });
    this.broadcastState({ type: 'tts.feedback', text: `试听已加入队列：${sample.slice(0, 20)}` });
  }

  /** 音色注册表快照（面板/HTTP API 用）。 */
  voiceDesignsSnapshot() {
    return {
      enabled: this.config.voiceDesign?.enabled !== false && Boolean(this.registry),
      count: this.registry?.size || 0,
      maxUsers: this.registry?.maxUsers || 0,
      users: this.registry?.list() || [],
    };
  }

  /** 面板删除某 UID 的音色注册。 */
  removeVoiceDesign(uid) {
    const removed = this.registry?.remove(uid) || false;
    if (removed) {
      this.broadcastState({ type: 'tts.feedback', text: `已删除 ${uid} 的音色注册` });
    }
    return removed;
  }

  /** 面板试听某 UID 的注册音色（MIMO 可用时用其设计提示词，否则 Edge 默认音色兜底）。 */
  previewVoiceDesign(uid, text) {
    const entry = this.registry?.get(uid);
    if (!entry) throw new Error('该 UID 未注册音色');
    const sample = cleanupTtsText(text) || '欢迎来到直播间，这是音色试听。';
    const useMimo = Boolean(this.engines?.mimo);
    this.enqueue({
      uid: String(uid),
      user: entry.user || `UID ${uid}`,
      text: sample,
      engine: useMimo ? 'mimo' : 'edge',
      voice: useMimo ? this.state.settings.mimoVoice : this.state.settings.voice,
      designPrompt: useMimo ? entry.prompt : null,
    });
    this.broadcastState({ type: 'tts.feedback', text: `试听 ${entry.user || uid} 的音色` });
    return { user: entry.user, prompt: entry.prompt };
  }

  /** 黑盒诊断：引擎连接状态 + 单次真实合成（调试用）。 */
  async diag() {
    const profile = this.resolveVoiceProfile({ uid: 'tts-test' });
    const engine = this.engines?.[profile.engine] || this.engine;
    const engineInfo = {
      provider: profile.engine,
      connected: engine?.connected,
      closed: engine?.closed,
      voice: profile.voice,
      hasClient: Boolean(engine?.client),
      wsReadyState: engine?.client?._ws?.readyState ?? null,
      wsBuffered: engine?.client?._ws?.bufferedAmount ?? null,
      wsUrlHost: engine?.client?._ws?.url?.slice(0, 60) ?? null,
      playerAvailable: this.player?.available ?? null,
    };
    let synth = null;
    try {
      const buf = await engine.synthesize('诊断测试', profile);
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
      fishAvailable: Boolean(this.engines?.fish?.available),
      fishModel: this.engines?.fish?.model || this.config.fishModel || 's2.1-pro',
      playing: this.state.playing,
      queueCount: this.queue.length,
      synthesizingCount: this.synthActive,
      readyCount: this.queue.filter(item => item.status === "ready").length,
      synthConcurrency: this.synthConcurrency,
      lastError: this.state.lastError,
      voice: this.state.voice,
      skippedCount: this.state.skippedCount,
      spokenCount: this.state.spokenCount,
      settings: { ...this.state.settings },
      voiceDesign: {
        enabled: this.config.voiceDesign?.enabled !== false && Boolean(this.registry),
        count: this.registry?.size || 0,
      },
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
      this.playbackGeneration = (this.playbackGeneration || 0) + 1;
      // 关闭时清空队列并跳过当前播放
      for (const item of this.queue) item.cancel();
      this.queue.length = 0;
      this.currentItem?.cancel();
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
      void this.skip();
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

    // 音色设计指令（观众级：注册/删除/查询；朗读开关外也可注册）
    if (this.handleVoiceCommand(event, text, baseEntry)) {
      this.stats.voiceCommand += 1;
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
    const profile = this.resolveVoiceProfile(event);
    this.recordDanmaku({
      ...baseEntry,
      action: 'read',
      text: readText,
      voice: profile.designPrompt ? '设计音色' : (profile.voice || undefined),
      engine: profile.engine,
    });
    this.enqueue({ uid, user: event.user, text: readText, ...profile });
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
    if (this.state.settings.noPrefixForMedalGuard && (guard >= 1 || medal)) return text;
    if (guard >= 1) return `舰长（${user}）：${text}`;
    if (medal && user && user !== '匿名用户') return `${user}，${text}`;
    return text;
  }

  /**
   * MIMO 通道资格：佩戴粉丝牌 / 舰长 / 主播房管 / TTS_MIMO_UIDS 白名单。
   * 决定两件事：能否注册音色设计 + hybrid 路由下是否走 MIMO 引擎。
   */
  canUseMimoLane(event) {
    const uid = String(event?.uid || '');
    return Boolean(event?.medal)
      || Number(event?.guard || 0) >= 1
      || this.isController(uid)
      || Boolean(this.config.mimoUids?.has(uid));
  }

  /**
   * 音色设计指令（观众级）：注册音色 / 删除音色 [uid] / 我的音色。
   * 返回 true = 已消费该弹幕（不进入朗读过滤链）。注册确认用新音色朗读（=即时试听）。
   */
  handleVoiceCommand(event, text, baseEntry) {
    const cmd = parseVoiceCommand(text);
    if (!cmd) return false;

    const uid = String(event.uid || '');
    const user = event.user || '观众';

    if (cmd.type === 'fish-select') {
      const message = this.canUseMimoLane(event)
        ? this.fishSelection.select(uid, cmd.index) : '选择 Fish 音色需要粉丝牌';
      this.recordDanmaku({ ...baseEntry, action: 'voice-command', reason: message });
      this.broadcastState({ type: 'tts.feedback', text: message });
      return true;
    }
    // 指令冷却（主播/房管豁免；含被拒绝的尝试，防刷屏）
    const cooldownMs = Math.max(0, Number(this.config.voiceDesign?.cooldownSeconds ?? 60)) * 1000;
    this.voiceCmdAt = this.voiceCmdAt || new Map();
    if (!this.isController(uid) && cooldownMs > 0) {
      const last = this.voiceCmdAt.get(uid);
      if (last !== undefined && this.now() - last < cooldownMs) {
        this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '音色指令冷却中' });
        return true;
      }
      this.voiceCmdAt.set(uid, this.now());
      if (this.voiceCmdAt.size > 1000) this.voiceCmdAt.clear();
    }

    if (['fish-bind', 'fish-search'].includes(cmd.type) || ((this.config.provider === 'fish' || (this.config.provider === 'hybrid' && this.fishBindings.has(cmd.targetUid || uid))) && ['query', 'remove'].includes(cmd.type))) {
      const feedback = message => {
        this.recordDanmaku({ ...baseEntry, action: 'voice-command', reason: message });
        this.broadcastState({ type: 'tts.feedback', text: message });
      };
      if (!/^[1-9]\d{0,19}$/.test(uid)) {
        feedback('无法识别真实用户 UID，暂不能绑定音色');
        return true;
      }
      if (['fish-bind', 'fish-search'].includes(cmd.type)) {
        if (!this.canUseMimoLane(event)) {
          this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '音色绑定需粉丝牌' });
          this.broadcastState({ type: 'tts.feedback', text: user + '：绑定 Fish 音色需要粉丝牌' });
          return true;
        }
        const voice = cmd.type === 'fish-bind' ? normalizeFishVoice(cmd.voice) : '';
        const query = (cmd.query || cmd.voice || '').trim();
        if (!voice && query && query.length <= 60 && !/^[a-f\d-]{30,}$/i.test(query)) {
          if (!this.engines.fish?.available) { feedback('Fish Audio API Key 未配置，暂不能搜索'); return true; }
          feedback(this.fishSelection.request(uid, user, query));
          return true;
        }
        if (this.isFishVoiceBlocked(voice)) { feedback('该 Fish 音色已被主播拉黑，请选择其他音色'); return true; }
        if (!voice) { feedback('Fish 音色 ID 格式错误：请输入 32 位 ID 或带连字符的 UUID'); return true; }
        if (!this.fishBindings.has(uid) && this.fishBindings.size >= 10000) { feedback('Fish 音色绑定数量已达上限'); return true; }
        this.fishBindings.set(uid, voice);
        this.persistState();
        feedback(user + ' 已绑定 Fish 音色：' + voice + (['fish', 'hybrid'].includes(this.config.provider) ? '' : '（切换 Fish Audio 或混合模式后生效）'));
      } else if (cmd.type === 'remove') {
        const target = cmd.targetUid || uid;
        if (target !== uid && !this.isController(uid)) { feedback('无权限删除他人音色'); return true; }
        const removed = this.fishBindings.delete(target);
        this.persistState();
        feedback(removed ? '已删除 Fish 音色绑定，恢复默认音色' : '该用户尚未绑定 Fish 音色');
      } else {
        feedback(user + ' 的 Fish 音色：' + (this.fishBindings.get(uid) || this.state.settings.fishVoice || '未设置'));
      }
      return true;
    }

    if (this.config.voiceDesign?.enabled === false || !this.registry) {
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '音色功能未开启' });
      this.broadcastState({ type: 'tts.feedback', text: '音色注册功能未开启' });
      return true;
    }

    if (cmd.type === 'register') {
      if (!this.canUseMimoLane(event)) {
        this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '音色注册需粉丝牌' });
        this.broadcastState({ type: 'tts.feedback', text: `${user}：注册音色需要粉丝牌` });
        return true;
      }
      // LLM 细化（可选）：抽象描述 → MiMo voicedesign 可用提示词。
      // 异步执行（~2-4s）不阻塞弹幕主流程；失败/超时回退原文。
      const useLlm = this.llm?.available && this.config.voiceDesign?.refine !== false;
      if (useLlm) {
        this.recordDanmaku({ ...baseEntry, action: 'voice-register', reason: '音色设计中…' });
        this.broadcastState({ type: 'tts.feedback', text: `${user} 的音色设计中…` });
        this.refineAndRegister(event, cmd.prompt, baseEntry).catch(error => {
          console.error('[TtsService] 音色细化流程异常:', error.message);
        });
        return true;
      }
      this.completeRegister(event, cmd.prompt, null, baseEntry);
      return true;
    }

    if (cmd.type === 'remove') {
      if (cmd.targetUid) {
        if (!this.isController(uid)) {
          this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '无权限删除他人音色' });
          return true;
        }
        const removed = this.registry.remove(cmd.targetUid);
        this.recordDanmaku({ ...baseEntry, action: 'voice-remove' });
        this.broadcastState({
          type: 'tts.feedback',
          text: removed ? `已删除 ${cmd.targetUid} 的音色` : `UID ${cmd.targetUid} 未注册音色`,
        });
        return true;
      }
      const removed = this.registry.remove(uid);
      if (!removed) {
        this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: '未注册过音色' });
        this.broadcastState({ type: 'tts.feedback', text: `${user} 还没有注册音色` });
        return true;
      }
      this.recordDanmaku({ ...baseEntry, action: 'voice-remove' });
      this.enqueue({ uid, user, text: '音色已删除，恢复默认朗读', ...this.resolveVoiceProfile(event) });
      this.broadcastState({ type: 'tts.feedback', text: `${user} 已删除音色` });
      return true;
    }

    if (cmd.type === 'query') {
      const entry = this.registry.get(uid);
      const profile = this.resolveVoiceProfile(event);
      this.recordDanmaku({ ...baseEntry, action: 'voice-query' });
      this.enqueue({
        uid,
        user,
        text: entry ? `你注册的音色是：${entry.prompt.slice(0, 60)}` : '你还没有注册音色，发送「设计音色」加一段描述试试',
        ...profile,
      });
      return true;
    }
    return true;
  }

  /** LLM 细化注册提示词 → 落库 + 确认朗读。细化失败回退原文（功能不因 LLM 挂掉而失效）。 */
  async refineAndRegister(event, rawPrompt, baseEntry) {
    let prompt = rawPrompt;
    let refined = false;
    try {
      prompt = await refineVoicePrompt(this.llm, rawPrompt);
      refined = prompt !== rawPrompt;
    } catch (error) {
      console.warn(`[TtsService] 音色细化失败，回退原文: ${error.message}`);
    }
    this.completeRegister(event, prompt, refined ? rawPrompt : null, baseEntry);
  }

  /** 注册落库 + 确认朗读（新音色即时试听）。refined 校验失败时回退原文重试一次。 */
  completeRegister(event, prompt, rawPrompt, baseEntry) {
    const uid = String(event.uid || '');
    const user = event.user || '观众';
    let entry = null;
    let error = null;
    try {
      entry = this.registry.register(uid, prompt, user, rawPrompt);
    } catch (e1) {
      error = e1;
      if (rawPrompt) {
        try { entry = this.registry.register(uid, rawPrompt, user, null); error = null; } catch { /* keep e1 */ }
      }
    }
    if (!entry) {
      this.recordDanmaku({ ...baseEntry, action: 'skipped', reason: `注册失败：${error.message}` });
      this.broadcastState({ type: 'tts.feedback', text: `音色注册失败：${error.message}` });
      return;
    }
    const profile = this.resolveVoiceProfile(event);
    this.recordDanmaku({ ...baseEntry, action: 'voice-register', engine: profile.engine });
    this.enqueue({
      uid,
      user,
      text: profile.designPrompt ? '音色注册成功，以后你的弹幕就用这个声音啦' : '音色已注册，MIMO 朗读通道生效后启用',
      ...profile,
    });
    this.broadcastState({ type: 'tts.feedback', text: `${user} 已注册音色${entry.rawPrompt ? '（LLM 细化）' : ''}` });
  }

  /**
   * 引擎路由 + 音色档案解析：
   * - provider='edge'   → 全 Edge
   * - provider='mimo'   → 全 MIMO
   * - provider='hybrid' → MIMO 通道用户（粉丝牌/舰长/房管/白名单）走 MIMO，其余走 Edge
   * MIMO 通道且已注册音色设计 → voicedesign 模型（designPrompt，无预置音色）。
   * 返回 { engine:'edge'|'mimo', voice:string|null, designPrompt:string|null }
   */
  resolveVoiceProfile(event) {
    const provider = this.config.provider || 'edge';
    const uid = String(event?.uid || '');
    if (provider === 'hybrid' && this.fishBindings.has(uid) && !this.isFishVoiceBlocked(this.fishBindings.get(uid))) return { engine: 'fish', voice: this.fishBindings.get(uid), designPrompt: null };
    if (provider === 'fish') {
      const voice = [this.fishBindings.get(uid), this.resolveVoice(event, 'fish'), this.state.settings.fishVoice].find(id => id && !this.isFishVoiceBlocked(id));
      if (voice) return { engine: 'fish', voice, designPrompt: null };
    }
    let engineName = provider === 'mimo' ? 'mimo'
      : provider === 'hybrid' ? (this.canUseMimoLane(event) ? 'mimo' : 'edge')
      : 'edge';
    if (engineName === 'mimo' && !this.engines?.mimo) engineName = 'edge';
    if (engineName === 'mimo') {
      const design = this.config.voiceDesign?.enabled === false ? null : this.registry?.get(uid);
      if (design) return { engine: 'mimo', voice: null, designPrompt: design.prompt };
      return {
        engine: 'mimo',
        voice: this.resolveVoice(event, 'mimo') || this.state.settings.mimoVoice,
        designPrompt: null,
      };
    }
    return {
      engine: 'edge',
      voice: this.resolveVoice(event, 'edge') || this.state.settings.voice,
      designPrompt: null,
    };
  }

  /**
   * 音色绑定（优先级从高到低）：
   * 1. 用户级预设（UID 或原始用户名匹配）
   * 2. 舰长（guard≥1）→ voiceGuard
   * 3. 粉丝牌等级区间命中
   * 4. null（该引擎全局默认）
   * @param {object} event 弹幕事件
   * @param {string} engineName 'edge' | 'mimo'（校验绑定音色是否属于该引擎音色空间）
   */
  resolveVoice(event, engineName) {
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
    // 引擎音色校验：绑定音色不属于该引擎音色空间（如 MIMO 通道上配置了 Edge 音色）→ 回退全局
    const engine = this.engines?.[engineName] || this.engine;
    if (voice && engine?.isVoiceSupported && !engine.isVoiceSupported(voice)) {
      return null;
    }
    return voice;
  }

  /** 切换到目标音色（面板全局音色变更使用；弹幕级绑定走 synthesize 软切换，不再走这里）。 */
  switchVoice(voice) {
    if (voice === this.currentVoice) return;
    this.currentVoice = voice;
    try {
      (this.engines?.edge || this.engine)?.setParameters?.({ voice });
    } catch (error) {
      console.error('[TtsService] 音色切换失败:', error.message);
    }
  }

  enqueue(input) {
    if (this.stopped) return;
    if (this.queue.length >= MAX_QUEUE_LENGTH) this.queue.shift().cancel();
    const engine = input.engine === 'fish' ? this.engines?.fish : (this.engines?.[input.engine] || this.engine);
    const voice = input.voice || (input.engine === 'fish' ? this.state.settings.fishVoice
      : input.engine === 'mimo' ? this.state.settings.mimoVoice : this.state.settings.voice);
    const item = { ...input, voice, synthEngine: engine, status: 'pending', cancelled: false };
    item.result = new Promise(resolve => { item.resolveResult = resolve; });
    item.cancellation = new Promise(resolve => { item.cancel = () => {
      item.cancelled = true; item.audio = null; resolve({ cancelled: true });
    }; });
    this.queue.push(item);
    this.fillSynthesis();
    void this.pump();
    this.broadcastState();
  }

  fillSynthesis() {
    if (this.stopped) return;
    // Edge shares a mutable WebSocket client: keep that engine at one request.
    // Stateless Fish/MIMO HTTP requests may use the remaining parallel slots.
    for (const item of [this.currentItem, ...this.queue]) {
      if (this.synthActive >= this.synthConcurrency) break;
      if (!item || item.cancelled || item.status !== 'pending') continue;
      const engine = item.synthEngine;
      const active = this.synthByEngine.get(engine) || 0;
      const limit = engine === (this.engines?.edge || this.engine) ? 1 : this.synthConcurrency;
      if (active >= limit) continue;
      item.status = 'synthesizing';
      this.synthActive++;
      this.synthByEngine.set(engine, active + 1);
      void (async () => {
        try {
          if (!engine) throw new Error('朗读引擎未配置');
          if (item.engine === 'fish' && this.isFishVoiceBlocked(item.voice)) throw new Error('该 Fish 音色已被主播拉黑');
          const audio = await engine.synthesize(item.text, { voice: item.voice, designPrompt: item.designPrompt });
          if (!item.cancelled) { item.audio = audio; item.status = 'ready'; }
        } catch (error) {
          if (!item.cancelled) { item.error = error; item.status = 'failed'; }
        } finally {
          this.synthActive--;
          this.synthByEngine.set(engine, (this.synthByEngine.get(engine) || 1) - 1);
          item.resolveResult({});
          this.fillSynthesis();
          this.broadcastState();
        }
      })();
    }
  }

  async pump() {
    if (this.busy || this.stopped) return;
    const item = this.queue.shift();
    if (!item) return;
    this.busy = true;
    this.currentItem = item;
    this.state.playing = { user: item.user, text: item.text };
    this.fillSynthesis();
    this.broadcastState();
    try {
      await Promise.race([item.result, item.cancellation]);
      if (item.cancelled || this.stopped) return;
      if (item.error) throw item.error;
      const audio = item.audio;
      item.audio = null;
      const hash = createHash('sha1').update(audio).digest('hex').slice(0, 12);
      const rec = this.recent.find(entry => entry.action === 'read' && entry.text === item.text.slice(0, 60));
      if (rec) rec.audioHash = hash;
      await Promise.race([this.player.play(audio), item.cancellation]);
      if (!item.cancelled && !this.stopped) { this.state.spokenCount++; this.state.lastError = ''; }
    } catch (error) {
      if (!item.cancelled && !this.stopped) {
        this.state.lastError = error.message;
        console.error('[TtsService] 朗读失败:', error.message);
        this.broadcastState({ type: 'tts.feedback', text: '朗读失败: ' + error.message.slice(0, 60) });
      }
    } finally {
      item.audio = null;
      this.currentItem = null;
      this.state.playing = null;
      this.busy = false;
      this.broadcastState();
      void this.pump();
    }
  }

  async skip() {
    this.currentItem?.cancel();
    this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    try {
      this.player.stop();
    } catch { /* ignore */ }
    this.state.playing = null;
    this.broadcastState({ type: 'tts.feedback', text: '已跳过当前朗读' });
  }

  async start() {
    this.stopped = false;
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
    this.stopped = true;
    this.currentItem?.cancel();
    for (const item of this.queue) item.cancel();
    this.fishSelection.stop();
    await this.engines?.fish?.close?.();
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
