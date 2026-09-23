import fs from 'fs';
import path from 'path';

/**
 * 音色设计注册表：UID → voice design 提示词。
 * 持久化到 data/voice-designs.json（tmp+rename 原子写，与 JsonSongRepository 同款）。
 */
export class VoiceDesignRegistry {
  constructor({
    file,
    maxUsers = 500,
    promptMin = 4,
    promptMax = 120,
    blockedKeywords = [],
  } = {}) {
    this.file = file || '';
    this.maxUsers = maxUsers;
    this.promptMin = promptMin;
    this.promptMax = promptMax;
    this.blockedKeywords = blockedKeywords.map(k => String(k).toLocaleLowerCase('zh-CN'));
    /** uid -> { prompt, user, updatedAt }（Map 保持插入序，作 LRU） */
    this.users = new Map();
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const users = parsed?.users && typeof parsed.users === 'object' ? parsed.users : {};
      for (const [uid, entry] of Object.entries(users)) {
        if (!/^\d+$/.test(uid) || typeof entry?.prompt !== 'string' || !entry.prompt.trim()) continue;
        this.users.set(uid, {
          prompt: String(entry.prompt),
          rawPrompt: typeof entry.rawPrompt === 'string' ? entry.rawPrompt : null,
          user: String(entry.user || ''),
          updatedAt: Number(entry.updatedAt || 0),
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[VoiceRegistry] 注册表读取失败，将使用空表:', error.message);
      }
    }
  }

  save() {
    if (!this.file) return;
    try {
      const directory = path.dirname(this.file);
      fs.mkdirSync(directory, { recursive: true });
      const users = {};
      for (const [uid, entry] of this.users) users[uid] = entry;
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, users }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.file);
    } catch (error) {
      console.error('[VoiceRegistry] 注册表保存失败:', error.message);
    }
  }

  /** 校验并清洗提示词；非法时抛 Error（message 为可读原因）。 */
  validatePrompt(prompt) {
    const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length < this.promptMin) throw new Error(`提示词至少 ${this.promptMin} 字`);
    if (cleaned.length > this.promptMax) throw new Error(`提示词最长 ${this.promptMax} 字`);
    const lower = cleaned.toLocaleLowerCase('zh-CN');
    if (this.blockedKeywords.some(k => lower.includes(k))) throw new Error('提示词含屏蔽词');
    return cleaned;
  }

  /** 注册/更新；成功返回 entry，失败抛 Error。超出容量时淘汰最旧条目。
   *  prompt = 实际消费的音色描述（可为 LLM 细化结果）；rawPrompt = 观众原始输入（面板展示用）。 */
  register(uid, prompt, user = '', rawPrompt = null) {
    uid = String(uid || '');
    if (!/^\d+$/.test(uid) || uid === '0') throw new Error('无效 UID');
    const cleaned = this.validatePrompt(prompt);
    const entry = {
      prompt: cleaned,
      rawPrompt: rawPrompt && String(rawPrompt) !== cleaned ? String(rawPrompt) : null,
      user: String(user || ''),
      updatedAt: Date.now(),
    };
    // 重新插入到末尾（LRU）
    this.users.delete(uid);
    if (this.users.size >= this.maxUsers) {
      const oldest = this.users.keys().next().value;
      this.users.delete(oldest);
    }
    this.users.set(uid, entry);
    this.save();
    return entry;
  }

  remove(uid) {
    const existed = this.users.delete(String(uid || ''));
    if (existed) this.save();
    return existed;
  }

  get(uid) {
    return this.users.get(String(uid || '')) || null;
  }

  /** 新注册在前（updatedAt 倒序）。 */
  list() {
    return [...this.users.entries()]
      .map(([uid, entry]) => ({ uid, ...entry }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get size() {
    return this.users.size;
  }
}
