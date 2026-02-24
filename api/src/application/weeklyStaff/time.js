const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getParts(timestampMs, timezone) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
  }
  const parts = fmt.formatToParts(new Date(timestampMs));
  const out = {};
  for (const part of parts) out[part.type] = part.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    dow: weekdayMap[out.weekday] ?? 0,
  };
}

function getTimezoneOffsetMs(utcMs, timezone) {
  const p = getParts(utcMs, timezone);
  const pseudo = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return pseudo - utcMs;
}

function localWallTimeToUtc(localPseudoMs, timezone) {
  let guess = localPseudoMs;
  for (let i = 0; i < 4; i += 1) {
    const offset = getTimezoneOffsetMs(guess, timezone);
    guess = localPseudoMs - offset;
  }
  return guess;
}

function getWeekWindow(timestampMs, timezone = 'Europe/Istanbul', weekStartDow = 1) {
  const p = getParts(timestampMs, timezone);
  const daysSinceStart = (p.dow - Number(weekStartDow) + 7) % 7;
  const localStartPseudo = Date.UTC(p.year, p.month - 1, p.day - daysSinceStart, 0, 0, 0, 0);
  const weekStartMs = localWallTimeToUtc(localStartPseudo, timezone);
  return {
    weekStartMs,
    weekEndMs: weekStartMs + WEEK_MS,
  };
}

module.exports = {
  WEEK_MS,
  getWeekWindow,
};
