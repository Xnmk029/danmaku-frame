import test from 'node:test';
import assert from 'node:assert/strict';
import { FishSelection } from '../src/tts/fish-selection.mjs';
import { FishTtsEngine } from '../src/tts/fish-tts.mjs';
import { DanmakuTtsService } from '../src/tts/tts-service.mjs';
import { parseVoiceCommand } from '../src/danmaku/voice-commands.mjs';
const voice = 'c996fb5342d64a1ebb42eb2e3d586711';
const items = [{ id: voice, title: '派大星', author: '作者一' }];
const flush = () => new Promise(resolve => setImmediate(resolve));

test('search API encodes Chinese names, filters unusable/duplicate voices, limits candidates', async () => {
  const engine = new FishTtsEngine({ apiKey: 'test', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).pathname, '/model');
    assert.equal(new URL(url).searchParams.get('title'), '派大星 & 声音');
    assert.equal(options.headers.Authorization, 'Bearer test');
    return Response.json({ items: [
      { _id: voice, title: '<派大星>', author: { nickname: '作者' } },
      { _id: voice, title: '重复' }, { _id: 'invalid', title: '错误' },
      { _id: 'a'.repeat(32), title: '下架', dmca_taken_down: true },
    ] });
  } });
  assert.deepEqual(await engine.searchVoices('派大星 & 声音'), [{ id: voice, title: '<派大星>', author: '作者' }]);
});

test('selection queue isolates users, counts only after display, rejects expired choices and restores idle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1000;
  const bound = [], events = [];
  const selection = new FishSelection({ search: async () => items, publish: e => events.push(e.phase), bind: (...v) => bound.push(v), now: () => now, intro: 100, duration: 1000, hold: 100 });
  t.after(() => selection.stop());
  selection.request('1', '甲', '派大星');
  selection.request('2', '乙', '派大星');
  assert.match(selection.request('1', '甲', '其他'), /正在处理/);
  await flush();
  assert.equal(selection.snapshot().expiresAt, 2100);
  assert.match(selection.select('2', 1), /没有/);
  assert.match(selection.select('1', 3), /编号/);
  assert.match(selection.select('1', 1), /已绑定/);
  assert.deepEqual(bound, [['1', voice]]);
  now = 1200; t.mock.timers.tick(100); await flush();
  assert.equal(selection.snapshot().uid, '2');
  assert.equal(selection.snapshot().expiresAt, 2300);
  now = 2300;
  assert.match(selection.select('2', 1), /超时/);
  t.mock.timers.tick(1100);
  assert.equal(selection.snapshot().phase, 'timeout');
  t.mock.timers.tick(100);
  assert.equal(selection.snapshot().phase, 'idle');
  assert.ok(events.includes('success'));
});

test('empty/error states finish, stopped searches cannot publish late results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const states = [];
  const selection = new FishSelection({ search: async q => { if (q === 'empty') return []; if (q === 'error') throw Error('secret'); return new Promise(r => { finish = r; }); }, publish: s => states.push(s), bind() {}, hold: 10 });
  selection.request('1', '甲', 'empty'); await flush();
  assert.equal(selection.snapshot().phase, 'empty');
  t.mock.timers.tick(10);
  selection.request('1', '甲', 'error'); await flush();
  assert.equal(selection.snapshot().phase, 'error');
  assert.equal(JSON.stringify(states).includes('secret'), false);
  t.mock.timers.tick(10);
  selection.request('1', '甲', 'pending');
  selection.stop(); const count = states.length; finish(items); await flush();
  assert.equal(states.length, count);
});

test('danmaku search requires eligibility; immediate selection bypasses search cooldown and persists binding', async t => {
  assert.deepEqual(parseVoiceCommand('选择音色 二'), { type: 'fish-select', index: 2 });
  assert.deepEqual(parseVoiceCommand('搜索音色 派大星'), { type: 'fish-search', query: '派大星' });
  let searches = 0;
  const fish = { available: true, setParameters() {}, searchVoices: async () => { searches++; return items; } };
  const service = new DanmakuTtsService({ engine: { setParameters() {} }, engines: { fish }, player: { setVolume() {} }, config: { provider: 'fish' } });
  t.after(() => service.fishSelection.stop());
  const event = { type: 'danmaku', uid: '123', user: '甲', text: '音色 派大星', medal: { name: '牌', lv: 1 } };
  service.handleDanmaku({ ...event, uid: '456', medal: null });
  assert.equal(searches, 0);
  service.handleDanmaku(event); await flush();
  assert.equal(searches, 1);
  service.handleDanmaku({ ...event, uid: '789', text: '选择音色 一' });
  assert.equal(service.fishBindings.size, 0);
  service.handleDanmaku({ ...event, text: '选择音色 一' });
  assert.equal(service.fishBindings.get('123'), voice);
  assert.equal(service.resolveVoiceProfile(event).voice, voice);
  service.handleDanmaku({ ...event, uid: '321', text: '选择音色 ' + voice });
  assert.equal(service.fishBindings.get('321'), voice);
  assert.equal(searches, 1, 'ID alias binds directly without another search');
});


test('Fish registration aliases accept names and IDs without stealing MIMO design or selection commands', () => {
 for (const prefix of ['注册音色','音色注册','选择音色','音色']) {
   for (const delimiter of [' ', ':', '：']) {
     assert.deepEqual(parseVoiceCommand(prefix + delimiter + '派大星'), {type:'fish-bind',voice:'派大星'});
     assert.deepEqual(parseVoiceCommand(prefix + delimiter + voice), {type:'fish-bind',voice});
   }
   assert.equal(parseVoiceCommand(prefix), null);
 }
 assert.deepEqual(parseVoiceCommand('设计音色 温柔女声'), {type:'register',prompt:'温柔女声'});
 assert.deepEqual(parseVoiceCommand('音色设计 温柔女声'), {type:'register',prompt:'温柔女声'});
 assert.deepEqual(parseVoiceCommand('选择音色 一'), {type:'fish-select',index:1});
 assert.deepEqual(parseVoiceCommand('选择音色 1'), {type:'fish-select',index:1});
 assert.deepEqual(parseVoiceCommand('删除音色'), {type:'remove'});
});
