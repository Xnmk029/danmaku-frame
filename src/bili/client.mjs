import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { decodePackets, makePacket } from './packet-codec.mjs';
import { normalizeBiliCommand } from './event-normalizer.mjs';
import { getCookieValue } from '../config/env.mjs';
import { buildDanmuInfoUrl, getBuvid3 } from './wbi.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

// 内置默认弹幕服务器（BiliDMLib 兜底实践：getDanmuInfo/getConf 全失败时仍可尝试连接）
const DEFAULT_HOSTS = [
  { host: 'broadcastlv.chat.bilibili.com', port: 443 },
  { host: 'tx-gz-live-comet-02.chat.bilibili.com', port: 443 },
  { host: 'tx-bj-live-comet-02.chat.bilibili.com', port: 443 },
  { host: 'broadcastlv.chat.bilibili.com', port: 2243 },
];

// 连接配置缓存（借鉴 blivedm）：B站 room_init/getDanmuInfo 接口有频率限制，
// 短时间重复连接时直接复用缓存，避免重复请求被打 412/-352。
const CONNECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_JITTER_MS = 2000; // 随机抖动防重启风暴

function parseRoomId(rawRoomId, fallback) {
  const value = String(rawRoomId || fallback).trim();
  return value.match(/live\.bilibili\.com\/(\d+)/i)?.[1]
    || value.match(/\d+/)?.[0]
    || fallback;
}

export class BiliLiveClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.connectionSequence = 0;
    this.roomId = '';
    this.shouldReconnect = false;
    this.liveStatus = 0;
    this.cachedConnection = null;
    this.reconnectAttempts = 0; // 连续失败次数（指数退避）
  }

  get headers() {
    return {
      'User-Agent': USER_AGENT,
      ...(this.config.cookie ? { Cookie: this.config.cookie } : {}),
    };
  }

  async getConnectionConfig(rawRoomId) {
    const normalizedRoom = parseRoomId(rawRoomId, this.config.defaultRoomId);

    // 缓存命中：同一房间 5 分钟内复用 token/host/port/liveStatus
    const cached = this.cachedConnection;
    if (cached && cached.rawRoomId === normalizedRoom
      && Date.now() - cached.at < CONNECTION_CACHE_TTL_MS) {
      return { ...cached };
    }

    let realRoomId = Number.parseInt(normalizedRoom, 10);
    let liveStatus = 0;

    try {
      const response = await fetch(
        `https://api.live.bilibili.com/room/v1/Room/room_init?id=${realRoomId}`,
        {
          headers: { ...this.headers, Referer: `https://live.bilibili.com/${realRoomId}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = await response.json();
      if (payload.data?.room_id) realRoomId = payload.data.room_id;
      liveStatus = Number(payload.data?.live_status || 0);
    } catch (error) {
      this.emit('warning', new Error(`读取直播间信息失败: ${error.message}`));
    }

    // 弹幕连接候选：token 可能为空（匿名/风控时仍可连接），host 列表用于轮换
    let token = '';
    const hosts = [];
    const buvid3 = this.buvid3;

    // 优先 WBI 签名请求（绕过 -352）；失败则匿名请求；再失败用 getConf 兜底
    try {
      const wbiUrl = await buildDanmuInfoUrl(realRoomId, this.config.cookie, buvid3);
      const headers = {
        ...this.headers,
        Referer: 'https://www.bilibili.com/',
        ...(buvid3 ? { Cookie: `${this.config.cookie}; buvid3=${buvid3};` } : {}),
      };
      const response = await fetch(
        wbiUrl || `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}&type=0`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      const payload = await response.json();
      if (payload.code === 0 && payload.data) {
        token = payload.data.token || '';
        for (const h of payload.data.host_list || []) {
          if (h.host && h.wss_port) hosts.push({ host: h.host, port: h.wss_port });
        }
      }
    } catch (error) {
      this.emit('warning', new Error(`读取弹幕连接配置失败: ${error.message}`));
    }

    // getConf 兜底（匿名 token，实测可连）
    if (!hosts.length || !token) {
      try {
        const fallbackResponse = await fetch(
          `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${realRoomId}&platform=pc&player=web`,
          {
            headers: { ...this.headers, Referer: `https://live.bilibili.com/${realRoomId}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        const fallbackPayload = await fallbackResponse.json();
        if (!token) token = fallbackPayload.data?.token || '';
        for (const h of fallbackPayload.data?.host_server_list || []) {
          if (h.host && h.wss_port) hosts.push({ host: h.host, port: h.wss_port });
        }
      } catch (error) {
        this.emit('warning', new Error(`读取弹幕连接配置失败: ${error.message}`));
      }
    }

    // 内置默认 host 兜底（BiliDMLib 实践：即使无 token 也可尝试连接）
    for (const h of DEFAULT_HOSTS) {
      if (!hosts.some(item => item.host === h.host)) hosts.push(h);
    }

    // 随机选 host（分散风控，避免单一 host 被针对）
    const selected = hosts.length ? hosts[Math.floor(Math.random() * hosts.length)] : DEFAULT_HOSTS[0];
    const result = {
      rawRoomId: normalizedRoom, realRoomId, token, host: selected.host, port: selected.port,
      liveStatus, at: Date.now(), hosts, buvid3,
    };
    // 有 token 才缓存（无 token 时每次尝试不同 host）
    if (token) this.cachedConnection = { ...result };
    return result;
  }

  async connect(rawRoomId) {
    this.shouldReconnect = true;
    this.roomId = parseRoomId(rawRoomId, this.config.defaultRoomId);
    this.closeSocket();
    const sequence = ++this.connectionSequence;

    // 获取 buvid3（风控标识，匿名可用；失败不阻塞连接）
    if (!this.buvid3) {
      this.buvid3 = await getBuvid3(this.config.cookie).catch(() => '');
    }

    this.emit('status', { type: 'status', connected: false, message: 'CONNECTING...' });
    const connection = await this.getConnectionConfig(this.roomId);
    if (sequence !== this.connectionSequence || !this.shouldReconnect) return;

    this.roomId = String(connection.realRoomId);
    this.liveStatus = connection.liveStatus;

    // 多 host 顺序重试：对端断开（1006/拒连）时换下一个 host，避免单一 host 被针对
    const hostList = (connection.hosts?.length ? connection.hosts : DEFAULT_HOSTS)
      .filter((h, i, arr) => arr.findIndex(x => x.host === h.host) === i);
    const tryHost = (index) => {
      if (sequence !== this.connectionSequence || !this.shouldReconnect) return;
      const target = hostList[index % hostList.length];
      const socket = new WebSocket(`wss://${target.host}:${target.port}/sub`, {
        headers: {
          ...this.headers,
          Origin: 'https://live.bilibili.com',
          Referer: `https://live.bilibili.com/${connection.realRoomId}`,
        },
      });
      this.socket = socket;

      socket.on('open', () => {
        if (sequence !== this.connectionSequence) return socket.close();
        // 匿名鉴权（uid=0）：B站 getDanmuInfo 常被风控（-352）时 fallback 的 getConf token 为游客级，
        // 配主播 DedeUserID 会被服务端拒绝（1006）；游客 uid 匹配游客 token 稳定可用。
        const uid = 0;
        const buvid = connection.buvid3 || this.config.buvid || getCookieValue(this.config.cookie, 'buvid3');
        socket.send(makePacket(7, JSON.stringify({
          uid,
          roomid: connection.realRoomId,
          protover: 3,
          platform: 'web',
          type: 2,
          key: connection.token,
          buvid,
        })));
        this.heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN && sequence === this.connectionSequence) {
            socket.send(makePacket(2, '[object Object]', 3));
          }
        }, 30_000);
      });

      socket.on('message', data => {
        if (sequence !== this.connectionSequence) return;
        try {
          this.handlePackets(Buffer.from(data), connection);
        } catch (error) {
          this.emit('warning', new Error(`解析弹幕数据失败: ${error.message}`));
        }
      });

      socket.on('error', error => {
        if (sequence === this.connectionSequence) this.emit('warning', error);
      });

      socket.on('close', (code) => {
        if (sequence !== this.connectionSequence) return;
        this.clearHeartbeat();
        this.emit('status', { type: 'status', connected: false, message: 'OFFLINE' });
        if (this.shouldReconnect) {
          // 尝试下一个 host（异常断开 1006）；轮完一轮后指数退避
          const nextIndex = index + 1;
          if (nextIndex < hostList.length && code === 1006) {
            console.error(`[Bilibili] host ${target.host} 被断开(1006)，尝试下一个 host(${hostList[nextIndex].host})`);
            tryHost(nextIndex);
            return;
          }
          this.reconnectAttempts += 1;
          const expMs = Math.min(RECONNECT_BASE_MS * (2 ** Math.min(this.reconnectAttempts - 1, 4)), 60_000);
          const delay = expMs + Math.floor(Math.random() * RECONNECT_JITTER_MS);
          console.error(`[Bilibili] 连接断开(code=${code})，${Math.round(delay / 1000)}s 后重连（第 ${this.reconnectAttempts} 次）`);
          this.reconnectTimer = setTimeout(() => {
            if (this.shouldReconnect && sequence === this.connectionSequence) {
              this.connect(this.roomId).catch(error => this.emit('warning', error));
            }
          }, delay);
        }
      });
    };
    tryHost(0);
  }

  handlePackets(buffer, connection) {
    for (const packet of decodePackets(buffer)) {
      if (packet.error) {
        this.emit('warning', new Error(packet.error));
        continue;
      }
      if (packet.opcode === 8) {
        // 收到鉴权成功（Opcode 8）→ 连接真正建立，重置失败计数
        this.reconnectAttempts = 0;
        const label = connection.liveStatus === 1 ? 'LIVE'
          : connection.liveStatus === 2 ? 'ROUND'
            : '未开播';
        this.emit('status', {
          type: 'status',
          connected: true,
          message: `ROOM ${connection.realRoomId} (${label})`,
          liveStatus: connection.liveStatus,
        });
      } else if (packet.opcode === 3 && packet.body.length >= 4) {
        this.emit('event', { type: 'popularity', value: packet.body.readUInt32BE(0) });
      } else if (packet.opcode === 5) {
        try {
          const event = normalizeBiliCommand(JSON.parse(packet.body.toString('utf8')));
          if (event) this.emit('event', event);
        } catch {
          // B站会混入非 JSON 通知；单包解析失败不影响后续包。
        }
      }
    }
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  closeSocket() {
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      const oldSocket = this.socket;
      this.socket = null;
      oldSocket.removeAllListeners();
      try {
        oldSocket.close();
      } catch {
        // Already closed.
      }
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.connectionSequence += 1;
    this.closeSocket();
    this.emit('status', { type: 'status', connected: false, message: 'OFFLINE' });
  }
}

export { parseRoomId };
