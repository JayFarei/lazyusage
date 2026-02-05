"""Interactive TUI for usage monitoring with keyboard shortcuts."""

import asyncio
from datetime import datetime
from typing import Dict, Optional
from textual.app import App, ComposeResult
from textual.containers import Container, Vertical
from textual.widgets import Header, Footer, Static
from textual.reactive import reactive
from textual import work
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from ..collectors.claude import ClaudePersistentCollector
from ..collectors.codex import CodexPersistentCollector
from ..utils.time import calculate_time_progress


def _create_time_markers(divisions: int, bar_width: int = 30) -> str:
    """Create evenly-spaced division markers.

    Args:
        divisions: Number of divisions (5 for 5h, 7 for weekly)
        bar_width: Width of bar (default 30)

    Returns:
        Bar string with evenly distributed markers
    """
    if divisions <= 1:
        return " " * bar_width

    # Calculate positions using rounding for more even distribution
    markers = []
    for i in range(1, divisions):
        # Use round() instead of int() for better distribution
        pos = round(i * bar_width / divisions)
        markers.append(pos)

    # Build bar character by character
    bar = ""
    for i in range(bar_width):
        if i in markers:
            bar += "┃"
        else:
            bar += " "

    return bar


def _create_period_bar(time_pct: float, bar_width: int = 30) -> str:
    """Create a filled progress bar showing time elapsed.

    Args:
        time_pct: Percentage of time elapsed (0-100)
        bar_width: Width of bar (default 30)

    Returns:
        Bar string with time progression
    """
    # Calculate filled width
    filled = int((time_pct / 100) * bar_width)

    # Build bar
    bar = '▓' * filled + '░' * (bar_width - filled)

    return bar


class MetricsWidget(Static):
    """Widget for displaying usage metrics with progress bars."""

    def __init__(self, title: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.title = title
        self.metrics = {}
        self.last_updated = None
        self.error_message = None

    def update_metrics(self, metrics: Optional[Dict], error: Optional[str] = None):
        """Update metrics and refresh display."""
        if error:
            self.error_message = error
            self.metrics = {}
        else:
            self.error_message = None
            self.metrics = metrics or {}

        self.last_updated = datetime.now().strftime("%H:%M:%S")
        self.refresh()

    def render(self) -> Panel:
        """Render metrics as a Rich Panel."""
        if self.error_message:
            return Panel(
                f"[red]Error: {self.error_message}[/red]",
                title=self.title,
                border_style="red"
            )

        if not self.metrics:
            return Panel(
                "[yellow]Loading...[/yellow]",
                title=self.title,
                border_style="cyan"
            )

        table = Table.grid(padding=(0, 1))
        # Fixed-width column for labels to ensure alignment
        table.add_column(justify="left", no_wrap=True, width=18)
        table.add_column(justify="left")

        # Create label mapping with consistent format
        label_map = {
            'session': 'Session (5h)',
            'week_all': 'Weekly (All)',
            'week_sonnet': 'Weekly (Sonnet)',
            '5h': 'Session (5h)',
            'weekly': 'Weekly'
        }

        for name, data in self.metrics.items():
            label = label_map.get(name, name)

            # Determine window hours and divisions
            if 'session' in name or '5h' in name:
                window_hours = 5
                divisions = 5
            else:  # weekly metrics
                window_hours = 168  # 7 days
                divisions = 7

            # Capacity bar (token usage)
            used = data['used_pct']
            bar_width = 35  # Changed to 35 for perfect division by 5 and 7
            filled = int((used / 100) * bar_width)
            capacity_bar = '▓' * filled + '░' * (bar_width - filled)

            # Time markers bar
            markers_bar = _create_time_markers(divisions, bar_width)

            # Period bar (time progression)
            time_pct = calculate_time_progress(data['resets'], window_hours)
            period_bar = _create_period_bar(time_pct, bar_width)

            # Render three bars with icons and updated colors
            table.add_row(f"{label}:", f"{capacity_bar} ◆ {used}%")
            table.add_row("", f"[dim]{markers_bar}[/dim]")
            table.add_row("", f"[cyan][dim]{period_bar}[/dim][/cyan] ⏱ {int(time_pct)}%")
            table.add_row("", f"  Resets: {data['resets']}")
            table.add_row()

        return Panel(table, title=self.title, border_style="cyan")


class StatusBar(Static):
    """Status bar showing refresh state and timing."""

    last_updated = reactive("")
    auto_refresh_enabled = reactive(True)
    refresh_interval = reactive(10)

    def render(self) -> Text:
        """Render status bar."""
        status = Text()

        if self.last_updated:
            status.append(f"Last updated: {self.last_updated}")
        else:
            status.append("Initializing...")

        status.append(" | ")

        if self.auto_refresh_enabled:
            status.append(f"Auto-refresh: ", style="green")
            status.append(f"ON ({self.refresh_interval}s)", style="bold green")
        else:
            status.append("Auto-refresh: ", style="yellow")
            status.append("PAUSED", style="bold yellow")

        return status


class UsageTUI(App):
    """Interactive TUI for Claude/Codex usage monitoring."""

    CSS = """
    /* Catppuccin Mocha Theme */
    Screen {
        background: #1e1e2e;  /* Mocha Base */
    }

    Header {
        background: #1e1e2e;  /* Mocha Base */
        color: #cdd6f4;       /* Mocha Text */
    }

    #metrics-container {
        height: 100%;
        layout: vertical;
        background: #1e1e2e;  /* Mocha Base */
    }

    MetricsWidget {
        height: 1fr;
        margin: 0 1;
        background: #1e1e2e;  /* Mocha Base */
    }

    StatusBar {
        dock: bottom;
        height: 1;
        background: #1e1e2e;  /* Mocha Base */
        color: #cdd6f4;       /* Mocha Text */
        padding: 0 1;
    }

    Footer {
        background: #1e1e2e;  /* Mocha Base */
    }
    """

    BINDINGS = [
        ("r", "refresh", "Refresh"),
        ("p", "toggle_pause", "Pause"),
        ("+", "speed_up", "Faster"),
        ("-", "slow_down", "Slower"),
        ("q", "quit", "Quit"),
        ("?", "help", "Help"),
    ]

    auto_refresh_enabled = reactive(True)
    refresh_interval = reactive(10)

    def __init__(self, refresh_interval: int = 10, **kwargs):
        super().__init__(**kwargs)
        self.refresh_interval = max(5, refresh_interval)
        self.claude_collector = None
        self.codex_collector = None
        self.refresh_timer = None

    def compose(self) -> ComposeResult:
        """Build the UI layout."""
        yield Header(show_clock=True)
        yield Container(
            MetricsWidget("Claude Usage", id="claude"),
            MetricsWidget("Codex Usage", id="codex"),
            id="metrics-container"
        )
        yield StatusBar(id="status")
        yield Footer()

    def on_mount(self) -> None:
        """Start collectors and refresh loop when app starts."""
        self.title = "Usage Monitor"
        self._update_subtitle()

        # Start collectors in background
        self.start_collectors()

    def _update_subtitle(self) -> None:
        """Update subtitle with current refresh rate."""
        self.sub_title = f"Refresh: {self.refresh_interval}s | Press ? for help"

    def watch_refresh_interval(self, new_interval: int) -> None:
        """Watch for refresh interval changes and update subtitle."""
        self._update_subtitle()

    @work(exclusive=True, thread=True)
    def start_collectors(self) -> None:
        """Initialize persistent collectors and collect initial metrics."""
        try:
            # Create Claude collector
            self.claude_collector = ClaudePersistentCollector()
            claude_metrics = self.claude_collector.start()

            # Create Codex collector
            self.codex_collector = CodexPersistentCollector()
            codex_metrics = self.codex_collector.start()

            # Update UI from main thread
            self.call_from_thread(self._update_ui, claude_metrics, codex_metrics)

            # Start auto-refresh loop
            self.call_from_thread(self._schedule_refresh)

        except Exception as e:
            self.call_from_thread(
                self.notify,
                f"Error starting collectors: {e}",
                severity="error"
            )

    def _schedule_refresh(self) -> None:
        """Schedule next refresh."""
        if self.refresh_timer:
            self.refresh_timer.cancel()

        if self.auto_refresh_enabled:
            self.refresh_timer = self.set_timer(
                self.refresh_interval,
                self._auto_refresh
            )

    def _auto_refresh(self) -> None:
        """Auto-refresh callback."""
        if self.auto_refresh_enabled:
            self.refresh_metrics()
            self._schedule_refresh()

    @work(exclusive=True, thread=True)
    def refresh_metrics(self) -> None:
        """Refresh metrics from collectors."""
        if not self.claude_collector or not self.codex_collector:
            return

        try:
            claude_metrics = self.claude_collector.refresh()
            codex_metrics = self.codex_collector.refresh()

            self.call_from_thread(self._update_ui, claude_metrics, codex_metrics)

        except Exception as e:
            self.call_from_thread(
                self.notify,
                f"Error refreshing metrics: {e}",
                severity="warning"
            )

    def _update_ui(self, claude_metrics: Dict, codex_metrics: Dict) -> None:
        """Update UI widgets with new metrics."""
        claude_widget = self.query_one("#claude", MetricsWidget)
        codex_widget = self.query_one("#codex", MetricsWidget)
        status_bar = self.query_one("#status", StatusBar)

        claude_widget.update_metrics(claude_metrics)
        codex_widget.update_metrics(codex_metrics)

        status_bar.last_updated = datetime.now().strftime("%H:%M:%S")
        status_bar.auto_refresh_enabled = self.auto_refresh_enabled
        status_bar.refresh_interval = self.refresh_interval

    async def action_refresh(self) -> None:
        """Manual refresh action (R key)."""
        self.notify("Refreshing metrics...")
        self.refresh_metrics()

    def action_toggle_pause(self) -> None:
        """Pause/resume auto-refresh (P key)."""
        self.auto_refresh_enabled = not self.auto_refresh_enabled

        status_bar = self.query_one("#status", StatusBar)
        status_bar.auto_refresh_enabled = self.auto_refresh_enabled

        if self.auto_refresh_enabled:
            self.notify("Auto-refresh enabled", severity="information")
            self._schedule_refresh()
        else:
            self.notify("Auto-refresh paused", severity="warning")
            if self.refresh_timer:
                self.refresh_timer.cancel()

    def action_speed_up(self) -> None:
        """Increase refresh rate (decrease interval) (+ key)."""
        old_interval = self.refresh_interval
        self.refresh_interval = max(5, self.refresh_interval - 5)

        if self.refresh_interval != old_interval:
            status_bar = self.query_one("#status", StatusBar)
            status_bar.refresh_interval = self.refresh_interval
            self.notify(f"Refresh interval: {self.refresh_interval}s")

            # Restart timer with new interval
            if self.auto_refresh_enabled:
                self._schedule_refresh()
        else:
            self.notify("Minimum refresh interval is 5s", severity="warning")

    def action_slow_down(self) -> None:
        """Decrease refresh rate (increase interval) (- key)."""
        old_interval = self.refresh_interval
        self.refresh_interval = min(60, self.refresh_interval + 5)

        if self.refresh_interval != old_interval:
            status_bar = self.query_one("#status", StatusBar)
            status_bar.refresh_interval = self.refresh_interval
            self.notify(f"Refresh interval: {self.refresh_interval}s")

            # Restart timer with new interval
            if self.auto_refresh_enabled:
                self._schedule_refresh()
        else:
            self.notify("Maximum refresh interval is 60s", severity="warning")

    def action_help(self) -> None:
        """Show help overlay (? key)."""
        help_text = """
[bold cyan]Keyboard Shortcuts:[/bold cyan]

[bold]R[/bold] - Refresh now (manual)
[bold]P[/bold] - Pause/Resume auto-refresh
[bold]+[/bold] - Increase refresh rate (decrease interval)
[bold]-[/bold] - Decrease refresh rate (increase interval)
[bold]?[/bold] - Show this help
[bold]Q[/bold] - Quit

[dim]Press any key to close this help[/dim]
"""
        self.notify(help_text)

    async def action_quit(self) -> None:
        """Override quit action to ensure cleanup."""
        # Cancel any running workers first
        for worker in self.workers:
            if not worker.is_finished:
                worker.cancel()

        # Now cleanup collectors
        await self._cleanup_collectors_async()
        self.exit()

    def on_unmount(self) -> None:
        """Cleanup when app exits."""
        # Synchronous cleanup for unmount
        import time

        # Cancel refresh timer
        if self.refresh_timer:
            try:
                self.refresh_timer.cancel()
            except Exception:
                pass

        # Stop collectors
        if self.claude_collector:
            try:
                self.claude_collector.stop()
            except Exception:
                pass

        if self.codex_collector:
            try:
                self.codex_collector.stop()
            except Exception:
                pass

        # Give time for cleanup
        time.sleep(1)

    async def _cleanup_collectors_async(self) -> None:
        """Async cleanup for action_quit."""
        import asyncio

        # Cancel refresh timer
        if self.refresh_timer:
            try:
                self.refresh_timer.cancel()
            except Exception:
                pass

        # Stop collectors in parallel
        if self.claude_collector:
            try:
                self.claude_collector.stop()
            except Exception:
                pass

        if self.codex_collector:
            try:
                self.codex_collector.stop()
            except Exception:
                pass

        # Wait for cleanup to complete
        await asyncio.sleep(1)
