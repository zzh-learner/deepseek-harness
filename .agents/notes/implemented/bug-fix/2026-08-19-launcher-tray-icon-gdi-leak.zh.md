# Agent Note: DshLauncher 托盘图标仅在状态变化时重绘并持有 HICON 所有权

Status: implemented

[English](2026-08-19-launcher-tray-icon-gdi-leak.md) | 中文

## Problem

托盘图标在约 2 小时 46 分的运行后消失。五条 Windows 错误报告崩溃记录共享同一存活时长——进程启动到 `.NET Runtime` 事件 1026 均为 165–166 分钟——且堆栈相同：`Image.FromHbitmap` 位于 `System.Windows.Forms.ThreadExceptionDialog..ctor` 之内，由定时器窗口回调触发。两个代码事实造就了它。`TrayApp.Poll` 每 3 秒一次轮询，无论状态是否变化都重画状态图标；`DrawIcon` 返回 `Icon.FromHandle(bitmap.GetHicon())`：该包装对象不拥有 HICON，其 `Dispose` 永不释放句柄，而 `NativeMethods.SafeDestroyIcon` 包装当时没有任何调用点。每轮泄漏 1 个 USER 与 3 个 GDI 对象；每进程 10,000 的 GDI 配额在 166 分钟时耗尽，下一次绘制在 GDI+ 中抛出 `ExternalException`，而 WinForms 默认错误对话框自身还要分配 GDI 图标，于是异常处理器内再次抛出，进程死亡。`Program.RunTray` 未注册 `Application.ThreadException` 或 `AppDomain.CurrentDomain.UnhandledException` 处理器，对话框成为唯一的失败路径。

## Decision

图标仅在轮询状态与上一次不同时重绘；首次轮询必定绘制（`_lastStatus` 初始为 null）。菜单可用性、状态面板与 web 宕机气泡仍每轮执行——只有 GDI 绘制这一步被门控。`DrawIcon` 改为先克隆再释放：`var handle = bitmap.GetHicon(); try { return (Icon)Icon.FromHandle(handle).Clone(); } finally { NativeMethods.SafeDestroyIcon(handle); }`——克隆体拥有私有 HICON，因此 `TrayApp.Dispose` 释放 `_currentIcon` 时释放的是真实句柄。`RunTray` 把 UI 线程异常经 `Application.ThreadException`、其余异常经 `AppDomain.CurrentDomain.UnhandledException` 通过 `ProcessService.Log` 写入 `launcher.log`，取代对话框作为失败路径。

## Evidence

一个 1000 次迭代的测量程序用 `GetGuiResources` 环绕绘制采样：旧模式每迭代增长 USER +1、GDI +3（200 次切片：USER 4→204，GDI 16→613）；克隆加销毁模式 USER 持平，GDI 停留在 GDI+ 有界的内部缓存内（1000 次：USER 4→4，GDI 5→16）。线上部署的二进制展示了同样的签名——运行 805 秒时 USER 284/GDI 825，每 15 秒 +5 USER/+15 GDI——与按每 3 秒 3 个 GDI 对 10,000 配额推得的 165–166 分钟崩溃时长吻合。修复后重启的实例在连续 15 轮轮询中保持 USER 16/GDI 21 持平，两个服务均在线。

## Alternatives considered

**正确释放句柄但保持每轮绘制。** 足以止漏，但为不可见的效果每分钟 20 次分配 GDI 对象，且未来任何同形回归都会以全速回归。按状态变化门控后每天至多几次绘制，并让"首查必画"的保证显式化。

**按状态组合缓存一个 `Icon`。** 四个缓存图标同样能有界分配，但在绘制已被门控后只增加失效面而无收益；逐次克隆更简单。

**在 `Poll` 外层 try/catch。** 吞掉 GDI 耗尽只会掩盖原因，留下一个顶着空图标的失明进程；全局处理器改为记录失败，所有权修复则消除原因。

**看门狗重启启动器。** 掩盖确定性缺陷并增加活动部件；这次崩溃没有任何非确定性成分。

## Consequences

166 分钟一次的崩溃节奏消失了；`launcher.log` 此后承载任何未处理异常，而不只依赖事件日志，WinForms 错误对话框——它自身就是 GDI 消费者——不再位于 GDI 耗尽进程的失败路径上。代价：变陈旧的图标（例如 DPI 变化后）现在只在下一次状态变化或重启时刷新；UI 线程异常会让进程无感知地继续存活，因此托盘行为异常时应查看 `launcher.log`。已知覆盖缺口：没有自动化测试观测 GDI 增长——那需要交互式窗口站；上述测量数字即为存档证据，`stop-cycle.test.ps1` 覆盖未受影响的进程生命周期路径。
