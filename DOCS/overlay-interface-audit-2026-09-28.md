# 待机页、直播边框与弹幕姬接口盘点

核对日期：2026-09-28。依据当前源码，未调用控制接口、未启停服务、未切换 OBS 场景；实际运行实例是否与源码一致尚未验证。

## 1. 服务边界

- 页面及 HTTP 服务：默认 `http://127.0.0.1:7788`。
- 实时消息：默认 `ws://127.0.0.1:7789`。
- OBS 控制：LiveControl 主进程直连 OBS WebSocket；待机页通过弹幕姬的 OBS 代理切场景。这是两条独立的连接与配置路径。
- 页面位于 `G:/产品/OBS/danmaku-frame`；本次控制台入口为用户指定的 `G:/产品/LiveControl`。仓库内还有 `danmaku-frame/livecontrol`，需在实施时核对运行版本，不能默认两者同步。
- HTTP 路由共 31 个“方法 + 路径”组合：12 GET、19 POST（不计 HEAD、OPTIONS 和静态页面）。部分端点依赖服务实例注入。
- WS 有 12 个有效 action；另有一个明确拒绝的旧 action `setCookie`。

## 2. 画面入口及参数

### 待机页 `/standby.html`：5 个参数

| 参数 | 当前行为 |
| --- | --- |
| duration | 秒数，默认 120，限制 10–3600 |
| mode | `countdown` 或 `clock`，默认倒计时 |
| room | 直播间；留空订阅服务端默认房间 |
| bgm | 页面音频资源地址；留空不播放页面 BGM |
| obsScene | 结束后目标场景；留空时服务端尝试默认场景 |

页面订阅 `subscribe` 和 `ncm.subscribe`；消费 `danmaku`、`status`、`ncm.playback`、`ncm.offline`。断线 3 秒后重连。

倒计时归零调用 `POST /api/obs/switch-scene`，请求 `{scene}`。页面自身保存计时状态，没有服务端共享计时状态、暂停/继续/重置接口。每个页面实例分别计时，刷新会重新开始。

当前没有预览模式：普通浏览器预览也会发送切场景请求。仅把 `obsScene` 留空不能禁用联动，因为服务端可能配置默认场景。

### 直播边框 `/` 或 `/index.html`：14 个参数

| 参数 | 当前行为 |
| --- | --- |
| room | 直播间输入值 |
| theme | `light` / `dark`；未指定时有本地主题记忆 |
| color | 强调色；URL 中 `#` 必须编码成 `%23` |
| rgb | `true` 开启 RGB |
| fx | `none` / `flow` / `pulse`，初始化默认 `flow` |
| width | 弹幕区域宽度，px；不是 OBS 画布宽度 |
| fontsize | 弹幕字号，px |
| font | 字体族 |
| current | 当前内容文案 |
| next | 接下来内容文案 |
| model | 模型文案 |
| hideticker | `true` 隐藏底部信息栏 |
| hidebar | `true` 隐藏操作栏 |
| autoconnect | `false` 禁止自动连接 |

边框消费 `status`、`popularity`、`voice.selection`、`ncm.playback`、`ncm.offline`，以及带 text 的 `danmaku/gift/sc`。当前不把 `guard/entry/watched/like` 放入聊天列表。

歌曲封面按消息数据使用远程 URL 或 `GET /api/ncm/cover?id=...`。音色候选卡复用 `/public/voice-selection/card.js` 与 `card.css`。

注意：边框 WS onopen 只在 room 非空时发 subscribe，待机页则总会发 subscribe。新客户端应统一显式订阅，即使使用服务端默认房间。

## 3. HTTP 接口清单

除特别说明外，POST 使用 JSON，请求 Content-Type 为 application/json。

### 画面与互动相关：5 个

| 方法 | 路径 | 请求/返回重点 |
| --- | --- | --- |
| GET | /healthz | ok、端口、WS 客户端数、roomId、B站连接/登录状态、朗读/点歌状态 |
| GET | /api/interaction/state | type=interaction.state；connected、roomId、canSend、stats、recent 等；最近最多 200 条互动 |
| POST | /api/danmaku/send | `{text, replyMid?, replyUname?}`；需 B站登录态；发送限制由业务层处理 |
| GET | /api/ncm/state | 播放源诊断及 playback 快照 |
| GET | /api/ncm/cover?id=... | 封面二进制；id 缺失 400，不存在 404 |

### OBS：1 个

| 方法 | 路径 | 请求/返回重点 |
| --- | --- | --- |
| POST | /api/obs/switch-scene | `{scene}`；返回 `{ok:true,scene,skipped?}`；空值回退 OBS_DEFAULT_SCENE |

代理执行 OBS `SetCurrentProgramScene`。同目标场景 5 秒内有去重逻辑；这不是预览隔离。失败返回 502 和 `{ok:false,error}`。

### 朗读与音色：12 个

| 方法 | 路径 | 请求/用途 |
| --- | --- | --- |
| GET | /api/tts/state | enabled、provider、playing、queueCount、settings、lastError、recent 等 |
| GET | /api/tts/diag | 朗读诊断 |
| GET | /api/tts/voice-map | 默认音色及分层映射 |
| GET | /api/tts/voice-designs | 音色注册表快照 |
| POST | /api/tts/enabled | `{enabled}`，持久化 |
| POST | /api/tts/settings | voice、mimoVoice、fishVoice、noPrefixForMedalGuard、rate、pitch、volume、playerVolume、gain；持久化 |
| POST | /api/tts/provider | `{provider}`：edge / mimo / hybrid / fish；可用性由业务层验证 |
| POST | /api/tts/test | `{text?}`，试听 |
| POST | /api/tts/inject | `{uid,user,text,guard,medal}`，注入朗读过滤链；不等于向所有画面广播测试弹幕 |
| POST | /api/tts/skip | `{}`，跳过当前朗读 |
| POST | /api/tts/voice-designs/delete | `{uid}` |
| POST | /api/tts/voice-designs/test | `{uid,text?}` |

### 守护开关：2 个

| 方法 | 路径 | 请求/用途 |
| --- | --- | --- |
| GET | /api/auto-restart | `{enabled}` |
| POST | /api/auto-restart | `{enabled:boolean}`，保存开关 |

### 登录：4 个

| 方法 | 路径 | 请求/用途 |
| --- | --- | --- |
| GET | /api/bili-auth/state | 登录状态与 B站连接状态 |
| POST | /api/bili-auth/qr | 生成二维码 |
| POST | /api/bili-auth/poll | `{id}`，查询扫码状态 |
| POST | /api/bili-auth/check | 检查登录态 |

登录写接口要求本机同源，并带 `X-Bili-Control: 1`。Electron file:// 可读 state；登录操作宜打开 `/public/bili-auth/`。凭证不传入画面。

### 直播信息：7 个

| 方法 | 路径 | 请求/用途 |
| --- | --- | --- |
| GET | /api/live/info | 房间信息 |
| GET | /api/live/areas | 分区树，返回 `{ok:true,list}` |
| POST | /api/live/update | `{title?,areaId?}` |
| POST | /api/live/news | `{content}` |
| POST | /api/live/cover | `{dataUrl}` |
| POST | /api/live/start | `{areaId?}` |
| POST | /api/live/stop | `{}` |

开播/关播是平台直播状态操作，与 OBS 切场景、OBS 开始推流不同。新画面不需要直接调用这些写接口。

## 4. WebSocket 协议

### 客户端 action：12 个有效项

| action | 其他字段 | 用途 |
| --- | --- | --- |
| subscribe | roomId? | 连接/切换服务端共用直播间 |
| unsubscribe | 无 | 取消弹幕订阅计数 |
| ncm.subscribe | 无 | 订阅正在播放信息 |
| ncm.unsubscribe | 无 | 取消歌曲信息订阅 |
| song.get_state | 无 | 点歌快照 |
| song.player_event | event=ended/error | 播放器回报，推进点歌队列 |
| song.admin | command=skip/clear/pause/resume | 点歌管理 |
| tts.get_state | 无 | 朗读快照 |
| tts.set_enabled | enabled | 朗读开关 |
| tts.set_settings | voice/fishVoice/rate/pitch/volume/playerVolume | 朗读设置；字段少于 HTTP 版本 |
| tts.test | text? | 试听 |
| tts.skip | 无 | 跳过 |

旧 `setCookie` 仅返回 COOKIE_INPUT_DISABLED，不是可用接口。

### 服务端事件

- 连接与错误：`status`、`error`。
- 互动：`danmaku`、`gift`、`sc`、`guard`、`entry`、`popularity`、`watched`、`like`。
- 音乐：`ncm.playback`、`ncm.offline`。
- 朗读/音色：`tts.state`、`voice.selection`。
- 点歌：`song.state`、`song.feedback`、`song.queued`、`song.started`、`song.queue_empty`、`song.cancelled`、`song.queue_cleared`、`song.player_command`。

聊天事件包含各自的业务字段；弹幕展示需保留 `user/text/uid/emots/bigEmote`，身份信息及礼物、SC 等字段按事件类型处理，不能假设所有事件都有 text。

`ncm.playback` 使用 `song.name/artists/duration`、`progress`、`playing`、`updatedAt`、`cover` 等；页面按毫秒进度进行本地插值。它是播放信息展示，不等于播放音频。点歌播放器和待机页 bgm 是另外的音频来源。

连接建立时自动下发 song.state，以及可用时的 voice.selection 快照。互动历史需走 HTTP；不应假设 WS 自动补发历史。

### 当前限制

- 一个服务端只有一个 activeRoomId。不同页面订阅不同房间会改变共用连接，不是独立多房间订阅。
- 常规广播发送给所有已连接客户端；subscribed 主要用于连接生命周期，不是严格事件过滤。NCM 才按 ncmSubscribed 定向发送。
- 每客户端每分钟超过 60 条请求返回 RATE_LIMITED；不要逐帧发送控制命令。
- 本机回环免 token；远程控制消息需要 JSON 中的 token。song.get_state、tts.get_state 在鉴权之前处理；不能把 token 理解成所有读事件的访问隔离。
- 当前两个页面硬编码 ws:// 与 7789，未实现可配置 WSS 地址或远程 token 传入。

## 5. LiveControl 已有对接

| preload 方法 | IPC | 当前作用 |
| --- | --- | --- |
| setStandbyDuration(sec) | standby:setDuration | 保存秒数，10–3600 |
| setStandbyMode(mode) | standby:setMode | 保存模式 |
| setStandbyScene(scene) | standby:setScene | 保存结束目标场景；当前 renderer 未发现调用入口 |
| applyStandbyToObs() | standby:applyToObs | 生成待机 URL 并修改 OBS 浏览器源 |
| setObs(obs) | config:setObs | 保存 OBS 连接配置 |
| start/stop/restart(id) | svc:start/stop/restart | 服务生命周期 |

待机 URL 当前只拼接 duration、mode、obsScene，尚未接入 room、bgm。保存配置本身不推送到已经打开的页面。

应用到 OBS 使用 GetInputList / GetInputSettings / SetInputSettings；优先配置的 browserSource，否则按名称含 standby 查找，再按 URL 查找，最后回退第一个浏览器源。该回退应移除，边框与待机源应分别绑定。

更新 URL 依赖浏览器源重载；相同 URL 不应假定一定触发刷新。现有接口不提供明确的“重新开始倒计时”语义。

## 6. 推荐对接方案

### 第一阶段：直接复用现有接口

1. 新边框与待机成品作为同一 HTTP 服务下的新页面/资源接入，保持资源路径可解析。
2. 抽取共用消息适配层：连接 WS，显式发送 subscribe 与 ncm.subscribe，按 type 分发，重连后重新订阅。
3. 对视觉组件提供弹幕、歌曲、连接状态、音色候选等数据；继续使用已有后台朗读和点歌能力。
4. LiveControl 增加边框配置，统一用 URLSearchParams 生成地址；边框/待机分别保存浏览器源绑定。
5. 首轮主题、文案、布局参数通过 URL 初始化；需要生效时明确应用到对应源。
6. 新增预览隔离开关；预览实例不得调用切场景，也不启动额外音频。该开关目前不存在，需要实现。

### 第二阶段：需要直播中无刷新调整时再新增

以下均为建议接口，当前不存在：

- GET/POST `/api/overlay/config`：按页面/配置标识保存主题、文案、布局及目标房间。
- GET `/api/standby/state`：集中提供 phase、截止时间、剩余时间和版本。
- POST `/api/standby/control`：start/pause/resume/reset；明确控制目标实例。
- WS `overlay.config`、`standby.state`：推送配置和计时状态；预览与正式播出分离。
- OBS 源/场景枚举及准确绑定接口：可先放在 LiveControl 主进程，避免页面拿 OBS 密码。

优先修正：预览切场景、浏览器源误选、房间订阅不一致。随后完成视觉复用与配置入口；无刷新控制按实际需求扩展。

## 7. 源码依据

- HTTP：src/transport/http-server.mjs
- WS：src/transport/websocket-gateway.mjs
- 依赖装配/默认场景：src/app.mjs
- OBS 代理：src/obs/obs-proxy.mjs
- 互动快照：src/interaction/interaction-service.mjs
- 事件数据：src/bili/event-normalizer.mjs
- 页面：index.html、standby.html
- 控制台：G:/产品/LiveControl/preload.js、main.js、renderer/renderer.js
