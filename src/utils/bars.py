"""Shared bar-rendering utilities for usage formatters."""


# LCM of 5 and 7, ensures bars divide evenly for both session (5h) and weekly (7d)
BAR_WIDTH_STEP = 35

# Bar width limits (both multiples of BAR_WIDTH_STEP)
MIN_BAR_WIDTH = 35
MAX_BAR_WIDTH = 315

# Minimum terminal dimensions below which we show a "resize" message
MIN_TERMINAL_WIDTH = 70
MIN_TERMINAL_HEIGHT = 35


def calculate_bar_width(available_width: int, overhead: int) -> int:
    """Compute bar width from available terminal/widget width minus layout overhead.

    Snaps down to the nearest multiple of 35 (LCM of 5 and 7) so that
    marker positions for both 5-division and 7-division bars land on
    exact character boundaries.

    Args:
        available_width: Total available width in characters (terminal or widget)
        overhead: Characters consumed by labels, padding, borders, etc.

    Returns:
        Bar width snapped to nearest multiple of 35, clamped to [35, 315]
    """
    raw = available_width - overhead
    snapped = (raw // BAR_WIDTH_STEP) * BAR_WIDTH_STEP
    return max(MIN_BAR_WIDTH, min(snapped, MAX_BAR_WIDTH))


def create_time_markers(divisions: int, bar_width: int) -> str:
    """Create evenly-spaced division markers.

    Since bar_width is always a multiple of 35 (LCM of 5 and 7),
    markers land on exact character positions for both 5-div and 7-div.

    Args:
        divisions: Number of divisions (5 for 5h, 7 for weekly)
        bar_width: Width of the bar (must be multiple of 35)

    Returns:
        Unstyled bar string with evenly distributed markers
    """
    if divisions <= 1:
        return " " * bar_width

    segment = bar_width // divisions
    bar = ""
    for i in range(bar_width):
        if i > 0 and i % segment == 0 and i // segment < divisions:
            bar += "\u2503"  # ┃
        else:
            bar += " "

    return bar


def create_capacity_bar(used_pct: float, bar_width: int) -> str:
    """Create a filled/empty block bar showing capacity usage.

    Args:
        used_pct: Percentage used (0-100)
        bar_width: Width of the bar

    Returns:
        Unstyled bar string with filled and empty blocks
    """
    filled = round((used_pct / 100) * bar_width)
    return "\u2593" * filled + "\u2591" * (bar_width - filled)  # ▓ and ░


def create_period_bar(time_pct: float, bar_width: int) -> str:
    """Create a filled progress bar showing time elapsed.

    Args:
        time_pct: Percentage of time elapsed (0-100)
        bar_width: Width of the bar

    Returns:
        Unstyled bar string with time progression
    """
    filled = int((time_pct / 100) * bar_width)
    return "\u2593" * filled + "\u2591" * (bar_width - filled)  # ▓ and ░
