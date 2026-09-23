import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config/env.mjs';
import { createHttpServer } from './transport/http-server.mjs';
import { createWebSocketGateway } from './transport/websocket-gateway.mjs';
import { BiliLiveClient } from './bili/client.mjs';
import { BiliAuthService } from './bili/auth.mjs';
import { JsonSongRepository } from './song-request/repository.mjs';
import { SongRequestService } from './song-request/song-service.mjs';
import { MusicProviderRegistry } from './music/provider-registry.mjs';
import { LocalMusicProvider } from './music/providers/local-provider.mjs';
import { DirectUrlProvider } from './music/providers/direct-url-provider.mjs';
import { WindowsMediaController } from './platform/windows-media-controller.mjs';
import { ObsProxy } from './obs/obs-proxy.mjs';
import { AmllBridge } from './ncm/amll-bridge.mjs';
import { AmllServer } from './ncm/amll-server.mjs';
import { SmtcBridge } from './ncm/smtc-bridge.mjs';
import { NowPlaying } from './ncm/now-playing.mjs';
import { EdgeTtsEngine } from './tts/edge-tts.mjs';
import { MimoTtsEngine } from './tts/mimo-tts.mjs';
import { FishTtsEngine } from './tts/fish-tts.mjs';
import { WindowsPlayer } from './tts/windows-player.mjs';
import { DanmakuTtsService } from './tts/tts-service.mjs';
import { VoiceDesignRegistry } from './tts/voice-registry.mjs';
import { SenseNovaClient } from './llm/sensenova.mjs';
import { InteractionService } from './interaction/interaction-service.mjs';
import { parseSongCommand } from './danmaku/command-parser.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

export function createApplication(runtimeEnv = process.env) {
  const config = loadConfig(projectRoot, runtimeEnv);
  const providers = new MusicProviderRegistry([
    new LocalMusicProvider({
      projectRoot,
      musicDirectory: config.song.musicDirectory,
    }),
    new DirectUrlProvider({ enabled: config.song.allowDirectUrls }),
  ]);
  const songService = new SongRequestService({
    config: {
      ...config.song,
      ownerUid: config.bilibili.ownerUid,
      adminUids: config.bilibili.adminUids,
    },
    repository: new JsonSongRepository(config.song.stateFile),
    providers,
  });
  const biliAuth = new BiliAuthService({ file: config.bilibili.authFile, cookie: config.bilibili.cookie });
  config.bilibili.cookie = biliAuth.cookie;
  const biliClient = new BiliLiveClient(config.bilibili);
  biliAuth.on('credentials', credentials => biliClient.updateCredentials(credentials));
  let previousAuthStatus;
  biliAuth.on('state', state => {
    if (state.status !== previousAuthStatus) console.log(`[BilibiliAuth] ${state.message}`);
    previousAuthStatus = state.status;
    biliClient.recoverLogin(state.status);
  });
  const mediaController = new WindowsMediaController({ enabled: config.song.legacyMediaKeys });
  const obsProxy = new ObsProxy({
    url: config.obs.websocketUrl,
    password: config.obs.websocketPassword,
  });
  const amllBridge = config.amll.enabled
    ? new NowPlaying({ source: config.amll.source,
      smtc: new SmtcBridge({ appPattern: config.amll.smtcAppPattern, intervalMs: config.amll.smtcIntervalMs }),
      amll: config.amll.mode === 'client'
        ? new AmllBridge({ url: config.amll.wsUrl })
        : new AmllServer({ port: config.amll.listenPort }),
    })
    : null;
  amllBridge?.on('warning', error => console.warn('[NowPlaying]', error.message));
  // TTS 双引擎：edge（微软 Edge 在线，免费）+ mimo（小米 MiMo-TTS v2.5，需 API Key）
  // provider=hybrid 时按用户分层路由：粉丝牌/舰长/房管/白名单 → MIMO，其余 → Edge
  const edgeTtsEngine = new EdgeTtsEngine({
    voice: config.tts.voice,
    rate: config.tts.rate,
    pitch: config.tts.pitch,
    volume: config.tts.volume,
  });
  const mimoTtsEngine = config.tts.mimoApiKey
    ? new MimoTtsEngine({
        apiKey: config.tts.mimoApiKey,
        baseUrl: config.tts.mimoBaseUrl,
        voice: config.tts.mimoVoice,
      })
    : null;
  const ttsPlayer = new WindowsPlayer({
    audioDir: path.dirname(config.tts.audioFile),
    scriptFile: path.resolve(sourceDirectory, '..', 'scripts', 'tts-player.ps1'),
    volume: config.tts.playerVolume,
  });
  const fishTtsEngine = new FishTtsEngine({ apiKey: config.tts.fishApiKey, baseUrl: config.tts.fishBaseUrl,
    model: config.tts.fishModel, referenceId: config.tts.fishVoice, timeoutMs: config.tts.fishTimeoutMs,
    proxyUrl: config.tts.fishProxyUrl || undefined });
  // 音色设计注册表（弹幕指令「设计音色 <提示词>」绑定 UID → MIMO voicedesign 模型）
  const voiceRegistry = new VoiceDesignRegistry({
    file: config.tts.voiceDesign.registryFile,
    maxUsers: config.tts.voiceDesign.maxUsers,
    promptMin: config.tts.voiceDesign.promptMin,
    promptMax: config.tts.voiceDesign.promptMax,
    blockedKeywords: config.tts.blockedKeywords,
  });
  // 外挂 LLM（SenseNova）：音色设计提示词细化 / 后续弹幕情绪修正；无 key 时降级为直存原文
  const llmClient = config.llm?.apiKey ? new SenseNovaClient(config.llm) : null;
  const ttsService = new DanmakuTtsService({
    engine: edgeTtsEngine,
    engines: { edge: edgeTtsEngine, mimo: mimoTtsEngine, fish: fishTtsEngine },
    player: ttsPlayer,
    registry: voiceRegistry,
    llm: llmClient,
    config: {
      ...config.tts,
      voiceDesign: { ...config.tts.voiceDesign, refine: config.llm?.voiceRefine !== false },
      // env 域 0-1（WindowsPlayer 用）→ settings 域 0-100（控制台用）
      playerVolume: Math.round(config.tts.playerVolume * 100),
      isCommandText: text => Boolean(parseSongCommand(text)),
    },
    ownerUid: config.bilibili.ownerUid,
    adminUids: config.bilibili.adminUids,
  });
  songService.on('media-key', action => {
    try {
      mediaController.press(action);
    } catch (error) {
      console.error('[MediaKey]', error.message);
    }
  });
  // 互动面板：聚合事件历史 + 数据栏统计（LiveControl「直播互动」页消费）
  const interactionService = new InteractionService({
    biliClient,
    ownerUid: config.bilibili.ownerUid,
    authProvider: () => biliAuth.snapshot(),
  });
  let gateway;

  const http = createHttpServer({
    biliAuth,
    biliConnectionProvider: () => ({ connected: biliClient.connected, authMode: biliClient.authMode }),
    root: projectRoot,
    host: config.host,
    port: config.httpPort,
    wsAuthToken: config.wsAuthToken,
    switchSceneHandler: async ({ scene }) => obsProxy.switchScene(scene || config.obs.defaultScene),
    coverHandler: amllBridge ? async id => amllBridge.getCoverData(id) : null,
    nowPlayingProvider: () => ({ ...(amllBridge?.diagnostics() || { enabled: false }), playback: amllBridge?.snapshot() || null }),
    ttsService,
    ttsProviderHandler: (provider) => ttsService.setProvider(provider),
    autoRestartFile: config.autoRestart.switchFile,
    autoRestartDefault: config.autoRestart.enabled,
    interactionService,
    danmakuSendHandler: async ({ text, replyMid, replyUname }) =>
      biliClient.sendDanmaku(text, Number(replyMid) > 0
        ? { mid: Number(replyMid), uname: String(replyUname || '') }
        : null),
    // 直播中心管理（标题/公告/封面/分区/开播关播）
    liveHandlers: {
      info: () => biliClient.getLiveRoomInfo(),
      areas: () => biliClient.getAreaList(),
      update: (body) => biliClient.updateRoomInfo({ title: body?.title, areaId: body?.areaId }),
      news: (body) => biliClient.updateRoomNews(body?.content),
      cover: (body) => biliClient.updateCover(body?.dataUrl),
      start: (body) => biliClient.startLive(body?.areaId),
      stop: () => biliClient.stopLive(),
    },
    healthProvider: () => ({
      ok: true,
      service: 'danmaku-frame',
      httpPort: config.httpPort,
      wsPort: config.wsPort,
      wsClients: gateway?.clientCount() || 0,
      songEnabled: songService.state.enabled,
      ttsEnabled: ttsService.state.enabled,
      nowPlaying: amllBridge?.diagnostics() || { enabled: false },
      roomId: biliClient.roomId || null,
      bilibiliAuth: { status: biliAuth.state.status, message: biliAuth.state.message },
      bilibiliConnection: { connected: biliClient.connected, authMode: biliClient.authMode },
    }),
  });

  return {
    config,
    http,
    biliClient,
    biliAuth,
    songService,
    obsProxy,
    ttsService,
    interactionService,
    async start() {
      await http.start();
      try {
        gateway = createWebSocketGateway({
          host: config.host,
          port: config.wsPort,
          authToken: config.wsAuthToken,
          maxPayload: config.maxWsMessageBytes,
          biliClient,
          songService,
          amllBridge,
          ttsService,
        });
        await gateway.ready;
      } catch (error) {
        await http.stop();
        throw error;
      }
      await ttsService.start();
      biliAuth.start();
      console.log('====================================================');
      console.log(`[DanmakuFrame] HTTP: http://${config.host}:${config.httpPort}`);
      console.log(`[WebSocket] Relay: ws://${config.host}:${config.wsPort}`);
      console.log(`[SongPlayer] 点歌播放器: http://${config.host}:${config.httpPort}/public/song-player/`);
      console.log(`[NowPlaying] 播放信息来源: ${config.amll.enabled ? config.amll.source : '已禁用'}（AMLL / 网易云 SMTC）`);
      console.log(`[BilibiliAuth] 登录管理: http://${config.host}:${config.httpPort}/public/bili-auth/`);
      console.log(`[TTS] 弹幕朗读: ${config.tts.enabled ? `开启 (${config.tts.voice})` : '关闭 (TTS_ENABLED=false)'}`);
      console.log(`[LLM] 音色细化: ${llmClient ? `开启 (${config.llm.model})` : '关闭 (SENSENOVA_API_KEY 未配置)'}`);
      console.log(`[AutoRestart] 崩溃自动重启: ${config.autoRestart.enabled ? '开启' : '关闭'}`);
      console.log('====================================================');
    },
    async stop() {
      biliAuth.stop();
      if (gateway) await gateway.stop();
      await ttsService.stop();
      await fishTtsEngine.close();
      await obsProxy.disconnect();
      await http.stop();
    },
  };
}
