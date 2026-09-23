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
