"""Text formatter (matches bash script output)."""

from typing import Dict


def format_claude(metrics: Dict[str, Dict]) -> str:
    """Format Claude metrics as text (matches bash script output).

    Args:
        metrics: Dict with keys 'session', 'week_all', 'week_sonnet'

    Returns:
        Formatted string like:
        "Session: 25% used (75% remaining) (resets 2:31pm) | Weekly: 15% used (85% remaining) (resets Feb 9 at 8:19pm) | Sonnet: 10% used (90% remaining) (resets Feb 9 at 8:19pm)"
    """
    session = metrics['session']
    week_all = metrics['week_all']
    week_sonnet = metrics['week_sonnet']

    return (
        f"Session: {session['used_pct']}% used ({session['remaining_pct']}% remaining) (resets {session['resets']}) | "
        f"Weekly: {week_all['used_pct']}% used ({week_all['remaining_pct']}% remaining) (resets {week_all['resets']}) | "
        f"Sonnet: {week_sonnet['used_pct']}% used ({week_sonnet['remaining_pct']}% remaining) (resets {week_sonnet['resets']})"
    )


def format_codex(metrics: Dict[str, Dict]) -> str:
    """Format Codex metrics as text (matches bash script output).

    Args:
        metrics: Dict with keys '5h', 'weekly'

    Returns:
        Formatted string like:
        "5h: 20% used (80% remaining) (resets 3:15pm) | Weekly: 12% used (88% remaining) (resets Feb 10 at 9:00pm)"
    """
    five_h = metrics['5h']
    weekly = metrics['weekly']

    return (
        f"5h: {five_h['used_pct']}% used ({five_h['remaining_pct']}% remaining) (resets {five_h['resets']}) | "
        f"Weekly: {weekly['used_pct']}% used ({weekly['remaining_pct']}% remaining) (resets {weekly['resets']})"
    )


def format_all(claude_metrics: Dict[str, Dict], codex_metrics: Dict[str, Dict]) -> str:
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
