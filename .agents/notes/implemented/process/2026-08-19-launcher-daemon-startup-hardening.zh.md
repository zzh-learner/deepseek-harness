# Agent Note: launcher daemon 启动加固

Status: implemented

[English](2026-08-19-launcher-daemon-startup-hardening.md) | 中文

## 问题

一次早晨的 launcher 重启后 daemon 挂掉，背后是三层叠加的失败。`hindsight-api-slim` 对 `claude-agent-sdk` 的依赖是 `>=0.2.82`、无上界；上游发布 0.2.140 后，下一次 `uvx hindsight-api@0.9.1` 的解析需要下载约 100 MB 的 wheel。下载期间三个独立超时先后触发：launcher 在 60 秒后放弃等待 daemon 端口；embed CLI 自身的启动预算（`HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT`，默认 180 秒）在下载中途到期且不清理任何进程；随后第二次 bootstrap 又因第一个尝试遗留的 uv 进程仍持有 wheel 缓存锁而损失 300 秒。Stop 不仅帮不上忙还放大问题：它只通过监听端口找进程，仍在启动中的链（正在下载依赖、尚无监听）躲过每次 stop，每次重试都在上一条链上再叠一条。

## 决策

由一个数字统管整个 daemon 启动：`daemonStartTimeoutSeconds`（默认改为 300）既是 launcher 的端口等待，也作为 `HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT` 与 `UV_LOCK_TIMEOUT` 转发给 bootstrap，分别约束 embed CLI 的预算与 uv 的锁等待。预算之内任何一层都不会在其他层仍在推进时提前放弃，并发的第二个 bootstrap 会等锁而不是撞锁报错。

Stop 与 Start 现在同时跟踪 spawn 根进程，而不只看监听者。每次 spawn 把 `web.pid`/`daemon.pid`（`pid|start-time|process-name`）写入日志目录；Stop 在按端口杀之后再杀记忆中的根进程，Start 在 spawn 之前先清记忆中的根进程，任意时刻每个组件至多存在一条链。动手前按进程名与启动时间校验记录，PID 复用不会被误杀。pid 文件刻意做成跨进程状态：headless 动词运行在独立的 exe 实例里，与托盘进程不共享内存。`dsh-launcher.json` 新增 `logDir` 覆盖，stop-cycle 测试借此把 `web.pid`/`daemon.pid` 与日志重定向进临时目录，不再触碰真实的 `~/.dsh/launcher`。

daemon bootstrap 的 `Process` 对象改为与 web 相同的持有方式，不再在 `StartDaemonAsync` 返回时 Dispose：已 Dispose 的 Process 不再触发输出事件，这正是 `daemon.log` 里始终缺失 `=== pid ... exited ===` 尾行的原因。

## 备选方案

**按命令行扫描击杀孤儿 uv 进程。** 能覆盖 bootstrap 已退出的 detached daemon，但需要 WMI 级的进程枚举，且有误杀用户自己 hindsight 进程的风险；预算内的 `UV_LOCK_TIMEOUT` 让重试收敛到上一次下载上，已经足够。

**通过 IPC 把 headless 动词转发给托盘进程。** 可以让 pid 状态只存内存，但为了两行 pid 文件就能解决的问题引入管道协议不值，而且托盘退出后它同样失效。

## 后果

bootstrap 在两次 launcher 运行之间死掉的 daemon（孤儿、下载中、无监听、无记忆 pid）对 Stop 仍不可见；下一次 Start 的锁等待会吸收它，且下载完成一次后 wheel 缓存使问题不复存在。`~/.dsh/launcher/` 下新增的 pid 文件各一行，每次 stop 消费（删除）。stop-cycle 测试增加了无监听链场景并重定向 `logDir`，测试不再触碰真实的 launcher 目录。
