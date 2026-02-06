"""Main CLI interface with two primary commands: usage-check and usage."""

import click
import subprocess
import sys
import time
from typing import List, Optional
from .collectors.claude import ClaudeEphemeralCollector
from .collectors.codex import CodexEphemeralCollector
from .formatters.text import format_claude, format_codex, format_all
from .formatters.json import format_json, format_all_json


def detect_available_services() -> List[str]:
    """Detect which CLI services are available in PATH.

    Returns:
        List of available service names: ['claude', 'codex'] or subset
    """
    available = []

    # Try to detect claude CLI
    try:
        result = subprocess.run(
            ['which', 'claude'],
            capture_output=True,
            timeout=1
        )
        if result.returncode == 0:
            available.append('claude')
    except Exception:
        pass

    # Try to detect codex CLI
    try:
        result = subprocess.run(
            ['which', 'codex'],
            capture_output=True,
            timeout=1
        )
        if result.returncode == 0:
            available.append('codex')
    except Exception:
        pass

    return available


def validate_service(service: Optional[str], available: List[str]) -> List[str]:
    """Validate requested service is available and return list of services to query.

    Args:
        service: Requested service ('claude', 'codex', 'all', or None for auto-detect)
        available: List of available services

    Returns:
        List of services to query

    Raises:
        click.UsageError: If requested service is not available
    """
    if not service:
        # Auto-detect
        if not available:
            raise click.UsageError(
                "No CLI tools found. Please install 'claude' or 'codex' CLI."
            )
        return available

    if service == 'all':
        # Force check both
        if len(available) < 2:
            missing = set(['claude', 'codex']) - set(available)
            raise click.UsageError(
                f"'all' requested but {', '.join(missing)} not available. "
                f"Only {', '.join(available)} found."
            )
        return ['claude', 'codex']

    # Specific service requested
    if service not in available:
        raise click.UsageError(
            f"'{service}' CLI not found in PATH. "
            f"Available: {', '.join(available) if available else 'none'}"
        )

    return [service]


def collect_metrics(services: List[str], debug: bool = False):
    """Collect metrics from specified services.

    Args:
        services: List of service names to collect from
        debug: Whether to show timing information

    Returns:
        Tuple of (claude_metrics, codex_metrics, available_services)
        Either metric dict can be None if service not in services list
    """
    claude_metrics = None
    codex_metrics = None

    if 'claude' in services:
        if debug:
            click.echo("Collecting Claude metrics...", err=True)
        collector = ClaudeEphemeralCollector()
        claude_metrics = collector.collect()

    if 'codex' in services:
        if debug:
            click.echo("Collecting Codex metrics...", err=True)
        collector = CodexEphemeralCollector()
        codex_metrics = collector.collect()

    return claude_metrics, codex_metrics


@click.command(name='usage-check')
@click.argument(
    'service',
    required=False,
    type=click.Choice(['claude', 'codex', 'all'], case_sensitive=False)
)
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON')
@click.option('--text', 'output_text', is_flag=True, help='Output as text (default)')
@click.option('--debug', is_flag=True, help='Show execution timing')
def usage_check(service, output_json, output_text, debug):
    """Fast point-in-time usage snapshot.

    SERVICE: Optional service name (claude, codex, or all).
             If omitted, auto-detects available CLIs.

    Examples:
        usage-check              - Auto-detect and show text
        usage-check --json       - Auto-detect and output JSON
        usage-check claude       - Check Claude only
        usage-check all --json   - Check both, output JSON
    """
    start_time = time.time()

    # Auto-detect available services
    available = detect_available_services()

    # Validate and get list of services to query
    try:
        services = validate_service(service, available)
    except click.UsageError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    # Collect metrics
    claude_metrics, codex_metrics = collect_metrics(services, debug)

    # Format output
    if output_json:
        from .formatters.json import format_combined_json
        output = format_combined_json(
            claude_metrics,
            codex_metrics,
            available
        )
    else:
        # Text output (default)
        if len(services) == 1:
            if 'claude' in services:
                output = format_claude(claude_metrics)
            else:
                output = format_codex(codex_metrics)
        else:
            output = format_all(claude_metrics, codex_metrics)

    click.echo(output)

    # Show timing if debug mode
    if debug:
        elapsed = time.time() - start_time
        click.echo(f"\nExecution time: {elapsed:.2f}s", err=True)


@click.command(name='usage')
@click.argument(
    'service',
    required=False,
    type=click.Choice(['claude', 'codex', 'all'], case_sensitive=False)
)
@click.option('--live', is_flag=True, help='Enable continuous updates (TUI mode by default)')
@click.option('--json', 'output_json', is_flag=True, help='JSON output instead of TUI')
@click.option('--text', 'output_text', is_flag=True, help='Text output, single refresh')
@click.option('--refresh', default=10, type=int, help='Refresh interval in seconds (default: 10, min: 5)')
@click.option('--debug', is_flag=True, help='Show debug information')
def usage(service, live, output_json, output_text, refresh, debug):
    """Interactive TUI or continuous monitoring.

    SERVICE: Optional service name (claude, codex, or all).
             If omitted, auto-detects available CLIs.

    Examples:
        usage                    - Launch TUI with auto-detected CLIs
        usage claude             - TUI showing Claude metrics only
        usage --text             - Quick text snapshot (like usage-check)
        usage --json --live      - Continuous JSON stream
        usage codex --refresh 5  - Codex TUI with 5s refresh
    """
    start_time = time.time()

    # Auto-detect available services
    available = detect_available_services()

    # Validate and get list of services to query
    try:
        services = validate_service(service, available)
    except click.UsageError as e:
        click.echo(f"Error: {e.message}", err=True)
        sys.exit(1)

    # Route to appropriate mode
    if output_text:
        # Single text snapshot (delegate to usage-check behavior)
        claude_metrics, codex_metrics = collect_metrics(services, debug)

        if len(services) == 1:
            if 'claude' in services:
                output = format_claude(claude_metrics)
            else:
                output = format_codex(codex_metrics)
        else:
            output = format_all(claude_metrics, codex_metrics)

        click.echo(output)

        if debug:
            elapsed = time.time() - start_time
            click.echo(f"\nExecution time: {elapsed:.2f}s", err=True)

    elif output_json and live:
        # Continuous JSON stream
        click.echo("Error: Continuous JSON stream not yet implemented", err=True)
        click.echo("Use 'usage --text' for single snapshot or 'usage' for TUI", err=True)
        sys.exit(1)

    else:
        # Launch TUI (default)
        from .formatters.tui import UsageTUI
        app = UsageTUI(refresh_interval=refresh, services=services, debug=debug)
        app.run()


def usage_check_main():
    """Entry point for usage-check command."""
    usage_check()


def usage_main():
    """Entry point for usage command."""
    usage()


if __name__ == '__main__':
    # Support both entry points when running as module
    if len(sys.argv) > 0 and 'check' in sys.argv[0]:
        usage_check_main()
    else:
        usage_main()
