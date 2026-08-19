namespace DshLauncher;

using System.IO;
using System.Text.Json;

/// <summary>
/// Launcher configuration. Defaults mirror start-dsh-web.cmd: web on
/// 127.0.0.1:3080, Hindsight daemon on 127.0.0.1:9077, repo resolved by walking
/// up from the exe location or the working directory, falling back to the last
/// remembered repo. Overrides come from dsh-launcher.json next to the exe, or
/// ~/.dsh/launcher.json (exe-adjacent wins).
/// </summary>
public sealed class LauncherConfig
{
    /// <summary>Repository root that "pnpm dsh web" runs in.</summary>
    public string RepoPath { get; init; } = "";

    /// <summary>Host the dsh web server binds.</summary>
    public string Host { get; init; } = "127.0.0.1";

    /// <summary>Port the dsh web server binds.</summary>
    public int WebPort { get; init; } = 3080;

    /// <summary>Port the Hindsight daemon listens on.</summary>
    public int DaemonPort { get; init; } = 9077;

    /// <summary>Open the default browser once the web server answers.</summary>
    public bool AutoOpenBrowser { get; set; } = true;

    /// <summary>Seconds to wait for the web port after spawning "pnpm dsh web".</summary>
    public int WebStartTimeoutSeconds { get; init; } = 120;

    /// <summary>
    /// Seconds to wait for the daemon port after spawning daemon-start.js. Also
    /// forwarded as HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT (the embed CLI's own
    /// startup budget) and UV_LOCK_TIMEOUT, so a cold start whose uvx resolution
    /// downloads ~100 MB of dependencies is not cut short mid-download: the
    /// budget governs every layer that can give up while the daemon boots.
    /// </summary>
    public int DaemonStartTimeoutSeconds { get; init; } = 300;

    /// <summary>Web UI URL derived from host and port.</summary>
    public string WebUrl => $"http://{Host}:{WebPort}";

    /// <summary>Default directory holding launcher-managed logs and pid files: ~/.dsh/launcher. The remembered repo path always lives here, whatever <see cref="LogDir"/> resolves to.</summary>
    public static string DefaultLogDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "launcher");

    /// <summary>Directory holding launcher-managed logs and pid files: <see cref="DefaultLogDir"/>, or the logDir override from dsh-launcher.json (tests use it to leave the real directory untouched).</summary>
    public string LogDir => LogDirOverride ?? DefaultLogDir;

    /// <summary>See <see cref="LogDir"/>; null means the default directory.</summary>
    public string? LogDirOverride { get; init; }

    /// <summary>daemon-start.js path under ~/.hindsight, the idempotent daemon bootstrap.</summary>
    public static string DaemonStartScript => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".hindsight", "coding-agents", "dist", "daemon-start.js");

    /// <summary>dsh web stdout/stderr capture file.</summary>
    public string WebLogPath => Path.Combine(LogDir, "dsh-web.log");

    /// <summary>Daemon bootstrap output capture file.</summary>
    public string DaemonLogPath => Path.Combine(LogDir, "daemon.log");

    /// <summary>Pid file of the spawned dsh web chain root (pwsh): written on spawn, read by stop/re-start to kill a chain that has no listener yet.</summary>
    public string WebPidFile => Path.Combine(LogDir, "web.pid");

    /// <summary>Pid file of the spawned daemon bootstrap (node daemon-start.js): same contract as <see cref="WebPidFile"/>.</summary>
    public string DaemonPidFile => Path.Combine(LogDir, "daemon.pid");

    /// <summary>Launcher's own diagnostics log.</summary>
    public string LauncherLogPath => Path.Combine(LogDir, "launcher.log");

    /// <summary>Remembered repo root; written whenever walk-up discovery succeeds so an exe copied outside the checkout (Desktop, Start Menu) still finds the repo. Last checkout used wins.</summary>
    private static string CachedRepoPathFile => Path.Combine(DefaultLogDir, "repo-path.txt");

    /// <summary>
    /// Load configuration: defaults from repo discovery (walk-up from the exe
    /// or working directory, then the remembered repo), then JSON overrides
    /// (exe-adjacent dsh-launcher.json, then ~/.dsh/launcher.json; first file
    /// found wins). Missing or malformed files are skipped, not errors.
    /// </summary>
    public static LauncherConfig Load()
    {
        var discovered = FindRepoRoot(AppContext.BaseDirectory)
            ?? FindRepoRoot(Directory.GetCurrentDirectory());
        if (discovered is not null)
        {
            RememberRepo(discovered);
        }

        var defaults = new
        {
            RepoPath = discovered ?? ReadCachedRepo() ?? "",
            Host = "127.0.0.1",
            WebPort = 3080,
            DaemonPort = 9077,
            AutoOpenBrowser = true,
            WebStartTimeoutSeconds = 120,
            DaemonStartTimeoutSeconds = 300,
        };

        foreach (var candidate in ConfigFileCandidates())
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            JsonDocument? json = null;
            try
            {
                json = JsonDocument.Parse(File.ReadAllText(candidate));
            }
            catch (JsonException)
            {
                // A malformed override file must not brick the tray app; skip it.
            }

            if (json is null)
            {
                continue;
            }

            using (json)
            {
                return new LauncherConfig
                {
                    RepoPath = ReadString(json, "repoPath") is { Length: > 0 } path ? path : defaults.RepoPath,
                    Host = ReadString(json, "host") ?? defaults.Host,
                    WebPort = ReadInt(json, "webPort") ?? defaults.WebPort,
                    DaemonPort = ReadInt(json, "daemonPort") ?? defaults.DaemonPort,
                    AutoOpenBrowser = ReadBool(json, "autoOpenBrowser") ?? defaults.AutoOpenBrowser,
                    WebStartTimeoutSeconds = ReadInt(json, "webStartTimeoutSeconds") ?? defaults.WebStartTimeoutSeconds,
                    DaemonStartTimeoutSeconds = ReadInt(json, "daemonStartTimeoutSeconds") ?? defaults.DaemonStartTimeoutSeconds,
                    LogDirOverride = ReadString(json, "logDir") is { Length: > 0 } logDir ? logDir : null,
                };
            }
        }

        return new LauncherConfig
        {
            RepoPath = defaults.RepoPath,
            Host = defaults.Host,
            WebPort = defaults.WebPort,
            DaemonPort = defaults.DaemonPort,
            AutoOpenBrowser = defaults.AutoOpenBrowser,
            WebStartTimeoutSeconds = defaults.WebStartTimeoutSeconds,
            DaemonStartTimeoutSeconds = defaults.DaemonStartTimeoutSeconds,
        };
    }

    /// <summary>Candidate override files, most specific first.</summary>
    private static IEnumerable<string> ConfigFileCandidates()
    {
        yield return Path.Combine(AppContext.BaseDirectory, "dsh-launcher.json");
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "launcher.json");
    }

    private static string? ReadString(JsonDocument json, string name)
        => json.RootElement.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? ReadInt(JsonDocument json, string name)
        => json.RootElement.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var parsed) ? parsed : null;

    private static bool? ReadBool(JsonDocument json, string name)
        => json.RootElement.TryGetProperty(name, out var value)
            && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : null;

    /// <summary>
    /// Walk up from <paramref name="start"/> looking for the dsh repo root,
    /// identified by a package.json next to an apps/web directory.
    /// </summary>
    private static string? FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir is not null)
        {
            if (LooksLikeRepoRoot(dir.FullName))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return null;
    }

    /// <summary>Whether <paramref name="dir"/> carries the repo root markers: package.json next to apps/web.</summary>
    private static bool LooksLikeRepoRoot(string dir)
        => File.Exists(Path.Combine(dir, "package.json"))
            && Directory.Exists(Path.Combine(dir, "apps", "web"));

    /// <summary>Read the remembered repo root; trusted only while it still looks like a checkout, so a moved or deleted repo fails loud instead of starting the wrong tree.</summary>
    private static string? ReadCachedRepo()
    {
        try
        {
            var cached = File.ReadAllText(CachedRepoPathFile).Trim();
            return cached.Length > 0 && LooksLikeRepoRoot(cached) ? cached : null;
        }
        catch (IOException)
        {
            // Missing or unreadable cache: nothing remembered yet.
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            // The cache file belongs to another elevated context; ignore it.
            return null;
        }
    }

    /// <summary>Persist <paramref name="repo"/> as the remembered repo root; best-effort, never blocks a start.</summary>
    private static void RememberRepo(string repo)
    {
        try
        {
            Directory.CreateDirectory(DefaultLogDir);
            File.WriteAllText(CachedRepoPathFile, repo);
        }
        catch (IOException)
        {
            // Disk full or the log directory is unwritable; the next in-repo run retries.
        }
        catch (UnauthorizedAccessException)
        {
            // The log directory belongs to another elevated context; skip the write.
        }
    }
}
