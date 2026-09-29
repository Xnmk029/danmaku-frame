# Danmaku Frame

用于 OBS 的 B 站直播弹幕边框与本地中继服务。仓库同时包含弹幕朗读、点歌、歌曲显示、扫码登录、直播互动面板，以及 `livecontrol/` Electron 控制台。

> 运行平台以 Windows 为主：朗读播放器和网易云 SMTC 使用 Windows 能力。服务端使用 Node.js；本项目已在 Node.js 24 上验证。

## 快速开始

在 `danmaku-frame/` 目录运行：

```powershell
npm ci
if (!(Test-Path ..\.env)) { Copy-Item .env.example ..\.env }
```

配置文件位于**仓库上一级**的 `OBS/.env`，不是 `danmaku-frame/.env`。首次启动前至少检查 `BILIBILI_ROOM_ID`；按需设置 `TTS_ENABLED`、云端语音密钥和 OBS WebSocket 参数。已有 `../.env` 时请直接编辑，不要用示例文件覆盖。配置完成后运行：

```powershell
npm run supervised
```

`npm run supervised` 通过 `supervisor.mjs` 守护服务；开发时可用 `npm start` 直接运行。默认只监听本机：

- HTTP：`http://127.0.0.1:7788`
- WebSocket：`ws://127.0.0.1:7789`
- 健康检查：`http://127.0.0.1:7788/healthz`

## 在 OBS 中添加浏览器源

| 用途 | 浏览器源 URL |
| --- | --- |
| 弹幕边框 | `http://127.0.0.1:7788/index.html?room=30068664&hidebar=true` |
| 开场待机页 | `http://127.0.0.1:7788/standby.html?duration=120&room=30068664` |
| Matrix 风格弹幕 | `http://127.0.0.1:7788/matrix-danmaku.html` |
| 点歌播放器 | `http://127.0.0.1:7788/public/song-player/` |
| 网易云歌曲卡片 | `http://127.0.0.1:7788/public/ncm-nowplaying/nowplaying.html` |

将示例房间号换成自己的直播间号。弹幕边框建议使用 16:9 浏览器源尺寸，例如 1920×1080。

弹幕边框支持 `room`、`color`、`rgb=true`、`fx=none|flow|pulse`、`width`、`fontsize`、`font`、`hidebar=true`、`autoconnect=false` 等 URL 参数。待机页支持 `duration`（10–3600 秒）、`mode=countdown|clock`、`room`、`bgm` 和 `obsScene`；`obsScene` 指定倒计时结束后切换到的 OBS 场景。

## B 站登录与直播互动

打开 `http://127.0.0.1:7788/public/bili-auth/`，用哔哩哔哩 App 扫码并确认。登录凭证只保存在服务端的 `data/bilibili-auth.json`，不应放入浏览器 URL。普通弹幕接收可在未登录时工作；发送弹幕和直播中心写入操作需要有效登录态。

LiveControl 的“直播互动”页显示弹幕、礼物、醒目留言、上舰、进场及数据栏统计，并可弹出独立悬浮窗。“直播信息”页提供标题、公告、分区、封面和开播状态管理；开播取得的推流地址与密钥只在控制台展示。

## 弹幕朗读

在 `../.env` 中设置 `TTS_ENABLED=true`。`TTS_PROVIDER` 有四种路由：

| 值 | 路由 |
| --- | --- |
| `edge` | 全部使用 Edge TTS，无需 API Key |
| `mimo` | 全部使用小米 MiMo，需要 `MIMO_API_KEY` |
| `hybrid` | 已绑定 Fish 音色的用户优先走 Fish；其余按粉丝牌、舰长和白名单路由至 MiMo 或 Edge |
| `fish` | 全部使用 Fish Audio，需要 `FISH_AUDIO_API_KEY` 和可用的音色 ID |

控制台可以切换引擎、设置音色、语速与音量并试听。运行时设置保存在 `data/tts-state.json`，优先于 `.env` 中的初始 provider 设置。合成可并发准备，播放始终按弹幕入队顺序进行；`TTS_SYNTH_CONCURRENCY` 默认是 3。

朗读会根据 B 站事件自带的表情标记移除正文中的通用表情，例如 `真的[跪了]好笑` 读作“真的好笑”。直播间 `30068664` 的专属表情会读出名称，如 `[奶鲸]` 读作“奶鲸”；当前包括接收器、刚的门、奶鲸、奶蛙鲸、糖鲸、刚鲸。同房间后续新增的内嵌表情若带有房间标识，也会按名称朗读。其他大表情和清洗后无文字的弹幕会跳过。OBS 画面仍显示原始弹幕。可在 `../.env` 设置 `TTS_STRIP_KEYWORDS=[doge],不想读的词`，用逗号分隔要从朗读正文移除的字面词（不支持正则，英文不区分大小写）；`TTS_BLOCKED_KEYWORDS` 则会跳过包含匹配词的整条弹幕。没有 B 站表情元数据的普通 `[方括号文字]` 会保留，必要时可用移除词单独配置。修改 `.env` 后重启弹幕服务生效。

Fish Audio 示例配置：

```dotenv
TTS_ENABLED=true
TTS_PROVIDER=hybrid
FISH_AUDIO_API_KEY=你的密钥
FISH_AUDIO_MODEL=s2.1-pro-free
FISH_AUDIO_REFERENCE_ID=可用音色的32位ID
```

Windows 上 Fish 请求会自动读取系统代理。需要指定代理或强制直连时，设置 `FISH_AUDIO_PROXY_URL=http://127.0.0.1:端口` 或 `FISH_AUDIO_PROXY_URL=direct`。音色 ID 仅通过格式校验并不代表音色可用；被删除、设为私有或当前密钥无权访问的音色会在合成时由 Fish API 报错。可用 `TTS_FISH_BLOCKED_VOICES` 配置逗号分隔的禁用音色 ID，重启后清除相应的旧绑定。

### 观众音色指令

有粉丝牌、舰长身份、主播/房管权限或 `TTS_MIMO_UIDS` 白名单的用户可以绑定音色。指令本身不朗读。

| 指令 | 效果 |
| --- | --- |
| `音色 名称`、`注册音色 名称`、`音色注册 名称`、`选择音色 名称`、`搜索音色 名称` | 搜索 Fish 社区音色，展示最多三个候选 |
| `选择音色 一`、`选择音色 二`、`选择音色 三` | 选择当前候选；也可用 1/2/3 |
| `音色 32位ID`、`选择音色 UUID` | 直接绑定 Fish 音色 ID |
| `设计音色 描述` | 注册 MiMo 音色设计；可选 SenseNova 细化提示词 |
| `我的音色` | 查询自己的绑定 |
| `删除音色`、`重置音色` | 删除自己的绑定 |
| `删除音色 UID` | 主播或房管删除指定用户的绑定 |

Fish 名称搜索和编号选择由 `src/tts/fish-selection.mjs` 管理；选择只绑定发出指令的真实 UID。主播/房管还可发送 `朗读开`、`朗读关`、`朗读跳过`。

## 点歌与歌曲显示

将有权播放的音频放在 `music/`，设置 `SONG_REQUEST_ENABLED=true`。观众发送 `点歌 歌名`；主播/房管可用 `下一首`、`暂停点歌`、`继续播放`、`清空歌单` 等指令。管理页位于 `/public/song-player/admin.html`。网络直链播放默认关闭（`SONG_ALLOW_DIRECT_URLS=false`）。

歌曲显示使用 `NCM_SOURCE=auto` 时优先取 AMLL WebSocket 广播，无法使用时回退到 Windows SMTC。可通过 `NCM_SOURCE=amll` 或 `NCM_SOURCE=smtc` 固定来源；`GET /api/ncm/state` 可查看当前状态。

## LiveControl 桌面控制台

`livecontrol/` 是同一仓库中的 Electron 子项目。它管理弹幕姬及其他本地直播服务，提供朗读调音、互动悬浮窗和直播信息页。首次使用：

```powershell
cd livecontrol
npm ci
npm run build
npm start
```

修改 `livecontrol/renderer/*.js` 后重新运行 `npm run build`；`renderer/bundle.js` 与 `renderer/float-bundle.js` 是构建产物，不纳入 Git。当前服务定义使用 `G:/产品/OBS` 和 `G:/产品/vup` 等本机路径，迁移到另一台机器前请检查 `livecontrol/services.js`。控制台详情见 [LiveControl README](livecontrol/README.md)。

## 配置、安全与排障

- 完整配置项见 [`.env.example`](.env.example)。`../.env`、`data/`、`music/` 和本地构建产物不纳入 Git；清理工作区时请保留实际运行数据。
- 服务默认绑定 `127.0.0.1`。需要开放远程访问时，先设置 `WS_AUTH_TOKEN` 并核对 HTTP/WS 端点的鉴权。
- `GET /healthz` 检查服务、弹幕连接及朗读开关；`GET /api/tts/state` 查看队列、引擎和最后一次朗读错误；`GET /api/interaction/state` 查看互动快照。
- 修改代码后运行 `npm test` 和 `npm run check`；修改控制台渲染代码后再运行 `cd livecontrol; npm run build`。
- `npm run selftest`（在 `livecontrol/` 下）会真实启动和停止弹幕姬，直播期间不要执行。
- 守护模式只在工作进程异常退出时重启；正常停止不会触发重启。`data/auto-restart.json` 保存运行时自动重启开关。

## 代码位置

`server.mjs` 启动 `src/app.mjs` 装配服务；`src/config/env.mjs` 读取配置；`src/transport/` 提供 HTTP 和 WebSocket；`src/bili/` 连接 B 站；`src/tts/` 处理朗读；`src/song-request/` 处理点歌；`src/ncm/` 处理歌曲显示；`tests/` 是 Node.js 测试。OBS 页面位于仓库根目录和 `public/`。

`package.json` 中声明的许可证为 MIT。

## PHASE 直播边框（A/B/C）

原 O / 8 背景字形已改为「今日测试模型 ID」对应的长体版本号，配合 PHASE / MARK 本地图标。制作台填写完整模型 ID 后自动识别，保存即可同步前后景；见 [模型标记说明](DOCS/phase-model-mark.md)。

制作台：`http://127.0.0.1:7788/phase-frame.html`。在制作台中按布局调整弹幕条数、歌曲/下一项、心率与频谱；后景和前景的 OBS 地址可直接复制。旧 `index.html` 保留。

Windows 本机心率与桌面音频采集首次安装：

```powershell
powershell -File scripts/setup-phase-telemetry.ps1
```

完成后在制作台的“本机采集”中扫描手表并保存设置。佳明 Instinct 1 需要进入心率广播模式；采集的桌面音频来自 Windows 默认播放设备。完整接入说明见 [PHASE 直播边框接入](DOCS/phase-frame-integration.md)。

边框心形图标来自 [Pixel Icon Library by HackerNoon](https://pixeliconlibrary.com/)，按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用；主题配色及心跳动画由本项目实现，见 [素材声明](public/frame/assets/NOTICE.md)。

边框顶部硬件状态使用独立 Python 组件：`powershell -File scripts/start-hardware.ps1`，或在 LiveControl 启动「硬件状态」。显示真实 CPU / 物理内存 / NVIDIA GPU 占用率与可用温度；无传感器时显示 `—`。无需重启弹幕中继，详见 [硬件采集说明](DOCS/phase-hardware.md)。

### 工作区与验证

运行入口保留在根目录：`phase-frame.html`（边框）、`standby.html`（待机）、`index.html` / `matrix-danmaku.html`（旧边框）、`看门狗.html`。制作台和 OBS 使用原有入口地址。

- 设计与接入说明：`DOCS/`，视觉基准为 `DOCS/phase-signal-design.md`。
- 素材：`assets/phase/`、`assets/live2d/`；模型图标在 `public/frame/assets/model-marks/`。
- 旧页面：`public/standby/legacy.html`、`public/previews/awwwards-deepseek-frame.html`。
- 浏览器验证：`node scripts/verify/verify-model-mark.cjs`、`verify-frame.cjs`、`verify-reference.cjs`、`verify-config-sync.cjs`、`verify-hardware.cjs`。需本地 Playwright 和 Edge；可用 `PLAYWRIGHT_MODULE` 指定模块路径。截图写入 `tmp/qa/`。
- `data/`、`music/`、`tmp/`、构建输出、依赖与本地环境配置均不提交。
