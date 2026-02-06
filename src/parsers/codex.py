"""Parser for Codex CLI /status output."""

import re
from datetime import datetime
from typing import Dict, Optional
from ..utils.time import calculate_fallback_time, format_12h_time, format_reset_date


def parse_5h_limit(output: str) -> Dict[str, any]:
    """Parse 5h limit metric from Codex /status output.

    Args:
        output: Raw output from Codex CLI

    Returns:
        Dict with keys: used_pct, remaining_pct, resets
    """
    # Extract 5h percentage left
    match = re.search(r'5h limit:.*?(\d+)% left', output)
    left_pct = int(match.group(1)) if match else None

    # Extract 5h reset time (24-hour format like "14:31")
    match = re.search(r'5h limit:.*?resets\s+([0-9:]+)', output)
    reset_raw = match.group(1).strip() if match else None

    # Convert 24-hour time to 12-hour format
    resets = None
    if reset_raw and ':' in reset_raw:
        hour, minute = reset_raw.split(':')
        resets = format_12h_time(int(hour), int(minute))

    return {
        'used_pct': (100 - left_pct) if left_pct is not None else None,
        'remaining_pct': left_pct,
        'resets': resets
    }


def _parse_month(month_str: str) -> Optional[int]:
    """Parse month string to month number.

    Args:
        month_str: Month name (abbreviated like "Feb" or full like "February")

    Returns:
        Month number (1-12) or None if parsing fails
    """
    for fmt in ["%b", "%B"]:
        try:
            return datetime.strptime(month_str, fmt).month
        except ValueError:
            continue
    return None


def parse_weekly_limit(output: str) -> Dict[str, any]:
    """Parse weekly limit metric from Codex /status output.

    The weekly limit reset time appears on a separate line after "Weekly limit:"

    Args:
        output: Raw output from Codex CLI

    Returns:
        Dict with keys: used_pct, remaining_pct, resets
    """
    # Extract weekly percentage left
    match = re.search(r'weekly limit:.*?(\d+)% left', output, re.IGNORECASE)
    left_pct = int(match.group(1)) if match else None

    # Use single regex to find "Weekly limit:" and capture the next line's reset time
    # This is more efficient than splitting into lines and iterating
    reset_match = re.search(
        r'weekly limit:.*?\n.*?resets\s+(.+)',
        output,
        re.IGNORECASE | re.DOTALL
    )

    resets = None
    if reset_match:
        reset_raw = reset_match.group(1).strip()

        # Parse "HH:MM on D Mon" format
        time_match = re.match(r'(\d+):(\d+)\s+on\s+(\d+)\s+(\w+)', reset_raw)
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2))
            day = int(time_match.group(3))
            month_str = time_match.group(4)

            # Parse month string using helper function
            month_num = _parse_month(month_str)

            if month_num is not None:
                # Create datetime object with parsed values
                reset_dt = datetime(
                    year=datetime.now().year,
                    month=month_num,
                    day=day,
                    hour=hour,
                    minute=minute
                )

                # Format using consistent format_reset_date function
                resets = format_reset_date(reset_dt)

    return {
        'used_pct': (100 - left_pct) if left_pct is not None else None,
        'remaining_pct': left_pct,
        'resets': resets
    }


def parse_subscription(output: str) -> Optional[str]:
    """Parse subscription type from Codex /status output.

    Extracts from pattern: "Account: email@example.com (Plus)"

    Args:
        output: Raw output from Codex CLI

    Returns:
        Subscription type ('Plus', 'Free', etc.) or None
    """
    # Match pattern: "Account: ... (Type)"
    match = re.search(r'Account:.*?\(([A-Za-z]+)\)', output)
    if match:
        return match.group(1).capitalize()

    return None


def apply_fallbacks(metrics: Dict[str, Dict]) -> Dict[str, Dict]:
    """Apply fallback values to missing metrics.

    Args:
        metrics: Dict with keys '5h', 'weekly'

    Returns:
        Updated metrics dict with fallbacks applied
    """
    # 5h fallbacks (5-hour window)
    if metrics['5h']['used_pct'] is None:
        metrics['5h']['used_pct'] = 0
        metrics['5h']['remaining_pct'] = 100
    if metrics['5h']['resets'] is None:
        metrics['5h']['resets'] = calculate_fallback_time(5, same_day=True)

    # Weekly fallbacks (7-day window)
    if metrics['weekly']['used_pct'] is None:
        metrics['weekly']['used_pct'] = 0
        metrics['weekly']['remaining_pct'] = 100
    if metrics['weekly']['resets'] is None:
        metrics['weekly']['resets'] = calculate_fallback_time(168, same_day=False)  # 7 days = 168 hours

    return metrics


def parse_codex_output(output: str) -> Dict[str, any]:
    """Parse complete Codex status output.

    Args:
        output: Raw output from Codex CLI

    Returns:
        Dict with 'subscription_type', '5h', 'weekly'
    """
    metrics = {
        '5h': parse_5h_limit(output),
        'weekly': parse_weekly_limit(output)
    }

    metrics = apply_fallbacks(metrics)

    subscription = parse_subscription(output)

    return {
        'subscription_type': subscription,
        **metrics
    }
