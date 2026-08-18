namespace DshLauncher;

using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

/// <summary>
/// Entry point. Without arguments the exe runs as the tray launcher; CLI verbs
/// (--status/--start/--stop/--restart/--open) run headless for scripts and the
/// Task Scheduler. A second GUI instance signals the first to show its status
/// panel and exits.
/// </summary>
internal static class Program
{
    private const string SingletonMutexName = @"Local\DshLauncher.Singleton";
    private const string ShowPanelEventName = @"Local\DshLauncher.ShowPanel";

    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    private const int AttachParentProcess = -1;

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            return RunTray();
        }

        return RunHeadless(args);
    }

    private static int RunTray()
    {
        using var mutex = new Mutex(initiallyOwned: true, SingletonMutexName, out var createdNew);
        if (!createdNew)
        {
            using var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowPanelEventName);
            show.Set();
            return 0;
        }

        ApplicationConfiguration.Initialize();

        var config = LauncherConfig.Load();
        var service = new ProcessService(config);
        using var app = new TrayApp(config, service);
        using var watcher = new ThreadPoolWatcher(() => app.ShowPanel(), ShowPanelEventName);
        Application.Run();
        return 0;
    }

    private static int RunHeadless(string[] args)
    {
        var openBrowser = true;
        var verb = "";
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            switch (arg)
            {
                case "--no-browser":
                    openBrowser = false;
                    break;
                case "--start":
                case "--stop":
                case "--restart":
                case "--status":
                case "--open":
                case "--help":
                    verb = arg;
                    break;
                case "--probe":
                    if (verb == "" && i + 1 < args.Length && int.TryParse(args[i + 1], out var probePort))
                    {
                        return RunProbe(probePort);
                    }

                    AttachConsoleForCli();
                    Console.WriteLine("--probe needs a port: --probe 3080");
                    return 2;
                default:
                    AttachConsoleForCli();
                    Console.WriteLine($"unknown argument: {arg}");
                    PrintUsage();
                    return 2;
            }
        }

        AttachConsoleForCli();
        if (verb == "" || verb == "--help")
        {
            if (verb == "")
            {
                PrintUsage();
                return 2;
            }

            PrintUsage();
            return 0;
        }

        var config = LauncherConfig.Load();
        var service = new ProcessService(config);

        switch (verb)
        {
            case "--status":
            {
                var status = service.QueryStatus();
                Console.WriteLine($"dsh web:          {StateText(status.Web)}{PidSuffix(status.WebPid)} at {config.WebUrl}");
                Console.WriteLine($"hindsight daemon: {StateText(status.Daemon)}{PidSuffix(status.DaemonPid)} on 127.0.0.1:{config.DaemonPort}");
                Console.WriteLine($"repo:             {(config.RepoPath.Length > 0 ? config.RepoPath : "(not found)")}");
                return status.AllRunning ? 0 : 1;
            }

            case "--open":
                service.OpenBrowser();
                return 0;

            case "--start":
            case "--stop":
            case "--restart":
            default:
            {
                var result = verb switch
                {
                    "--start" => service.StartAsync(openBrowser).ConfigureAwait(false).GetAwaiter().GetResult(),
                    "--stop" => service.StopAsync().ConfigureAwait(false).GetAwaiter().GetResult(),
                    _ => service.RestartAsync(openBrowser).ConfigureAwait(false).GetAwaiter().GetResult(),
                };
                foreach (var detail in result.Details)
                {
                    Console.WriteLine(detail);
                }

                Console.WriteLine(result.Summary);
                return result.Success ? 0 : 1;
            }
        }
    }

    /// <summary>Diagnostic dump: every IPv4 TCP row matching the port, plus the parent chain of the listener.</summary>
    private static int RunProbe(int port)
    {
        AttachConsoleForCli();
        var rows = NativeMethods.ReadTcpTable();
        var any = false;
        foreach (var row in rows)
        {
            if (NativeMethods.SwapPortBytes(row.LocalPort) == port)
            {
                any = true;
                Console.WriteLine($"row: state={row.State} port={port} addr={row.LocalAddr} pid={row.OwningPid}");
            }
        }

        if (!any)
        {
            Console.WriteLine($"no IPv4 rows match port {port} ({rows.Length} rows total)");
        }

        var listener = NativeMethods.FindListenerPid(port);
        Console.WriteLine($"listener pid: {listener?.ToString() ?? "none"}");
        if (listener is { } pid)
        {
            var current = pid;
            for (var depth = 0; depth < 12; depth++)
            {
                var parent = NativeMethods.FindParentPid(current);
                if (parent is null)
                {
                    Console.WriteLine($"chain: [{current}] parent unknown (access denied or exited)");
                    break;
                }

                var name = "?";
                try
                {
                    using var proc = System.Diagnostics.Process.GetProcessById(parent.Value);
                    name = proc.ProcessName;
                }
                catch (System.ArgumentException)
                {
                    name = "exited";
                }

                Console.WriteLine($"chain: [{current}] <- {name} ({parent.Value})");
                current = parent.Value;
                if (name is "explorer" or "exited")
                {
                    break;
                }
            }
        }

        return 0;
    }

    private static string StateText(ComponentState state) => state switch
    {
        ComponentState.Running => "running",
        ComponentState.Starting => "starting",
        _ => "stopped",
    };

    private static string PidSuffix(int? pid) => pid is { } value ? $" (pid {value})" : "";

    private static void PrintUsage()
    {
        Console.WriteLine("DSH launcher - tray controller for dsh web + hindsight daemon");
        Console.WriteLine();
        Console.WriteLine("  (no arguments)      run as the tray app");
        Console.WriteLine("  --status            print component states; exit 0 only when both are up");
        Console.WriteLine("  --start             start daemon + web (idempotent); opens browser unless --no-browser");
        Console.WriteLine("  --stop              stop web and daemon (idempotent)");
        Console.WriteLine("  --restart           stop then start");
        Console.WriteLine("  --open              open the web UI in the default browser");
        Console.WriteLine("  --no-browser        with --start/--restart: skip opening the browser");
        Console.WriteLine("  --help              this text");
    }

    /// <summary>
    /// A WinExe has no console; attach to the parent console so CLI output is
    /// visible when invoked from a terminal. When stdout is already redirected
    /// (pipe or file) the inherited handle is used as-is, because replacing it
    /// with the console device would swallow the redirected output.
    /// </summary>
    private static void AttachConsoleForCli()
    {
        if (StdoutIsRedirected() || !AttachConsole(AttachParentProcess))
        {
            return;
        }

        Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
    }

    /// <summary>True when the standard output handle is a pipe or disk file rather than a console.</summary>
    private static bool StdoutIsRedirected()
    {
        var handle = GetStdHandle(StdOutputHandle);
        if (handle == IntPtr.Zero || handle == InvalidHandleValue)
        {
            return false;
        }

        var type = GetFileType(handle);
        return type != FileTypeCharacter;
    }

    private const int StdOutputHandle = -11;
    private const uint FileTypeCharacter = 2;
    private static readonly IntPtr InvalidHandleValue = new(-1);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int standardHandleId);

    [DllImport("kernel32.dll")]
    private static extern uint GetFileType(IntPtr handle);

    /// <summary>Marshal a named-event signal onto the UI thread for the tray instance.</summary>
    private sealed class ThreadPoolWatcher : IDisposable
    {
        private readonly EventWaitHandle _handle;
        private readonly RegisteredWaitHandle _registration;

        public ThreadPoolWatcher(Action showPanel, string eventName)
        {
            _handle = new EventWaitHandle(false, EventResetMode.AutoReset, eventName);
            _registration = ThreadPool.RegisterWaitForSingleObject(
                _handle,
                (_, _) => showPanel(),
                null,
                -1,
                executeOnlyOnce: false);
        }

        public void Dispose()
        {
            _registration.Unregister(null);
            _handle.Dispose();
        }
    }
}
