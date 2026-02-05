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
from ..collectors.claude import ClaudePersistentCollector
from ..collectors.codex import CodexPersistentCollector
from ..utils.time import calculate_time_progress


def _create_time_markers(divisions: int, bar_width: int = 30) -> str:
    """Create a bar showing only division markers.

    Args:
        divisions: Number of divisions (5 for 5h, 7 for weekly)
        bar_width: Width of bar (default 30)

    Returns:
        Formatted bar string with markers
    """
    # Calculate marker positions
    markers = [int(i * bar_width / divisions) for i in range(1, divisions)]

    # Build bar character by character
    bar = ""
    for i in range(bar_width):
        if i in markers:
            bar += "┃"
        else:
            bar += " "

    # Return with dim styling for subtle appearance
    return f"[dim]{bar}[/dim]"


def _create_period_bar(time_pct: float, bar_width: int = 30) -> str:
    """Create a filled progress bar showing time elapsed.

    Args:
        time_pct: Percentage of time elapsed (0-100)
        bar_width: Width of bar (default 30)

    Returns:
        Formatted bar string with time progression
    """
    # Calculate filled width
    filled = int((time_pct / 100) * bar_width)

    # Build bar
    bar = '▓' * filled + '░' * (bar_width - filled)

    # Return with yellow color to distinguish from capacity bars
    return f"[yellow]{bar}[/yellow]"


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
        self.claude_collector = None
        self.codex_collector = None
        self.running = False

    def _signal_handler(self, signum, frame):
        """Handle Ctrl+C gracefully."""
        self.running = False
        self._winddown()
        sys.exit(0)

    def _winddown(self):
        """Cleanup: stop persistent collectors."""
        if self.claude_collector:
            try:
                self.claude_collector.stop()
            except Exception as e:
                if self.debug:
                    self.console.print(f"[yellow]Error stopping Claude collector: {e}[/yellow]")

        if self.codex_collector:
            try:
                self.codex_collector.stop()
            except Exception as e:
                if self.debug:
                    self.console.print(f"[yellow]Error stopping Codex collector: {e}[/yellow]")

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

        # Title
        table.add_row()
        table.add_row("[bold cyan]Usage Dashboard[/bold cyan]")
        table.add_row()

        # Claude metrics
        if claude_metrics:
            table.add_row("[bold]Claude Usage[/bold]")

            for name, data in claude_metrics.items():
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

                # Capacity bar (existing usage bar)
                used = data['used_pct']
                bar_width = 30
                filled = int((used / 100) * bar_width)
                capacity_bar = '▓' * filled + '░' * (bar_width - filled)

                # Time markers bar
                markers_bar = _create_time_markers(divisions, bar_width)

                # Period bar (time progression)
                time_pct = calculate_time_progress(data['resets'], window_hours)
                period_bar = _create_period_bar(time_pct, bar_width)

                # Render: capacity + markers + period + reset text
                table.add_row(
                    f"  {capacity_bar}",
                    f"{used}% Capacity"
                )
                table.add_row(
                    f"  {markers_bar}",
                    f"Time segments ({divisions} divisions)"
                )
                table.add_row(
                    f"  {period_bar}",
                    f"{int(time_pct)}% Period"
                )
                table.add_row(
                    "",
                    f"Resets {data['resets']}"
                )

            table.add_row()

        # Codex metrics
        if codex_metrics:
            table.add_row("[bold]Codex Usage[/bold]")

            for name, data in codex_metrics.items():
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

                # Capacity bar (existing usage bar)
                used = data['used_pct']
                bar_width = 30
                filled = int((used / 100) * bar_width)
                capacity_bar = '▓' * filled + '░' * (bar_width - filled)

                # Time markers bar
                markers_bar = _create_time_markers(divisions, bar_width)

                # Period bar (time progression)
                time_pct = calculate_time_progress(data['resets'], window_hours)
                period_bar = _create_period_bar(time_pct, bar_width)

                # Render: capacity + markers + period + reset text
                table.add_row(
                    f"  {capacity_bar}",
                    f"{used}% Capacity"
                )
                table.add_row(
                    f"  {markers_bar}",
                    f"Time segments ({divisions} divisions)"
                )
                table.add_row(
                    f"  {period_bar}",
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
            self.console.print("[cyan]WINDUP: Creating persistent collectors...[/cyan]")

        windup_start = time.time()

        try:
            # Create Claude collector
            if self.debug:
                self.console.print(f"[cyan]Creating Claude collector...[/cyan]")
            self.claude_collector = ClaudePersistentCollector()
            claude_metrics = self.claude_collector.start()

            # Create Codex collector
            if self.debug:
                self.console.print(f"[cyan]Creating Codex collector...[/cyan]")
            self.codex_collector = CodexPersistentCollector()
            codex_metrics = self.codex_collector.start()

            windup_time = time.time() - windup_start
            if self.debug:
                self.console.print(f"[green]WINDUP complete in {windup_time:.1f}s[/green]\n")

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
                    # Refresh metrics from both collectors
                    if self.debug:
                        self.console.print(f"[cyan]REFRESH {refresh_count}: Collecting metrics...[/cyan]")

                    claude_metrics = self.claude_collector.refresh()
                    codex_metrics = self.codex_collector.refresh()

                    cycle_time = time.time() - cycle_start

                    if self.debug:
                        self.console.print(f"[green]REFRESH {refresh_count} complete in {cycle_time:.1f}s[/green]")

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
