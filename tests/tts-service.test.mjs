import test from 'node:test';
import assert from 'node:assert/strict';
import { DanmakuTtsService, cleanupTtsText } from '../src/tts/tts-service.mjs';

function createService(overrides = {}) {
  let clock = 1_000;
  const calls = [];
  const engine = {
    async synthesize(text) {
      calls.push({ op: 'synth', text });
      return Buffer.from(`mp3:${text}`);
    },
    setParameters(params) {
      calls.push({ op: 'setParams', params });
    },
  };
  const player = {
    async start() { calls.push({ op: 'start' }); },
    async play(audio) {
      calls.push({ op: 'play', audio: audio.toString() });
    },
    stop() { calls.push({ op: 'stop' }); },
    async close() { calls.push({ op: 'close' }); },
    setVolume(volume) { calls.push({ op: 'setVolume', volume }); },
  };
  const service = new DanmakuTtsService({
    engine,
    player,
    config: {
      enabled: true,
      voice: 'zh-CN-XiaoxiaoNeural',
      maxTextLength: 60,
      skipCommands: true,
      blockedUids: new Set(['999']),
      blockedKeywords: ['禁词'],
      dedupeWindowMs: 10_000,
      cooldownMs: 0,
      isCommandText: text => /^点歌/.test(text),
      ...overrides,
    },
    ownerUid: '1',
    adminUids: new Set(['2']),
    now: () => clock++,
  });
  return { service, calls, clock: () => clock };
}

function danmaku(text, uid = '10', user = '弹幕用户', extra = {}) {
  return { type: 'danmaku', uid: String(uid), user, text, ...extra };
}

test('朗读前缀：舰长 → 舰长，有粉丝牌 → 用户名，都没有 → 无前缀', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('舰长晚上好', '10001', '舰长小明', { guard: 1, medal: { name: '粉丝团', lv: 5 } }));
  service.handleDanmaku(danmaku('铁粉晚上好', '10002', '铁粉小红', { guard: 0, medal: { name: '粉丝团', lv: 3 } }));
  service.handleDanmaku(danmaku('路人晚上好', '10003', '路人小李', { guard: 0, medal: null }));
  await new Promise(resolve => setTimeout(resolve, 40));
  const synths = calls.filter(item => item.op === 'synth').map(item => item.text);
  assert.deepEqual(synths, ['舰长，舰长晚上好', '铁粉小红，铁粉晚上好', '路人晚上好']);
});

test('朗读前缀可关闭（readPrefix=false 时读原文）', async () => {
  const { service, calls } = createService({ readPrefix: false });
  service.handleDanmaku(danmaku('晚上好', '10001', '舰长小明', { guard: 1 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  const synths = calls.filter(item => item.op === 'synth').map(item => item.text);
  assert.deepEqual(synths, ['晚上好']);
});

test('增益 100-150% 映射引擎 volume（+0% ~ +50%），超出钳制', () => {
  const { service, calls } = createService();
  service.setSettings({ gain: 150 });
  assert.equal(service.snapshot().settings.gain, 150);
  const params = calls.filter(item => item.op === 'setParams').at(-1)?.params;
  assert.equal(params.volume, '+50%');
  service.setSettings({ gain: 999 });
  assert.equal(service.snapshot().settings.gain, 150); // 钳制上限
  service.setSettings({ gain: 50 });
  assert.equal(service.snapshot().settings.gain, 100); // 钳制下限
});

test('cleanupTtsText 去除表情与控制符并折叠空白', () => {
  assert.equal(cleanupTtsText('你好🎉世界\u200D❤️️ ！'), '你好世界 ！');
  assert.equal(cleanupTtsText('  多   个  空格  '), '多 个 空格');
  assert.equal(cleanupTtsText(''), '');
});

test('开关关闭时不产生合成与播放调用', async () => {
  const { service, calls } = createService({ enabled: false });
  service.handleDanmaku(danmaku('你好主播'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 0);
  assert.equal(calls.filter(item => item.op === 'play').length, 0);
});

test('开启后朗读一条弹幕（合成→写入→播放）', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('你好主播'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(calls.filter(item => item.op === 'synth').map(item => item.text), ['你好主播']);
  assert.equal(calls.filter(item => item.op === 'play').length, 1);
  assert.equal(service.state.spokenCount, 1);
});

test('命令弹幕（点歌）不朗读', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('点歌 夜曲'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 0);
});

test('超长弹幕与黑名单用户/关键词不朗读', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('x'.repeat(61)));
  service.handleDanmaku(danmaku('你好', '999'));
  service.handleDanmaku(danmaku('这个禁词真好笑'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 0);
});

test('同一用户同文本 10 秒内去重', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('冲鸭'));
  service.handleDanmaku(danmaku('冲鸭'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 1);
  assert.equal(service.state.skippedCount, 1);
});

test('全局连续 3 次相同文本后跳过', async () => {
  const { service, calls } = createService({ dedupeWindowMs: 0 });
  service.handleDanmaku(danmaku('刷屏啦', '10'));
  service.handleDanmaku(danmaku('刷屏啦', '11'));
  service.handleDanmaku(danmaku('刷屏啦', '12'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 2);
});

test('多条弹幕串行排队播放（不重叠）', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('第一条'));
  service.handleDanmaku(danmaku('第二条', '11'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const synths = calls.filter(item => item.op === 'synth').map(item => item.text);
  const plays = calls.filter(item => item.op === 'play').map(item => item.audio);
  assert.deepEqual(synths, ['第一条', '第二条']);
  assert.deepEqual(plays, ['mp3:第一条', 'mp3:第二条']);
  assert.equal(service.state.queueCount, 0);
});

test('主播/房管弹幕命令可开关朗读', async () => {
  const { service, calls } = createService({ enabled: true });
  service.handleDanmaku(danmaku('朗读关', '1'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.state.enabled, false);
  assert.equal(calls.filter(item => item.op === 'synth').length, 0);

  service.handleDanmaku(danmaku('朗读开', '2'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.state.enabled, true);
});

test('普通观众的命令弹幕被消费但不执行', async () => {
  const { service, calls } = createService({ enabled: true });
  service.handleDanmaku(danmaku('朗读关', '100'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.state.enabled, true);
  assert.equal(calls.filter(item => item.op === 'synth').length, 0);
});

test('合成失败记录错误并继续处理后续队列', async () => {
  const { service } = createService();
  const feedbacks = [];
  service.on('state', payload => {
    if (payload.type === 'tts.feedback' && payload.text.includes('朗读失败')) feedbacks.push(payload.text);
  });
  service.engine.synthesize = async text => {
    if (text === '坏消息') throw new Error('合成失败');
    return Buffer.from(`mp3:${text}`);
  };
  service.handleDanmaku(danmaku('坏消息'));
  service.handleDanmaku(danmaku('好消息', '11'));
  await new Promise(resolve => setTimeout(resolve, 50));
  // 失败弹幕产生错误反馈
  assert.ok(feedbacks.some(text => text.includes('合成失败')));
  // 后续队列继续处理完成
  assert.equal(service.state.spokenCount, 1);
  assert.equal(service.state.queueCount, 0);
});

test('setEnabled(false) 清空队列并跳过当前播放', async () => {
  const { service, calls } = createService();
  service.handleDanmaku(danmaku('朗读中'));
  service.setEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(service.state.enabled, false);
  assert.equal(service.state.playing, null);
  assert.ok(calls.some(item => item.op === 'stop'));
  assert.equal(service.state.queueCount, 0);
});

test('snapshot 结构完整', () => {
  const { service } = createService();
  const snapshot = service.snapshot();
  assert.equal(snapshot.type, 'tts.state');
  assert.equal(typeof snapshot.enabled, 'boolean');
  assert.equal(typeof snapshot.queueCount, 'number');
  assert.equal(snapshot.voice, 'zh-CN-XiaoxiaoNeural');
  assert.equal(snapshot.settings.voice, 'zh-CN-XiaoxiaoNeural');
});

test('setSettings 更新音色/语速/音调/音量并同步引擎与播放器', () => {
  const { service, calls } = createService();
  service.setSettings({
    voice: 'zh-CN-YunxiNeural',
    rate: '+25%',
    pitch: '-10Hz',
    playerVolume: 60,
  });
  const snapshot = service.snapshot();
  assert.equal(snapshot.settings.voice, 'zh-CN-YunxiNeural');
  assert.equal(snapshot.settings.rate, '+25%');
  assert.equal(snapshot.settings.pitch, '-10Hz');
  assert.equal(snapshot.settings.playerVolume, 60);
  assert.equal(snapshot.voice, 'zh-CN-YunxiNeural');
  const params = calls.filter(item => item.op === 'setParams').at(-1)?.params;
  assert.equal(params.voice, 'zh-CN-YunxiNeural');
  assert.equal(params.rate, '+25%');
  assert.equal(params.pitch, '-10Hz');
  assert.equal(calls.filter(item => item.op === 'setVolume').at(-1)?.volume, 0.6);
});

test('setSettings 拒绝非法格式并钳制音量范围', () => {
  const { service } = createService();
  service.setSettings({ rate: 'abc', pitch: 'zzz', playerVolume: 500 });
  const s = service.snapshot().settings;
  assert.equal(s.rate, '+0%'); // 非法速率保持默认
  assert.equal(s.pitch, '+0Hz');
  assert.equal(s.playerVolume, 100); // 500 → 钳制 100
});

test('speakTest 在关闭状态下也能试听（绕过开关）', async () => {
  const { service, calls } = createService({ enabled: false });
  service.speakTest('试听文本');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(item => item.op === 'synth').length, 1);
  assert.equal(calls.filter(item => item.op === 'play').length, 1);
});

test('设置持久化到状态文件并可跨实例恢复', async () => {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const stateFile = path.join(os.tmpdir(), `tts-state-test-${Date.now()}.json`);
  try {
    const first = createService({ stateFile });
    first.service.setEnabled(true);
    first.service.setSettings({ voice: 'zh-CN-YunyangNeural', rate: '+15%', playerVolume: 40 });
    // 新实例读取同一文件（同 engine/player mock）
    const second = createService({ stateFile });
    assert.equal(second.service.state.enabled, true);
    assert.equal(second.service.state.settings.voice, 'zh-CN-YunyangNeural');
    assert.equal(second.service.state.settings.rate, '+15%');
    assert.equal(second.service.state.settings.playerVolume, 40);
  } finally {
    fs.unlinkSync(stateFile);
  }
});