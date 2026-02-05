"""Parser for Claude CLI usage output."""

import re
from typing import Dict, Optional
from ..utils.time import calculate_fallback_time


def parse_session(output: str) -> Dict[str, any]:
    """Parse session metric from Claude /usage output.

    Args:
        output: Raw output from Claude CLI

    Returns:
        Dict with keys: used_pct, remaining_pct, resets
    """
    # Extract session percentage: look for "Current session" followed by "% used"
    match = re.search(r'Current session.*?(\d+)% used', output, re.DOTALL)
    used_pct = int(match.group(1)) if match else None

    # Extract session reset time: look for "Resets" after "Current session"
    match = re.search(r'Current session.*?Resets\s+([^\(]+)', output, re.DOTALL)
    resets = match.group(1).strip() if match else None

    return {
        'used_pct': used_pct,
        'remaining_pct': (100 - used_pct) if used_pct is not None else None,
        'resets': resets
    }


def parse_week_all(output: str) -> Dict[str, any]:
    """Parse weekly all-models metric from Claude /usage output.

    Args:
        output: Raw output from Claude CLI

    Returns:
        Dict with keys: used_pct, remaining_pct, resets
    """
    # Extract weekly percentage: look for "Current week (all models)" followed by "% used"
    match = re.search(r'Current week \(all models\).*?(\d+)% used', output, re.DOTALL)
    used_pct = int(match.group(1)) if match else None

    # Extract weekly reset time: look for "Resets" after "Current week (all models)"
    match = re.search(r'Current week \(all models\).*?Resets\s+([^\(]+)', output, re.DOTALL)
    resets = match.group(1).strip() if match else None

    return {
        'used_pct': used_pct,
        'remaining_pct': (100 - used_pct) if used_pct is not None else None,
        'resets': resets
    }


def parse_week_sonnet(output: str) -> Dict[str, any]:
    """Parse weekly Sonnet-only metric from Claude /usage output.

    Args:
        output: Raw output from Claude CLI

    Returns:
        Dict with keys: used_pct, remaining_pct, resets
    """
    # Extract Sonnet percentage: look for "Current week (Sonnet only)" followed by "% used"
    match = re.search(r'Current week \(Sonnet only\).*?(\d+)% used', output, re.DOTALL)
    used_pct = int(match.group(1)) if match else None

    # Extract Sonnet reset time: look for "Resets" after "Current week (Sonnet only)"
    match = re.search(r'Current week \(Sonnet only\).*?Resets\s+([^\(]+)', output, re.DOTALL)
    resets = match.group(1).strip() if match else None

    return {
        'used_pct': used_pct,
        'remaining_pct': (100 - used_pct) if used_pct is not None else None,
        'resets': resets
    }


def apply_fallbacks(metrics: Dict[str, Dict]) -> Dict[str, Dict]:
    """Apply fallback values to missing metrics.

    Args:
        metrics: Dict with keys 'session', 'week_all', 'week_sonnet'

    Returns:
        Updated metrics dict with fallbacks applied
    """
    # Session fallbacks (5-hour window)
    if metrics['session']['used_pct'] is None:
        metrics['session']['used_pct'] = 0
        metrics['session']['remaining_pct'] = 100
    if metrics['session']['resets'] is None:
        metrics['session']['resets'] = calculate_fallback_time(5, same_day=True)

    # Week (all models) fallbacks (7-day window)
    if metrics['week_all']['used_pct'] is None:
        metrics['week_all']['used_pct'] = 0
        metrics['week_all']['remaining_pct'] = 100
    if metrics['week_all']['resets'] is None:
        metrics['week_all']['resets'] = calculate_fallback_time(168, same_day=False)  # 7 days = 168 hours

    # Week (Sonnet only) fallbacks (7-day window)
    if metrics['week_sonnet']['used_pct'] is None:
        metrics['week_sonnet']['used_pct'] = 0
        metrics['week_sonnet']['remaining_pct'] = 100
    if metrics['week_sonnet']['resets'] is None:
        metrics['week_sonnet']['resets'] = calculate_fallback_time(168, same_day=False)

    return metrics


def parse_claude_output(output: str) -> Dict[str, Dict]:
    """Parse complete Claude usage output.

    Args:
        output: Raw output from Claude CLI

    Returns:
        Dict with keys 'session', 'week_all', 'week_sonnet'
    """
    metrics = {
        'session': parse_session(output),
        'week_all': parse_week_all(output),
        'week_sonnet': parse_week_sonnet(output)
    }

    return apply_fallbacks(metrics)
