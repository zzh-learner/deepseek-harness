namespace DshLauncher;

using System.Drawing;
using System.IO;
using System.Windows.Forms;

/// <summary>
/// Tray-resident UI: a NotifyIcon whose color reflects the web/daemon state, a
/// context menu with start/stop/restart/open/logs/auto-start, a status panel on
/// double-click, and a log viewer tailing the launcher-owned log files.
/// Quitting the launcher leaves the services running; Stop is the only path
/// that stops them.
/// </summary>
public sealed class TrayApp : IDisposable
{
    private readonly LauncherConfig _config;
    private readonly ProcessService _service;
    private readonly NotifyIcon _notifyIcon;
    private readonly ContextMenuStrip _menu;
    private readonly ToolStripMenuItem _openItem;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly ToolStripMenuItem _restartItem;
    private readonly ToolStripMenuItem _logItem;
    private readonly ToolStripMenuItem _autoStartItem;
    private readonly Timer _pollTimer;
    private readonly StatusPanel _panel;
    private readonly LogViewer _logViewer;
    private readonly List<IDisposable> _owned = [];
    private Icon? _currentIcon;
    private ServiceStatus _lastStatus = new(ComponentState.Stopped, ComponentState.Stopped, null, null);
    private bool _suppressTransitionBubble;

    public TrayApp(LauncherConfig config, ProcessService service)
    {
        _config = config;
        _service = service;

        _menu = new ContextMenuStrip();
        _openItem = new ToolStripMenuItem($"Open {config.WebUrl}", null, (_, _) => _service.OpenBrowser());
        _startItem = new ToolStripMenuItem("Start", null, async (_, _) => await RunActionAsync(() => _service.StartAsync(openBrowser: true)));
        _stopItem = new ToolStripMenuItem("Stop", null, async (_, _) => await RunActionAsync(() => _service.StopAsync()));
        _restartItem = new ToolStripMenuItem("Restart", null, async (_, _) => await RunActionAsync(() => _service.RestartAsync(openBrowser: true)));
        _logItem = new ToolStripMenuItem("View logs...", null, (_, _) => ShowLogViewer());
        _autoStartItem = new ToolStripMenuItem("Start with Windows", null, (_, _) => ToggleAutoStart())
        {
            Checked = AutoStart.IsEnabled(),
        };

        _menu.Items.Add(_openItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(_startItem);
        _menu.Items.Add(_stopItem);
        _menu.Items.Add(_restartItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(_logItem);
        _menu.Items.Add(_autoStartItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Exit launcher", null, (_, _) => ExitRequested?.Invoke()));

        _notifyIcon = new NotifyIcon
        {
            ContextMenuStrip = _menu,
            Text = "DSH launcher",
            Visible = true,
        };
        _notifyIcon.DoubleClick += (_, _) => ShowPanel();
        // Force menu handle creation now so BeginInvoke is always available for
        // signals arriving on threadpool threads (second-instance, StateChanged).
        _ = _menu.Handle;

        _panel = new StatusPanel(config, service, ShowLogViewer);
        _logViewer = new LogViewer();

        _pollTimer = new Timer { Interval = 3000 };
        _pollTimer.Tick += (_, _) => Poll();
        _service.StateChanged += OnServiceStateChanged;

        Poll();
        _pollTimer.Start();
    }

    /// <summary>Raised when the user picks Exit; Program terminates the message loop.</summary>
    public event Action? ExitRequested;

    /// <summary>Bring the status panel to the front (second-instance signal); safe from any thread.</summary>
    public void ShowPanel()
    {
        _menu.BeginInvoke((Action)(() =>
        {
            _panel.Show();
            _panel.Activate();
        }));
    }

    /// <summary>Bring the log viewer to the front.</summary>
    public void ShowLogViewer()
    {
        _logViewer.Show(_config);
        _logViewer.Activate();
    }

    private void ToggleAutoStart()
    {
        var enable = !_autoStartItem.Checked;
        AutoStart.SetEnabled(enable);
        _autoStartItem.Checked = AutoStart.IsEnabled();
        Bubble(
            _autoStartItem.Checked ? "launcher will start with Windows" : "launcher no longer starts with Windows",
            tooltip: false);
    }

    private async Task RunActionAsync(Func<Task<ActionResult>> action)
    {
        if (_service.Busy)
        {
            Bubble("another start/stop/restart is already running");
            return;
        }

        _suppressTransitionBubble = true;
        try
        {
            var result = await Task.Run(action);
            foreach (var detail in result.Details)
            {
                _service.Log(detail);
            }

            _service.Log(result.Summary);
            Bubble(result.Summary, error: !result.Success);
        }
        finally
        {
            _suppressTransitionBubble = false;
            Poll();
        }
    }

    private void OnServiceStateChanged()
    {
        if (_menu.IsHandleCreated && _menu.InvokeRequired)
        {
            _menu.BeginInvoke((Action)Poll);
            return;
        }

        Poll();
    }

    private void Poll()
    {
        var status = _service.QueryStatus();
        UpdateIcon(status);
        UpdateMenu(status);
        _panel.UpdateStatus(status);
        if (!status.Equals(_lastStatus))
        {
            var wentDown = _lastStatus.Web == ComponentState.Running && status.Web != ComponentState.Running;
            if (wentDown && !_suppressTransitionBubble && !_service.Busy)
            {
                Bubble("dsh web went down");
            }

            _lastStatus = status;
        }
    }

    private void UpdateMenu(ServiceStatus status)
    {
        var busy = _service.Busy;
        _openItem.Enabled = status.Web == ComponentState.Running;
        _startItem.Enabled = !busy && status.Web != ComponentState.Running;
        _stopItem.Enabled = !busy && (status.Web == ComponentState.Running || status.Daemon == ComponentState.Running);
        _restartItem.Enabled = !busy;
    }

    private void UpdateIcon(ServiceStatus status)
    {
        var next = DrawIcon(status);
        _currentIcon?.Dispose();
        _currentIcon = next;
        _notifyIcon.Icon = next;
        _notifyIcon.Text = status.AllRunning
            ? "DSH: web + daemon up"
            : status.Web == ComponentState.Running ? "DSH: web up, daemon down"
            : status.Daemon == ComponentState.Running ? "DSH: web down, daemon up"
            : "DSH: stopped";
    }

    /// <summary>Draw the tray icon: a dark rounded square, web state as the big dot, daemon state as the corner dot.</summary>
    private static Icon DrawIcon(ServiceStatus status)
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var bg = new SolidBrush(Color.FromArgb(30, 36, 48));
            g.FillRectangle(bg, 2, 2, 28, 28);

            var webColor = status.Web switch
            {
                ComponentState.Running => Color.FromArgb(46, 158, 91),
                ComponentState.Starting => Color.FromArgb(59, 130, 246),
                _ => Color.FromArgb(192, 57, 43),
            };
            using var web = new SolidBrush(webColor);
            g.FillEllipse(web, 7, 7, 18, 18);

            var daemonColor = status.Daemon == ComponentState.Running
                ? Color.FromArgb(46, 158, 91)
                : Color.FromArgb(213, 159, 46);
            using var daemon = new SolidBrush(daemonColor);
            g.FillEllipse(daemon, 20, 20, 9, 9);
            using var ring = new Pen(Color.FromArgb(30, 36, 48), 2f);
            g.DrawEllipse(ring, 19, 19, 11, 11);
        }

        return Icon.FromHandle(bitmap.GetHicon());
    }

    private void Bubble(string message, bool error = false, bool tooltip = true)
    {
        if (tooltip)
        {
            _notifyIcon.BalloonTipTitle = error ? "DSH launcher" : "DSH launcher";
            _notifyIcon.BalloonTipText = message;
            _notifyIcon.BalloonTipIcon = error ? ToolTipIcon.Error : ToolTipIcon.Info;
            _notifyIcon.ShowBalloonTip(3000);
        }
    }

    public void Dispose()
    {
        _pollTimer.Stop();
        _service.StateChanged -= OnServiceStateChanged;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        _menu.Dispose();
        _currentIcon?.Dispose();
        _panel.Dispose();
        _logViewer.Dispose();
        foreach (var owned in _owned)
        {
            owned.Dispose();
        }

        _owned.Clear();
    }

    /// <summary>Status panel form: live labels plus the four actions. Closing hides, not exits.</summary>
    private sealed class StatusPanel : Form
    {
        private readonly LauncherConfig _config;
        private readonly ProcessService _service;
        private readonly Label _webLabel = new();
        private readonly Label _daemonLabel = new();
        private readonly Label _uptimeLabel = new();
        private readonly Button _startButton = new();
        private readonly Button _stopButton = new();
        private readonly Button _restartButton = new();
        private readonly Button _openButton = new();
        private readonly CheckBox _autoOpen = new();
        private readonly Action _openLogs;
        private DateTime? _webUpSince;

        public StatusPanel(LauncherConfig config, ProcessService service, Action openLogs)
        {
            _config = config;
            _service = service;
            _openLogs = openLogs;

            Text = "DSH launcher";
            FormBorderStyle = FormBorderStyle.FixedToolWindow;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(420, 240);
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            TopMost = true;

            _webLabel.Location = new Point(16, 16);
            _webLabel.AutoSize = true;
            _daemonLabel.Location = new Point(16, 44);
            _daemonLabel.AutoSize = true;
            _uptimeLabel.Location = new Point(16, 72);
            _uptimeLabel.AutoSize = true;

            _startButton.Location = new Point(16, 110);
            _startButton.Size = new Size(88, 30);
            _startButton.Text = "Start";
            _startButton.Click += async (_, _) => await RunPanelAction(() => _service.StartAsync(_autoOpen.Checked));

            _stopButton.Location = new Point(112, 110);
            _stopButton.Size = new Size(88, 30);
            _stopButton.Text = "Stop";
            _stopButton.Click += async (_, _) => await RunPanelAction(() => _service.StopAsync());

            _restartButton.Location = new Point(208, 110);
            _restartButton.Size = new Size(88, 30);
            _restartButton.Text = "Restart";
            _restartButton.Click += async (_, _) => await RunPanelAction(() => _service.RestartAsync(_autoOpen.Checked));

            _openButton.Location = new Point(304, 110);
            _openButton.Size = new Size(96, 30);
            _openButton.Text = "Open UI";
            _openButton.Click += (_, _) => _service.OpenBrowser();

            _autoOpen.Location = new Point(16, 152);
            _autoOpen.AutoSize = true;
            _autoOpen.Text = "Open browser after start";
            _autoOpen.Checked = config.AutoOpenBrowser;
            _autoOpen.CheckedChanged += (_, _) => config.AutoOpenBrowser = _autoOpen.Checked;

            var logLink = new LinkLabel
            {
                Location = new Point(16, 184),
                AutoSize = true,
                Text = "View logs...",
            };
            logLink.LinkClicked += (_, _) => _openLogs();

            Controls.AddRange(
            [
                _webLabel,
                _daemonLabel,
                _uptimeLabel,
                _startButton,
                _stopButton,
                _restartButton,
                _openButton,
                _autoOpen,
                logLink,
            ]);
        }

        /// <summary>Panel-side action runner: disables buttons, awaits, re-enables.</summary>
        private async Task RunPanelAction(Func<Task<ActionResult>> action)
        {
            if (_service.Busy)
            {
                return;
            }

            SetButtonsEnabled(false);
            try
            {
                var result = await Task.Run(action);
                foreach (var detail in result.Details)
                {
                    _service.Log(detail);
                }

                _service.Log(result.Summary);
            }
            finally
            {
                SetButtonsEnabled(true);
            }
        }

        private void SetButtonsEnabled(bool enabled)
        {
            _startButton.Enabled = enabled;
            _stopButton.Enabled = enabled;
            _restartButton.Enabled = enabled;
        }

        public void UpdateStatus(ServiceStatus status)
        {
            if (!IsHandleCreated)
            {
                return;
            }

            var webText = status.Web == ComponentState.Running
                ? $"dsh web: running (pid {status.WebPid}) at {_config.WebUrl}"
                : "dsh web: stopped";
            var daemonText = status.Daemon == ComponentState.Running
                ? $"hindsight daemon: running (pid {status.DaemonPid}) on 127.0.0.1:{_config.DaemonPort}"
                : "hindsight daemon: stopped";
            if (_webLabel.Text != webText)
            {
                _webLabel.Text = webText;
            }

            if (_daemonLabel.Text != daemonText)
            {
                _daemonLabel.Text = daemonText;
            }

            if (status.Web == ComponentState.Running && _webUpSince is null)
            {
                _webUpSince = DateTime.Now;
            }

            if (status.Web != ComponentState.Running)
            {
                _webUpSince = null;
            }

            _uptimeLabel.Text = _webUpSince is { } since
                ? $"web up for {(DateTime.Now - since).ToString(@"hh\:mm\:ss")}"
                : "repo: " + (_config.RepoPath.Length > 0 ? _config.RepoPath : "(not found)");

            _openButton.Enabled = status.Web == ComponentState.Running;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                Hide();
                e.Cancel = true;
            }
            else
            {
                base.OnFormClosing(e);
            }
        }
    }
}
