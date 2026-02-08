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
from ..providers import create_claude_chain, create_codex_chain
from ..utils.time import calculate_time_progress
from ..utils.bars import (
    calculate_bar_width, create_time_markers, create_capacity_bar, create_period_bar,
    MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT,
)

# Layout overhead for TUI MetricsWidget:
#   Panel borders: 2, Panel padding: 2, Label column: 18,
#   Table cell padding: 4, Suffix text (" ◆ 100%"): 8, Safety margin: 2
TUI_OVERHEAD = 36


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
        """Render metrics with subscription in title."""
        # Check if terminal is too small
        term = self.app.size if self.app else self.size
        if term.width < MIN_TERMINAL_WIDTH or term.height < MIN_TERMINAL_HEIGHT:
            return Panel(
                f"[yellow]Terminal too small ({term.width}x{term.height}).\n"
                f"Please resize to at least {MIN_TERMINAL_WIDTH}x{MIN_TERMINAL_HEIGHT}.[/yellow]",
                title=self.title,
                border_style="yellow"
            )

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

        # Extract subscription and create dynamic title
        subscription = self.metrics.get('subscription_type')
        panel_title = f"{self.title} - {subscription}" if subscription else self.title

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
            # Skip subscription_type key
            if name == 'subscription_type':
                continue
            label = label_map.get(name, name)

            # Determine window hours and divisions
            if 'session' in name or '5h' in name:
                window_hours = 5
                divisions = 5
            else:  # weekly metrics
                window_hours = 168  # 7 days
                divisions = 7

            # Dynamic bar width based on widget size
            used = data['used_pct']
            bar_width = calculate_bar_width(self.size.width, TUI_OVERHEAD)

            # Capacity bar (token usage)
            capacity_bar = create_capacity_bar(used, bar_width)

            # Time markers bar
            markers_bar = create_time_markers(divisions, bar_width)

            # Period bar (time progression)
            time_pct = calculate_time_progress(data['resets'], window_hours)
            period_bar = create_period_bar(time_pct, bar_width)

            # Render three bars with icons and updated colors
            table.add_row(f"{label}:", f"{capacity_bar} ◆ {used}%")
            table.add_row("", f"[dim]{markers_bar}[/dim]")
            table.add_row("", f"[cyan][dim]{period_bar}[/dim][/cyan] ⏱ {int(time_pct)}%")
            table.add_row("", f"  Resets: {data['resets']}")
            table.add_row()

        return Panel(table, title=panel_title, border_style="cyan")


class StatusBar(Static):
    """Status bar showing refresh state and timing."""

    last_updated = reactive("")
    auto_refresh_enabled = reactive(True)
    refresh_interval = reactive(10)
    data_source = reactive("")

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

        if self.data_source:
            status.append(" | ")
            status.append("Source: ", style="cyan")
            status.append(self.data_source, style="bold cyan")

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
        height: 1fr;
        layout: vertical;
        background: #1e1e2e;  /* Mocha Base */
    }

    MetricsWidget {
        height: 1fr;
        margin: 0 1;
        background: #1e1e2e;  /* Mocha Base */
    }

    StatusBar {
        height: 1;
        background: #1e1e2e;  /* Mocha Base */
        color: #cdd6f4;       /* Mocha Text */
        padding: 0 1;
    }

    Footer {
        dock: bottom;
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

    def __init__(self, refresh_interval: int = 10, services: Optional[list] = None, debug: bool = False, **kwargs):
        super().__init__(**kwargs)
        self.refresh_interval = max(5, refresh_interval)
        self.services = services if services else ['claude', 'codex']
        self.debug_mode = debug
        self.claude_chain = None
        self.codex_chain = None
        self.refresh_timer = None
        self.data_source = {}  # Track data source per service
        self._init_storage()

    def _init_storage(self):
        """Initialize storage components."""
        try:
            from ..storage import UsageStore, DedupTracker
            self.usage_store = UsageStore()
            self.dedup_tracker = DedupTracker()
            # Run cleanup on startup
            self.usage_store.cleanup_old_snapshots(days=30)
        except Exception:
            self.usage_store = None
            self.dedup_tracker = None

    def compose(self) -> ComposeResult:
        """Build the UI layout."""
        yield Header(show_clock=True)

        # Only create widgets for requested services
        widgets = []
        if 'claude' in self.services:
            widgets.append(MetricsWidget("Claude Usage", id="claude"))
        if 'codex' in self.services:
            widgets.append(MetricsWidget("Codex Usage", id="codex"))

        yield Container(*widgets, id="metrics-container")
        yield StatusBar(id="status")
        yield Footer()

    def on_mount(self) -> None:
        """Start collectors and refresh loop when app starts."""
        self.title = "Usage Monitor"
        self._update_subtitle()

        # Start collectors in background
        self.start_collectors()

        # Start auto-refresh timer after a short delay to ensure app is fully initialized
        self.set_timer(0.5, self._start_refresh_timer)

    def _update_subtitle(self) -> None:
        """Update subtitle with current refresh rate."""
        self.sub_title = ""

    def watch_refresh_interval(self, new_interval: int) -> None:
        """Watch for refresh interval changes and update subtitle."""
        self._update_subtitle()
        # Restart timer with new interval if mounted and auto-refresh enabled
        if hasattr(self, 'refresh_timer') and self.is_mounted and self.auto_refresh_enabled:
            self._start_refresh_timer()

    def _start_refresh_timer(self) -> None:
        """Start or restart the auto-refresh timer."""
        # Cancel existing timer if any
        if self.refresh_timer:
            self.refresh_timer.stop()

        # Set up new timer if auto-refresh is enabled
        if self.auto_refresh_enabled:
            self.refresh_timer = self.set_timer(
                self.refresh_interval,
                self._handle_timer_callback
            )

    def _handle_timer_callback(self) -> None:
        """Handle timer callback and refresh metrics."""
        if self.auto_refresh_enabled:
            self.refresh_metrics()
            # Reschedule next refresh
            self._start_refresh_timer()

    @work(exclusive=True, thread=True)
    def start_collectors(self) -> None:
        """Initialize persistent chains and collect initial metrics."""
        claude_metrics = None
        codex_metrics = None
        claude_error = None
        codex_error = None

        # Create Claude chain if requested
        if 'claude' in self.services:
            try:
                self.claude_chain = create_claude_chain(persistent=True)
                result = self.claude_chain.start()
                claude_metrics = result.metrics
                self.data_source['claude'] = result.source.value
                if result.error:
                    claude_error = result.error
            except Exception as e:
                claude_error = str(e)

        # Create Codex chain if requested
        if 'codex' in self.services:
            try:
                self.codex_chain = create_codex_chain(persistent=True)
                result = self.codex_chain.start()
                codex_metrics = result.metrics
                self.data_source['codex'] = result.source.value
                if result.error:
                    codex_error = result.error
            except Exception as e:
                codex_error = str(e)

        # Update UI from main thread
        self.call_from_thread(
            self._update_ui, claude_metrics, codex_metrics,
            claude_error, codex_error,
        )

    @work(exclusive=True, thread=True)
    def refresh_metrics(self) -> None:
        """Refresh metrics from chains."""
        if not self.claude_chain and not self.codex_chain:
            return

        claude_metrics = None
        codex_metrics = None
        claude_error = None
        codex_error = None

        if self.claude_chain:
            try:
                result = self.claude_chain.refresh()
                claude_metrics = result.metrics
                self.data_source['claude'] = result.source.value
                if result.stale:
                    self.data_source['claude'] += ' (stale)'
                if result.error:
                    claude_error = result.error
            except Exception as e:
                claude_error = str(e)

        if self.codex_chain:
            try:
                result = self.codex_chain.refresh()
                codex_metrics = result.metrics
                self.data_source['codex'] = result.source.value
                if result.stale:
                    self.data_source['codex'] += ' (stale)'
                if result.error:
                    codex_error = result.error
            except Exception as e:
                codex_error = str(e)

        self.call_from_thread(
            self._update_ui, claude_metrics, codex_metrics,
            claude_error, codex_error,
        )

    def _store_snapshots(
        self,
        claude_metrics: Optional[Dict],
        codex_metrics: Optional[Dict]
    ) -> None:
        """Store metrics snapshots to database with deduplication."""
        if not self.usage_store or not self.dedup_tracker:
            return

        try:
            import uuid
            collection_id = str(uuid.uuid4())

            # Store Claude metrics if changed
            if claude_metrics and 'claude' in self.services:
                if self.dedup_tracker.should_store_metrics('claude', claude_metrics):
                    source = self.data_source.get('claude', 'unknown')
                    self.usage_store.store_snapshot(
                        'claude',
                        claude_metrics,
                        source,
                        collection_id
                    )

            # Store Codex metrics if changed
            if codex_metrics and 'codex' in self.services:
                if self.dedup_tracker.should_store_metrics('codex', codex_metrics):
                    source = self.data_source.get('codex', 'unknown')
                    self.usage_store.store_snapshot(
                        'codex',
                        codex_metrics,
                        source,
                        collection_id
                    )

        except Exception:
            # Silently fail, storage is best-effort
            pass

    def _update_ui(
        self,
        claude_metrics: Optional[Dict],
        codex_metrics: Optional[Dict],
        claude_error: Optional[str] = None,
        codex_error: Optional[str] = None,
    ) -> None:
        """Update UI widgets with new metrics."""
        status_bar = self.query_one("#status", StatusBar)

        # Update Claude widget if it exists
        if 'claude' in self.services:
            try:
                claude_widget = self.query_one("#claude", MetricsWidget)
                if claude_error:
                    claude_widget.update_metrics(None, error=claude_error)
                elif claude_metrics:
                    claude_widget.update_metrics(claude_metrics)
            except Exception:
                pass

        # Update Codex widget if it exists
        if 'codex' in self.services:
            try:
                codex_widget = self.query_one("#codex", MetricsWidget)
                if codex_error:
                    codex_widget.update_metrics(None, error=codex_error)
                elif codex_metrics:
                    codex_widget.update_metrics(codex_metrics)
            except Exception:
                pass

        status_bar.last_updated = datetime.now().strftime("%H:%M:%S")
        status_bar.auto_refresh_enabled = self.auto_refresh_enabled
        status_bar.refresh_interval = self.refresh_interval

        # Update data source display
        sources = []
        for service in self.services:
            source = self.data_source.get(service, 'unknown')
            sources.append(f"{service}: {source}")
        status_bar.data_source = " | ".join(sources)

        # Store snapshots to database
        self._store_snapshots(claude_metrics, codex_metrics)

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
            self._start_refresh_timer()
        else:
            self.notify("Auto-refresh paused", severity="warning")
            if self.refresh_timer:
                self.refresh_timer.stop()

    def action_speed_up(self) -> None:
        """Increase refresh rate (decrease interval) (+ key)."""
        old_interval = self.refresh_interval
        self.refresh_interval = max(5, self.refresh_interval - 5)

        if self.refresh_interval != old_interval:
            status_bar = self.query_one("#status", StatusBar)
            status_bar.refresh_interval = self.refresh_interval
            self.notify(f"Refresh interval: {self.refresh_interval}s")
            # Timer will be restarted by watch_refresh_interval
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
            # Timer will be restarted by watch_refresh_interval
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
                self.refresh_timer.stop()
            except Exception:
                pass

        # Stop chains
        if self.claude_chain:
            try:
                self.claude_chain.stop()
            except Exception:
                pass

        if self.codex_chain:
            try:
                self.codex_chain.stop()
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
                self.refresh_timer.stop()
            except Exception:
                pass

        # Stop chains in parallel
        if self.claude_chain:
            try:
                self.claude_chain.stop()
            except Exception:
                pass

        if self.codex_chain:
            try:
                self.codex_chain.stop()
            except Exception:
                pass

        # Wait for cleanup to complete
        await asyncio.sleep(1)
