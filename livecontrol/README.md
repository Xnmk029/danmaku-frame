# 直播控制台 (LiveControl) v2

统一管理直播相关服务的桌面面板。**UI 基于 Google 官方 Material Design 3 组件库
（`@material/web` Web Components）**，主题为 M3 Express（M3E）风格的 Indigo 调色板。

## 功能

- **4 服务管理**：弹幕姬 / 鸽子动画 / 面捕追踪 / 虚拟形象
  - 一键 启动 / 停止 / 重启（`md-text-button` + `md-filled-tonal-button`）
  - 状态灯实时显示（`md-list-item` 列表形态，行间留白分隔）
  - 底部日志面板实时尾随 stdout
- **一键开播 / 一键下播**：按依赖顺序联动（面捕 → 虚拟形象 → 弹幕姬 → 鸽子动画），逐步等待就绪
- **系统托盘**：关闭窗口 = 隐藏到托盘；托盘菜单快速启停各服务
- **M3E 主题**：深/浅双主题（`md-icon-button` 一键切换），组件级 token 覆盖
- **待机页倒计时快速调整**：快捷时长（30s~30min）+ 精确秒数输入（10~3600 自动钳制）+ 倒计时/时钟模式切换，实时生成 standby URL，一键复制 / 浏览器预览
- **开机自启**（`md-switch`，Electron `setLoginItemSettings`）

## 技术栈

| 层 | 技术 |
| --- | --- |
| UI | Google `@material/web` 2.5（MD3 Web Components：md-filled-button / md-filled-tonal-button / md-text-button / md-icon-button / md-list / md-switch / md-icon）+ Material Symbols 图标 |
| 主题 | M3 Express Indigo 调色板（CSS 变量 `--md-sys-color-*`，深/浅双套） |
| 壳 | Electron 33（主进程：托盘/进程管理/健康轮询/联动/配置） |
| 渲染 | renderer 经 **esbuild 打包为单文件**（file:// 下 ES module 无法多文件 import） |

## 运行

```bat
:: 首次：安装依赖（含 Electron 二进制）
npm install

:: 打包 renderer（改过 renderer/*.js 后需执行）
npm run build

:: 启动
npm start
```

无安装包版直接：`node_modules\electron\dist\electron.exe .`

### 自检模式

```bat
npm run selftest
```

无头验证：启动弹幕姬 → 等待 /healthz → 停止 → 结果写入 `selftest.log`。

## 服务定义

见 `services.js` 中 `SERVICE_DEFS`：命令/参数/工作目录/健康检查（http|tcp|process）/
启动前清理端口/联动顺序（chain）。扩展新服务在此追加一项即可。

## 项目结构

```text
LiveControl/
├── main.js              # Electron 主进程：窗口/托盘/IPC/自启/自检
├── preload.js           # contextBridge 安全桥
├── services.js          # 服务定义 + ServiceRuntime（spawn/日志/端口清理）
├── health.js            # 3s 轮询健康检查
├── orchestrator.js      # 一键开播/下播联动
├── config.js            # %APPDATA%\LiveControl\config.json
├── renderer/
│   ├── index.html       # MD3 组件页面
│   ├── style.css        # M3E token（深/浅）+ 布局
│   ├── renderer.js      # UI 逻辑（打包入口）
│   └── bundle.js        # esbuild 产物（勿手改）
└── LiveControl.App/     # v1 WPF 版（遗留，不再维护）
```

## 面向 Agent 的文件关联提示

> 给 AI 编码代理的导航地图：动哪个功能 → 改哪些文件 → 遵守什么约束。

### 文件职责图（一次改动会横跨的链路）

```text
[UI 控件事件]        [IPC 往返]            [能力实现]
renderer/renderer.js ──invoke('svc:xxx')──▶ preload.js ──ipcMain──▶ main.js ──▶ services.js / health.js / orchestrator.js / config.js
        │                                                                           ▲
        └─────────────── 'onSvcState' ◀── preload 事件桥 ◀── webContents.send ──────┘
```

- **`renderer/renderer.js`**：全部 UI 逻辑（按钮/开关/列表/日志渲染、与主进程的 IPC 调用）。**改这里后必须 `npm run build`**（esbuild 打包为 `renderer/bundle.js`，bundle 是产物，禁止手改；index.html 只引用 bundle）。
- **`renderer/style.css`**：M3E token 与布局。深/浅主题由 `dark` class 切换，token 只改 CSS 变量（`--md-sys-color-*`），不直接写死组件颜色。
- **`preload.js`**：contextBridge 白名单桥。新增 IPC 通道时必须同步在这里暴露，否则渲染进程拿不到。
- **`main.js`**：窗口/托盘/开机自启/自检/`--selftest` 入口，以及所有 `ipcMain.handle`/`ipcMain.on` 的真实实现。
- **`services.js`**：`SERVICE_DEFS`（服务清单）+ `ServiceRuntime`（spawn/stdout 日志/端口清理/停止）。
  - 增删服务：只改 `SERVICE_DEFS` 数组项（`id/name/desc/icon/file/args/cwd/health/url/killPorts/readyTimeout/chain` 全量字段）。
  - `PRODUCT_ROOT = 'G:/产品'`、`OBS_ROOT`、`VUP_ROOT` 是硬编码绝对路径，新服务复用。
- **`health.js`**：3s 轮询，`health:'http'` 服务请求 `url`（弹幕姬为 `http://127.0.0.1:7788/healthz`），`health:'process'` 查进程存活。
- **`orchestrator.js`**：一键开播/下播按 `chain` 数值升序联动的编排逻辑。
- **`config.js`**：`%APPDATA%\LiveControl\config.json` 读写（开机自启等设置持久化）。

### 与其他项目的关联（关键）

- **弹幕姬 = `G:\产品\OBS\danmaku-frame`**（服务端，端口 7788/7789），LiveControl 只负责启停/健康/日志，**不内嵌其业务代码**。弹幕朗读等业务能力全部走其 HTTP API 对接，新增面板只调 API、不读后端实现。
- **弹幕朗读（Edge TTS）对接 API**（服务端已实现，见 danmaku-frame README「面向 Agent 的提示」）：

  | 端点 | 用途 |
  | --- | --- |
  | `GET /api/tts/state` | 朗读开关/正在播报/队列/音色·语速·音调·音量设置 |
  | `POST /api/tts/enabled` `{enabled}` | 开关（持久化） |
  | `POST /api/tts/settings` `{voice,rate,pitch,playerVolume}` | 音色/语速(`±N%`)/音调(`±NHz`)/音量(0-100) 热更新 |
  | `POST /api/tts/test` `{text?}` | 试听合成播放（不受开关影响） |
  | `POST /api/tts/skip` | 跳过当前朗读 |
  | `POST /api/auto-restart` `{enabled}` | 弹幕姬崩溃自动重启开关 |

  对接时注意：以上端点非本机回环访问需要 `WS_AUTH_TOKEN`（与弹幕姬 `.env` 一致）；Electron 内 `fetch('http://127.0.0.1:7788/...')` 即回环。

- **VUP 侧**（面捕追踪/虚拟形象）：`G:\产品\vup\OpenSeeFace`、`G:\产品\vup\Live2DPlayer`，均为外部可执行程序，LiveControl 仅 spawn。

### 必须遵守的约束

1. `renderer/bundle.js` 是构建产物，任何改动一律改 `renderer/renderer.js` 后 `npm run build`；提交时不提交 bundle 差异以外的意外改动。
2. 新增 IPC 通道三处同步：`renderer/renderer.js`（invoke 调用）→ `preload.js`（暴露）→ `main.js`（实现）。
3. `LiveControl.App/` 是 **v1 WPF 遗留版本，不再维护**，不要改它。
4. 服务路径含中文与绝对盘符，测试脚本/自检沿用 `PRODUCT_ROOT` 常量而非相对路径假设。
5. `npm run selftest` 会真实启动/停止弹幕姬，跑之前确认没有正在直播。

## 调试

- `LC_DUMP_CSS=1 electron .`：窗口加载后导出组件计算样式到 `css-dump.json` 后退出
- 托盘/窗口逻辑在 `main.js`；UI 状态推送走 IPC（`svc:state` / `svc:log` / `stream:step`）

## 对比度说明（M3 规范）

- 一键开播：Primary 底(#BFC2FF) + On-Primary 深字(#1A1B2C)，深色模式高对比
- 一键下播：Error-Container 底(#93000A) + On-Error-Container 字(#FFDAD6)
- 状态文字统一 On-Surface-Variant；行分隔留白而非描边
- 组件按钮间距由 MD3 组件内置（8dp gap + 24dp 内边距，内容严格居中）
