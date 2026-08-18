namespace DshLauncher;

using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

/// <summary>Per-component lifecycle state as the launcher observes it.</summary>
public enum ComponentState
{
    Stopped,
    Starting,
    Running,
}

/// <summary>Point-in-time status of both managed components.</summary>
public sealed record ServiceStatus(ComponentState Web, ComponentState Daemon, int? WebPid, int? DaemonPid)
{
    /// <summary>Both components up.</summary>
    public bool AllRunning => Web == ComponentState.Running && Daemon == ComponentState.Running;
}

/// <summary>Outcome of one start/stop/restart action, for humans and exit codes.</summary>
public sealed record ActionResult(bool Success, string Summary)
{
    /// <summary>Long-form lines for the CLI: per-step detail in execution order.</summary>
    public List<string> Details { get; init; } = [];
}

/// <summary>
/// Starts and stops the dsh web server and the Hindsight daemon, tracks their
/// state by listening ports, and captures their output into launcher-owned log
/// files. Process discovery is port-based, so the launcher also manages servers
/// it did not spawn (for example the window left by start-dsh-web.cmd).
/// </summary>
public sealed class ProcessService(LauncherConfig config)
{
    private readonly object _busyLock = new();
    private bool _busy;
    private Process? _webProcess;

    /// <summary>Raised once when a start/stop/restart sequence finishes; consumers re-query status.</summary>
    public event Action? StateChanged;

    /// <summary>True while a start/stop/restart sequence owns the lifecycle.</summary>
    public bool Busy
    {
        get { lock (_busyLock) { return _busy; } }
    }

    /// <summary>Probe both ports and map them to owning PIDs.</summary>
    public ServiceStatus QueryStatus()
    {
        var webPid = NativeMethods.FindListenerPid(config.WebPort);
        var daemonPid = NativeMethods.FindListenerPid(config.DaemonPort);
        return new ServiceStatus(
            webPid is null ? ComponentState.Stopped : ComponentState.Running,
            daemonPid is null ? ComponentState.Stopped : ComponentState.Running,
            webPid,
            daemonPid);
    }

    /// <summary>Test whether a TCP port answers within a short timeout.</summary>
    public static bool PortAnswers(int port, int timeoutMs = 400)
    {
        try
        {
            using var client = new TcpClient();
            return client.ConnectAsync("127.0.0.1", port).Wait(timeoutMs) && client.Connected;
        }
        catch (SocketException)
        {
            return false;
        }
        catch (AggregateException)
        {
            // Refused/reset while connecting: the port is simply not answering.
            return false;
        }
    }

    /// <summary>
    /// Start daemon then web if not already up. Idempotent: components already
    /// listening are reported as such, and the browser still opens unless the
    /// config or <paramref name="openBrowser"/> opts out.
    /// </summary>
    public async Task<ActionResult> StartAsync(bool openBrowser, CancellationToken cancellation = default)
    {
        if (!TryBegin())
        {
            return new ActionResult(false, "another start/stop/restart is already in progress");
        }

        try
        {
            var details = new List<string>();
            var daemonOk = await StartDaemonAsync(details, cancellation);
            var webOk = await StartWebAsync(details, cancellation);

            if (openBrowser && webOk && config.AutoOpenBrowser)
            {
                OpenBrowser();
                details.Add($"opened {config.WebUrl} in the default browser");
            }

            var summary = webOk
                ? daemonOk ? $"started; web {config.WebUrl}, daemon :{config.DaemonPort} up"
                    : $"started; web {config.WebUrl} up, daemon :{config.DaemonPort} NOT up (see {config.DaemonLogPath})"
                : $"web did not come up within {config.WebStartTimeoutSeconds}s (see {config.WebLogPath})";
            return new ActionResult(webOk, summary) { Details = details };
        }
        finally
        {
            End();
        }
    }

    /// <summary>Kill both the web process chain and the daemon. Idempotent.</summary>
    public async Task<ActionResult> StopAsync(CancellationToken cancellation = default)
    {
        if (!TryBegin())
        {
            return new ActionResult(false, "another start/stop/restart is already in progress");
        }

        try
        {
            var details = new List<string>();
            var webStopped = await StopComponentAsync(config.WebPort, "dsh web", WebChainNames, details, cancellation);
            var daemonStopped = await StopComponentAsync(config.DaemonPort, "hindsight daemon", DaemonChainNames, details, cancellation);
            _webProcess?.Dispose();
            _webProcess = null;

            var success = webStopped && daemonStopped;
            var summary = success
                ? "stopped dsh web and hindsight daemon"
                : webStopped ? "stopped dsh web; hindsight daemon could not be stopped"
                : daemonStopped ? "stopped hindsight daemon; dsh web could not be stopped"
                : "neither component could be stopped";
            return new ActionResult(success, summary) { Details = details };
        }
        finally
        {
            End();
        }
    }

    /// <summary>Stop, then start again.</summary>
    public async Task<ActionResult> RestartAsync(bool openBrowser, CancellationToken cancellation = default)
    {
        var stop = await StopAsync(cancellation);
        if (!stop.Success)
        {
            return new ActionResult(false, $"restart aborted after stop failed: {stop.Summary}") { Details = stop.Details };
        }

        var start = await StartAsync(openBrowser, cancellation);
        return new ActionResult(start.Success, $"restart: {start.Summary}")
        {
            Details = stop.Details.Concat(start.Details).ToList(),
        };
    }

    /// <summary>Open the web UI with the shell default browser.</summary>
    public void OpenBrowser()
    {
        Process.Start(new ProcessStartInfo(config.WebUrl) { UseShellExecute = true });
    }

    private async Task<bool> StartDaemonAsync(List<string> details, CancellationToken cancellation)
    {
        if (PortAnswers(config.DaemonPort))
        {
            details.Add($"hindsight daemon already up on :{config.DaemonPort}");
            return true;
        }

        if (!File.Exists(LauncherConfig.DaemonStartScript))
        {
            details.Add($"daemon bootstrap missing: {LauncherConfig.DaemonStartScript}");
            return false;
        }

        Directory.CreateDirectory(LauncherConfig.LogDir);
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = LauncherConfig.LogDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add(LauncherConfig.DaemonStartScript);
        psi.ArgumentList.Add("--harness");
        psi.ArgumentList.Add("dsh");

        using var process = Process.Start(psi)!;
        PumpOutput(process, config.DaemonLogPath);
        details.Add($"spawned daemon bootstrap (pid {process.Id}) -> {config.DaemonLogPath}");

        return await WaitPortAsync(config.DaemonPort, config.DaemonStartTimeoutSeconds, cancellation);
    }

    private async Task<bool> StartWebAsync(List<string> details, CancellationToken cancellation)
    {
        if (PortAnswers(config.WebPort))
        {
            details.Add($"dsh web already up on :{config.WebPort}");
            return true;
        }

        if (string.IsNullOrEmpty(config.RepoPath) || !File.Exists(Path.Combine(config.RepoPath, "package.json")))
        {
            details.Add("repo root not found; put dsh-launcher.json with repoPath next to the exe, or run the launcher from the repo once to remember it");
            return false;
        }

        Directory.CreateDirectory(LauncherConfig.LogDir);
        // pwsh runs with the profile (no -NoProfile): pnpm resolves through the
        // fnm setup the profile performs. The repo path is single-quoted for
        // pwsh, with embedded single quotes doubled per pwsh literal rules.
        var escapedRepo = config.RepoPath.Replace("'", "''");
        var psi = new ProcessStartInfo
        {
            FileName = "pwsh",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = config.RepoPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-NoLogo");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add($"Set-Location -LiteralPath '{escapedRepo}'; pnpm dsh web");

        var process = Process.Start(psi)!;
        _webProcess?.Dispose();
        _webProcess = process;
        PumpOutput(process, config.WebLogPath);
        details.Add($"spawned pnpm dsh web (pid {process.Id}) in {config.RepoPath} -> {config.WebLogPath}");

        return await WaitPortAsync(config.WebPort, config.WebStartTimeoutSeconds, cancellation);
    }

    /// <summary>Ancestor process names that belong to a spawned dsh web chain: the pnpm/node pipeline. A cmd counts only when its own parent is node, which is the pnpm.CMD shim pattern; an interactive cmd's parent is a terminal or explorer, so the walk stops below it.</summary>
    private static readonly HashSet<string> WebChainNames = ["node"];

    /// <summary>Ancestor process names of the daemon listener: the uv/uvx supervisor chain down through hindsight-api and python.</summary>
    private static readonly HashSet<string> DaemonChainNames = ["node", "python", "hindsight-api", "uv", "uvx"];

    /// <summary>
    /// Stop whatever listens on <paramref name="port"/>. The kill root is the
    /// topmost ancestor whose process name is in <paramref name="chainNames"/>
    /// (a cmd ancestor counts only when its parent is node, the pnpm shim
    /// pattern), so taskkill /T removes the whole component pipeline without
    /// touching the hosting shell (pwsh exits on its own once its command
    /// finishes; an interactive shell is never in the chain).
    /// </summary>
    private async Task<bool> StopComponentAsync(int port, string name, HashSet<string> chainNames, List<string> details, CancellationToken cancellation)
    {
        var pid = NativeMethods.FindListenerPid(port);
        if (pid is null)
        {
            details.Add($"{name}: not running (nothing on :{port})");
            return true;
        }

        var root = FindKillRoot(pid.Value, chainNames);
        if (RunTaskKill(root, details, name) && await WaitPortFreeAsync(port, 10, cancellation))
        {
            return true;
        }

        // The port is still answering: fall back to killing the listener itself.
        if (root != pid.Value && RunTaskKill(pid.Value, details, $"{name} (listener)")
            && await WaitPortFreeAsync(port, 10, cancellation))
        {
            return true;
        }

        details.Add($"{name}: port :{port} still answering after kill attempts");
        return false;
    }

    /// <summary>Walk up from <paramref name="pid"/> through ancestors named in <paramref name="chainNames"/> (cmd only under a node parent); the last accepted ancestor is the kill root.</summary>
    internal static int FindKillRoot(int pid, HashSet<string> chainNames)
    {
        var root = pid;
        var current = pid;
        while (NativeMethods.FindParentPid(current) is { } parent && BelongsToChain(parent, chainNames))
        {
            root = parent;
            current = parent;
        }

        return root;
    }

    /// <summary>Whether <paramref name="pid"/> is a pipeline member: in the name set, or a cmd whose parent is node (the pnpm.CMD shim).</summary>
    private static bool BelongsToChain(int pid, HashSet<string> chainNames)
    {
        var name = ProcessName(pid);
        if (chainNames.Contains(name))
        {
            return true;
        }

        return name == "cmd"
            && NativeMethods.FindParentPid(pid) is { } grandparent
            && ProcessName(grandparent) == "node";
    }

    private static string ProcessName(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.ProcessName.ToLowerInvariant();
        }
        catch (ArgumentException)
        {
            // The process exited between the PID lookup and this query.
            return "";
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // Access denied (elevated or system process): the name is unknown.
            return "";
        }
    }

    private static bool RunTaskKill(int pid, List<string> details, string name)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "taskkill",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("/PID");
        psi.ArgumentList.Add(pid.ToString(System.Globalization.CultureInfo.InvariantCulture));
        psi.ArgumentList.Add("/T");
        psi.ArgumentList.Add("/F");

        using var taskKill = Process.Start(psi)!;
        var output = taskKill.StandardOutput.ReadToEnd();
        taskKill.WaitForExit(15000);
        details.Add($"{name}: taskkill /PID {pid} /T /F -> exit {taskKill.ExitCode}");
        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            details.Add($"  {line}");
        }

        return taskKill.ExitCode == 0;
    }

    /// <summary>Pump redirected stdout/stderr of <paramref name="process"/> into <paramref name="logPath"/>, rotating past 8 MB.</summary>
    private static void PumpOutput(Process process, string logPath)
    {
        RotateIfNeeded(logPath);
        var writer = new StreamWriter(
            new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.Read),
            new UTF8Encoding(false))
        {
            AutoFlush = true,
        };

        writer.WriteLine($"=== launcher spawn pid {process.Id} at {DateTime.Now:yyyy-MM-dd HH:mm:ss} ===");

        process.OutputDataReceived += (_, e) => WriteLogLine(writer, e.Data);
        process.ErrorDataReceived += (_, e) => WriteLogLine(writer, e.Data);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        process.Exited += (_, _) =>
        {
            WriteLogLine(writer, $"=== pid {process.Id} exited at {DateTime.Now:yyyy-MM-dd HH:mm:ss} ===");
            writer.Dispose();
        };
        process.EnableRaisingEvents = true;
    }

    /// <summary>Write one pumped line; a null payload marks stream end, not content.</summary>
    private static void WriteLogLine(StreamWriter writer, string? line)
    {
        if (line is null)
        {
            return;
        }

        try
        {
            writer.WriteLine(line);
        }
        catch (ObjectDisposedException)
        {
            // The process exited and disposed the writer concurrently.
        }
        catch (IOException)
        {
            // Disk full or the log file became unreadable; dropping output beats killing the pump.
        }
    }

    /// <summary>Rename an oversized log to .old (overwriting the previous .old).</summary>
    private static void RotateIfNeeded(string logPath)
    {
        try
        {
            var info = new FileInfo(logPath);
            if (info.Exists && info.Length > 8 * 1024 * 1024)
            {
                File.Move(logPath, logPath + ".old", overwrite: true);
            }
        }
        catch (IOException)
        {
            // Rotation is best-effort; appending continues into the large file.
        }
    }

    private static async Task<bool> WaitPortAsync(int port, int timeoutSeconds, CancellationToken cancellation)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            if (PortAnswers(port))
            {
                return true;
            }

            try
            {
                await Task.Delay(500, cancellation);
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        return PortAnswers(port);
    }

    private static async Task<bool> WaitPortFreeAsync(int port, int timeoutSeconds, CancellationToken cancellation)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            if (NativeMethods.FindListenerPid(port) is null)
            {
                return true;
            }

            try
            {
                await Task.Delay(500, cancellation);
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        return NativeMethods.FindListenerPid(port) is null;
    }

    private bool TryBegin()
    {
        lock (_busyLock)
        {
            if (_busy)
            {
                return false;
            }

            _busy = true;
            return true;
        }
    }

    private void End()
    {
        lock (_busyLock)
        {
            _busy = false;
        }

        StateChanged?.Invoke();
    }

    /// <summary>Append one diagnostics line to launcher.log; IO failures are swallowed after being named.</summary>
    public void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(LauncherConfig.LogDir);
            File.AppendAllText(config.LauncherLogPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}\n");
        }
        catch (IOException)
        {
            // Launcher diagnostics must never crash the tray app over a log write.
        }
        catch (UnauthorizedAccessException)
        {
            // The log directory belongs to another elevated context; skip the line.
        }
    }
}
