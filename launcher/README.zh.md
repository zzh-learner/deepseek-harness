# DSH Launcher

[English](README.md) | 中文

DeepSeek Harness Web UI 的 Windows 桌面启动器（托盘 exe）。它用常驻托盘程序取代双击 start-dsh-web.cmd：一并启动、停止、重启 `pnpm dsh web` 与 Hindsight 记忆 daemon，显示实时状态，并尾随服务日志。

不属于 pnpm workspace：纯 C# WinForms（`net9.0-windows`），用 .NET 9 SDK 构建。

## 管理的组件

| 组件 | 地址 | 启动方式 |
|---|---|---|
| dsh web | `http://127.0.0.1:3080` | `pwsh -NoLogo -Command "Set-Location -LiteralPath <repo>; pnpm dsh web"`（加载 profile，fnm/pnpm 才能解析） |
| Hindsight daemon | `127.0.0.1:9077` | `node ~/.hindsight/coding-agents/dist/daemon-start.js --harness dsh`（幂等 bootstrap） |

状态通过监听端口跟踪（IPv4 `GetExtendedTcpTable`），因此启动器也能管理不是它拉起的服务器——包括 start-dsh-web.cmd 留下的窗口。

**停止语义：** Stop 会杀掉两个组件。kill root 是组件流水线的最顶层祖先（web 是 node/cmd，daemon 是 uv/uvx/python），用 `taskkill /T /F` 移除；宿主 shell（pwsh、Windows Terminal、交互式 cmd）永远不在链内，得以存活。仍在启动中的链——例如 daemon 的 uvx 解析正在下载依赖、尚无监听端口——通过 pid 文件定位（日志目录下的 `web.pid`、`daemon.pid`，spawn 时写入，杀前按进程名与启动时间校验，防 PID 复用），因此 Stop/Restart 不会漏掉启动中的链；新的 Start 也会先清掉记忆中的旧链，而不是与之并发竞争。

**daemon 启动预算：** daemon 等待默认 300 秒，并作为 `HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT`（embed CLI 自身的预算，默认 180 秒）与 `UV_LOCK_TIMEOUT` 传给 bootstrap——冷启动解析新的 `claude-agent-sdk`/`botocore` wheel（约 100 MB）时，由 `dsh-launcher.json` 的 `daemonStartTimeoutSeconds` 一个数字统一管辖，而不是三层独立超时在下载中途各自放弃。

**退出语义：** 退出启动器（Exit 菜单）不停止服务；Stop 是唯一的停止路径。

## 托盘 UI

- 托盘图标：双绿为全部在线，部分在线为黄，全部停止为红；双击打开状态面板。
- 右键菜单：Open UI、Start、Stop、Restart、View logs、Start with Windows（HKCU Run 键）、Exit。
- 状态面板：各组件状态、PID、web 运行时长、仓库路径、操作按钮、自动打开浏览器开关。
- 日志查看器尾随 `~/.dsh/launcher/dsh-web.log`、`daemon.log` 与 `launcher.log`（8 MB 轮转为 `.old`）。
- 单实例：第二次启动会唤起第一个实例的状态面板后退出。

## CLI 动词

无界面动词供脚本与任务计划使用；仅成功时退出码为 0：

```
DshLauncher.exe                # tray app
DshLauncher.exe --status       # print states; exit 0 only when both up
DshLauncher.exe --start [--no-browser]
DshLauncher.exe --stop
DshLauncher.exe --restart [--no-browser]
DshLauncher.exe --open         # just open the browser
DshLauncher.exe --probe 3080   # diagnostic: TCP rows + process chain for a port
```

（注释说明：`--status` 仅在两个组件都在线时退出码为 0；`--probe` 输出某端口的 TCP 行与进程链。）

## 构建

需要 .NET 9 SDK（`%LOCALAPPDATA%\Microsoft\dotnet` 下的用户级安装即可；机器上的 9.x 桌面运行时即可运行产物）：

```
pwsh -File launcher/build.ps1
```

单文件、依赖框架的 exe 输出到 `launcher/dist/DshLauncher.exe`（约 230 KB）。可以复制到任意位置（桌面、开始菜单）；仓库位置依次按「从 exe 向上、从工作目录向上、上次记忆的仓库」解析（记忆文件为 `~/.dsh/launcher/repo-path.txt`，每次仓库内运行和构建冒烟步骤都会刷新）。有多个检出时以最后使用的为准，需要固定时在 exe 旁放 `dsh-launcher.json`：

```json
{
  "repoPath": "C:\\path\\to\\deepseek-harness",
  "webPort": 3080,
  "daemonPort": 9077,
  "autoOpenBrowser": true
}
```

（`~/.dsh/launcher.json` 也有效；exe 旁的文件优先。所有键均可省略。其他可覆盖键：`host`、`webStartTimeoutSeconds`（默认 120）、`daemonStartTimeoutSeconds`（默认 300）、`logDir`——通常只有测试会重定向它。）

## 测试

```
pwsh -File launcher/tests/stop-cycle.test.ps1
```

在一次性端口上构造模拟的 `node -> cmd shim -> node` 链，并断言停止周期：端口释放、链内进程消失、宿主 shell 存活、二次停止幂等、记忆中无监听的启动链被连带杀掉且 pid 文件被消费、`--status` 退出码正确。3080/9077 上的在线服务与真实的 `~/.dsh/launcher` 不受影响（临时配置重定向了 `logDir`）。

## 重新生成图标

```
pwsh -File launcher/assets/make-icon.ps1
```

用 System.Drawing 绘制 `launcher/assets/app.ico`（深色圆角方块、白色 D、绿色状态点），尺寸 256/48/32/16 px。
