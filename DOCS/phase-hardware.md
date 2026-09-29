# 边框硬件状态

现有页面是 Canvas + 原生 JavaScript，由 Node.js 中继服务提供；浏览器没有读取整机 CPU、GPU 利用率和硬件温度的接口。Node.js 可读取 CPU 时间与内存，但原有服务没有 Windows 温度 / GPU 传感器适配。因此新增独立 Python 标准库组件，避免重启直播中的中继。

## 运行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-hardware.ps1
```

首次启动只需要 Windows 和 Python 3，无 pip 依赖。默认复用既有心率采集 Python 路径，可用 `PHASE_TELEMETRY_PYTHON` 指定。手动前台运行：`python scripts/phase-hardware.py`；一次检查：`python scripts/phase-hardware.py --once`。`--once` 只检查 Win32 / NVML，持续服务才运行可选温度查询。

`node supervisor.mjs` 启动弹幕服务时会检查并启动硬件组件，复用已经运行的 LiveControl 采集进程；可通过 `PHASE_HARDWARE_AUTOSTART=false` 关闭此行为。组件运行在独立进程中。电脑重启后需要随弹幕服务重新启动，不依赖上一会话的临时进程。

真实 LiveControl 工程 `G:/产品/LiveControl/services.js` 已登记「硬件状态」，下次打开控制台即可独立启停，也会加入开播顺序。无需在直播中重启 LiveControl。手动启动的组件可通过控制台之后的启动操作重新托管。

边框前景 / 合成页每 2 秒读取 `http://127.0.0.1:7790/state`。后景不发起采集请求。断开或超过 8 秒未更新时显示 `—`，没有模拟值。修改静态代码后，刷新对应 OBS 浏览器源即可加载；已有页面不会自动热换脚本。推荐下播或切到其他场景后刷新。服务仅绑定回环地址，仅允许本机页面跨域读取，不支持远程浏览器或 file:// 页面。

## 数据含义

| 字段 | 来源与口径 |
| --- | --- |
| CPU % | Windows GetSystemTimes 时间差，总逻辑处理器忙碌时间 / 总时间 |
| RAM % | GlobalMemoryStatusEx，已使用物理内存 / 可用总物理内存；不是提交量或显存 |
| RAM 下方可用 GB | GlobalMemoryStatusEx 的 ullAvailPhys；可供使用的物理内存，GB = 10⁹ 字节，保留一位小数；内存温度不再显示 |
| GPU % / °C | NVIDIA NVML，默认第 0 张 NVIDIA 独显的 GPU 核心利用率与核心温度；可用 `--gpu-index` 切换；不会把核显混入平均值 |
| CPU °C | 优先独立只读桥接缓存（FanControl IPC / CPU 专用监控库），其次 AIDA64 共享内存，最后 LibreHardwareMonitor / OpenHardwareMonitor WMI；优先 CPU Package / Tctl/Tdie，无封装温度时使用最高核心温度 |

CPU 没有通用 Win32 温度接口。本机没有可读取的传感器发布接口时对应值为 `null`，前端显示 `— °C`。如需补全，需要兼容版本的官方 [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) / OpenHardwareMonitor 提供 WMI；仅运行使用该库的 FanControl 不会自动创建 WMI 命名空间。部分传感器需要管理员权限。组件不会自行提权或安装驱动；即使提供程序在运行，无有效读数或硬件不支持时仍显示 `—`。启动兼容提供程序后最多约 30 秒自动接入，之后每 10 秒更新温度；缓存超过 25 秒失效。RAM 栏已改为可用内存 GB，不再显示温度。

采集进程每 2 秒生成一份缓存，所有 OBS 页面共享，读取次数不会增加硬件查询频率。WMI 查询单独线程、8 秒超时，无提供程序时 30 秒重试。NVML 经官方驱动 DLL 直接读取，没有每次启动 nvidia-smi 的开销。

## 复用 FanControl / AIDA64 CPU 温度

独立 C# 只读桥接器优先尝试 FanControl 的 `GetSensorClient()`、`GetAllSensors()`、`ReadSensorValues()`。当前 V281 客户端实际返回传感器 RPC 未实现，因此自动改用 FanControl 自带 `LibreHardwareMonitorLib.dll`，仅开启 `IsCpuEnabled`，读取 CPU Package / 核心温度。管理员身份下已实测取得有效 CPU Package 温度。它不接管 FanControl、不改配置或风扇速度、不安装驱动；只导出 CPU 温度到 `data/hardware/cpu-temperature.json`。普通 Python 读取这份缓存，保留 8 秒失效检查。

构建（本机已有 .NET 10 SDK / runtime，无新增 NuGet 依赖）：

```powershell
dotnet restore scripts/fancontrol-temperature/phase-fancontrol.csproj --configfile scripts/fancontrol-temperature/NuGet.Config
dotnet publish scripts/fancontrol-temperature/phase-fancontrol.csproj --no-restore -c Release -o data/hardware/fancontrol-bridge-v2
```

启动：`powershell -File scripts/start-cpu-temperature.ps1 -Elevated`；这会显示 Windows UAC 提示，由用户确认。只提升独立只读桥接器，OBS / 浏览器 / Python 无需提权。默认 FanControl 路径沿用本机现有目录，也可以传入 `-FanControlDirectory`。组件每 2 秒更新，RPC 超时为 3 秒，失败时清空温度。`-Replace` 仅替换本项目 `data/hardware/` 下的旧版桥接进程。下次登录如未运行，需要重新启动桥接器；没有注册提权计划任务或安装服务。当前实际来源为 `FanControl/LibreHardwareMonitor`，CPU 字段 `temperatureKind=package`。

AIDA64 替代方式：在其「设置 / 硬件监控 / 外部应用程序」启用共享内存，并勾选 CPU Package 温度。Python 自动读取 `AIDA64_SensorValues`（兼容 Global 前缀、旧 ANSI 和新版 UTF-16LE）。AIDA64 需保持运行；本次排查时没有运行 AIDA64 实例，因此该来源尚未进行本机真实温度验证。读取仅打开现存共享内存，不修改 AIDA64 设置。格式与 CPU 标识来源：[外部应用程序文档](https://www.aida64.com/user-manual/hardware-monitoring/external-applications)、[传感器 ID 清单](https://www.aida64.com/user-manual/hardware-monitoring/external-applications/complete-sensor-value-list?language_content_entity=en)。

## 布局与验证

A / B 顶部 `x=544, y=31, w=336, h=65`，C 右上 `x=1548, y=31, w=254, h=65`。CPU / RAM / GPU 三列，24px 等宽占用率、12px 温度、1px 负载细线，颜色跟随当前主题。复用 1920×1080 比例缩放，不增加面板背景、阴影或光晕。

```powershell
python -m unittest discover -s tests -p test_phase_hardware.py
node scripts/verify/verify-hardware.cjs
```

数据源参考：[Microsoft GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes)、[GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)、[NVIDIA NVML](https://developer.nvidia.com/management-library-nvml)。
