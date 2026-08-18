namespace DshLauncher;

using Microsoft.Win32;

/// <summary>
/// Windows login auto-start for the launcher via the per-user Run key
/// (HKCU/Software/Microsoft/Windows/CurrentVersion/Run, value DshLauncher).
/// </summary>
public static class AutoStart
{
    private static string RunKeyPath => string.Join(
        System.IO.Path.DirectorySeparatorChar.ToString(),
        "Software", "Microsoft", "Windows", "CurrentVersion", "Run");

    private const string ValueName = "DshLauncher";

    /// <summary>Whether the Run key currently points at this exe.</summary>
    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return key?.GetValue(ValueName) is string existing
            && PathsEqual(existing, Environment.ProcessPath);
    }

    /// <summary>Point the Run key at this exe, or remove it.</summary>
    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
        if (enabled)
        {
            key.SetValue(ValueName, Quote(Environment.ProcessPath));
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }

    /// <summary>Quote an exe path for a Run command; null becomes an empty command that only ever disables.</summary>
    private static string Quote(string? exePath) => "\"" + (exePath ?? string.Empty) + "\"";

    /// <summary>Compare a Run-key command (possibly quoted) with an exe path, case-insensitive as Windows paths are.</summary>
    private static bool PathsEqual(string runCommand, string? exePath)
    {
        var trimmed = runCommand.Trim().Trim('"');
        return exePath is not null
            && string.Equals(trimmed, exePath, StringComparison.OrdinalIgnoreCase);
    }
}
