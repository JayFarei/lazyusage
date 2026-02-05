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
        # Parse "Feb 9 at 8:19pm"
        try:
            # Parse date + time
            parsed = datetime.strptime(time_str, "%b %d at %I:%M%p")
            # Use current year and infer if date should be next year
            parsed = parsed.replace(year=now.year)

            # If the parsed date is more than 6 months in the past, assume it's next year
            # This handles cases where reset dates span year boundaries
            if (now - parsed).days > 180:
                parsed = parsed.replace(year=now.year + 1)

            return parsed
        except ValueError:
            return now
    else:
        # Parse time only "2:31pm"
        try:
            parsed = datetime.strptime(time_str.upper(), "%I:%M%p")
            # Set to today
            parsed = parsed.replace(year=now.year, month=now.month, day=now.day)
            return parsed
        except ValueError:
            return now
