import { WebSocketServer, WebSocket } from 'ws';

function isLoopback(address = '') {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

export function createWebSocketGateway({
  host,
  port,
  authToken,
  maxPayload,
  biliClient,
  songService,
  amllBridge = null,
  ttsService = null,
}) {
  const clients = new Set();
  let activeRoomId = '';
  let ncmSubscribers = 0;
  let gatewayNcm = null;
  const server = new WebSocketServer({ host, port, maxPayload, clientTracking: false });
  const ready = new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  function send(client, payload) {
    if (client.readyState !== WebSocket.OPEN) return;
    try {
      client.send(JSON.stringify(payload));
    } catch (error) {
      console.error('[WebSocket] 发送消息失败:', error.message);
    }
  }

  function broadcast(payload) {
    for (const client of clients) send(client.socket, payload);
  }

  function authorized(client, payload) {
    return isLoopback(client.address)
      || (authToken && payload.token === authToken);
  }

  biliClient.on('status', broadcast);
  biliClient.on('event', event => {
    broadcast(event);
    if (event.type === 'danmaku') {
      songService.handleDanmaku(event).catch(error => {
        console.error('[SongRequest] 弹幕命令处理失败:', error.message);
      });
      if (ttsService) {
        try {
          ttsService.handleDanmaku(event);
        } catch (error) {
          console.error('[TtsService] 弹幕处理失败:', error.message);
        }
      }
    }
  });
  biliClient.on('warning', error => console.error('[Bilibili]', error.message));
  songService.on('broadcast', broadcast);
  if (ttsService) ttsService.on('state', broadcast);

  // AMLL 播放信息：订阅驱动（无订阅者时暂停连接）
  if (amllBridge) {
    const refreshNcm = () => {
      if (ncmSubscribers > 0) {
        // AmllServer.start() 返回 ready promise；AmllBridge.start() 无返回值 → 统一包装
        Promise.resolve(amllBridge.start()).catch(error => {
          console.error(`[AMLL] 启动失败（端口 ${amllBridge.port} 可能被占用）:`, error.message);
        });
        if (amllBridge.active) sendNcm(amllBridge.snapshot());
      } else {
        amllBridge.stop();
      }
    };
    const sendNcm = payload => {
      for (const client of clients) {
        if (client.ncmSubscribed) send(client.socket, payload);
      }
    };
    amllBridge.on('playback', sendNcm);
    amllBridge.on('offline', () => sendNcm({ type: 'ncm.offline' }));
    amllBridge.on('online', () => sendNcm(amllBridge.snapshot()));
    gatewayNcm = { refreshNcm, sendNcm };
  }

  server.on('connection', (socket, request) => {
    const client = {
      socket,
      address: request.socket.remoteAddress || '',
      subscribed: false,
      messageCount: 0,
      windowStartedAt: Date.now(),
    };
    clients.add(client);
    send(socket, songService.snapshot());

    socket.on('message', rawMessage => {
      const now = Date.now();
      if (now - client.windowStartedAt >= 60_000) {
        client.windowStartedAt = now;
        client.messageCount = 0;
      }
      client.messageCount += 1;
      if (client.messageCount > 60) {
        send(socket, { type: 'error', code: 'RATE_LIMITED', message: '请求过于频繁' });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawMessage.toString());
      } catch {
        send(socket, { type: 'error', code: 'INVALID_JSON', message: '消息必须是 JSON' });
        return;
      }

      if (payload.action === 'song.get_state') {
        send(socket, songService.snapshot());
        return;
      }

      if (payload.action === 'tts.get_state' && ttsService) {
        send(socket, ttsService.snapshot());
        return;
      }

      if (!authorized(client, payload)) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: '控制操作需要有效令牌' });
        return;
      }

      if (payload.action === 'subscribe') {
        const requestedRoom = String(payload.roomId || biliClient.config.defaultRoomId);
        client.subscribed = true;
        if (requestedRoom !== activeRoomId) {
          activeRoomId = requestedRoom;
          biliClient.connect(requestedRoom).catch(error => {
            console.error('[Bilibili] 连接失败:', error.message);
            broadcast({ type: 'status', connected: false, message: 'ERROR' });
          });
        }
      } else if (payload.action === 'ncm.subscribe') {
        if (!client.ncmSubscribed) {
          client.ncmSubscribed = true;
          ncmSubscribers += 1;
          gatewayNcm?.refreshNcm();
        }
      } else if (payload.action === 'ncm.unsubscribe') {
        if (client.ncmSubscribed) {
          client.ncmSubscribed = false;
          ncmSubscribers -= 1;
          gatewayNcm?.refreshNcm();
        }
      } else if (payload.action === 'unsubscribe') {
        client.subscribed = false;
        if (![...clients].some(item => item.subscribed)) {
          activeRoomId = '';
          biliClient.disconnect();
        }
      } else if (payload.action === 'song.player_event') {
        songService.handlePlayerEvent(payload.event);
      } else if (payload.action === 'song.admin') {
        if (payload.command === 'skip') songService.advance('skipped');
        else if (payload.command === 'clear') songService.clearQueue();
        else if (payload.command === 'pause' || payload.command === 'resume') {
          broadcast({ type: 'song.player_command', action: payload.command });
        }
      } else if (payload.action === 'tts.set_enabled' && ttsService) {
        ttsService.setEnabled(Boolean(payload.enabled));
      } else if (payload.action === 'tts.set_settings' && ttsService) {
        ttsService.setSettings({
          voice: payload.voice,
          rate: payload.rate,
          pitch: payload.pitch,
          volume: payload.volume,
          playerVolume: payload.playerVolume,
        });
      } else if (payload.action === 'tts.test' && ttsService) {
        ttsService.speakTest(payload.text);
      } else if (payload.action === 'tts.skip' && ttsService) {
        ttsService.skip().catch(error => console.error('[TtsService] 跳过失败:', error.message));
      } else if (payload.action === 'setCookie') {
        send(socket, {
          type: 'error',
          code: 'COOKIE_INPUT_DISABLED',
          message: '浏览器端 Cookie 输入已停用，请通过服务端 .env 配置',
        });
      }
    });

    socket.on('error', error => console.error('[WebSocket] 客户端异常:', error.message));
    socket.on('close', () => {
      clients.delete(client);
      if (client.ncmSubscribed) {
        client.ncmSubscribed = false;
        ncmSubscribers -= 1;
        gatewayNcm?.refreshNcm();
      }
      if (client.subscribed && ![...clients].some(item => item.subscribed)) {
        activeRoomId = '';
        biliClient.disconnect();
      }
    });
  });

  server.on('error', error => console.error('[WebSocket] Server error:', error.message));

  return {
    server,
    ready,
    broadcast,
    clientCount: () => clients.size,
    stop: () => new Promise(resolve => {
      for (const client of clients) client.socket.close(1001, 'Server shutdown');
      biliClient.disconnect();
      amllBridge?.stop();
      server.close(() => resolve());
    }),
  };
}

export { isLoopback };
