@echo off
chcp 65001 >nul
title Danmaku-Frame Live Relay Server (Supervised)

echo ====================================================
echo 🚀 正在启动 Danmaku-Frame 弹幕姬（崩溃自动重启守护模式）...
echo ====================================================

:: 清理残留的 danmaku-frame Node 进程（旧实例/旧守护）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'danmaku-frame' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 自动清理残留 7788 和 7789 占用
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:":7788 " ^| findstr "LISTENING"') do (
    echo [SYS] 清理端口 7788 旧进程 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:":7789 " ^| findstr "LISTENING"') do (
    echo [SYS] 清理端口 7789 旧进程 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo ----------------------------------------------------
echo 📌 16:9 主弹幕边框地址: http://localhost:7788/index.html
echo 🛸 黑客帝国"内部消息"顶层弹幕 (UIDemo): http://localhost:7788/matrix-danmaku.html
echo 💻 看门狗监控测试控制台: http://localhost:7788/看门狗.html
echo 💠 调音界面: LiveControl 直播控制台 (G:\产品\LiveControl)
echo 📡 OBS 浏览器源链接: http://localhost:7788/index.html
echo ⚙️ WebSocket 中继端口: ws://localhost:7789
echo 💬 弹幕朗读开关: 弹幕发送「朗读开/朗读关/朗读跳过」（主播/房管）
echo 🛡️ 崩溃自动重启开关: data/auto-restart.json 或 .env AUTO_RESTART_ENABLED
echo ----------------------------------------------------
echo.

cd /d "%~dp0\danmaku-frame"
node supervisor.mjs

pause