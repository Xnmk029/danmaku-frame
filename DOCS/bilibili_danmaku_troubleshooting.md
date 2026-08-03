# B站直播弹幕插件 (danmaku-frame) 排查与修复处理链路文档

## 📌 1. 项目背景与需求概述

本项目为一个具备 **赛博朋克 16:9 边框** 风格的 B站直播弹幕 H5 插件，支持 OBS 浏览器源嵌入及普通浏览器独立使用。
在前期构建完成后，先后遇到了弹幕接收断连、弹幕用户名全打码为 `某*****` 以及名称显示“时好时坏/闪烁打码”等问题。本文档详细记录该问题的全链路排查、根因定位及最终解决方案。

---

## 🔍 2. 核心问题与根因分析 (Root Cause Analysis)

### 故障现象一：页面能建立 WebSocket 连接但收不到弹幕
- **排查链路**：通过拦截日志分析发现目标直播间 `30068664` 当时处于 `live_status: 0`（未开播）状态，服务端仅推送人气包不推送弹幕消息。
- **根因**：没有开播状态的直观提示，且默认测试房间无实时观众发言。

### 故障现象二：弹幕用户名被强制打码为 `某*****`
- **排查链路**：
  1. 对比开源弹幕工具（`danmuji.org` / `copyliu/bililive_dm`）。
  2. B站自 2023 年起针对未登录/游客身份的 Websocket 连接实施了强打码风控，`DANMU_MSG` 中的 `info[2][1]` 昵称会被格式化为 `某*****`。
  3. 初步注入了 `buvid3` 和 `DedeUserID`，但发现名字依然在短暂宽限期后退化为星号。
- **根因**：**完全缺少 `SESSDATA` 核心鉴权 Cookie**。`SESSDATA` 是 B站最核心的登录凭证且带有 `HttpOnly` 保护标志，前端 JS 无法自动抓取，必须由登录用户显式提供。

### 故障现象三：用户名显示“时好时坏”（一会儿正常一会儿变星号）
- **排查链路**：
  1. 检查后台 WebSocket 日志与连接生命周期。
  2. 之前为防风控添加了 `90s 强制重连定时器`（`antiDegradeTimer`）。
- **根因**：在没有真实 `SESSDATA` 的情况下，90 秒的强制重连会在每次重连鉴权阶段产生短暂的“游客身份窗口期”，导致弹幕名字在“正常缓存”与“游客打码”之间交替闪烁，造成“时好时坏”的不稳定表现。

---

## 🛠️ 3. 技术解决方案与实施链路

### 步骤 1：接入 `bililive_dm` 同款 API 架构与双层鉴权
在 `server.mjs` 中将旧版 `room/v1/Danmu/getConf` 升级为带 Cookie 的 `xlive/web-room/v1/index/getDanmuInfo?id=...&type=0` API，并保持旧 API 自动降级逻辑：

```javascript
// 带 SESSDATA 的 getDanmuInfo 请求
const r2 = await fetch(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${realRoomId}&type=0`, {
  headers: {
    'Cookie': BILI_COOKIE,
    'User-Agent': 'Mozilla/5.0 ...',
    'Referer': `https://live.bilibili.com/${realRoomId}`
  }
});
```

### 步骤 2：注入完整真实 Cookie 与用户真实 UID
在 `BILI_COOKIE` 中显式填入由用户从已登录浏览器控制台复制的 `SESSDATA`：

```javascript
const BILI_COOKIE = 'SESSDATA=...; buvid3=...; bili_jct=...; DedeUserID=<uid>; DedeUserID__ckMd5=...';
const BILI_UID = 316052822;
```

在建立 WebSocket 鉴权包 (Opcode 7) 时使用 `BILI_UID` 代替之前的 `0` (游客)：

```javascript
const authPayload = JSON.stringify({
  uid: BILI_UID,
  roomid: conf.realRoomId,
  protover: 3,
  platform: 'web',
  type: 2,
  key: conf.token,
  buvid: 'F98F0559-221B-15A7-884D-2FEBEC08B5F025820infoc'
});
```

### 步骤 3：彻底移除引发闪烁的定时重连
删除了 `antiDegradeTimer`（90 秒强制重连）。在拥有合法 `SESSDATA` 后，WebSocket 连接将长效保持最高权限身份，彻底消除了周期性打码闪烁现象。

### 步骤 4：前端 `userCache` 缓存字典 + 后端 `cleanDanmakuUser` 兜底脱敏
1. **服务端脱敏 (`cleanDanmakuUser`)**：若遭遇个别风控包，将 `某*****` 结合勋章和 UID 智能净化为 `[勋章]·粉丝` 或 `用户_xxxx`。
2. **前端记忆还原 (`userCache`)**：在 `index.html` 中维护粉丝勋章到真实昵称的缓存映射，即使后续收到风控包也能利用历史记录自动恢复用户真实名字。

---

## 🎨 4. UI/UX 默认配置对齐

同时将 UI 默认设置调整为用户指定的极客荧光绿风格：
- 主主题色/发光阴影: `#76ff03` (荧光绿)
- 灯效模式: `FX: FLOW` (动态全色系流光)
- 面板宽度: `240px` (精简窄版)
- 弹幕字号: `22px` (大字号)
- 字体系列: `Mono` (等宽字体)

---

## 📋 5. 验证结果

1. **常驻服务验证**：
   - HTTP 端口: `7788`
   - WebSocket 中继端口: `7789`
   - 日志显示 `[RelayWS] B站 直播间 [30068664] 鉴权成功！状态: LIVE`
2. **打码消除验证**：
   - 弹幕发言者完整显示真实 B站 账号昵称（如 `小小小名不是小明`），持续长效无星号打码。
3. **远程同步**：
   - 代码及文档已全部 Push 至 GitHub 仓库: `https://github.com/Xnmk029/danmaku-frame.git`

---
*文档生成时间: 2026-07-23*
