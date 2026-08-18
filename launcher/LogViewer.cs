namespace DshLauncher;

using System.Drawing;
using System.IO;
using System.Windows.Forms;

/// <summary>
/// Tail viewer for the launcher-owned log files (dsh web output, daemon
/// bootstrap output, launcher diagnostics). Polls the file once per second
/// while visible; does not follow renames across rotation.
/// </summary>
public sealed class LogViewer : Form
{
    private readonly ComboBox _filePicker = new();
    private readonly TextBox _text = new();
    private readonly CheckBox _autoScroll = new();
    private readonly Timer _timer = new() { Interval = 1000 };
    private LauncherConfig? _config;
    private long _lastLength;

    public LogViewer()
    {
        Text = "DSH launcher logs";
        ClientSize = new Size(860, 560);
        StartPosition = FormStartPosition.CenterParent;

        _filePicker.Location = new Point(12, 12);
        _filePicker.Size = new Size(360, 24);
        _filePicker.DropDownStyle = ComboBoxStyle.DropDownList;
        _filePicker.SelectedIndexChanged += (_, _) => Reload();

        _autoScroll.Location = new Point(384, 14);
        _autoScroll.AutoSize = true;
        _autoScroll.Text = "Auto-scroll";
        _autoScroll.Checked = true;

        var folderButton = new Button
        {
            Location = new Point(740, 10),
            Size = new Size(100, 28),
            Text = "Open folder",
        };
        folderButton.Click += (_, _) => OpenFolder();

        _text.Location = new Point(12, 44);
        _text.Size = new Size(836, 504);
        _text.Multiline = true;
        _text.ReadOnly = true;
        _text.ScrollBars = ScrollBars.Vertical;
        _text.Font = new Font(FontFamily.GenericMonospace, 9f);
        _text.WordWrap = false;

        Controls.AddRange([_filePicker, _autoScroll, folderButton, _text]);

        _timer.Tick += (_, _) => Reload();
    }

    /// <summary>Show (or raise) the viewer bound to the current config and log files.</summary>
    public void Show(LauncherConfig config)
    {
        _config = config;
        if (_filePicker.Items.Count == 0)
        {
            _filePicker.Items.Add(new LogChoice("dsh web", config.WebLogPath));
            _filePicker.Items.Add(new LogChoice("hindsight daemon", config.DaemonLogPath));
            _filePicker.Items.Add(new LogChoice("launcher", config.LauncherLogPath));
            _filePicker.SelectedIndex = 0;
        }

        Reload();
        Show();
        _timer.Start();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            _timer.Stop();
            Hide();
            e.Cancel = true;
        }
        else
        {
            base.OnFormClosing(e);
        }
    }

    private void OpenFolder()
    {
        if (_config is null || !Directory.Exists(LauncherConfig.LogDir))
        {
            return;
        }

        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(LauncherConfig.LogDir)
        {
            UseShellExecute = true,
        });
    }

    private void Reload()
    {
        if (_config is null || _filePicker.SelectedItem is not LogChoice choice)
        {
            return;
        }

        try
        {
            var info = new FileInfo(choice.Path);
            if (!info.Exists)
            {
                if (_text.Text.Length > 0)
                {
                    _text.Clear();
                    _lastLength = 0;
                }

                return;
            }

            if (info.Length < _lastLength || choice.Path != _currentPath)
            {
                // File shrank (rotation replaced it) or the selection changed: reread from the top.
                _text.Clear();
                _lastLength = 0;
            }

            if (info.Length == _lastLength && choice.Path == _currentPath)
            {
                return;
            }

            _currentPath = choice.Path;
            using var stream = new FileStream(choice.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            stream.Seek(_lastLength, SeekOrigin.Begin);
            using var reader = new StreamReader(stream);
            var appended = reader.ReadToEnd();
            _lastLength = stream.Position;
            if (appended.Length > 0)
            {
                _text.AppendText(appended);
                if (_autoScroll.Checked)
                {
                    _text.SelectionStart = _text.Text.Length;
                    _text.ScrollToCaret();
                }
            }
        }
        catch (IOException)
        {
            // The writer holds the file with FileShare.Read, so a colliding read is retried on the next tick.
        }
    }

    private string? _currentPath;

    private sealed record LogChoice(string Label, string Path)
    {
        public override string ToString() => Label;
    }
}
