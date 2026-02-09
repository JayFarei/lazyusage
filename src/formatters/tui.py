"""Interactive TUI for usage monitoring with keyboard shortcuts."""

import asyncio
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional
from textual.app import App, ComposeResult
from textual.containers import Container, Vertical
from textual.widgets import Header, Footer, Static, TabbedContent, TabPane
from textual.reactive import reactive
from textual import work
from textual_plotext import PlotextPlot
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from ..providers import create_claude_chain, create_codex_chain
from ..utils.time import calculate_time_progress
from ..utils.bars import (
    calculate_bar_width, create_time_markers, create_capacity_bar, create_period_bar,
    MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT,
)

# Setup file logger for debugging (non-blocking)
_log_file = Path("/tmp/tui_debug.log")
logging.basicConfig(
    filename=_log_file,
    level=logging.DEBUG,
    format='%(asctime)s.%(msecs)03d [%(name)s] %(message)s',
    datefmt='%H:%M:%S',
    force=True
)
logger = logging.getLogger(__name__)

# Layout overhead for TUI MetricsWidget:
#   Panel borders: 2, Panel padding: 2, Label column: 18,
#   Table cell padding: 4, Suffix text (" ◆ 100%"): 8, Safety margin: 2
TUI_OVERHEAD = 36


class MetricsWidget(Static):
    """Widget for displaying usage metrics with progress bars."""

    def __init__(self, title: str, service: str = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.title = title
        self.service = service  # 'claude' or 'codex'
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


class MetricChartWidget(Static):
    """Widget for displaying a single metric chart with time projection."""

    def __init__(
        self,
        metric_name: str,
        window_hours: int,
        start_time: datetime,
        *args,
        **kwargs
    ):
        super().__init__(*args, **kwargs)
        self.metric_name = metric_name
        self.window_hours = window_hours
        self.start_time = start_time
        self.service = None  # Set by parent
        self.metrics = {}
        self.error_message = None

    def compose(self) -> ComposeResult:
        """Compose with PlotextPlot."""
        yield PlotextPlot()

    def on_mount(self):
        """Generate chart when widget mounts."""
        if self.metrics and self.metric_name in self.metrics:
            self.update_chart()

    def update_data(self, service: str, metrics: Optional[Dict], error: Optional[str] = None):
        """Update chart data (called by parent widget)."""
        self.service = service
        if error:
            self.error_message = error
            self.metrics = {}
        else:
            self.error_message = None
            self.metrics = metrics or {}

        if self.is_mounted and self.metric_name in self.metrics:
            self.update_chart()

    def update_chart(self):
        """Generate chart showing NOW → RESET with recent usage dots."""
        if self.error_message or not self.metrics:
            return

        if self.metric_name not in self.metrics:
            return

        from ..storage import UsageStore
        from ..utils.time import format_time_remaining

        store = UsageStore()
        plot = self.query_one(PlotextPlot)

        # Get current usage and reset time
        current_usage = self.metrics[self.metric_name].get('used_pct', 0)
        resets_str = self.metrics[self.metric_name].get('resets', '')

        if not resets_str:
            return

        # Parse reset time
        try:
            from ..utils.time import parse_time_to_datetime
            resets_at = parse_time_to_datetime(resets_str)
        except:
            return

        now = datetime.now()
        time_remaining = (resets_at - now).total_seconds()

        if time_remaining <= 0:
            # Already past reset time
            return

        # Get recent history (last 10% of window or minimum 30 minutes)
        lookback_hours = max(0.5, self.window_hours * 0.1)
        history = store.get_history(self.service, self.metric_name, hours=lookback_hours)

        # Calculate window start (when quota period began)
        window_start = resets_at - timedelta(hours=self.window_hours)

        # Create timeline from NOW to RESET
        # We'll use 50 points for smooth rendering
        num_points = 50
        timeline = []
        for i in range(num_points + 1):
            timeline.append(now + timedelta(seconds=(time_remaining * i / num_points)))

        # Calculate expected line: ideal prorata consumption
        # Shows what % should be consumed based on % of time elapsed
        # At NOW: current % of time elapsed in window
        # At RESET: 100% (full window elapsed)
        expected_line = []
        total_window_seconds = self.window_hours * 3600

        for t in timeline:
            # Calculate % of time elapsed from window start
            elapsed_seconds = (t - window_start).total_seconds()
            time_pct = (elapsed_seconds / total_window_seconds) * 100
            expected_line.append(min(100, max(0, time_pct)))

        # Setup plot
        plot.plt.clf()
        plot.plt.plotsize(100, 15)

        # Skip theme - manually configure all colors to avoid theme overrides
        # Use "default" to let the PlotextPlot CSS background show through
        plot.plt.canvas_color("default")

        # Set axes and grid colors manually (matching dark theme style)
        plot.plt.axes_color("#cdd6f4")  # Mocha Text (light gray/blue)
        plot.plt.ticks_color("#cdd6f4")  # Mocha Text

        x_indices = list(range(len(timeline)))

        # 1. Expected line: ideal prorata (thinner line)
        # Use RGB yellow tuple to ensure correct color rendering
        plot.plt.plot(x_indices, expected_line,
                     color=(255, 255, 0),  # RGB yellow
                     marker="braille")  # Braille for thinnest possible line

        # 2. Plot recent actual usage dots (if any)
        if history and len(history) > 0:
            actual_x = []
            actual_y = []

            for snapshot in history:
                ts = datetime.fromisoformat(snapshot['timestamp'].replace('Z', '+00:00'))
                if ts.tzinfo:
                    ts = ts.replace(tzinfo=None)

                # Calculate position on timeline (0 = NOW, num_points = RESET)
                if ts <= now:
                    # Recent past: show near left edge (NOW)
                    seconds_ago = (now - ts).total_seconds()
                    # Map to position near 0 (show last few minutes)
                    if seconds_ago <= 600:  # Last 10 minutes
                        x_pos = -seconds_ago / time_remaining * num_points
                        if x_pos >= -5:  # Only show very recent
                            actual_x.append(max(0, x_pos))
                            actual_y.append(snapshot['used_pct'])

            # Add current usage point at NOW
            actual_x.append(0)
            actual_y.append(current_usage)

            if actual_x:
                plot.plt.scatter(actual_x, actual_y,
                                color="cyan",
                                marker="dot")

        # Chart labels
        plot.plt.title(f"{self.metric_name.upper()} - Time to Reset")
        plot.plt.xlabel("Time")
        plot.plt.ylabel("Usage %")
        plot.plt.ylim(0, 100)

        # X-axis labels: NOW → time remaining → RESET
        label_positions = [0]
        label_texts = ["NOW"]

        # Add intermediate labels
        for i in [1, 2, 3]:
            pos = int(num_points * i / 4)
            label_positions.append(pos)
            t = timeline[pos]
            label_texts.append(format_time_remaining(t, resets_at, self.window_hours))

        # Reset label at the end
        label_positions.append(num_points)
        label_texts.append("RESET")

        plot.plt.xticks(label_positions, label_texts)

        # Manually add legend in bottom right corner with braille markers
        # Place text at bottom right of chart area
        legend_x = num_points * 0.88  # 88% to the right for better right alignment
        legend_y_base = 12  # Near bottom

        # Add legend entries with braille character prefix and matching line colors
        plot.plt.text("⣀⣀ Expected", x=legend_x, y=legend_y_base + 6,
                     color=(255, 255, 0),  # RGB yellow to match line
                     alignment="right", background="default")
        plot.plt.text("•• Actual", x=legend_x, y=legend_y_base,
                     color="cyan", alignment="right", background="default")

        # Force canvas color one final time before refresh
        plot.plt.canvas_color((30, 30, 46))  # RGB for #1e1e2e

        plot.refresh()


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


class ContextualFooter(Static):
    """Custom footer that shows context-appropriate shortcuts."""

    view_mode = reactive("graph")

    def render(self) -> Text:
        """Render context-appropriate shortcuts."""
        text = Text()

        # Define shortcuts based on view mode
        global_shortcuts = [
            ("s", "Snapshot"),
            ("g", "Graphs"),
            ("r", "Refresh"),
            ("p", "Pause"),
            ("q", "Quit"),
            ("?", "Help"),
        ]

        # Show global shortcuts (removed graph shortcuts as they're in tab names)
        for key, label in global_shortcuts:
            if text.plain:
                text.append("  ")
            text.append(f"{key}", style="bold yellow")
            text.append(f" {label}")

        return text

    def update_view_mode(self, mode: str) -> None:
        """Update view mode and refresh footer."""
        self.view_mode = mode


class UsageTUI(App):
    """Interactive TUI for Claude/Codex usage monitoring."""

    CSS = """
    /* Catppuccin Mocha Theme */
    Screen {
        background: #1e1e2e;  /* Mocha Base */
    }

    Header {
        background: #313244;  /* Mocha Surface0 */
    }

    Footer {
        background: #313244;  /* Mocha Surface0 */
    }

    TabbedContent {
        height: 1fr;
        background: #1e1e2e;  /* Mocha Base */
    }

    TabPane {
        layout: vertical;
        padding: 1 2;
        background: #1e1e2e;  /* Mocha Base */
    }

    MetricsWidget {
        height: 1fr;
        margin: 0 0 1 0;
    }

    MetricChartWidget {
        height: 1fr;
        margin: 0 0 1 0;
    }

    PlotextPlot {
        height: 1fr;
        width: 1fr;
        background: #1e1e2e;  /* Mocha Base - exact match with rest of UI */
    }

    StatusBar {
        background: #313244;  /* Mocha Surface0 */
        color: #cdd6f4;       /* Mocha Text */
        height: 1;
    }

    ContextualFooter {
        background: #313244;  /* Mocha Surface0 */
        color: #cdd6f4;       /* Mocha Text */
        height: 1;
        dock: bottom;
    }

    /* View container visibility */
    .view-container {
        height: 1fr;
    }

    .hidden {
        display: none;
    }
    """

    BINDINGS = [
        ("s", "show_snapshot", "Snapshot"),
        ("g", "show_graph", "Graphs"),
        ("1", "show_claude_weekly", "Claude Weekly"),
        ("2", "show_codex_weekly", "Codex Weekly"),
        ("3", "show_claude_session", "Claude Session"),
        ("4", "show_codex_session", "Codex Session"),
        ("5", "show_claude_sonnet", "Claude Sonnet"),
        ("r", "refresh", "Refresh"),
        ("p", "toggle_pause", "Pause"),
        ("+", "speed_up", "Faster"),
        ("-", "slow_down", "Slower"),
        ("q", "quit", "Quit"),
        ("?", "help", "Help"),
    ]

    auto_refresh_enabled = reactive(True)
    refresh_interval = reactive(10)
    view_mode = reactive("snapshot")  # "graph" or "snapshot" - start with snapshot

    def __init__(self, refresh_interval: int = 10, services: Optional[list] = None, debug: bool = False, **kwargs):
        super().__init__(**kwargs)
        self.refresh_interval = max(5, refresh_interval)
        self.services = services if services else ['claude', 'codex']
        self.debug_mode = debug
        self.claude_chain = None
        self.codex_chain = None
        self.refresh_timer = None
        self.data_source = {}  # Track data source per service
        self.app_start_time = datetime.now()  # Track when app opened for "from open" charts
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

        # Snapshot view container (visible by default)
        with Container(id="snapshot-container", classes="view-container"):
            if 'claude' in self.services:
                yield MetricsWidget(
                    "Claude Usage",
                    service="claude",
                    id="claude-snapshot"
                )
            if 'codex' in self.services:
                yield MetricsWidget(
                    "Codex Usage",
                    service="codex",
                    id="codex-snapshot"
                )

        # Graph view tabs (single level, hidden by default)
        with TabbedContent(initial="claude-weekly-tab" if 'claude' in self.services else "codex-weekly-tab", id="graph-tabs", classes="view-container hidden"):
            # Tab 1: Claude Weekly (MOST IMPORTANT)
            if 'claude' in self.services:
                with TabPane("Claude Weekly (1)", id="claude-weekly-tab"):
                    yield MetricChartWidget(
                        metric_name="week_all",
                        window_hours=168,
                        start_time=self.app_start_time,
                        id="claude-weekly-chart"
                    )

            # Tab 2: Codex Weekly
            if 'codex' in self.services:
                with TabPane("Codex Weekly (2)", id="codex-weekly-tab"):
                    yield MetricChartWidget(
                        metric_name="weekly",
                        window_hours=168,
                        start_time=self.app_start_time,
                        id="codex-weekly-chart"
                    )

            # Tab 3: Claude Session
            if 'claude' in self.services:
                with TabPane("Claude Session (3)", id="claude-session-tab"):
                    yield MetricChartWidget(
                        metric_name="session",
                        window_hours=5,
                        start_time=self.app_start_time,
                        id="claude-session-chart"
                    )

            # Tab 4: Codex Session
            if 'codex' in self.services:
                with TabPane("Codex Session (4)", id="codex-session-tab"):
                    yield MetricChartWidget(
                        metric_name="5h",
                        window_hours=5,
                        start_time=self.app_start_time,
                        id="codex-session-chart"
                    )

            # Tab 5: Claude Sonnet
            if 'claude' in self.services:
                with TabPane("Claude Sonnet (5)", id="claude-sonnet-tab"):
                    yield MetricChartWidget(
                        metric_name="week_sonnet",
                        window_hours=168,
                        start_time=self.app_start_time,
                        id="claude-sonnet-chart"
                    )

        yield StatusBar(id="status")
        yield ContextualFooter()

    def on_mount(self) -> None:
        """Start collectors and refresh loop when app starts."""
        self.title = "Usage Monitor"
        # Set initial subtitle based on default view mode (snapshot)
        self.sub_title = "Snapshot View - Press 'g' for graphs"

        # Start collectors in background
        self.start_collectors()

        # Start auto-refresh timer after a short delay to ensure app is fully initialized
        self.set_timer(0.5, self._start_refresh_timer)

    def _update_subtitle(self) -> None:
        """Update subtitle with current mode and navigation hints."""
        # Subtitle is now managed by watch_view_mode
        pass

    def watch_refresh_interval(self, new_interval: int) -> None:
        """Watch for refresh interval changes and update subtitle."""
        self._update_subtitle()
        # Restart timer with new interval if mounted and auto-refresh enabled
        if hasattr(self, 'refresh_timer') and self.is_mounted and self.auto_refresh_enabled:
            self._start_refresh_timer()

    def watch_view_mode(self, new_mode: str) -> None:
        """Toggle visibility between graph and snapshot views."""
        try:
            snapshot_container = self.query_one("#snapshot-container")
            graph_tabs = self.query_one("#graph-tabs")

            if new_mode == "snapshot":
                snapshot_container.remove_class("hidden")
                graph_tabs.add_class("hidden")
                # Update subtitle to show current mode
                self.sub_title = "Snapshot View - Press 'g' for graphs"
            else:  # "graph"
                snapshot_container.add_class("hidden")
                graph_tabs.remove_class("hidden")
                # Update subtitle to show current mode
                self.sub_title = "Graph View - Use 1-5 to switch charts, 's' for snapshot"

            # Update footer to show context-appropriate shortcuts
            try:
                footer = self.query_one(ContextualFooter)
                footer.update_view_mode(new_mode)
            except Exception:
                pass

        except Exception as e:
            logger.error(f"watch_view_mode failed: {e}")


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

        # Update snapshot widgets (always)
        if 'claude' in self.services:
            try:
                claude_snapshot = self.query_one("#claude-snapshot", MetricsWidget)
                if claude_error:
                    claude_snapshot.update_metrics(None, error=claude_error)
                elif claude_metrics:
                    claude_snapshot.update_metrics(claude_metrics)
            except Exception:
                pass

        if 'codex' in self.services:
            try:
                codex_snapshot = self.query_one("#codex-snapshot", MetricsWidget)
                if codex_error:
                    codex_snapshot.update_metrics(None, error=codex_error)
                elif codex_metrics:
                    codex_snapshot.update_metrics(codex_metrics)
            except Exception:
                pass

        # Update metric chart widgets (store metrics always, render only if mounted)
        if 'claude' in self.services:
            for chart_id in ["claude-weekly-chart", "claude-session-chart", "claude-sonnet-chart"]:
                try:
                    chart = self.query_one(f"#{chart_id}", MetricChartWidget)
                    chart.update_data("claude", claude_metrics, claude_error)
                except Exception:
                    pass

        if 'codex' in self.services:
            for chart_id in ["codex-weekly-chart", "codex-session-chart"]:
                try:
                    chart = self.query_one(f"#{chart_id}", MetricChartWidget)
                    chart.update_data("codex", codex_metrics, codex_error)
                except Exception:
                    pass

        status_bar.last_updated = datetime.now().strftime("%H:%M:%S")
        status_bar.auto_refresh_enabled = self.auto_refresh_enabled
        status_bar.refresh_interval = self.refresh_interval

        # Update data source display
        sources = []
        if 'claude' in self.services:
            sources.append(f"Claude: {self.data_source.get('claude', 'unknown')}")
        if 'codex' in self.services:
            sources.append(f"Codex: {self.data_source.get('codex', 'unknown')}")
        status_bar.data_source = " | ".join(sources) if sources else "No data"

        # Store snapshots to database
        self._store_snapshots(claude_metrics, codex_metrics)

    def action_show_snapshot(self) -> None:
        """Toggle to snapshot view (s key)."""
        try:
            self.view_mode = "snapshot"
        except Exception as e:
            logger.error(f"action_show_snapshot failed: {e}")

    def action_show_graph(self) -> None:
        """Switch to graph view (g key)."""
        try:
            self.view_mode = "graph"
            # Optionally focus on the first available tab
            try:
                graph_tabs = self.query_one("#graph-tabs", TabbedContent)
                if not graph_tabs.active or graph_tabs.active == "":
                    if 'claude' in self.services:
                        graph_tabs.active = "claude-weekly-tab"
                    elif 'codex' in self.services:
                        graph_tabs.active = "codex-weekly-tab"
            except Exception:
                pass
        except Exception as e:
            logger.error(f"action_show_graph failed: {e}")

    def action_show_claude_weekly(self) -> None:
        """Jump to Claude Weekly chart (1 key)."""
        if 'claude' not in self.services:
            return
        # Switch to graph mode first
        self.view_mode = "graph"
        # Set active tab after a brief delay to ensure view is visible
        self.call_later(lambda: self._set_active_tab("claude-weekly-tab"))

    def action_show_codex_weekly(self) -> None:
        """Jump to Codex Weekly chart (2 key)."""
        if 'codex' not in self.services:
            return
        self.view_mode = "graph"
        self.call_later(lambda: self._set_active_tab("codex-weekly-tab"))

    def action_show_claude_session(self) -> None:
        """Jump to Claude Session chart (3 key)."""
        if 'claude' not in self.services:
            return
        self.view_mode = "graph"
        self.call_later(lambda: self._set_active_tab("claude-session-tab"))

    def action_show_codex_session(self) -> None:
        """Jump to Codex Session chart (4 key)."""
        if 'codex' not in self.services:
            return
        self.view_mode = "graph"
        self.call_later(lambda: self._set_active_tab("codex-session-tab"))

    def action_show_claude_sonnet(self) -> None:
        """Jump to Claude Sonnet chart (5 key)."""
        if 'claude' not in self.services:
            return
        self.view_mode = "graph"
        self.call_later(lambda: self._set_active_tab("claude-sonnet-tab"))

    def _set_active_tab(self, tab_id: str) -> None:
        """Helper to set active tab safely."""
        try:
            graph_tabs = self.query_one("#graph-tabs", TabbedContent)
            graph_tabs.active = tab_id
        except Exception as e:
            logger.error(f"_set_active_tab failed for {tab_id}: {e}")

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

[bold yellow]Global:[/bold yellow]
[bold]S[/bold] - Show snapshot view (progress bars)
[bold]G[/bold] - Show graph view (historical charts)
[bold]R[/bold] - Refresh now (manual)
[bold]P[/bold] - Pause/Resume auto-refresh
[bold]+[/bold] - Increase refresh rate (decrease interval)
[bold]-[/bold] - Decrease refresh rate (increase interval)
[bold]?[/bold] - Show this help
[bold]Q[/bold] - Quit

[bold yellow]Graph View:[/bold yellow]
[bold]1[/bold] - Claude Weekly chart (most important)
[bold]2[/bold] - Codex Weekly chart
[bold]3[/bold] - Claude Session chart
[bold]4[/bold] - Codex Session chart
[bold]5[/bold] - Claude Sonnet chart

[dim]Use Tab/Shift+Tab to navigate between charts[/dim]
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
