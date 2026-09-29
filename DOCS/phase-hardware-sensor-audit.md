# 本机温度接入排查 · 2026-09-30

- CPU：Intel Core Ultra 7 270K Plus；主板：Gigabyte Z890M AORUS ELITE WIFI7 ICE。
- RAM：Colorful BA32G6000D5ZP40B，DDR5 32GB。用户确认无内存温度；边框内存栏已改为可用物理内存 GB。
- Python 硬件进程与 NVML 正常；CPU / RAM 占用率正常。
- `root/LibreHardwareMonitor` 与 `root/OpenHardwareMonitor` 查询都返回「无效命名空间」，不是查询超时。因此现有 WMI 温度适配器没有数据源。
- FanControl V281 正在运行，所带 LibreHardwareMonitorLib 为 0.9.6；CPU 监控开启，内存监控关闭。FanControl 库的存在不等于向其他应用发布 WMI 数据。
- PawnIO 驱动已经安装并运行。没有必要重新安装驱动。
- 当前采集进程没有管理员权限。用现有监控库做只读 CPU 诊断，能识别 CPU 以及 CPU Package、P/E-Core 温度传感器，但所有温度读数均为 null。尚未证明提升权限后必然可读；权限或驱动访问问题需要在有权限的传感器提供进程中验证。

结论：CPU 温度目前有两个缺口：没有可供 Python 读取的 WMI 发布接口，以及普通权限直接读取暂时取不到有效数值。占用率正常，并不能证明低层温度读取已接通。下一步应复用 FanControl 的只读数据发布，或使用有权限的监控程序向本机发布温度；不应把主板温度、距 TjMax 的差值当作 CPU 温度。

## 后续接口验证

用户确认 FanControl 和 AIDA64 均可读取 CPU 温度。已发现 FanControl 的 `SensorsRPC` 接口并实际发起只读请求；普通权限返回 `UnauthorizedAccessException`（命名管道拒绝访问）。因此温度传感器存在，问题是外部读取权限 / 发布接口，而非硬件缺少温度传感器。

进一步验证：用户授权管理员身份运行桥接器后，FanControl 客户端返回 RPC `Unimplemented`，并未实际发布传感器方法。已改为同一只读组件复用它自带的 LibreHardwareMonitorLib 0.9.6，仅启用 CPU 监控，在管理员身份下成功读取 CPU Package 温度（两次实测 69°C / 74°C）。没有修改 FanControl 管道 ACL、风扇或配置。

当前 Python / 边框已接通桥接缓存，`/state` 的 `cpu.temperatureSource=FanControl/LibreHardwareMonitor`、`temperatureKind=package`、`temperatureStatus=connected`。AIDA64 共享内存仅作为备选，当前没有运行实例，不能声明该来源已实测接通。

官方库使用示例与权限说明：[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)。本次只读诊断源码位于 `tmp/archive/scratch/sensor-probe`，结果位于 `tmp/archive/scratch/cpu-sensor-probe.json`。
