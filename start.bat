@echo off
chcp 65001 >nul
title Danmaku-Frame Live Relay Server

echo ====================================================
echo 🚀 正在启动 Danmaku-Frame H5 直播边框弹幕中继服务...
echo ====================================================

:: 检查并自动清理残留端口 (7788 / 7789)
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
echo 💻 看门狗监控测试控制台: http://localhost:7788/看门狗.html
echo 📡 OBS 浏览器源链接: http://localhost:7788/index.html
echo ⚙️ WebSocket 中继端口: ws://localhost:7789
echo ----------------------------------------------------
echo 提示: 按 Ctrl + C 可随时停止服务
echo ====================================================
echo.

cd /d "%~dp0"
node server.mjs

pause
