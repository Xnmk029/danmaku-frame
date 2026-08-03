import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { decodePackets, makePacket } from './packet-codec.mjs';
import { normalizeBiliCommand } from './event-normalizer.mjs';
import { getCookieValue } from '../config/env.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

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
  }

  get headers() {
    return {
      'User-Agent': USER_AGENT,
      ...(this.config.cookie ? { Cookie: this.config.cookie } : {}),
    };
  }

  async getConnectionConfig(rawRoomId) {
    let realRoomId = Number.parseInt(parseRoomId(rawRoomId, this.config.defaultRoomId), 10);
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

    let token = '';
    let host = 'broadcastlv.chat.bilibili.com';
    let port = 443;

    try {
      const response = await fetch(
        `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}&type=0`,
        {
          headers: { ...this.headers, Referer: `https://live.bilibili.com/${realRoomId}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = await response.json();
      if (payload.code === 0 && payload.data) {
        token = payload.data.token || '';
        const selectedHost = payload.data.host_list?.[0];
        if (selectedHost) {
          host = selectedHost.host || host;
          port = selectedHost.wss_port || port;
        }
      } else {
        const fallbackResponse = await fetch(
          `https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${realRoomId}&platform=pc&player=web`,
          {
            headers: { ...this.headers, Referer: `https://live.bilibili.com/${realRoomId}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        const fallbackPayload = await fallbackResponse.json();
        token = fallbackPayload.data?.token || '';
        const selectedHost = fallbackPayload.data?.host_server_list?.[0];
        if (selectedHost) {
          host = selectedHost.host || host;
          port = selectedHost.wss_port || port;
        }
      }
    } catch (error) {
      this.emit('warning', new Error(`读取弹幕连接配置失败: ${error.message}`));
    }

    return { realRoomId, token, host, port, liveStatus };
  }

  async connect(rawRoomId) {
    this.shouldReconnect = true;
    this.roomId = parseRoomId(rawRoomId, this.config.defaultRoomId);
    this.closeSocket();
    const sequence = ++this.connectionSequence;

    this.emit('status', { type: 'status', connected: false, message: 'CONNECTING...' });
    const connection = await this.getConnectionConfig(this.roomId);
    if (sequence !== this.connectionSequence || !this.shouldReconnect) return;

    this.roomId = String(connection.realRoomId);
    this.liveStatus = connection.liveStatus;
    const socket = new WebSocket(`wss://${connection.host}:${connection.port}/sub`, {
      headers: {
        ...this.headers,
        Origin: 'https://live.bilibili.com',
        Referer: `https://live.bilibili.com/${connection.realRoomId}`,
      },
    });
    this.socket = socket;

    socket.on('open', () => {
      if (sequence !== this.connectionSequence) return socket.close();
      const uid = this.config.uid
        || Number.parseInt(getCookieValue(this.config.cookie, 'DedeUserID'), 10)
        || 0;
      const buvid = this.config.buvid || getCookieValue(this.config.cookie, 'buvid3');
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

    socket.on('close', () => {
      if (sequence !== this.connectionSequence) return;
      this.clearHeartbeat();
      this.emit('status', { type: 'status', connected: false, message: 'OFFLINE' });
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          if (this.shouldReconnect && sequence === this.connectionSequence) {
            this.connect(this.roomId).catch(error => this.emit('warning', error));
          }
        }, 3_000);
      }
    });
  }

  handlePackets(buffer, connection) {
    for (const packet of decodePackets(buffer)) {
      if (packet.error) {
        this.emit('warning', new Error(packet.error));
        continue;
      }
      if (packet.opcode === 8) {
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
