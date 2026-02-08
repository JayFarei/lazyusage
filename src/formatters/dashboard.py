"""Live dashboard with progress bars."""

import time
import signal
import sys
from datetime import datetime
from typing import Dict, Optional
from rich.console import Console
from rich.live import Live
from rich.layout import Layout
from rich.panel import Panel
from rich.progress import Progress, BarColumn, TextColumn
from rich.table import Table
from ..providers import create_claude_chain, create_codex_chain
from ..utils.time import calculate_time_progress
from ..utils.bars import (
    calculate_bar_width, create_time_markers, create_capacity_bar, create_period_bar,
    MIN_TERMINAL_WIDTH, MIN_TERMINAL_HEIGHT,
)

# Layout overhead for Dashboard:
#   Prefix spaces: 2, Max column 2 content ("Time segments (7 divisions)"): 28,
#   Table cell padding: 4, Safety margin: 2
DASHBOARD_OVERHEAD = 36


class Dashboard:
    """Live dashboard with progress bars for both CLIs."""

    def __init__(self, refresh_interval: int = 10, debug: bool = False):
        """Initialize dashboard.

        Args:
            refresh_interval: Seconds between refreshes (minimum 5)
            debug: Show debug information
        """
        self.refresh_interval = max(5, refresh_interval)  # Minimum 5 seconds
        self.debug = debug
        self.console = Console()
        self.claude_chain = None
        self.codex_chain = None
        self.data_source = {}
        self.running = False
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

    def _signal_handler(self, signum, frame):
        """Handle Ctrl+C gracefully."""
        self.running = False
        self._winddown()
        sys.exit(0)

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
            if claude_metrics:
                if self.dedup_tracker.should_store_metrics('claude', claude_metrics):
                    source = self.data_source.get('claude', 'unknown')
                    self.usage_store.store_snapshot(
                        'claude',
                        claude_metrics,
                        source,
                        collection_id
                    )

            # Store Codex metrics if changed
            if codex_metrics:
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

    def _winddown(self):
        """Cleanup: stop persistent chains."""
        if self.claude_chain:
            try:
                self.claude_chain.stop()
            except Exception as e:
                if self.debug:
                    self.console.print(f"[yellow]Error stopping Claude chain: {e}[/yellow]")

        if self.codex_chain:
            try:
                self.codex_chain.stop()
            except Exception as e:
                if self.debug:
                    self.console.print(f"[yellow]Error stopping Codex chain: {e}[/yellow]")

    def _create_table(self, claude_metrics: Optional[Dict], codex_metrics: Optional[Dict], last_updated: str, cycle_time: Optional[float] = None) -> Table:
        """Create rich table with progress bars.

        Args:
            claude_metrics: Claude metrics dict
            codex_metrics: Codex metrics dict
            last_updated: Last update timestamp
            cycle_time: Time taken for last refresh cycle (debug mode)

        Returns:
            Rich Table
        """
        table = Table.grid(padding=(0, 1))
        table.add_column(justify="right")
        table.add_column(justify="left", no_wrap=True)

        # Check if terminal is too small
        term = self.console.size
        if term.width < MIN_TERMINAL_WIDTH or term.height < MIN_TERMINAL_HEIGHT:
            table.add_row(
                f"[yellow]Terminal too small ({term.width}x{term.height}). "
                f"Please resize to at least {MIN_TERMINAL_WIDTH}x{MIN_TERMINAL_HEIGHT}.[/yellow]"
            )
            return table

        # Title
        table.add_row()
        table.add_row("[bold cyan]Usage Dashboard[/bold cyan]")
        table.add_row()

        # Dynamic bar width based on terminal size
        bar_width = calculate_bar_width(self.console.size.width, DASHBOARD_OVERHEAD)

        # Claude metrics
        if claude_metrics:
            subscription = claude_metrics.get('subscription_type')
            title = f"[bold]Claude Usage - {subscription}[/bold]" if subscription else "[bold]Claude Usage[/bold]"
            table.add_row(title)

            for name, data in claude_metrics.items():
                if name == 'subscription_type':
                    continue
                label_map = {
                    'session': 'Session',
                    'week_all': 'Weekly',
                    'week_sonnet': 'Sonnet'
                }
                label = label_map.get(name, name)

                # Determine window hours and divisions
                if name == 'session':
                    window_hours = 5
                    divisions = 5
                else:  # weekly metrics
                    window_hours = 168  # 7 days
                    divisions = 7

                # Capacity bar (token usage)
                used = data['used_pct']
                capacity_bar = create_capacity_bar(used, bar_width)

                # Time markers bar
                markers_bar = create_time_markers(divisions, bar_width)

                # Period bar (time progression)
                time_pct = calculate_time_progress(data['resets'], window_hours)
                period_bar = create_period_bar(time_pct, bar_width)

                # Render: capacity + markers + period + reset text
                table.add_row(
                    f"  {capacity_bar}",
                    f"{used}% Capacity"
                )
                table.add_row(
                    f"  [dim]{markers_bar}[/dim]",
                    f"Time segments ({divisions} divisions)"
                )
                table.add_row(
                    f"  [yellow]{period_bar}[/yellow]",
                    f"{int(time_pct)}% Period"
                )
                table.add_row(
                    "",
                    f"Resets {data['resets']}"
                )

            table.add_row()

        # Codex metrics
        if codex_metrics:
            subscription = codex_metrics.get('subscription_type')
            title = f"[bold]Codex Usage - {subscription}[/bold]" if subscription else "[bold]Codex Usage[/bold]"
            table.add_row(title)

            for name, data in codex_metrics.items():
                if name == 'subscription_type':
                    continue
                label_map = {
                    '5h': '5h',
                    'weekly': 'Weekly'
                }
                label = label_map.get(name, name)

                # Determine window hours and divisions
                if name == '5h':
                    window_hours = 5
                    divisions = 5
                else:  # weekly
                    window_hours = 168
                    divisions = 7

                # Capacity bar (token usage)
                used = data['used_pct']
                capacity_bar = create_capacity_bar(used, bar_width)

                # Time markers bar
                markers_bar = create_time_markers(divisions, bar_width)

                # Period bar (time progression)
                time_pct = calculate_time_progress(data['resets'], window_hours)
                period_bar = create_period_bar(time_pct, bar_width)

                # Render: capacity + markers + period + reset text
                table.add_row(
                    f"  {capacity_bar}",
                    f"{used}% Capacity"
                )
                table.add_row(
                    f"  [dim]{markers_bar}[/dim]",
                    f"Time segments ({divisions} divisions)"
                )
                table.add_row(
                    f"  [yellow]{period_bar}[/yellow]",
                    f"{int(time_pct)}% Period"
                )
                table.add_row(
                    "",
                    f"Resets {data['resets']}"
                )

            table.add_row()

        # Footer
        table.add_row()
        footer = f"Last updated: {last_updated} | Refresh: {self.refresh_interval}s"
        if cycle_time and self.debug:
            footer += f" | Cycle: {cycle_time:.1f}s"
        table.add_row(footer)

        return table

    def run(self):
        """Run live dashboard with three-phase workflow.

        Phase 1 (Windup): Create persistent collectors, collect initial metrics
        Phase 2 (Poll loop): Refresh metrics, render, sleep, repeat
        Phase 3 (Winddown): Cleanup on Ctrl+C or exit
        """
        # Setup signal handler for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)

        self.running = True

        # Phase 1: Windup
        if self.debug:
            self.console.print("[cyan]WINDUP: Creating persistent chains...[/cyan]")

        windup_start = time.time()

        try:
            # Create Claude chain
            if self.debug:
                self.console.print(f"[cyan]Creating Claude chain...[/cyan]")
            self.claude_chain = create_claude_chain(persistent=True)
            result = self.claude_chain.start()
            claude_metrics = result.metrics
            self.data_source['claude'] = result.source.value

            # Create Codex chain
            if self.debug:
                self.console.print(f"[cyan]Creating Codex chain...[/cyan]")
            self.codex_chain = create_codex_chain(persistent=True)
            result = self.codex_chain.start()
            codex_metrics = result.metrics
            self.data_source['codex'] = result.source.value

            windup_time = time.time() - windup_start
            if self.debug:
                self.console.print(f"[green]WINDUP complete in {windup_time:.1f}s[/green]")
                self.console.print(f"[cyan]Sources: Claude={self.data_source['claude']}, Codex={self.data_source['codex']}[/cyan]\n")

        except Exception as e:
            self.console.print(f"[red]Error during windup: {e}[/red]")
            self._winddown()
            return

        # Phase 2: Poll loop
        with Live(self._create_table(claude_metrics, codex_metrics, datetime.now().strftime("%H:%M:%S")), refresh_per_second=1) as live:
            refresh_count = 0

            while self.running:
                # Sleep before refresh (except first iteration)
                if refresh_count > 0:
                    time.sleep(self.refresh_interval)

                if not self.running:
                    break

                refresh_count += 1
                cycle_start = time.time()

                try:
                    # Refresh metrics from both chains
                    if self.debug:
                        self.console.print(f"[cyan]REFRESH {refresh_count}: Collecting metrics...[/cyan]")

                    result = self.claude_chain.refresh()
                    claude_metrics = result.metrics
                    self.data_source['claude'] = result.source.value
                    if result.stale:
                        self.data_source['claude'] += ' (stale)'

                    result = self.codex_chain.refresh()
                    codex_metrics = result.metrics
                    self.data_source['codex'] = result.source.value
                    if result.stale:
                        self.data_source['codex'] += ' (stale)'

                    cycle_time = time.time() - cycle_start

                    if self.debug:
                        self.console.print(f"[green]REFRESH {refresh_count} complete in {cycle_time:.1f}s[/green]")
                        self.console.print(f"[cyan]Sources: Claude={self.data_source['claude']}, Codex={self.data_source['codex']}[/cyan]")

                    # Store snapshots to database
                    self._store_snapshots(claude_metrics, codex_metrics)

                    # Update display
                    live.update(
                        self._create_table(
                            claude_metrics,
                            codex_metrics,
                            datetime.now().strftime("%H:%M:%S"),
                            cycle_time if self.debug else None
                        )
                    )

                except Exception as e:
                    if self.debug:
                        self.console.print(f"[red]Error during refresh: {e}[/red]")
                    # Continue polling despite errors

        # Phase 3: Winddown
        if self.debug:
            self.console.print("\n[cyan]WINDDOWN: Cleaning up sessions...[/cyan]")
        self._winddown()
        if self.debug:
            self.console.print("[green]WINDDOWN complete[/green]")
