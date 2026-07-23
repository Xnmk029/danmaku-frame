import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTTP_PORT = process.env.PORT || 8080;
const WS_PORT = process.env.WS_PORT || 8787;
const ROOT = __dirname; // Serving g:/产品/OBS/danmaku-frame

if (process.stdin.resume) {
  process.stdin.resume();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

process.on('uncaughtException', (err) => {
  console.error('[RelayServer UncaughtException]', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[RelayServer UnhandledRejection]', reason);
});

// 1. HTTP Static Server (Port 8080)
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  let filePath = path.join(ROOT, pathname);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    let targetPath = filePath;
    if (err) {
      if (!path.extname(filePath)) {
        targetPath = path.join(filePath, 'index.html');
      }
    } else if (stats.isDirectory()) {
      targetPath = path.join(filePath, 'index.html');
    }

    fs.readFile(targetPath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
        return;
      }

      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

httpServer.on('error', (err) => {
  console.error('[HTTPServer Error]', err.message);
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Danmaku-Frame H5 直播边框 HTTP 服务: http://localhost:${HTTP_PORT}`);
  console.log(`📡 WebSocket 弹幕中继服务: ws://localhost:${WS_PORT}`);
  console.log(`----------------------------------------------------`);
  console.log(`📌 页面地址: http://localhost:${HTTP_PORT}/index.html`);
  console.log(`====================================================`);
});

// 2. Bilibili WebSocket Protocol Utilities
async function getBilibiliDanmuConf(roomId) {
  const str = (roomId || '30068664').toString().trim();
  const cleanId = str.match(/live\.bilibili\.com\/(\d+)/i)?.[1] || str.match(/\d+/)?.[0] || '30068664';
  let realRoomId = parseInt(cleanId, 10);
  if (isNaN(realRoomId)) realRoomId = 6;

  let liveStatus = 0; // 0: 未开播, 1: 正在直播, 2: 轮播
  
  try {
    const r1 = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${realRoomId}`);
    const d1 = await r1.json();
    if (d1.data) {
      if (d1.data.room_id) realRoomId = d1.data.room_id;
      liveStatus = d1.data.live_status || 0;
    }
  } catch (e) {}

  let token = '';
  let host = 'broadcastlv.chat.bilibili.com';
  let port = 443;

  try {
    const r2 = await fetch(`https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id=${realRoomId}&platform=pc&player=web`);
    const d2 = await r2.json();
    if (d2.data) {
      token = d2.data.token || '';
      if (d2.data.host_server_list && d2.data.host_server_list.length > 0) {
        host = d2.data.host_server_list[0].host || host;
        port = d2.data.host_server_list[0].wss_port || 443;
      }
    }
  } catch (e) {}

  return { realRoomId, token, host, port, liveStatus };
}

function makePacket(opcode, payloadStr, protover = 3) {
  const bodyBytes = Buffer.from(payloadStr, 'utf-8');
  const packetLen = 16 + bodyBytes.length;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(packetLen, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(protover, 6);
  header.writeUInt32BE(opcode, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, bodyBytes]);
}

// 3. WebSocket Danmaku Relay Server (Port 8787)
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('error', (err) => {
  console.error('[RelayWSS] Server Error:', err.message);
});

wss.on('connection', (clientWs) => {
  console.log('[RelayWS] 客户端已连接 H5 弹幕中继服务器');

  clientWs.on('error', (err) => {
    console.error('[RelayWS] 客户端 Socket 异常:', err.message);
  });

  let activeBiliWs = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let connectionSeq = 0;

  function safeSend(msgObj) {
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(msgObj));
      }
    } catch (e) {
      console.error('[RelayWS] safeSend Error:', e.message);
    }
  }

  function stopBiliWs() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (activeBiliWs) {
      try {
        const oldWs = activeBiliWs;
        activeBiliWs = null;
        oldWs.on('error', () => {}); // 拦截旧 Socket 关闭时的 error 事件
        oldWs.close();
      } catch (e) {}
    }
  }

  async function connectToBilibili(rawRoomId) {
    try {
      stopBiliWs();
      const currentSeq = ++connectionSeq;

      safeSend({ type: 'status', connected: false, message: `CONNECTING...` });
      const conf = await getBilibiliDanmuConf(rawRoomId);

      if (currentSeq !== connectionSeq) {
        return;
      }

      console.log(`[RelayWS] 正在建立 B站 弹幕连接 [房间号: ${conf.realRoomId}]...`);

      const wsUrl = `wss://${conf.host}:${conf.port}/sub`;
      const ws = new WebSocket(wsUrl);

      ws.on('error', (err) => {
        console.error('[RelayWS] Socket Error Guarded:', err.message);
        if (currentSeq === connectionSeq) {
          safeSend({ type: 'status', connected: false, message: `ERROR` });
        }
      });

      activeBiliWs = ws;

      ws.on('open', () => {
        if (currentSeq !== connectionSeq) {
          try { ws.close(); } catch(e) {}
          return;
        }
        console.log(`[RelayWS] WebSocket 已连通，发送带登录 UID 凭证的 Opcode 7 鉴权包...`);
        const authPayload = JSON.stringify({
          uid: 0,
          roomid: conf.realRoomId,
          protover: 3,
          platform: 'web',
          type: 2,
          key: conf.token,
          buvid: 'F98F0559-221B-15A7-884D-2FEBEC08B5F025820infoc'
        });
        ws.send(makePacket(7, authPayload, 3));

        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && currentSeq === connectionSeq) {
            ws.send(makePacket(2, '[object Object]', 3));
          }
        }, 30000);
      });

      function parsePacketBuffer(buf) {
        let offset = 0;
        while (offset + 16 <= buf.length) {
          const packLen = buf.readUInt32BE(offset);
          if (packLen < 16 || offset + packLen > buf.length) break;

          const headerLen = buf.readUInt16BE(offset + 4);
          const protover = buf.readUInt16BE(offset + 6);
          const opcode = buf.readUInt32BE(offset + 8);
          const body = buf.subarray(offset + headerLen, offset + packLen);

          // Opcode 8: Auth Reply
          if (opcode === 8) {
            const statusTag = conf.liveStatus === 1 ? 'LIVE' : (conf.liveStatus === 2 ? 'ROUND' : '未开播');
            console.log(`[RelayWS] B站 直播间 [${conf.realRoomId}] 鉴权成功！状态: ${statusTag}`);
            safeSend({ type: 'status', connected: true, message: `ROOM ${conf.realRoomId} (${statusTag})`, liveStatus: conf.liveStatus });
          } 
          // Opcode 3: Popularity Heartbeat Reply
          else if (opcode === 3) {
            if (body.length >= 4) {
              const popularity = body.readUInt32BE(0);
              safeSend({ type: 'popularity', value: popularity });
            }
          } 
          // Opcode 5: Danmaku & Notification Packets
          else if (opcode === 5) {
            if (protover === 3 || protover === 2) {
              let decompressed = null;
              try {
                if (protover === 3) decompressed = zlib.brotliDecompressSync(body);
                else if (protover === 2) decompressed = zlib.inflateSync(body);
              } catch (e) {
                decompressed = null;
              }

              if (decompressed) {
                parsePacketBuffer(decompressed);
              }
            } else {
              try {
                const json = JSON.parse(body.toString('utf-8'));
                if (json.cmd) {
                  if (json.cmd.includes('DANMU_MSG')) {
                    const info = json.info || [];
                    const text = info[1] || '';
                    const user = (info[2] && info[2][1]) || '匿名用户';
                    const guard = info[7] || 0;
                    const medal = (info[3] && info[3][1]) ? { name: info[3][1], lv: info[3][0] } : null;

                    safeSend({
                      type: 'danmaku',
                      user,
                      text,
                      guard,
                      medal
                    });
                  } else if (json.cmd === 'SEND_GIFT') {
                    const d = json.data || {};
                    safeSend({
                      type: 'gift',
                      user: d.uname || '匿名用户',
                      text: `赠送了 ${d.giftName || '礼物'} x${d.num || 1}`,
                      guard: 0
                    });
                  } else if (json.cmd === 'SUPER_CHAT_MESSAGE') {
                    const d = json.data || {};
                    safeSend({
                      type: 'sc',
                      user: (d.user_info && d.user_info.uname) || '匿名用户',
                      text: `[SC ¥${d.price || 0}] ${d.message || ''}`,
                      guard: 0
                    });
                  }
                }
              } catch (e) {}
            }
          }

          offset += packLen;
        }
      }

      ws.on('message', (data) => {
        if (currentSeq !== connectionSeq) return;
        try {
          if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) return;
          parsePacketBuffer(Buffer.from(data));
        } catch (err) {
          console.error('[RelayWS] Packet parsing error:', err.message);
        }
      });

      ws.on('close', (code, reason) => {
        if (currentSeq === connectionSeq) {
          console.log(`[RelayWS] B站 连接关闭: ${code} ${reason.toString()}`);
          safeSend({ type: 'status', connected: false, message: `OFFLINE` });
          stopBiliWs();

          // 自动重连机制：若客户端依然在线，3秒后自动尝试重连 B站 上游
          if (clientWs.readyState === WebSocket.OPEN) {
            reconnectTimer = setTimeout(() => {
              if (clientWs.readyState === WebSocket.OPEN && currentSeq === connectionSeq) {
                console.log(`[RelayWS] 正在自动重连 B站 直播间 [${conf.realRoomId}]...`);
                connectToBilibili(conf.realRoomId);
              }
            }, 3000);
          }
        }
      });
    } catch (err) {
      console.error('[RelayWS] connectToBilibili outer exception:', err.message || err);
      safeSend({ type: 'status', connected: false, message: `ERROR` });
    }
  }

  clientWs.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (payload.action === 'subscribe') {
        connectToBilibili(payload.roomId || '6');
      } else if (payload.action === 'unsubscribe') {
        stopBiliWs();
        safeSend({ type: 'status', connected: false, message: `OFFLINE` });
      }
    } catch (err) {
      console.error('[RelayWS] Client msg error:', err.message);
    }
  });

  clientWs.on('close', () => {
    console.log('[RelayWS] 客户端已断开');
    stopBiliWs();
  });
});
