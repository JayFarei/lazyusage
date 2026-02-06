"""Text formatter (matches bash script output) with graceful handling of missing services."""

from typing import Dict, Optional


def format_claude(metrics: Dict[str, any]) -> str:
    """Format Claude metrics as text with subscription suffix.

    Args:
        metrics: Dict with keys 'subscription_type', 'session', 'week_all', 'week_sonnet'

    Returns:
        Formatted string like:
        "Session: 25% used (75% remaining) (resets 2:31pm) | Weekly: 15% used (85% remaining) (resets Feb 9 at 8:19pm) | Sonnet: 10% used (90% remaining) (resets Feb 9 at 8:19pm) [Subscription: Max]"
    """
    subscription = metrics.get('subscription_type')
    session = metrics['session']
    week_all = metrics['week_all']
    week_sonnet = metrics['week_sonnet']

    base = (
        f"Session: {session['used_pct']}% used ({session['remaining_pct']}% remaining) (resets {session['resets']}) | "
        f"Weekly: {week_all['used_pct']}% used ({week_all['remaining_pct']}% remaining) (resets {week_all['resets']}) | "
        f"Sonnet: {week_sonnet['used_pct']}% used ({week_sonnet['remaining_pct']}% remaining) (resets {week_sonnet['resets']})"
    )

    if subscription:
        return f"{base} [Subscription: {subscription}]"
    return base


def format_codex(metrics: Dict[str, any]) -> str:
    """Format Codex metrics as text with subscription suffix.

    Args:
        metrics: Dict with keys 'subscription_type', '5h', 'weekly'

    Returns:
        Formatted string like:
        "5h: 20% used (80% remaining) (resets 3:15pm) | Weekly: 12% used (88% remaining) (resets Feb 10 at 9:00pm) [Subscription: Plus]"
    """
    subscription = metrics.get('subscription_type')
    five_h = metrics['5h']
    weekly = metrics['weekly']

    base = (
        f"5h: {five_h['used_pct']}% used ({five_h['remaining_pct']}% remaining) (resets {five_h['resets']}) | "
        f"Weekly: {weekly['used_pct']}% used ({weekly['remaining_pct']}% remaining) (resets {weekly['resets']})"
    )

    if subscription:
        return f"{base} [Subscription: {subscription}]"
    return base


def format_all(claude_metrics: Dict[str, any], codex_metrics: Dict[str, any]) -> str:
    """Format combined Claude and Codex metrics.

    Args:
        claude_metrics: Claude metrics dict
        codex_metrics: Codex metrics dict

    Returns:
        Combined formatted string with headers
    """
    claude_line = format_claude(claude_metrics)
    codex_line = format_codex(codex_metrics)

    return f"Claude: {claude_line}\nCodex: {codex_line}"


def format_with_availability(
    claude_metrics: Optional[Dict[str, any]],
    codex_metrics: Optional[Dict[str, any]],
    available_services: list
) -> str:
    """Format metrics with graceful handling of missing services.

    Args:
        claude_metrics: Claude metrics dict (None if not available)
        codex_metrics: Codex metrics dict (None if not available)
        available_services: List of available service names

    Returns:
        Formatted string with [not available] for missing services
    """
    lines = []

    # Claude line
    if claude_metrics and 'claude' in available_services:
        lines.append(f"Claude: {format_claude(claude_metrics)}")
    else:
        lines.append("Claude: [not available]")

    # Codex line
    if codex_metrics and 'codex' in available_services:
        lines.append(f"Codex: {format_codex(codex_metrics)}")
    else:
        lines.append("Codex: [not available]")

    return "\n".join(lines)
