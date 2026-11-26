import { LOCALE } from '../config.js';

const DAY = 86_400_000;
const WEEKDAYS = {
  short: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  long: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
};

// Times are shown in the forecast location's time zone. Intl can do that, but
// its first use with a time zone costs tens of milliseconds on a phone, right
// when the stored forecast is drawn. So the forecast brings the zone's UTC
// offsets over its range (open-meteo.js), and times within it are plain
// arithmetic; Intl remains for everything outside.
const zones = new Map();

// `offsets`: [[from, offset ms], ...] ascending, ending with [until, null].
export function setOffsets(timeZone, offsets) {
  if (offsets?.length > 1) zones.set(timeZone, offsets);
}

function offsetAt(ms, timeZone) {
  const offsets = zones.get(timeZone);
  if (!offsets || ms < offsets[0][0] || ms >= offsets.at(-1)[0]) return null;
  let i = 0;
  while (offsets[i + 1][0] <= ms) i++;
  return offsets[i][1];
}

// The local wall clock of `ms` as the UTC fields of a shifted Date, or null.
function local(ms, timeZone) {
  const offset = offsetAt(ms, timeZone);
  return offset == null ? null : new Date(ms + offset);
}

const formatters = new Map();

function format(ms, timeZone, options, locale = LOCALE) {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    formatters.set(key, formatter);
  }
  return formatter.format(ms);
}

const pad = (n) => String(n).padStart(2, '0');

export function clock(ms, tz) {
  if (ms == null) return '--:--';
  const d = local(ms, tz);
  return d
    ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    : format(ms, tz, { hour: '2-digit', minute: '2-digit' });
}

export function hour(ms, tz) {
  const d = local(ms, tz);
  return d
    ? String(d.getUTCHours())
    : String(Number(format(ms, tz, { hour: 'numeric', hourCycle: 'h23' }).replace(/\D/g, '')));
}

export function weekday(ms, tz, style = 'short') {
  const d = local(ms, tz);
  return d ? WEEKDAYS[style][d.getUTCDay()] : format(ms, tz, { weekday: style }).replace('.', '');
}

export function dayOfMonth(ms, tz) {
  const d = local(ms, tz);
  return d ? String(d.getUTCDate()) : format(ms, tz, { day: 'numeric' });
}

// Days since the epoch on the local calendar; en-CA formats as YYYY-MM-DD.
function dayNumber(ms, tz) {
  const offset = offsetAt(ms, tz);
  if (offset != null) return Math.floor((ms + offset) / DAY);
  return (
    Date.parse(`${format(ms, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA')}T00:00Z`) /
    DAY
  );
}

export function temp(value) {
  if (value == null || Number.isNaN(value)) return '–';
  const rounded = Math.round(value);
  return `${rounded === 0 ? 0 : rounded}°`;
}

// Austrian style without Intl (see above); the values stay far below 1000.
export function decimal(value, digits = 1) {
  return value.toFixed(digits).replace('.', ',');
}

// "18 Uhr", "morgen 6 Uhr", "Mi 14 Uhr": relative to the location's today.
export function when(ms, now, tz, exact) {
  const days = dayDiff(ms, now, tz);
  const time = exact ? clock(ms, tz) : `${hour(ms, tz)} Uhr`;
  if (days === 0) return time;
  if (days === 1) return `morgen ${time}`;
  return `${weekday(ms, tz)} ${time}`;
}

export function dayDiff(ms, now, tz) {
  return Math.round(dayNumber(ms, tz) - dayNumber(now, tz));
}
