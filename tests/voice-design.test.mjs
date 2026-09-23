import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseVoiceCommand } from '../src/danmaku/voice-commands.mjs';
import { VoiceDesignRegistry } from '../src/tts/voice-registry.mjs';
import { DanmakuTtsService } from '../src/tts/tts-service.mjs';

const MIMO_IDS = new Set(['mimo_default', '冰糖', '茉莉', '苏打', '白桦']);

function createService(overrides = {}, registry = null, llm = null) {
  let clock = 1_000_000_000_000;
  const calls = [];
  const mkEngine = name => ({
    name,
    async synthesize(text, opts = {}) {
      calls.push({ op: 'synth', engine: name, text, voice: opts.voice, designPrompt: opts.designPrompt });
      return Buffer.from(`mp3:${name}:${text}`);
    },
    setParameters(params) { calls.push({ op: 'setParams', engine: name, params }); },
    isVoiceSupported(voice) {
      return name === 'mimo' ? MIMO_IDS.has(voice) : /^zh-CN-/.test(voice);
    },
  });
  const player = {
    async start() { calls.push({ op: 'start' }); },
    async play(audio) { calls.push({ op: 'play', audio: audio.toString() }); },
    stop() { calls.push({ op: 'stop' }); },
    async close() { calls.push({ op: 'close' }); },
    setVolume(v) { calls.push({ op: 'setVolume', volume: v }); },
  };
  const service = new DanmakuTtsService({
    engine: mkEngine('edge'),
    engines: { edge: mkEngine('edge'), mimo: mkEngine('mimo') },
    player,
    registry,
    config: {
      enabled: true,
      provider: 'hybrid',
      voice: 'zh-CN-XiaoxiaoNeural',
      mimoVoice: 'mimo_default',
      maxTextLength: 60,
      skipCommands: true,
      dedupeWindowMs: 10_000,
      cooldownMs: 0,
      mimoUids: new Set(['316052822']),
      voiceDesign: { enabled: true, cooldownSeconds: 60, promptMin: 4, promptMax: 120 },
      isCommandText: text => /^点歌/.test(text),
      ...overrides,
    },
    ownerUid: '1',
    adminUids: new Set(['2']),
    now: () => ++clock,
    llm,
  });
  return { service, calls };
}

function danmaku(text, uid = '10', user = '弹幕用户', extra = {}) {
  return { type: 'danmaku', uid: String(uid), user, text, ...extra };
}
const medal = lv => ({ name: '粉丝团', lv });
const wait = ms => new Promise(r => setTimeout(r, ms ?? 40));

test('parseVoiceCommand：注册/删除/查询及别名', () => {
  assert.deepEqual(parseVoiceCommand('设计音色 慵懒御姐音'), { type: 'register', prompt: '慵懒御姐音' });
  assert.deepEqual(parseVoiceCommand('设计音色:少年感男声'), { type: 'register', prompt: '少年感男声' });
  assert.deepEqual(parseVoiceCommand('定制音色  元气  少女'), { type: 'register', prompt: '元气 少女' });
  assert.deepEqual(parseVoiceCommand('删除音色'), { type: 'remove' });
  assert.deepEqual(parseVoiceCommand('重置音色'), { type: 'remove' });
  assert.deepEqual(parseVoiceCommand('删除音色 316052822'), { type: 'remove', targetUid: '316052822' });
  assert.deepEqual(parseVoiceCommand('我的音色'), { type: 'query' });
  assert.equal(parseVoiceCommand('今天天气不错'), null);
  assert.equal(parseVoiceCommand('注册音色'), null);
});

test('registry：注册/查询/删除/持久化/校验/容量淘汰', () => {
  const file = path.join(os.tmpdir(), `voice-designs-test-${Date.now()}.json`);
  try {
    const reg = new VoiceDesignRegistry({ file, maxUsers: 2, promptMin: 4, promptMax: 10, blockedKeywords: ['禁词'] });
    reg.register('111', '慵懒御姐', '甲');
    assert.equal(reg.get('111').prompt, '慵懒御姐');
    // 校验：过短/超长/屏蔽词
    assert.throws(() => reg.register('222', '短'), /至少/);
    assert.throws(() => reg.register('222', 'x'.repeat(11)), /最长/);
    assert.throws(() => reg.register('222', '含有禁词描述'), /屏蔽词/);
    assert.throws(() => reg.register('abc', '正常描述词'), /UID/);
    // 持久化：新实例读回
    reg.register('222', '少年感男声', '乙');
    const reg2 = new VoiceDesignRegistry({ file, maxUsers: 2, promptMin: 4, promptMax: 10 });
    assert.equal(reg2.get('222').user, '乙');
    // 容量淘汰最旧（111 先注册）
    reg2.register('333', '元气少女音', '丙');
    assert.equal(reg2.get('111'), null);
    assert.ok(reg2.get('333'));
    // 删除
    assert.equal(reg2.remove('333'), true);
    assert.equal(reg2.remove('333'), false);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('注册指令：粉丝牌用户注册→确认用新音色（MIMO voicedesign）→后续弹幕走设计音色', async () => {
  const file = path.join(os.tmpdir(), `vd-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const { service, calls } = createService({}, reg);
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '10001', '牌牌', { medal: medal(5) }));
    await wait();
    // 确认朗读：mimo 引擎 + designPrompt
    const confirm = calls.find(c => c.op === 'synth' && c.text.includes('注册成功'));
    assert.equal(confirm.engine, 'mimo');
    assert.equal(confirm.designPrompt, '慵懒御姐音');
    // 后续弹幕走设计音色
    service.handleDanmaku(danmaku('晚上好', '10001', '牌牌', { medal: medal(5) }));
    await wait();
    const read = calls.find(c => c.op === 'synth' && c.text === '牌牌，晚上好');
    assert.equal(read.engine, 'mimo');
    assert.equal(read.designPrompt, '慵懒御姐音');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('hybrid 路由：无牌路人 → Edge；粉丝牌 → MIMO；白名单 UID 无牌也走 MIMO', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('路人弹幕', '20001', '路人', { medal: null }));
  service.handleDanmaku(danmaku('粉丝弹幕', '20002', '粉丝', { medal: medal(3) }));
  service.handleDanmaku(danmaku('主播弹幕', '316052822', '小小小名不是小明', { medal: null }));
  await wait();
  const synths = calls.filter(c => c.op === 'synth');
  assert.equal(synths.find(s => s.text === '路人弹幕').engine, 'edge');
  assert.equal(synths.find(s => s.text === '粉丝，粉丝弹幕').engine, 'mimo');
  assert.equal(synths.find(s => s.text.includes('主播弹幕')).engine, 'mimo');
});

test('provider=edge 时全部走 Edge；provider=mimo 时全部走 MIMO', async () => {
  const edgeOnly = createService({ provider: 'edge' });
  edgeOnly.service.handleDanmaku(danmaku('粉丝弹幕', '20002', '粉丝', { medal: medal(3) }));
  await wait();
  assert.equal(edgeOnly.calls.find(c => c.op === 'synth').engine, 'edge');

  const mimoAll = createService({ provider: 'mimo' });
  mimoAll.service.handleDanmaku(danmaku('路人弹幕', '20001', '路人', { medal: null }));
  await wait();
  assert.equal(mimoAll.calls.find(c => c.op === 'synth').engine, 'mimo');
});

test('注册权限：无牌非白名单被拒（消费不朗读），指令冷却拦截重复注册', async () => {
  const file = path.join(os.tmpdir(), `vd2-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const { service, calls } = createService({}, reg);
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '30001', '路人', { medal: null }));
    await wait();
    assert.equal(reg.get('30001'), null);
    assert.equal(calls.filter(c => c.op === 'synth').length, 0); // 拒绝不朗读
    // 白名单用户注册成功，但第二条指令被冷却拦截
    service.handleDanmaku(danmaku('设计音色 少年感男声', '316052822', '主播', { medal: null }));
    await wait();
    assert.equal(reg.get('316052822').prompt, '少年感男声');
    service.handleDanmaku(danmaku('设计音色 换一种声音', '316052822', '主播', { medal: null }));
    await wait();
    assert.equal(reg.get('316052822').prompt, '少年感男声'); // 冷却期未更新
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('删除音色：自己删除走默认音色确认；主播可删他人', async () => {
  const file = path.join(os.tmpdir(), `vd3-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const { service, calls } = createService({ voiceDesign: { enabled: true, cooldownSeconds: 0, promptMin: 4, promptMax: 120 } }, reg);
  try {
    reg.register('40001', '慵懒御姐音', '牌牌');
    service.handleDanmaku(danmaku('删除音色', '40001', '牌牌', { medal: medal(5) }));
    await wait();
    assert.equal(reg.get('40001'), null);
    // 删除后该用户回到 MIMO 预置音色（仍是粉丝牌通道）
    const confirm = calls.find(c => c.op === 'synth' && c.text.includes('已删除'));
    assert.equal(confirm.engine, 'mimo');
    assert.equal(confirm.designPrompt, null);
    assert.equal(confirm.voice, 'mimo_default');
    // 主播删他人
    reg.register('40002', '少年感男声', '路人乙');
    service.handleDanmaku(danmaku('删除音色 40002', '1', '主播'));
    assert.equal(reg.get('40002'), null);
    // 普通用户删他人 → 拒绝
    reg.register('40003', '少年感男声', '路人丙');
    service.handleDanmaku(danmaku('删除音色 40003', '40001', '牌牌', { medal: medal(5) }));
    assert.ok(reg.get('40003'));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('MIMO 不可用（engines.mimo=null）时 hybrid 全量回退 Edge，注册仍受理', async () => {
  const file = path.join(os.tmpdir(), `vd4-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const { service, calls } = createService({}, reg);
  service.engines.mimo = null;
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '50001', '粉丝', { medal: medal(5) }));
    await wait();
    assert.ok(reg.get('50001')); // 注册受理
    const confirm = calls.find(c => c.op === 'synth' && c.text.includes('已注册'));
    assert.equal(confirm.engine, 'edge'); // 确认朗读回退 Edge
    service.handleDanmaku(danmaku('你好', '50001', '粉丝', { medal: medal(5) }));
    await wait();
    const read = calls.find(c => c.op === 'synth' && c.text === '粉丝，你好');
    assert.equal(read.engine, 'edge');
    assert.equal(read.designPrompt, null); // Edge 不用设计提示词
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('面板 API：voiceDesignsSnapshot / removeVoiceDesign / previewVoiceDesign', async () => {
  const file = path.join(os.tmpdir(), `vd5-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const { service, calls } = createService({}, reg);
  try {
    reg.register('60001', '慵懒御姐音', '牌牌');
    const snap = service.voiceDesignsSnapshot();
    assert.equal(snap.count, 1);
    assert.equal(snap.users[0].uid, '60001');
    service.previewVoiceDesign('60001', '试听一下');
    await wait();
    const prev = calls.find(c => c.op === 'synth' && c.text === '试听一下');
    assert.equal(prev.engine, 'mimo');
    assert.equal(prev.designPrompt, '慵懒御姐音');
    assert.equal(service.removeVoiceDesign('60001'), true);
    assert.equal(service.voiceDesignsSnapshot().count, 0);
    assert.throws(() => service.previewVoiceDesign('60001'), /未注册/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('provider 持久化到状态文件并跨实例恢复', async () => {
  const stateFile = path.join(os.tmpdir(), `tts-state-vd-${Date.now()}.json`);
  try {
    const first = createService({ stateFile });
    first.service.setProvider('hybrid');
    const second = createService({ stateFile });
    assert.equal(second.service.config.provider, 'hybrid');
    second.service.setProvider('edge');
    const third = createService({ stateFile });
    assert.equal(third.service.config.provider, 'edge');
    assert.throws(() => third.service.setProvider('bogus'), /edge/);
  } finally {
    fs.rmSync(stateFile, { force: true });
  }
});

// ---------- 外挂 LLM：注册提示词细化 ----------

const mkLlm = (reply, { fail = false } = {}) => ({
  available: true,
  model: 'mock-llm',
  async chat(messages, opts = {}) {
    this.lastCall = { messages, opts };
    if (fail) throw new Error('LLM 请求超时');
    return reply;
  },
});

test('LLM 细化：抽象描述 → 细化提示词入库，rawPrompt 保留原文，确认用细化音色', async () => {
  const file = path.join(os.tmpdir(), `vd-llm-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const llm = mkLlm('一个憨厚慵懒的青年男声，语调拖长带鼻音，说话慢半拍，傻气里透着真诚');
  const { service, calls } = createService({}, reg, llm);
  try {
    service.handleDanmaku(danmaku('设计音色 派大星', '70001', '粉丝', { medal: medal(5) }));
    await wait();
    const entry = reg.get('70001');
    assert.equal(entry.rawPrompt, '派大星'); // 原文留存（面板展示）
    assert.ok(entry.prompt.includes('憨厚')); // 存的是细化结果
    // LLM 收到 system + user 两条消息
    assert.equal(llm.lastCall.messages.length, 2);
    assert.equal(llm.lastCall.messages[1].content, '派大星');
    // 确认朗读用细化后的 designPrompt
    const confirm = calls.find(c => c.op === 'synth' && c.text.includes('注册成功'));
    assert.equal(confirm.engine, 'mimo');
    assert.equal(confirm.designPrompt, entry.prompt);
    // 持久化字段完整
    const reg2 = new VoiceDesignRegistry({ file });
    assert.equal(reg2.get('70001').rawPrompt, '派大星');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('LLM 失败/超时 → 回退原文注册，功能不失效', async () => {
  const file = path.join(os.tmpdir(), `vd-llm2-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const llm = mkLlm(null, { fail: true });
  const { service, calls } = createService({}, reg, llm);
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '70002', '粉丝', { medal: medal(5) }));
    await wait();
    const entry = reg.get('70002');
    assert.equal(entry.prompt, '慵懒御姐音'); // 回退原文
    assert.equal(entry.rawPrompt, null);
    const confirm = calls.find(c => c.op === 'synth' && c.text.includes('注册成功'));
    assert.equal(confirm.designPrompt, '慵懒御姐音');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('LLM 细化结果校验失败（超长）→ 回退原文', async () => {
  const file = path.join(os.tmpdir(), `vd-llm3-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const llm = mkLlm('长'.repeat(200)); // 超 promptMax
  const { service } = createService({}, reg, llm);
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '70003', '粉丝', { medal: medal(5) }));
    await wait();
    assert.equal(reg.get('70003').prompt, '慵懒御姐音'); // 回退原文
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('voiceDesign.refine=false 或有 LLM 但未开启 → 直存原文', async () => {
  const file = path.join(os.tmpdir(), `vd-llm4-${Date.now()}.json`);
  const reg = new VoiceDesignRegistry({ file, promptMin: 4, promptMax: 120 });
  const llm = mkLlm('不应被调用的细化结果描述');
  const { service } = createService(
    { voiceDesign: { enabled: true, cooldownSeconds: 60, promptMin: 4, promptMax: 120, refine: false } },
    reg, llm,
  );
  try {
    service.handleDanmaku(danmaku('设计音色 慵懒御姐音', '70004', '粉丝', { medal: medal(5) }));
    await wait();
    assert.equal(reg.get('70004').prompt, '慵懒御姐音'); // 未走 LLM
    assert.equal(llm.lastCall, undefined);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
