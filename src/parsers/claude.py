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


def parse_subscription(output: str) -> Optional[str]:
    """Parse subscription type from Claude landing page.

    Extracts subscription from pattern: "Sonnet 4.5 · Claude Max"

    Args:
        output: Raw output from Claude CLI

    Returns:
        Subscription type ('Max', 'Pro', etc.) or None
    """
    # Priority 1: Look for subscription tiers after "Claude" (Max, Pro, Plus)
    # Match pattern like "· Claude Max" or "· Claude Pro"
    match = re.search(r'·\s+Claude\s+(Max|Pro|Plus)', output)
    if match:
        return match.group(1)

    # Priority 2: Look for standalone subscription keywords near "Claude"
    # Check within reasonable proximity (same line or next line)
    for line in output.split('\n'):
        if 'Claude' in line or 'Sonnet' in line:
            if re.search(r'\bMax\b', line):
                return 'Max'
            if re.search(r'\bPro\b', line):
                return 'Pro'
            if re.search(r'\bPlus\b', line):
                return 'Plus'

    # Priority 3: Generic "Claude [Type]" but exclude product names
    match = re.search(r'Claude\s+([A-Z][a-z]+)', output)
    if match:
        subscription = match.group(1)
        # Exclude product names like "Code"
        if subscription not in ['Code']:
            return subscription

    return None


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


def parse_claude_output(output: str) -> Dict[str, any]:
    """Parse complete Claude usage output.

    Args:
        output: Raw output from Claude CLI

    Returns:
        Dict with 'subscription_type', 'session', 'week_all', 'week_sonnet'
    """
    metrics = {
        'session': parse_session(output),
        'week_all': parse_week_all(output),
        'week_sonnet': parse_week_sonnet(output)
    }

    metrics = apply_fallbacks(metrics)

    # Add subscription as top-level key
    subscription = parse_subscription(output)

    return {
        'subscription_type': subscription,
        **metrics
    }
