import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { decodePackets, makePacket } from './packet-codec.mjs';
import { normalizeBiliCommand } from './event-normalizer.mjs';
import { getCookieValue } from '../config/env.mjs';
import { buildDanmuInfoRequest, getBuvid3 } from './wbi.mjs';

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
    this.authMode = 'disconnected';
    this.connected = false;
    this.lastRecoveryAt = 0;
  }

  get headers() {
    return {
      'User-Agent': USER_AGENT,
      ...((this.config.cookie || this.buvid3) ? { Cookie: [
        ...String(this.config.cookie || '').split(';').map(x => x.trim()).filter(x => x && !x.startsWith('buvid3=')),
        ...(this.buvid3 || getCookieValue(this.config.cookie, 'buvid3') ? [`buvid3=${this.buvid3 || getCookieValue(this.config.cookie, 'buvid3')}`] : []),
      ].join('; ') } : {}),
    };
  }

  async getConnectionConfig(rawRoomId) {
    const normalizedRoom = parseRoomId(rawRoomId, this.config.defaultRoomId);
    const credentialVersion = this.connectionSequence;

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
    let authMode = 'guest'; // 'login' = 有效登录态（真实 uid，用户名不脱敏）；'guest' = 游客
    let uid = 0;
    const hosts = [];
    const buvid3 = this.buvid3;

    // 仅明确未登录时走游客；网络/风控错误保留身份重试。
    try {
      const signed = await buildDanmuInfoRequest(realRoomId, this.config.cookie);
      const headers = {
        ...this.headers,
        Referer: 'https://www.bilibili.com/',
      };
      const response = await fetch(
        signed?.url || `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}&type=0`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`弹幕配置 HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.code === 0 && payload.data) {
        token = payload.data.token || '';
        if (signed && !token) throw new Error('登录态弹幕 token 缺失');
        authMode = signed ? 'login' : 'guest';
        uid = signed?.uid || 0;
        for (const h of payload.data.host_list || []) {
          if (h.host && h.wss_port) hosts.push({ host: h.host, port: h.wss_port });
        }
      } else if (signed) throw new Error(`弹幕配置暂不可用（code=${Number(payload.code)}）`);
    } catch (error) {
      // A failed request is not evidence of an expired login. Retry without guest downgrade.
      throw new Error(`读取弹幕连接配置失败，将保留凭证重试: ${error.message}`);
    }

    // getConf 兜底（匿名 token，实测可连）
    if ((!hosts.length || !token) && authMode !== 'login') {
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
        authMode = 'guest';
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
      liveStatus, at: Date.now(), hosts, buvid3, authMode, uid,
    };
    // 游客不缓存；旧连接异步响应不能覆盖新登录的缓存。
    if (token && authMode === 'login' && credentialVersion === this.connectionSequence) this.cachedConnection = { ...result };
    return result;
  }

  async connect(rawRoomId) {
    this.shouldReconnect = true;
    this.roomId = parseRoomId(rawRoomId, this.config.defaultRoomId);
    this.closeSocket();
    this.connected = false;
    this.authMode = 'connecting';
    const sequence = ++this.connectionSequence;

    // 获取 buvid3（风控标识，匿名可用；失败不阻塞连接）
    if (!this.buvid3) {
      this.buvid3 = getCookieValue(this.config.cookie, 'buvid3') || this.config.buvid || await getBuvid3(this.config.cookie).catch(() => '');
    }

    this.emit('status', { type: 'status', connected: false, message: 'CONNECTING...' });
    let connection;
    try { connection = await this.getConnectionConfig(this.roomId); }
    catch (error) {
      if (sequence !== this.connectionSequence || !this.shouldReconnect) return;
      this.emit('warning', error);
      this.emit('status', { type: 'status', connected: false, message: '连接校验暂不可用，正在重试' });
      this.reconnectAttempts++;
      const delay = Math.min(3000 * 2 ** Math.min(this.reconnectAttempts - 1, 4), 60_000);
      this.reconnectTimer = setTimeout(() => {
        if (sequence === this.connectionSequence && this.shouldReconnect) void this.connect(this.roomId).catch(e => this.emit('warning', e));
      }, delay);
      return;
    }
    if (sequence !== this.connectionSequence || !this.shouldReconnect) return;

    this.roomId = String(connection.realRoomId);
    this.liveStatus = connection.liveStatus;
    this.authMode = connection.authMode;

    // 多 host 顺序重试：对端断开（1006/拒连）时换下一个 host，避免单一 host 被针对
    const hostList = (connection.hosts?.length ? connection.hosts : DEFAULT_HOSTS)
      .filter((h, i, arr) => arr.findIndex(x => x.host === h.host) === i);
    const tryHost = (index) => {
      if (sequence !== this.connectionSequence || !this.shouldReconnect) return;
      const target = hostList[index % hostList.length];
      connection.host = target.host;
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
        // 登录态（有效 SESSDATA + wbi 签名 token）→ 真实 uid（用户名不脱敏）；
        // 游客（getConf/匿名 token）→ uid=0（避免 uid 与游客 token 不匹配被 1006）
        const uid = connection.authMode === 'login'
          ? (connection.uid || this.config.uid
              || Number.parseInt(getCookieValue(this.config.cookie, 'DedeUserID'), 10)
              || 0)
          : 0;
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
        this.connected = false;
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
        let auth;
        try { auth = JSON.parse(packet.body.toString('utf8')); } catch { auth = null; }
        if (auth?.code !== 0) {
          this.cachedConnection = null;
          this.connected = false;
          this.emit('warning', new Error(`弹幕鉴权失败（code=${Number(auth?.code ?? -1)}），重新获取凭证`));
          this.emit('status', { type: 'status', connected: false, message: '弹幕鉴权失败，正在重试' });
          this.socket?.close(1000, 'Authentication rejected');
          continue;
        }
        this.connected = true;
        // 收到鉴权成功（Opcode 8）→ 连接真正建立，重置失败计数
        this.reconnectAttempts = 0;
        console.error(`[Bilibili] 弹幕鉴权成功（${connection.authMode === 'login' ? '登录态' : '游客·昵称可能被打码' }） host=${connection.host}`);
        const label = connection.liveStatus === 1 ? 'LIVE'
          : connection.liveStatus === 2 ? 'ROUND'
            : '未开播';
        this.emit('status', {
          type: 'status',
          connected: true,
          message: `ROOM ${connection.realRoomId} (${label})`,
          liveStatus: connection.liveStatus,
          authMode: connection.authMode,
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
    this.connected = false;
    this.authMode = 'disconnected';
    this.emit('status', { type: 'status', connected: false, message: 'OFFLINE' });
  }

  /** Cookie + bili_jct CSRF 校验，所有写操作共用 */
  _requireCsrf() {
    const cookie = this.config.cookie || '';
    const csrf = getCookieValue(cookie, 'bili_jct');
    if (!getCookieValue(cookie, 'SESSDATA') || !csrf) {
      throw new Error('B站未登录，请先在「扫码登录」页完成登录');
    }
    return csrf;
  }

  /** 解析真实 room_id：连接中直接用，未连接时走 room_init */
  async _resolveRoomId() {
    let roomId = Number(this.roomId) || 0;
    if (!roomId) {
      const normalized = parseRoomId('', this.config.defaultRoomId);
      roomId = Number(normalized) || 0;
      try {
        const response = await fetch(
          `https://api.live.bilibili.com/room/v1/Room/room_init?id=${roomId}`,
          { headers: { ...this.headers, Referer: `https://live.bilibili.com/${roomId}` }, signal: AbortSignal.timeout(8000) },
        );
        const payload = await response.json();
        if (payload.data?.room_id) roomId = payload.data.room_id;
      } catch { /* 用短号兜底 */ }
    }
    return roomId;
  }

  /** api.live.bilibili.com 表单 POST + 统一错误归一（code 总带在 message 里便于按码判断） */
  async _livePost(path, fields) {
    const csrf = this._requireCsrf();
    const body = new URLSearchParams({ ...fields, csrf, csrf_token: csrf });
    const response = await fetch(`https://api.live.bilibili.com${path}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://link.bilibili.com/p/center/index',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`B站接口 HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error('B站响应格式异常');
    if (payload.code !== 0) {
      const known = {
        [-101]: 'B站登录已失效，请重新扫码',
        [-111]: 'CSRF 校验失败，请重新扫码登录',
        [-1]: '操作太频繁，请稍候再试',
        60009: '目标分区不存在或已下线',
        60013: '所在地区受实名认证限制无法开播',
        60024: '目标分区需要人脸认证',
        60034: '系统维护中，请使用官方直播姬',
        100402: '封面图地址不合法',
      };
      const detail = payload.message || payload.msg || '操作失败';
      throw new Error(`${known[payload.code] || detail}（code=${payload.code}）`);
    }
    return payload.data;
  }

  /**
   * 发送直播弹幕（服务端代发，Cookie + bili_jct CSRF）。
   * POST https://api.live.bilibili.com/msg/send —— 契约见 bilibili-API-collect:
   * code: 0 成功；-101 未登录；-111 csrf 失败；10031 频率过快；1003212 超长。
   * @提及（官方直播间「@TA」）：msg 含 "@昵称 " 字面前缀，并带 reply_mid/reply_uname/reply_attr，
   * 服务端据此高亮 @ 段并给被@方「有人@我」通知。
   */
  async sendDanmaku(text, mention = null) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('弹幕内容为空');
    const hasMention = mention && Number(mention.mid) > 0 && !!mention.uname;
    const msg = hasMention ? `@${mention.uname} ${raw}` : raw;
    if (msg.length > 40) throw new Error('弹幕超出 40 字上限');

    const csrf = this._requireCsrf();

    // 限频护栏：普通账号约 1 条/秒，过快会被 B站 10031 拒收
    const now = Date.now();
    if (this.lastSendAt && now - this.lastSendAt < 1100) {
      throw new Error('发送过于频繁，请稍候再试');
    }

    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');

    const body = new URLSearchParams({
      bubble: '0', msg, color: '16777215', mode: '1', fontsize: '25',
      rnd: String(Math.floor(Date.now() / 1000)), roomid: String(roomId),
      csrf, csrf_token: csrf,
      statistics: '{"appId":100,"platform":5}',
    });
    if (hasMention) {
      body.set('reply_mid', String(mention.mid));
      body.set('reply_uname', String(mention.uname));
      body.set('reply_attr', '0');
    }
    const response = await fetch('https://api.live.bilibili.com/msg/send', {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `https://live.bilibili.com/${roomId}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`B站接口 HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error('B站响应格式异常');
    if (payload.code !== 0) {
      const known = {
        [-101]: 'B站登录已失效，请重新扫码',
        [-111]: 'CSRF 校验失败，请重新扫码登录',
        10031: '发送频率过快，请稍候再试',
        1003212: '弹幕超出长度限制',
      };
      throw new Error(known[payload.code] || payload.message || payload.msg || `发送失败（code=${payload.code}）`);
    }
    this.lastSendAt = Date.now();
    return { roomId, msg };
  }

  // ==================== 直播中心管理（开播/信息编辑） ====================

  /** 房间信息：标题/分区/开播状态/封面/公告（公开 GET + 登录态） */
  async getLiveRoomInfo() {
    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');
    const response = await fetch(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
      { headers: { ...this.headers, Referer: `https://live.bilibili.com/${roomId}` }, signal: AbortSignal.timeout(8000) },
    );
    const payload = await response.json().catch(() => null);
    if (!payload || payload.code !== 0) {
      throw new Error(payload?.message || `获取房间信息失败（code=${payload?.code}）`);
    }
    const d = payload.data || {};
    let news = '';
    try {
      // 主播公告在 getRoomInfoOld（需本人登录态）
      const uid = Number(this.config.uid) || 0;
      if (uid) {
        const r = await fetch(
          `https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=${uid}`,
          { headers: { ...this.headers, Referer: 'https://link.bilibili.com/p/center/index' }, signal: AbortSignal.timeout(8000) },
        );
        const p = await r.json().catch(() => null);
        if (p?.code === 0) news = p.data?.news || '';
      }
    } catch { /* 公告读取失败不阻塞主信息 */ }
    return {
      roomId,
      uid: Number(d.uid || 0),
      title: d.title || '',
      liveStatus: Number(d.live_status || 0), // 0 未开播 1 直播中 2 轮播
      areaId: Number(d.area_id || 0),
      areaName: d.area_name || '',
      parentAreaId: Number(d.parent_area_id || 0),
      parentAreaName: d.parent_area_name || '',
      cover: d.user_cover || d.cover_from_user || d.keyframe || '',
      news,
      canOperate: !!getCookieValue(this.config.cookie, 'SESSDATA'),
    };
  }

  /** 直播分区树（公开 GET，5 分钟缓存） */
  async getAreaList() {
    if (this._areaCache && Date.now() - this._areaCache.at < 5 * 60 * 1000) return this._areaCache.list;
    const response = await fetch('https://api.live.bilibili.com/room/v1/Area/getList', {
      headers: this.headers, signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => null);
    if (!payload || payload.code !== 0) {
      throw new Error(payload?.message || `获取分区列表失败（code=${payload?.code}）`);
    }
    const list = (payload.data || []).map((p) => ({
      id: Number(p.id),
      name: p.name,
      list: (p.list || []).map((c) => ({ id: Number(c.id), name: c.name, hot: Number(c.hot_status) === 1 })),
    }));
    this._areaCache = { at: Date.now(), list };
    return list;
  }

  /** 改标题（≤40字）/分区（area_id 子分区）—— Room/update，返回标题审核信息 */
  async updateRoomInfo({ title, areaId } = {}) {
    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');
    const fields = { room_id: String(roomId) };
    if (title !== undefined) fields.title = String(title).trim().slice(0, 40);
    if (Number(areaId) > 0) fields.area_id = String(Number(areaId));
    if (!('title' in fields) && !('area_id' in fields)) throw new Error('无可更新字段');
    const data = await this._livePost('/room/v1/Room/update', fields);
    return { audit: data?.audit_info || null };
  }

  /** 主播公告（≤60字，空串=隐藏）—— xlive/app-blink updateRoomNews */
  async updateRoomNews(content) {
    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');
    const uid = Number(this.config.uid) || 0;
    if (!uid) throw new Error('缺少登录 uid');
    await this._livePost('/xlive/app-blink/v1/index/updateRoomNews', {
      room_id: String(roomId), uid: String(uid), content: String(content || '').slice(0, 60),
    });
    return { ok: true };
  }

  /**
   * 换封面（两步）：
   *  ① x/dynamic/feed/draw/upload_bfs multipart 上传 → i0.hdslb.com URL
   *  ② preLive/UpdatePreLiveInfo 携带 cover=URL（仅接受 .hdslb.com 域）
   */
  async updateCover(dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('封面图仅支持 png/jpg/webp');
    const csrf = this._requireCsrf();
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const form = new FormData();
    form.set('biz', 'new_dyn');
    form.set('category', 'daily');
    form.set('csrf', csrf);
    form.set('file_up', new Blob([Buffer.from(m[2], 'base64')], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), `cover.${ext}`);
    const upRes = await fetch('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
      method: 'POST', headers: this.headers, body: form, signal: AbortSignal.timeout(20_000),
    });
    const upPayload = await upRes.json().catch(() => null);
    const coverUrl = upPayload?.data?.image_url || '';
    if (upPayload?.code !== 0 || !coverUrl) {
      throw new Error(upPayload?.message || `封面上传失败（code=${upPayload?.code}）`);
    }
    await this._livePost('/xlive/app-blink/v1/preLive/UpdatePreLiveInfo', {
      platform: 'web', mobi_app: 'web', build: '1', cover: coverUrl, liveDirectionType: '1', visit_id: '',
    });
    return { cover: coverUrl };
  }

  /**
   * 开播：B站侧登记 + 取回推流地址/密钥（rtmp.addr + rtmp.code）。
   * 60024（人脸校验）时按官方文档建议携带直播姬 version/build 重试一次。
   */
  async startLive(areaId = 0) {
    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');
    const area = Number(areaId) || 0;
    if (!area) throw new Error('开播需要先选择直播分区');
    const fields = { room_id: String(roomId), area_v2: String(area), platform: 'pc_link' };
    let data;
    try {
      data = await this._livePost('/room/v1/Room/startLive', fields);
    } catch (e) {
      if (!/code=60024/.test(e.message)) throw e;
      data = await this._livePost('/room/v1/Room/startLive', { ...fields, version: '1.0.0', build: '1234' });
    }
    const rtmp = data?.rtmp || {};
    if (data?.status === 'LIVE') this.liveStatus = 1;
    return {
      status: data?.status || 'LIVE',
      change: Number(data?.change ?? 0),
      rtmpAddr: rtmp.addr || '',
      rtmpCode: rtmp.code || '',
    };
  }

  /** 关播 */
  async stopLive() {
    const roomId = await this._resolveRoomId();
    if (!roomId) throw new Error('未确定目标直播间');
    const data = await this._livePost('/room/v1/Room/stopLive', {
      room_id: String(roomId), platform: 'pc_link',
    });
    if (data?.status === 'PREPARING' || data?.status === 'ROUND') this.liveStatus = 0;
    return { status: data?.status || 'PREPARING', change: Number(data?.change ?? 0) };
  }

  updateCredentials({ cookie, uid }) {
    this.config.cookie = cookie;
    this.config.uid = uid || 0;
    this.buvid3 = '';
    this.cachedConnection = null;
    if (this.shouldReconnect && this.roomId) void this.connect(this.roomId).catch(e => this.emit('warning', e));
  }

  recoverLogin(status) {
    if (status === 'expired') this.cachedConnection = null;
    if (status === 'valid' && this.authMode === 'guest' && this.shouldReconnect
        && Date.now() - this.lastRecoveryAt >= 60_000) {
      this.lastRecoveryAt = Date.now();
      this.cachedConnection = null;
      void this.connect(this.roomId).catch(e => this.emit('warning', e));
    }
  }
}

export { parseRoomId };
