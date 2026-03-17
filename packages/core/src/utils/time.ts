/**
 * Time formatting utilities.
 * Ported from Python src/utils/time.py
 */

export function format12hTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  const minuteStr = minute.toString().padStart(2, "0");
  return `${displayHour}:${minuteStr}${period}`;
}

export function formatResetDate(dt: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const datePart = `${months[dt.getMonth()]} ${dt.getDate()}`;
  const timePart = format12hTime(dt.getHours(), dt.getMinutes());
  return `${datePart} at ${timePart}`;
}

export function calculateFallbackTime(
  hoursOffset: number,
  sameDay: boolean = true,
): string {
  const resetTime = new Date(Date.now() + hoursOffset * 3600_000);
  if (sameDay) {
    return format12hTime(resetTime.getHours(), resetTime.getMinutes());
  }
  return formatResetDate(resetTime);
}

export function parseTimeToDatetime(timeStr: string): Date {
  const now = new Date();

  if (timeStr.includes(" at ")) {
    // Format: "Feb 9 at 8:19pm" or "Feb 11 at 11am"
    const match = timeStr.match(
      /^(\w+)\s+(\d+)\s+at\s+(\d+)(?::(\d+))?\s*(am|pm)$/i,
    );
    if (!match) return now;

    const [, monthStr, dayStr, hourStr, minuteStr, meridiem] = match;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    const month = months[monthStr.toLowerCase()];
    if (month === undefined) return now;

    const day = parseInt(dayStr, 10);
    let hour = parseInt(hourStr, 10);
    const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

    if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;

    const parsed = new Date(now.getFullYear(), month, day, hour, minute);

    // If the date is more than 180 days in the past, assume next year
    const diffMs = now.getTime() - parsed.getTime();
    if (diffMs > 180 * 86400_000) {
      parsed.setFullYear(now.getFullYear() + 1);
    }

    return parsed;
  }

  // Format: "2:31pm" or "6pm"
  const match = timeStr.match(/^(\d+)(?::(\d+))?\s*(am|pm)$/i);
  if (!match) return now;

  const [, hourStr, minuteStr, meridiem] = match;
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

  if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;

  const parsed = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
  );

  // If the time is in the past, assume tomorrow
  if (parsed.getTime() < now.getTime()) {
    parsed.setDate(parsed.getDate() + 1);
  }

  return parsed;
}

export function formatResetFromIso(isoStr: string): string {
  if (!isoStr) {
    return calculateFallbackTime(5, true);
  }

  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) {
      return calculateFallbackTime(5, true);
    }

    const now = new Date();
    const sameDay =
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate();

    if (sameDay) {
      return format12hTime(dt.getHours(), dt.getMinutes());
    }
    return formatResetDate(dt);
  } catch {
    return calculateFallbackTime(5, true);
  }
}

export function calculateTimeProgress(
  resetTimeStr: string,
  windowHours: number,
): number {
  const now = new Date();
  const resetTime = parseTimeToDatetime(resetTimeStr);
  const windowMs = windowHours * 3600_000;

  // parseTimeToDatetime assumes past times are "tomorrow", but for progress
  // calculation a reset time in the past means the window already elapsed.
  // If resetTime is more than windowHours in the future, it was incorrectly
  // bumped to tomorrow, so correct it back.
  if (resetTime.getTime() - now.getTime() > windowMs) {
    resetTime.setDate(resetTime.getDate() - 1);
  }

  const windowStart = new Date(resetTime.getTime() - windowMs);
  const elapsedMs = now.getTime() - windowStart.getTime();
  const percentage = (elapsedMs / windowMs) * 100;
  return Math.max(0, Math.min(100, percentage));
}

export function formatTimeRemaining(
  t: Date,
  resetsAt: Date,
  _windowHours: number,
): string {
  const totalSeconds = (resetsAt.getTime() - t.getTime()) / 1000;

  if (totalSeconds <= 0) return "0m";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    if (hours > 0) return `${days}d ${hours}h`;
    return `${days}d`;
  }
  if (hours > 0) {
    if (minutes > 0) return `${hours}h ${minutes}m`;
    return `${hours}h`;
  }
  return `${minutes}m`;
}
