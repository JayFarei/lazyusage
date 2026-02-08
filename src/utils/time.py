"""Time formatting utilities."""

from datetime import datetime, timedelta
from typing import Tuple


def format_12h_time(hour: int, minute: int) -> str:
    """Convert 24-hour time to 12-hour format (lowercase am/pm, no dots).

    Args:
        hour: Hour in 24-hour format (0-23)
        minute: Minute (0-59)

    Returns:
        Formatted time like "2:31pm" or "10:15am"
    """
    # Create datetime object for formatting
    dt = datetime(2000, 1, 1, hour, minute)

    # Format: %-I removes leading zero, %M keeps minutes, %p gives AM/PM
    formatted = dt.strftime("%-I:%M%p")

    # Convert to lowercase and remove dots
    formatted = formatted.lower().replace(".", "")

    return formatted


def format_reset_date(dt: datetime) -> str:
    """Format reset date as "Feb 9 at 8:19pm".

    Args:
        dt: Datetime object

    Returns:
        Formatted string like "Feb 9 at 8:19pm"
    """
    # Format: %b = abbreviated month, %-d = day without leading zero
    date_part = dt.strftime("%b %-d")

    # Get time part using format_12h_time
    time_part = format_12h_time(dt.hour, dt.minute)

    return f"{date_part} at {time_part}"


def calculate_fallback_time(hours_offset: int, same_day: bool = True) -> str:
    """Calculate fallback reset time.

    Args:
        hours_offset: Hours to add to current time
        same_day: If True, return time only (e.g., "2:31pm").
                  If False, return full date (e.g., "Feb 9 at 8:19pm")

    Returns:
        Formatted reset time string
    """
    reset_time = datetime.now() + timedelta(hours=hours_offset)

    if same_day:
        return format_12h_time(reset_time.hour, reset_time.minute)
    else:
        return format_reset_date(reset_time)


def parse_time_to_datetime(time_str: str) -> datetime:
    """Parse time string to datetime object.

    Handles formats like:
    - "2:31pm" -> today at 2:31pm
    - "Feb 9 at 8:19pm" -> Feb 9 at 8:19pm

    Args:
        time_str: Time string to parse

    Returns:
        Datetime object
    """
    now = datetime.now()

    # Check if it's a full date format (contains "at")
    if " at " in time_str:
        # Parse "Feb 9 at 8:19pm" or "Feb 11 at 11am"
        # Try multiple formats to handle with/without minutes
        formats = [
            "%b %d at %I:%M%p",  # "Feb 9 at 8:19pm"
            "%b %d at %I:%M%P",  # "Feb 9 at 8:19PM" (lowercase)
            "%b %d at %I%p",     # "Feb 11 at 11am" (no minutes)
            "%b %d at %I%P",     # "Feb 11 at 11AM" (no minutes, lowercase)
        ]

        parsed = None
        for fmt in formats:
            try:
                parsed = datetime.strptime(time_str, fmt)
                break
            except ValueError:
                continue

        if parsed is None:
            return now

        # Use current year and infer if date should be next year
        parsed = parsed.replace(year=now.year)

        # If the parsed date is more than 6 months in the past, assume it's next year
        # This handles cases where reset dates span year boundaries
        if (now - parsed).days > 180:
            parsed = parsed.replace(year=now.year + 1)

        return parsed
    else:
        # Parse time only "2:31pm" or "6pm"
        try:
            # Try with minutes first
            parsed = datetime.strptime(time_str.upper(), "%I:%M%p")
        except ValueError:
            try:
                # Try without minutes (e.g., "6pm")
                parsed = datetime.strptime(time_str.upper(), "%I%p")
            except ValueError:
                return now

        # Set to today
        parsed = parsed.replace(year=now.year, month=now.month, day=now.day)

        # If the parsed time is in the past (earlier today), it means the window
        # already reset and the next reset is tomorrow
        if parsed < now:
            parsed = parsed + timedelta(days=1)

        return parsed


def format_reset_from_iso(iso_str: str) -> str:
    """Convert ISO 8601 timestamp to display format.

    Converts API timestamps to the format used by PTY parsers:
    - Same day: "2:31pm"
    - Future date: "Feb 9 at 8:19pm"

    Args:
        iso_str: ISO 8601 timestamp (e.g., "2025-11-04T04:59:59.943648+00:00")

    Returns:
        Formatted time string matching PTY parser format
    """
    if not iso_str:
        return calculate_fallback_time(5, same_day=True)

    try:
        # Parse ISO 8601 timestamp
        # Handle both with and without microseconds/timezone
        dt = None
        for fmt in [
            "%Y-%m-%dT%H:%M:%S.%f%z",  # With microseconds and timezone
            "%Y-%m-%dT%H:%M:%S%z",      # Without microseconds
            "%Y-%m-%dT%H:%M:%SZ",       # UTC with Z suffix
        ]:
            try:
                dt = datetime.strptime(iso_str, fmt)
                break
            except ValueError:
                continue

        if dt is None:
            # Fallback parsing
            dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))

        # Convert to local time if timezone-aware
        if dt.tzinfo is not None:
            dt = dt.astimezone()

        now = datetime.now()

        # Check if same day
        if dt.date() == now.date():
            return format_12h_time(dt.hour, dt.minute)
        else:
            return format_reset_date(dt)

    except (ValueError, AttributeError):
        # Fallback on parse error
        return calculate_fallback_time(5, same_day=True)


def calculate_time_progress(reset_time_str: str, window_hours: int) -> float:
    """Calculate percentage of time elapsed in a window.

    Args:
        reset_time_str: Reset time string (e.g., "2:31pm" or "Feb 9 at 8:19pm")
        window_hours: Duration of time window in hours

    Returns:
        Percentage of time elapsed (0-100), clamped to valid range
    """
    now = datetime.now()
    reset_time = parse_time_to_datetime(reset_time_str)

    # Calculate window start time
    window_start = reset_time - timedelta(hours=window_hours)

    # Calculate elapsed time
    elapsed = now - window_start
    total_window = timedelta(hours=window_hours)

    # Calculate percentage
    percentage = (elapsed.total_seconds() / total_window.total_seconds()) * 100

    # Clamp to 0-100 range
    return max(0.0, min(100.0, percentage))
