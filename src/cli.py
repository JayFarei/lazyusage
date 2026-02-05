"""Main CLI interface."""

import click
import time
from .collectors.claude import ClaudeEphemeralCollector
from .collectors.codex import CodexEphemeralCollector
from .formatters.text import format_claude, format_codex, format_all
from .formatters.json import format_json, format_all_json
from .formatters.dashboard import Dashboard


@click.group(invoke_without_command=True)
@click.option('--live', is_flag=True, help='Launch live dashboard')
@click.option('--refresh', default=10, type=int, help='Dashboard refresh interval (default: 10s, minimum: 5s)')
@click.option('--debug', is_flag=True, help='Show execution timing')
@click.pass_context
def main(ctx, live, refresh, debug):
    """Usage monitoring CLI for Claude and Codex.

    Examples:
        usage claude           - Show Claude usage
        usage codex            - Show Codex usage
        usage all              - Show both CLIs
        usage --live           - Launch live dashboard (10s refresh)
        usage --live --refresh 5   - Live dashboard with 5s refresh
        usage dashboard --refresh 30   - Live dashboard with 30s refresh
    """
    # If --live flag is used, launch dashboard
    if live:
        dashboard = Dashboard(refresh_interval=refresh, debug=debug)
        dashboard.run()
    elif ctx.invoked_subcommand is None:
        # No subcommand and no --live flag: show help
        click.echo(ctx.get_help())


@main.command()
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON')
@click.option('--debug', is_flag=True, help='Show execution timing')
def claude(output_json, debug):
    """Collect and display Claude CLI usage."""
    start_time = time.time()

    # Collect metrics
    collector = ClaudeEphemeralCollector()
    metrics = collector.collect()

    # Format output
    if output_json:
        output = format_json('claude', metrics)
    else:
        output = format_claude(metrics)

    click.echo(output)

    # Show timing if debug mode
    if debug:
        elapsed = time.time() - start_time
        click.echo(f"\nExecution time: {elapsed:.2f}s")


@main.command()
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON')
@click.option('--debug', is_flag=True, help='Show execution timing')
def codex(output_json, debug):
    """Collect and display Codex CLI usage."""
    start_time = time.time()

    # Collect metrics
    collector = CodexEphemeralCollector()
    metrics = collector.collect()

    # Format output
    if output_json:
        output = format_json('codex', metrics)
    else:
        output = format_codex(metrics)

    click.echo(output)

    # Show timing if debug mode
    if debug:
        elapsed = time.time() - start_time
        click.echo(f"\nExecution time: {elapsed:.2f}s")


@main.command()
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON')
@click.option('--debug', is_flag=True, help='Show execution timing')
def all(output_json, debug):
    """Collect and display usage for both Claude and Codex."""
    start_time = time.time()

    # Collect metrics from both CLIs
    claude_collector = ClaudeEphemeralCollector()
    claude_metrics = claude_collector.collect()

    codex_collector = CodexEphemeralCollector()
    codex_metrics = codex_collector.collect()

    # Format output
    if output_json:
        output = format_all_json(claude_metrics, codex_metrics)
    else:
        output = format_all(claude_metrics, codex_metrics)

    click.echo(output)

    # Show timing if debug mode
    if debug:
        elapsed = time.time() - start_time
        click.echo(f"\nExecution time: {elapsed:.2f}s")


@main.command()
@click.option('--refresh', default=10, type=int, help='Refresh interval in seconds (default: 10s, minimum: 5s)')
@click.option('--debug', is_flag=True, help='Show debug information')
def dashboard(refresh, debug):
    """Launch live dashboard with progress bars."""
    dash = Dashboard(refresh_interval=refresh, debug=debug)
    dash.run()


@main.command()
@click.option('--refresh', default=10, type=int, help='Initial refresh interval in seconds (default: 10s, minimum: 5s)')
def tui(refresh):
    """Launch interactive TUI with keyboard controls.

    Keyboard shortcuts:
        R - Refresh now (manual)
        P - Pause/Resume auto-refresh
        + - Increase refresh rate (decrease interval)
        - - Decrease refresh rate (increase interval)
        J - Toggle JSON view
        ? - Show help
        Q - Quit
    """
    from .formatters.tui import UsageTUI
    app = UsageTUI(refresh_interval=refresh)
    app.run()


if __name__ == '__main__':
    main()
