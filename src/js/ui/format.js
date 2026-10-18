import { LOCALE } from '../config.js';

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

export const clock = (ms, tz) =>
  ms == null ? '--:--' : format(ms, tz, { hour: '2-digit', minute: '2-digit' });

export const hour = (ms, tz) =>
  String(Number(format(ms, tz, { hour: 'numeric', hourCycle: 'h23' }).replace(/\D/g, '')));

export const weekday = (ms, tz, style = 'short') => format(ms, tz, { weekday: style }).replace('.', '');

export const dayOfMonth = (ms, tz) => format(ms, tz, { day: 'numeric' });

// en-CA formats as YYYY-MM-DD.
const dateKey = (ms, tz) => format(ms, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');

export function temp(value) {
  if (value == null || Number.isNaN(value)) return '–';
  const rounded = Math.round(value);
  return `${rounded === 0 ? 0 : rounded}°`;
}

export function decimal(value, digits = 1) {
  return value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
  const [a, b] = [ms, now].map((t) => Date.parse(`${dateKey(t, tz)}T00:00Z`));
  return Math.round((a - b) / 86_400_000);
}
