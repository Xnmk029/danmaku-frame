# LiveControl 直播控制台

`LiveControl` 是 [Danmaku Frame](../README.md) 仓库内的 Windows Electron 控制台。它管理弹幕姬、鸽子动画、鲸鱼 RGB、面捕与虚拟形象等本地服务，并通过弹幕姬 HTTP/WS 接口显示直播互动和朗读状态。

## 运行

先在仓库根目录安装并启动弹幕姬，再在 `livecontrol/` 中运行：

```powershell
npm ci
npm run build
npm start
```

`npm run build` 将 `renderer/renderer.js` 和 `renderer/float.js` 分别打包为 `bundle.js` 与 `float-bundle.js`。这两个文件是本地构建产物，不纳入 Git；修改渲染代码后需要重新构建。`npm run dist` 可生成 Windows 安装包或便携版，输出目录为 `dist-v2/`。

当前 `services.js` 使用 `G:/产品/OBS` 和 `G:/产品/vup` 等本机路径。迁移目录或电脑时，先调整这些路径及相关服务可执行文件位置。

## 功能

- **服务控制**：启动、停止和查看弹幕姬、鸽子动画、鲸鱼 RGB、面捕、虚拟形象的状态与日志；一键开播/下播按服务依赖顺序执行。
- **弹幕朗读**：选择 Edge、MiMo、混合或 Fish Audio；调整音色、语速和播放音量，试听或跳过；管理 MiMo 音色设计注册表。
- **直播互动**：显示弹幕、礼物、醒目留言、上舰和进场，附带人气/看过/点赞数据；登录后可发送弹幕。互动流可弹出为置顶悬浮窗。
- **直播信息**：读取和编辑标题、公告、分区与封面，管理 B 站开播状态并显示推流参数。
- **直播辅助**：设置待机页倒计时、OBS 场景、开机自启、系统托盘和深浅主题。

弹幕姬默认提供 `http://127.0.0.1:7788` 与 `ws://127.0.0.1:7789`。B 站扫码登录入口是 `http://127.0.0.1:7788/public/bili-auth/`。Fish Audio 和 MiMo 的 API Key 只放在仓库上一级的 `OBS/.env`，不填入控制台页面。

## 代码与状态

| 文件 | 职责 |
| --- | --- |
| `services.js` | 服务路径、启动命令、健康检查与联动顺序 |
| `main.js` | Electron 窗口、托盘、进程与 IPC |
| `preload.js` | 向渲染进程暴露受限 IPC 接口 |
| `config.js` | 持久化控制台设置 |
| `renderer/renderer.js` | 主窗口交互与朗读面板 |
| `renderer/interaction.js` | 互动流与发送弹幕；主窗和悬浮窗共用 |
| `renderer/liveinfo.js` | 直播信息和开播操作 |
| `renderer/float.html`、`float.js` | 互动悬浮窗 |
| `renderer/style.css` | 主题与布局 |

控制台设置保存在 `%APPDATA%\LiveControl\config.json`；弹幕姬的登录、点歌与音色绑定在仓库 `data/` 中。两处运行状态均不属于 Git 源码。

## 接口与排障

控制台主要读取 `GET /healthz`、`GET /api/tts/state`、`GET /api/interaction/state` 和 `GET /api/live/info`；写操作通过相应的 `POST /api/tts/*`、`/api/danmaku/send`、`/api/live/*` 接口完成。互动事件由 WebSocket 实时推送。

- 页面空白或悬浮窗无法加载：在本目录运行 `npm run build`，确认两个 bundle 文件已生成。
- 控制台显示弹幕姬离线：先检查 `http://127.0.0.1:7788/healthz`，再查看服务日志。
- Fish Audio 试听报错：在弹幕姬 `GET /api/tts/state` 查看 `lastError`，核对 API Key 和音色 ID；音色 ID 格式正确仍可能已被 Fish 下架或无权访问。
- `npm run selftest` 会真实启动、检查并停止弹幕姬；直播期间不要运行。

完整的服务配置与观众弹幕指令见 [仓库 README](../README.md) 和 [`.env.example`](../.env.example)。
