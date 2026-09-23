# LIVE FRAME — B站直播弹幕 H5 赛博朋克边框插件

一款专为 **OBS Studio 直播与屏幕录制** 设计的高颜值 **赛博朋克 16:9 极简直播边框与 B站实时弹幕 H5 插件**。集成了 Watch Dogs 风格终端字符乱码解码动效 (Scramble Text Engine)、全色系 RGB 动态流光 / 呼吸灯效，以及开箱即用的原生 B站 WebSocket 弹幕中继服务。附带 **弹幕朗读（Edge TTS）**、**崩溃自动重启守护** 与 **LiveControl 桌面直播控制台**（弹幕朗读调音面板）。

> 📦 仓库布局：本仓库 == 完整项目 = 弹幕姬服务端（本目录）+ **`livecontrol/`**（Electron 直播控制台子项目，依赖本服务端）。目录结构见下文。

---

## 核心特性

- **16:9 赛博朋克极简边框**
  - 几何线条与黑客终端风格设计，支持无缝叠加至 OBS 游戏捕获或桌面捕获画面。
  - 支持 **RGB 流光全彩渐变**、**FX FLOW 流光**、**FX PULSE 呼吸灯** 等多重动态发光特效。

- **Scramble Text 终端乱码解码动效**
  - 弹幕弹出时附带快速字符乱码混淆与逐字解密效果（包含日文片假名 `アイウエオ`、二进制 `0101` 与终端符 `!<>-_\\/`）。
  - 动效流畅自然，提供独特的极客视觉体验。

- **原生 B站 WebSocket 动态 Token 鉴权**
  - 内置 Node.js 高性能 WebSocket 中继服务（端口 7789），支持动态请求 B站 API 提取鉴权 Token (`Opcode 7`)。
  - 原生支持 **Brotli** (`protover: 3`) 与 **Zlib** (`protover: 2`) 双重二进制数据流解压与拆包。
  - 精确解析普通弹幕 (`DANMU_MSG`)、高额送礼 (`SEND_GIFT`)、醒目留言 (`SUPER_CHAT_MESSAGE`) 及大航海勋章（舰长/提督/总督）。

- **丰富可调参数与本地持久化**
  - 实时自定义面板宽度 (W)、弹幕字体大小 (F) 与等宽/黑体/中文字体系列。
  - 支持快速调色盘与 HTML5 颜色选择器。
  - 支持 B站 APP 扫码登录，凭证保存在服务端，不进入浏览器 URL 或 `localStorage`。

- **开场待机倒计时页 (standby)**
  - 阈限空间式开场：三层 Z 轴（背景鸽子群 / 中央倒计时 / 前景弹幕+粒子），异步循环防重复。
  - 倒计时结束白闪释放，可联动 OBS WebSocket 自动切换正片场景。

- **AMLL 播放信息联动（网易云实时歌名）**
  - 订阅 AMLL WebSocket 广播（`ws://127.0.0.1:11444`，协议 V2），实时显示当前播放歌曲。
  - 三载体：独立 OBS 源（封面+歌名+进度条）、弹幕边框底部一行、待机页底部播放条。
  - 封面 Base64 由服务端缓存（`/api/ncm/cover`），无防盗链问题；AMLL 未运行自动隐藏。

- **弹幕点歌姬**
  - 支持“点歌 歌名”、取消点歌、查看歌单和主播切歌等命令。
  - 内置排队、防重复、用户配额、冷却、权限控制和播放状态恢复。
  - 首版支持 `music/` 目录中的本地合法音频；网络直链默认关闭。
  - 提供独立的 OBS 正在播放浏览器源。

- **弹幕朗读（Edge TTS）**
  - 微软 Edge 在线语音合成（无需 API Key），Windows 扬声器朗读弹幕。
  - 主播/房管弹幕命令 `朗读开` / `朗读关` / `朗读跳过` 实时控制；状态跨重启持久化。
  - 内置过滤：命令弹幕跳过、超长截断、用户/关键词黑名单、同文本去重、用户冷却、串行队列（不重叠）。
  - 支持音色/语速/音调/音量配置（默认晓晓 zh-CN-XiaoxiaoNeural）。

- **崩溃自动重启（Supervisor 守护）**
  - 启动 `node supervisor.mjs`（或使用根目录 `启动弹幕姬.bat`）自动获得守护模式。
  - 进程崩溃自动重启，指数退避（1s/2s/4s/…/30s），连续 8 次熔断防止崩溃循环。
  - 开关：`.env AUTO_RESTART_ENABLED`、`data/auto-restart.json`（运行时 API/看门狗页可改）。

---

## 项目结构

```text
danmaku-frame/                 # 弹幕姬服务端（本仓库 = 完整项目）
├── index.html            # 16:9 赛博朋克弹幕边框 H5 前端页面 (底层源)
├── standby.html          # 开场待机倒计时页（开播前情绪缓冲，可联动 OBS 切场景）
├── matrix-danmaku.html   # 《黑客帝国》“内部消息”代码拖尾跳过飘飞弹幕 (顶层源 / UIDemo)
├── server.mjs            # 轻量启动入口
├── supervisor.mjs        # 守护入口：崩溃自动重启（指数退避 + 让位接管感知）
├── src/                  # 服务端模块：B站连接、协议、点歌、TTS 朗读、HTTP/WS
├── scripts/              # tts-player.ps1 常驻播放器 / speak-test.mjs 自检 / 音频诊断
├── public/song-player/   # OBS 点歌播放器与管理页面
├── public/ncm-nowplaying/ # OBS 网易云正在播放卡片（AMLL 联动）
├── livecontrol/          # 🖥️ LiveControl 直播控制台（Electron + MD3 子项目）
├── music/                # 用户提供的合法本地音频（默认不纳入 Git）
├── data/                 # 点歌/朗读运行状态（默认不纳入 Git）
├── tests/                # Node.js 单元测试
├── 看门狗.html            # 运行状态监控与通信检测辅助页面
├── package.json          # 项目依赖与启动脚本
└── README.md             # 项目使用指南
```

### livecontrol/ 子项目（直播控制台）

Electron + Material Design 3 桌面面板：一键开播/下播、4 服务管理（弹幕姬/鸽子动画/面捕/虚拟形象）、弹幕朗读调音面板（音色/语速/音调/音量/试听）、崩溃自动重启开关、托盘常驻。

```bash
cd livecontrol
npm install          # 首次（含 Electron 二进制）
npm run build        # 打包 renderer（改过 renderer/*.js 后需要）
npm start            # 启动
# 打包发行版（产出 dist-v2/）
npm run dist
```

服务路径为相对布局（弹幕姬 = `../`），clone 后目录结构不变即可直接管理本地弹幕姬。

---

## 面向 Agent 的文件关联提示

> 给 AI 编码代理的导航地图：改某功能 → 触碰哪些文件 → 遵守什么约定。

### 装配链（一切从 `src/app.mjs` 出发）

```text
server.mjs ──▶ src/app.mjs（装配全部子系统）
                ├── config/env.mjs        ← 全部配置的唯一起点（.env 位于项目上层 G:\产品\OBS\.env）
                ├── transport/http-server.mjs     HTTP 7788：静态文件 + /healthz + /api/*
                ├── transport/websocket-gateway.mjs  WS 7789：弹幕广播 + action 指令
                ├── bili/client.mjs + packet-codec.mjs + event-normalizer.mjs   ← B站弹幕协议
                ├── song-request/         ← 点歌姬
                ├── tts/                  ← 弹幕朗读（Edge TTS）
                ├── ncm/                  ← AMLL 网易云播放信息（server/client 双模式）
                ├── obs/obs-proxy.mjs     ← OBS 场景切换联动
                ├── interaction/interaction-service.mjs  ← 互动面板（事件缓冲 + 数据栏统计 + 快照）
                └── platform/windows-media-controller.mjs  ← 媒体键模拟
supervisor.mjs ──▶ 守护入口（spawn server.mjs，崩溃自动重启，读 data/auto-restart.json）
```

### 弹幕朗读（Edge / MIMO TTS）链路 —— 改动时的文件地图

| 职责 | 文件 | 说明 |
| --- | --- | --- |
| 配置项 | `src/config/env.mjs`（`tts:` 块） | `TTS_*` 环境变量，解析为中心配置；新增 `TTS_PROVIDER=hybrid`、`TTS_MIMO_UIDS`、`TTS_VOICE_DESIGN_*` |
| 在线合成 | `src/tts/edge-tts.mjs` | msedge-tts 封装；`setParameters()` 热更新音色/语速/音调 |
| MIMO 合成 | `src/tts/mimo-tts.mjs` | 小米 MiMo-TTS v2.5；支持 `designPrompt` → `mimo-v2.5-tts-voicedesign` 模型 |
| 音色设计注册表 | `src/tts/voice-registry.mjs` | UID → 提示词（+原文 rawPrompt）；持久化 `data/voice-designs.json` |
| 外挂 LLM | `src/llm/sensenova.mjs` `src/llm/voice-prompts.mjs` | SenseNova OpenAI 兼容 client；`设计音色` 描述 → MiMo voicedesign 细化提示词（`LLM_VOICE_REFINE` 开关） |
| 本地播放 | `src/tts/windows-player.mjs` + `scripts/tts-player.ps1` | 常驻 PowerShell 播放器；stdin 指令 `PLAY/STOP/VOLUME/EXIT`；**改指令协议需两端同步** |
| 业务服务 | `src/tts/tts-service.mjs` | 过滤/去重/队列/命令（朗读开·关·跳过）/音色设计指令/试听/持久化 `data/tts-state.json`；`resolveVoiceProfile()` 按 provider/粉丝牌/白名单路由双引擎 |
| 指令解析 | `src/danmaku/voice-commands.mjs` | `注册音色/删除音色/我的音色` 等观众级指令解析 |
| 对外端点 | `src/transport/http-server.mjs` | `/api/tts/state` `enabled` `settings` `test` `skip` `provider` `voice-designs` |
| WS 指令 | `src/transport/websocket-gateway.mjs` | `tts.get_state` `set_enabled` `set_settings` `test` `skip` |
| 装配 | `src/app.mjs` | 注入 engines/player/service/registry；`start()` 启播放器 |
| 自检 | `scripts/speak-test.mjs` | 命令行试听 |

### 功能 ↔ 文件索引（改哪查哪）

- **B站弹幕协议**：`src/bili/`（client 连接/心跳/重连/发弹幕 `msg/send`，codec 拆包 Brotli/Zlib，normalizer 事件标准化）→ 事件 `{type: 'danmaku'|'gift'|'sc'|'guard'|'entry'|'watched'|'like'|'popularity', ...}` 经 gateway 广播。
- **直播互动面板**（LiveControl「直播互动」tab）：`src/interaction/interaction-service.mjs` 环形缓冲 + 统计；`GET /api/interaction/state` 快照、`POST /api/danmaku/send` 代发弹幕（需登录态 Cookie + `bili_jct`）。
- **弹幕命令扩展**：`src/danmaku/command-parser.mjs`（点歌命令表）+ `src/song-request/song-service.mjs`（执行/权限/队列）+ `src/tts/tts-service.mjs`（朗读命令）。
- **静态页面**：根目录 5 个 HTML 由 http-server 直出；`public/` 目录同理。**页面与后端解耦，改页面无需重启服务端进程**（逐请求读盘）。
- **测试配套**：`tests/*.test.mjs`（node --test），新增模块必须带测试；`npm test` 全量回归。

### 与其他项目的关联（关键）

- **`G:\产品\LiveControl`（直播控制台 Electron）管理本服务的启停/健康/日志**（healthz 轮询）；本服务只负责业务。**任何新能力若需外部控制面板，必须提供 HTTP 或 WS 端点**，控制台只调 API。弹幕朗读调音端点即为先例。
- `.env` 位于项目**上层** `G:\产品\OBS\.env`（`loadConfig` 主动读取），非 danmaku-frame 内。
- OBS 联动：`standby.html` 倒计时归零 → `POST /api/obs/switch-scene` → `obs/obs-proxy.mjs`；非回环需 `WS_AUTH_TOKEN`。

### 必须遵守的约定

1. 新端点/新 WS action 按现有鉴权模式：回环免 token，远程必须带 `WS_AUTH_TOKEN`。
2. `/api/*` 对**回环来源请求**自动附加 CORS 头并响应 OPTIONS 预检（供 LiveControl Electron 渲染进程等本地跨源页面调用）；不要对非回环请求放开 CORS。
3. `data/` 下状态文件（song-state / tts-state / auto-restart）是唯一持久化通道；改结构需兼容旧文件。
4. 播放器子进程协议变更（PS1 脚本）与 Node 侧必须同步修改、同步测试。
5. `supervisor.mjs` 是推荐入口（崩溃自动重启）；`server.mjs` 仍可直接运行（无守护）。
6. WS 广播对全部订阅者无差别推送；新增事件类型时须确认各消费页的白名单：`index.html` 仅上屏 `danmaku/gift/sc`（其余事件有 `text` 字段会以「匿名黑客」噪音渲染）、`standby.html` 仅 `danmaku`、`matrix-danmaku.html` 关键词过滤。
7. 直播中心管理接口 `/api/live/*`（info/areas/update/news/cover/start/stop）由 `BiliLiveClient` 承载，写操作一律走 `_livePost`（统一 CSRF + 错误码归一）；开播返回 `rtmp.addr`/`rtmp.code`，推流密钥每次开播更换。

---

## 快速开始

### 1. 安装依赖与启动服务

确保已安装 [Node.js](https://nodejs.org/) (建议 v18+)，在项目根目录运行以下命令：

```bash
# 安装项目依赖
npm install

# 启动 HTTP 与 WebSocket 弹幕中继服务
npm start

# 或：以守护模式启动（崩溃自动重启，推荐用于直播）
npm run supervised
```

服务启动成功后，终端将输出如下提示信息：

```text
====================================================
Danmaku-Frame H5 直播边框 HTTP 服务: http://localhost:7788
WebSocket 弹幕中继服务: ws://localhost:7789
----------------------------------------------------
页面地址: http://localhost:7788/index.html
点歌播放器: http://localhost:7788/public/song-player/
====================================================
```

### 点歌姬快速开始

1. 将有权播放的 `.mp3`、`.wav`、`.ogg`、`.m4a` 或 `.flac` 文件放入 `danmaku-frame/music/`。
2. 在根目录 `.env` 中填写主播 UID：

   ```env
   BILIBILI_OWNER_UID=你的UID
   BILIBILI_ADMIN_UIDS=房管UID1,房管UID2
   SONG_REQUEST_ENABLED=true
   SONG_BLOCKED_UIDS=
   SONG_ALLOWED_UIDS=
   SONG_BLOCKED_KEYWORDS=
   ```

3. 在 OBS 中添加浏览器源：

   ```text
   http://127.0.0.1:7788/public/song-player/
   ```

4. 观众发送 `点歌 文件名关键词`。主播或配置的管理员可以发送 `下一首`、`暂停点歌`、`继续播放`、`清空歌单`、`开启点歌`、`关闭点歌`。

管理页地址为 `http://127.0.0.1:7788/public/song-player/admin.html`。服务开放到局域网时，必须设置 `WS_AUTH_TOKEN`，并通过管理页 URL 的 `?token=...` 参数提供。

> 本项目不提供会员歌曲解锁、版权限制绕过或第三方音乐平台私有接口。请只使用已获得播放授权的音频。

### 弹幕朗读快速开始

1. 在根目录 `.env` 中开启并可选调整：

   ```env
   TTS_ENABLED=true
   TTS_PROVIDER=hybrid              # edge（全 Edge） / mimo（全 MIMO） / hybrid（粉丝牌/白名单→MIMO，其余→Edge）
   TTS_VOICE=zh-CN-XiaoxiaoNeural   # Edge 音色：云希/云扬...
   MIMO_VOICE=mimo_default          # MIMO 预置音色
   TTS_RATE=+0%
   TTS_PITCH=+0Hz
   TTS_PLAYER_VOLUME=100            # 本机扬声器音量 0-100
   MIMO_API_KEY=你的MIMO_KEY        # MIMO 与音色设计必需
   BILIBILI_OWNER_UID=你的UID       # 弹幕「朗读开/关/跳过」仅主播/房管可用
   TTS_MIMO_UIDS=                   # 无粉丝牌白名单（如主播自己）
   TTS_VOICE_DESIGN_ENABLED=true    # 弹幕指令注册音色设计
   # 可选：外挂 LLM（SenseNova）把抽象描述细化为 voicedesign 提示词；不配则直存原文
   SENSENOVA_API_KEY=你的SenseNova_KEY
   LLM_MODEL=sensenova-6.8-flash-lite
   LLM_VOICE_REFINE=true
   ```

2. 启动服务（`npm start` 或 `npm run supervised`）。弹幕朗读的调音界面（音色/语速/音调/音量/音色注册表）
   由 **`G:\产品\LiveControl`（直播控制台 Electron 应用）** 提供，服务端 API 已就绪：
   `GET /api/tts/state`、`POST /api/tts/enabled`、`POST /api/tts/settings`、`POST /api/tts/test`、`POST /api/tts/skip`、
   `POST /api/tts/provider`、`GET /api/tts/voice-designs`、`POST /api/tts/voice-designs/delete`。
   看门狗页 `http://127.0.0.1:7788/看门狗.html` 的 SYSTEM 面板提供开关入口。

3. **观众级音色设计指令**（粉丝牌/舰长/房管/TTS_MIMO_UIDS 白名单可用）：

   - `设计音色 <描述>` — 绑定 UID 到 MiMo `mimo-v2.5-tts-voicedesign` 音色设计提示词，确认朗读即为试听。
     配置了 `SENSENOVA_API_KEY` 时先由 LLM 把抽象描述（如「派大星」「萝莉音」）细化为多维度音色描述
     （年龄/音色质感/口音/语速/气质），注册表同时保留原文；LLM 不可用或超时自动回退原文
   - `我的音色` — 用已注册音色朗读当前提示词摘要
   - `删除音色` — 删除自己的注册
   - `删除音色 <uid>` — 主播/房管删除他人

4. 命令行自检语音输出：

   ```bash
   node scripts/speak-test.mjs "欢迎来到直播间" zh-CN-YunxiNeural
   ```

### 崩溃自动重启

- 用 `npm run supervised` 或根目录 `启动弹幕姬.bat` 启动即获得守护。
- 运行时开关：看门狗页 SYSTEM 面板 / `POST /api/auto-restart {"enabled":false}` / 直接写 `data/auto-restart.json`。
- 正常退出（Ctrl+C / 优雅停机）不触发重启；仅非零退出码视为崩溃。

---

## 在 OBS Studio 中使用

1. 打开 **OBS Studio**，在“来源”列表中点击 `+`，选择 **浏览器 (Browser Source)**。
2. 在 **URL** 输入框中填写：
   ```text
   http://localhost:7788/index.html?room=30068664&hidebar=true
   ```
3. 建议将宽度设置为 `1920`，高度设置为 `1080`（或匹配您的直播画布分辨率，如 `1280x720`）。
4. 勾选 **通过 OBS 刷新浏览器**，点击“确定”保存。

### URL 参数配置说明

可以通过在 URL 路径后拼接查询参数实现个性化效果与自动连接：

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `room` | 目标 B站直播间号或长链接 | `?room=30068664` |
| `color` | 十六进制边框发光主题色 | `?color=%2300e5ff` |
| `rgb` | 是否开启 RGB 渐变流光 (`true`/`false`) | `?rgb=true` |
| `fx` | 动态灯效模式 (`none`/`flow`/`pulse`) | `?fx=flow` |
| `width` | 弹幕面板宽度 (px) | `?width=360` |
| `fontsize` | 弹幕文字字号 (px) | `?fontsize=14` |
| `hidebar` | 自动隐藏顶部控制栏 (`true`/`false`) | `?hidebar=true` |
| `autoconnect` | 加载页面时自动连接直播间 (`true`/`false`) | `?autoconnect=true` |

### 开场待机页参数 (standby.html)

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `duration` | 倒计时秒数 (10–3600，默认 120) | `?duration=300` |
| `mode` | `countdown` 倒计时 / `clock` 实时时钟 | `?mode=clock` |
| `room` | 弹幕预览面板连接的直播间 | `?room=30068664` |
| `bgm` | 本地待机音乐（相对 danmaku-frame 根） | `?bgm=music/standby.mp3` |
| `obsScene` | 倒计时归零时切换的 OBS 场景名 | `?obsScene=正片` |
| `schedule` | 左下角节目安排文本 | `?schedule=20:00%20LIVE` |
| `social` | 左下角社交 ID 文本 | `?social=%40xxx` |
| `hidebar` | 隐藏顶部调试控制条 (`true`/`false`) | `?hidebar=true` |

OBS 浏览器源示例：

```text
http://localhost:7788/standby.html?duration=120&room=30068664&bgm=music/standby.mp3&obsScene=正片
```

### AMLL 播放信息（网易云正在播放）

需在网易云客户端安装 AMLL 相关插件并开启 WebSocket 广播（默认端口 `11444`）。服务端自动连接，无需额外配置；`danmaku-frame` 根目录 `.env` 可调整：

```env
NCM_ENABLED=true
AMLL_WS_URL=ws://127.0.0.1:11444
```

独立 OBS 浏览器源（封面 + 歌名 + 歌手 + 进度条）：

```text
http://127.0.0.1:7788/public/ncm-nowplaying/nowplaying.html
```

弹幕边框（index.html）底部与待机页（standby.html）底部会自动显示一行 `♪ 歌名 - 歌手`，AMLL 未运行或未播放时自动隐藏。

---

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源许可证。

## B站扫码登录与登录状态（2026-09-10）

打开 `http://127.0.0.1:7788/public/bili-auth/`（端口以实际配置为准），点击“扫码登录”，使用哔哩哔哩 APP 扫描并在手机上确认。LiveControl 源码版的顶部也有“B站扫码登录”入口及登录状态。现有已打包的旧版 LiveControl 可直接使用上述浏览器入口。

- 扫码成功后先调用 B站 nav 验证账号，再原子保存完整 Cookie 和 refresh token 至 `data/bilibili-auth.json`，并立即让已订阅的弹幕连接重新鉴权，无需重启。
- 启动时优先读取保存的扫码凭证，无保存文件时兼容父目录 `.env` 中的 `BILIBILI_COOKIE` / `BILIBILI_SESSDATA`。扫码后的账号 UID 取自 B站验证结果，不沿用旧账号 UID。
- 每 60 秒检查登录状态，区分有效、失效、未配置和网络故障。网络或风控错误保留凭证并重试，不误判为退出登录。
- 游客连接不缓存；检测到账号有效时，游客连接会自动重新鉴权。健康的登录态连接不会被每分钟强制重连。
- WebSocket 鉴权响应必须为 `code: 0` 才报告成功；失败会清理连接 token 并重试。登录有效不代表 B站保证每条消息都提供完整昵称。
- 登录 API 只允许本机页面访问。扫码密钥不返回浏览器；Cookie / refresh token 不出现在 API 状态、URL 或浏览器存储中。`data/` 不作为静态文件提供。
- 本版保存 refresh token，但尚不执行 B站 Cookie 自动续期；被服务端撤销或过期的凭证仍需要重新扫码。不要把状态检测或连接恢复理解为永久免登录。

排查入口：`/api/bili-auth/state` 提供登录状态和弹幕连接身份；`/healthz` 提供不含凭证的简要状态。不要仅根据“连接成功”判断是否登录。登录文件属于敏感本地状态，请勿提交或分享。

## 网易云 SMTC 与 Fish Audio（2026-09-22）

### 歌曲显示：Windows SMTC

默认 `NCM_SOURCE=auto`：优先使用已有 AMLL 播放信息，没有 AMLL 歌曲数据时回退到网易云音乐的 Windows SMTC 会话。SMTC 不依赖 BetterNCM 或 AMLL 插件。网易云客户端需开启系统媒体控制/SMTC 功能（设置名称因版本而异）。

- 读取歌名、歌手、专辑、封面、总时长、播放进度、暂停/恢复状态。Windows 10 1809 或更新版本可用。
- 默认只匹配 `cloudmusic|netease|网易云`，不会把浏览器视频或其他播放器显示到边框。
- 主边框、待机页和独立 `public/ncm-nowplaying/nowplaying.html` 继续消费相同的 `ncm.playback` 消息，无需修改 OBS 浏览器源 URL。主边框沿用暂停时隐藏歌曲卡片的行为。
- 可在父目录 `OBS/.env` 设置 `NCM_SOURCE=smtc` 强制使用 SMTC，或 `NCM_SOURCE=amll` 仅使用旧方案。`NCM_SMTC_APP_PATTERN` 可调整会话名称匹配，`NCM_SMTC_INTERVAL_MS` 默认 1000。
- 只在有歌曲显示订阅者时启动隐藏的 PowerShell 读取进程；最后一个订阅者退出后停止。进程故障会重试，超时会清除旧歌曲，避免残留。
- 诊断：`GET /api/ncm/state` 返回当前来源、播放状态与 SMTC 状态。没有打开边框等订阅页面时，状态为未启动是正常的。
- 独立读取检查：在 Windows PowerShell 运行 `powershell.exe -NoProfile -File scripts/smtc-watch.ps1 -Once`；无网易云匹配会话时返回现有 SourceAppUserModelId 列表。

### 弹幕朗读：Fish Audio 官方云端

在父目录 `OBS/.env` 配置（不要把密钥填入网页 URL 或发送到聊天）：

```dotenv
FISH_AUDIO_API_KEY=你的官方API密钥
FISH_AUDIO_REFERENCE_ID=音色页面的32位reference_id
FISH_AUDIO_MODEL=s2.1-pro
FISH_AUDIO_BASE_URL=https://api.fish.audio
FISH_AUDIO_TIMEOUT_MS=30000
# 可选：默认读取 Windows 系统代理；也可填 http://127.0.0.1:端口 或 direct
FISH_AUDIO_PROXY_URL=
```

重启弹幕服务后，在源码版 LiveControl 的“弹幕朗读”中选择“Fish Audio（云端）”。音色 ID 可在面板修改并持久化，点击试听验证。已有的运行时 provider 设置优先于 `TTS_PROVIDER`；切换引擎请使用面板或 `/api/tts/provider`。

- 接口为 `POST /v1/tts`，Bearer 鉴权、`model` 请求头、`reference_id` 指定音色，接收二进制 MP3 后复用 Windows 播放队列。
- 支持原有过滤、去重、排队、试听、跳过、播放音量；语速映射到 Fish `prosody.speed`（0.5–2）。音调与 Edge 增益不发送到 Fish。
- Fish 全量模式与 Edge、MIMO、既有 Hybrid 模式并列。Hybrid 下已绑定 Fish 音色的用户优先走 Fish，其余用户仍按原来的 Edge/MIMO 规则分流；MIMO 的音色设计提示词不会传给 Fish。用户/舰长/等级音色绑定在 Fish 模式下仅接受 Fish 音色 ID，其他引擎的音色名会回退到 Fish 默认音色。
- 没有密钥时切换会明确报错，不静默伪装为 Fish。401/402/403/422 不自动重试；429 与 5xx 最多重试一次。请求超时、空音频或错误格式不会进入播放器。
- Windows 上自动使用当前系统代理连接 Fish API；如需指定代理或强制直连，设置 `FISH_AUDIO_PROXY_URL`。音色页面已删除或不可用时，试听会提示更换音色 ID。
- 支持模型配置：`s1`、`s2-pro`、`s2.1-pro`、`s2.1-pro-free`、`drama-3-preview`。可用性、费用和限制以账号与官方说明为准，本项目默认不切换现有朗读引擎。

接口依据：[Fish Audio TTS](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)、[Microsoft SMTC 会话 API](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager)。

### Fish Audio 弹幕选音色

观众发送 `音色 <音色页面的32位ID>`，即可为自己的真实 UID 绑定社区音色。接受 32 位十六进制 ID 和标准带连字符 UUID；请求 Fish API 时统一转为小写 32 位 ID。指令本身不朗读，不自动切换全局引擎；在 Fish Audio 或混合模式下，后续弹幕使用该用户绑定音色。绑定保存在 TTS 状态文件中，重启保留，不依赖 MIMO 音色设计开关；绑定或更换音色沿用音色注册资格：普通观众需有粉丝牌，舰长、主播/房管及 TTS_MIMO_UIDS 白名单沿用原有豁免。无资格的指令不朗读、不修改已有绑定；查询和删除自己的绑定不要求粉丝牌。

Fish 模式或混合模式下已绑定 Fish 音色的用户可发 `我的音色` 查询、`删除音色` 或 `重置音色` 恢复默认；主播/房管可用 `删除音色 UID` 删除指定用户绑定。沿用音色指令冷却（默认 60 秒，主播/房管豁免）。格式校验通过仅表示绑定已保存，音色是否存在、可访问需以实际 Fish 合成响应为准。

### 按名称搜索 Fish 社区音色

有资格的观众发送 `音色 派大星` 或 `搜索音色 派大星`。歌曲卡暂时展示搜索状态，再显示最多三条名称、作者和中文编号；发送 `选择音色 一`（二/三或 1/2/3 也支持）完成自己的绑定。选择不受搜索指令的 60 秒冷却阻挡，权限仍与音色注册一致。

候选完全入场后倒计时 20 秒，最后 5 秒进度条变暖色；选中行高亮，约 2 秒后恢复最新歌曲。无结果、失败和超时都会自动退场；无歌曲时结束后隐藏。多名观众排队（最多 5 人等待），每人只保留一个请求，轮到自己才开始搜索和计时。重新连接边框时同步当前候选及剩余时间。

客户端入口：`public/voice-selection/card.js`、`card.css`；服务端流程：`src/tts/fish-selection.mjs`。更新后需重启弹幕服务并刷新 OBS 的边框浏览器源。搜索与绑定不调用付费合成，实际朗读仍受 Fish 账户额度影响。

### 并行合成与顺序播放

默认 `TTS_SYNTH_CONCURRENCY=3`（可配置 1～6）。Fish/MIMO 最多三条同时合成，前一条播放时提前准备后面的音频；播放器始终按入队顺序逐条播放，合成完成顺序不影响朗读顺序。Edge 共用有状态连接，同一 Edge 引擎仅单路合成，但可与 Fish/MIMO 并行，并可在上一条播放时合成下一条。

跳过会立即让出当前播放位置；关闭朗读会清空待播音频，迟到的结果不会再播放。已发出的云端请求可能继续完成，且按服务商规则计费；取消的在途请求仍计入并发上限，避免快速开关时堆积请求。队列继续保留最多八条等待弹幕，满时丢弃最旧等待项。

`/api/tts/state` 增加 `synthConcurrency`、`synthesizingCount`、`readyCount`，可查看并发上限、在途合成数量和已就绪待播数量。音色与引擎按入队时的选择保存，后续改绑不会改变已入队弹幕。

### 音色指令统一入口

`注册音色 名称`、`音色注册 名称`、`选择音色 名称`、`音色 名称` 等价，统一搜索 Fish 社区音色；参数是合法音色 ID 时直接绑定。`选择音色 一 / 二 / 三` 仍用于候选编号选择。支持空格、英文冒号和中文冒号分隔。MIMO 提示词设计使用 `设计音色 描述`。原有粉丝牌权限、搜索冷却与候选选择流程保持一致。

Fish 音色黑名单：`TTS_FISH_BLOCKED_VOICES` 使用逗号分隔音色 ID。重启服务后清除被屏蔽音色的旧绑定，搜索、ID 绑定、候选选择及合成均拦截；混合模式回到原 MIMO/Edge 规则，不屏蔽观众本人。
