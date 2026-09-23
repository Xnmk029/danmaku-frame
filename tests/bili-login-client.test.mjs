import test from 'node:test';
import assert from 'node:assert/strict';
import { BiliLiveClient } from '../src/bili/client.mjs';
import { makePacket } from '../src/bili/packet-codec.mjs';

const response = payload => new Response(JSON.stringify(payload));
const valid = { code: 0, data: { isLogin: true, mid: 456, wbi_img: {
  img_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',
  sub_url: 'https://i0.hdslb.com/bfs/wbi/abcdef0123456789abcdef0123456789.png',
} } };
function mockFetch(t, nav, danmuCode = 0) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('/nav')) return nav();
    if (url.includes('room_init')) return response({ code: 0, data: { room_id: 123 } });
    return response({ code: danmuCode, data: { token: 'fake', host_list: [{ host: 'example.invalid', wss_port: 443 }] } });
  };
  return calls;
}

test('nav timeout does not silently downgrade or cache a guest token', async t => {
  const calls = mockFetch(t, () => { throw new Error('timeout'); });
  const client = new BiliLiveClient({ cookie: 'SESSDATA=test', defaultRoomId: '123' });
  await assert.rejects(client.getConnectionConfig('123'), /保留凭证/);
  assert.equal(client.cachedConnection, null);
  assert.equal(calls.some(url => url.includes('getConf')), false);
});

test('expired login is guest, not cached; subsequent valid login gets verified UID', async t => {
  let loggedIn = false;
  mockFetch(t, () => response(loggedIn ? valid : { code: -101 }));
  const client = new BiliLiveClient({ cookie: 'SESSDATA=test; DedeUserID=999', uid: 999, defaultRoomId: '123' });
  assert.equal((await client.getConnectionConfig('123')).authMode, 'guest');
  assert.equal(client.cachedConnection, null);
  loggedIn = true;
  const config = await client.getConnectionConfig('123');
  assert.equal(config.authMode, 'login');
  assert.equal(config.uid, 456);
});

test('risk-control error with valid credentials does not become guest', async t => {
  const calls = mockFetch(t, () => response(valid), -352);
  const client = new BiliLiveClient({ cookie: 'SESSDATA=test', defaultRoomId: '123' });
  await assert.rejects(client.getConnectionConfig('123'), /-352/);
  assert.equal(calls.some(url => url.includes('getConf')), false);
});

test('opcode 8 rejects errors and malformed responses; only code zero connects', () => {
  const client = new BiliLiveClient({});
  const statuses = [];
  let closed = 0;
  client.on('status', s => statuses.push(s));
  client.on('warning', () => {});
  client.socket = { close: () => closed++ };
  for (const body of ['{"code":-101}', 'broken', '{}']) {
    client.cachedConnection = { token: 'old' };
    client.handlePackets(makePacket(8, body), { authMode: 'login' });
    assert.equal(client.cachedConnection, null);
    assert.equal(client.connected, false);
  }
  assert.equal(closed, 3);
  assert.equal(statuses.some(s => s.connected), false);
  client.handlePackets(makePacket(8, '{"code":0}'), { authMode: 'login', realRoomId: 123, host: 'example.invalid' });
  assert.equal(client.connected, true);
});

test('new credentials clear old token/device and reconnect active room', () => {
  const client = new BiliLiveClient({ cookie: 'SESSDATA=old' });
  client.buvid3 = 'old-device';
  client.cachedConnection = { token: 'old' };
  client.shouldReconnect = true;
  client.roomId = '123';
  let room;
  client.connect = async id => { room = id; };
  client.updateCredentials({ cookie: 'SESSDATA=new', uid: 456 });
  assert.equal(client.cachedConnection, null);
  assert.equal(client.buvid3, '');
  assert.equal(client.config.uid, 456);
  assert.equal(room, '123');
});

test('recovery reauthenticates guests but leaves healthy connections alone', () => {
  const client = new BiliLiveClient({});
  client.shouldReconnect = true;
  client.roomId = '123';
  let count = 0;
  client.connect = async () => { count++; };
  client.authMode = 'login';
  client.recoverLogin('valid');
  assert.equal(count, 0);
  client.authMode = 'guest';
  client.recoverLogin('network_error');
  assert.equal(count, 0);
  client.recoverLogin('valid');
  client.recoverLogin('valid');
  assert.equal(count, 1);
});
