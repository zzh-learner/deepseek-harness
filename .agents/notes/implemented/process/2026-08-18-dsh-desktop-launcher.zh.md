# Agent Note: DSH 桌面启动器 exe

Status: implemented

[English](2026-08-18-dsh-desktop-launcher.md) | 中文

## Problem

启动 Web UI 依赖双击 start-dsh-web.cmd：它打开一个专用 pwsh 窗口、启动 Hindsight daemon、等待端口就绪后退出。服务器的生命周期被绑在那个窗口上——关窗即中断会话，且没有任何停止、重启或查看状态的入口，每次操作都要手动找窗口或杀 PID。daemon 则相反：只有这个 cmd 会启动它，没有任何东西会停止它。

## Decision

在 pnpm workspace 之外新增 [launcher/](../../../../launcher/) 目录，放一个原生 Windows 托盘 exe：C# WinForms（`net9.0-windows`），发布为单文件、依赖框架的 exe（`launcher/build.ps1` → `launcher/dist/DshLauncher.exe`，约 230 KB）。托盘程序负责启动、停止、重启两个组件，用图标和状态面板反映状态，尾随 `~/.dsh/launcher/` 下三个由启动器持有的日志，注册 HKCU Run 开机自启，并拒绝第二个实例。

组件发现基于端口而非 spawn：通过 `GetExtendedTcpTable` 找监听者，因此启动器同样能管理不是它拉起的服务器，包括旧 cmd 留下的窗口。停止时用 `taskkill /T /F` 杀掉组件流水线的最顶层祖先——web 是 node/cmd（pnpm shim 链），daemon 是 uv/uvx/python——宿主 shell 永远不会被杀；cmd 祖先只有在其父进程是 node 时才算链内（即 pnpm.CMD shim 模式），交互式 shell 天然被排除。退出启动器不会停服务，Stop 是唯一的显式停机路径。无界面动词（`--status/--start/--stop/--restart/--open/--probe`）把同样的操作暴露给脚本，并返回可分支的退出码。

停止链路由 [launcher/tests/stop-cycle.test.ps1](../../../../launcher/tests/stop-cycle.test.ps1) 验证：在一次性端口上构造 node → cmd shim → node 模拟链，用 exe 旁的配置文件重定向组件端口，断言端口释放、链内进程消失、宿主 shell 存活、二次停止幂等、`--status` 退出码正确。

## Alternatives considered

**继续扩展 start-dsh-web.cmd。** 批处理无法常驻托盘、显示状态或持有日志，而且从 batch 里做可靠的进程树清理意味着继续堆 PowerShell 单行脚本，cmd 里已经难以阅读。

**Electron 或基于 Web 的托盘。** 与仓库的 TypeScript 技术栈一致，但为四个菜单动作付出约 200 MB 和捆绑 Chromium 的代价；机器上已装 .NET 桌面运行时，整个工具只是一个很小的 exe。

**基于 spawn 的进程所有权（跟踪子进程句柄）。** 对自己拉起的服务器清理语义更干净，但无法停止由 cmd、终端或上一个启动器实例启动的服务器；基于端口的发现统一覆盖所有这些情况。

## Consequences

设计上仅支持 Windows；其他平台继续用 cmd。exe 依赖 .NET 9 桌面运行时（本机已装；`%LOCALAPPDATA%\Microsoft\dotnet` 下的用户级 SDK 即可重建）。仓库发现依次按「从 exe 向上、从工作目录向上、上次记忆的仓库」解析（`~/.dsh/launcher/repo-path.txt`，每次仓库内运行和构建的 `--status` 冒烟步骤都会刷新），复制到检出之外的 exe 仍能找到仓库；`dsh-launcher.json` 可为非标准布局或多个检出固定仓库路径和端口（缓存以最后使用的检出为准）。构建产物不入库（`launcher/{bin,obj,dist}/` 进 .gitignore）；源码、图标生成器、构建脚本、测试和 README 均入库。GUI 子系统的退出码和输出只有通过管道调用才能到达 PowerShell，测试脚本里已明确记录——构建的冒烟步骤因此用 `Tee-Object` 管道，不用赋值。
