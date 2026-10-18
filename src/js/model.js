// Turns a stored forecast into what the screen shows at a given moment. Pure
// and time-parameterised, so a cached forecast stays correct as time passes
// (the window slides, "now" is re-interpolated) until it is refreshed.
//
// The sources are stitched into one continuous timeline: the nowcast owns the
// first NOWCAST_MINUTES, the hourly model takes over seamlessly (its offset to
// the nowcast decays instead of jumping), the daily forecast covers the rest.

import { DAYS, HOURLY_SPAN, NOWCAST_MINUTES, WET_THRESHOLD } from './config.js';
import { isPrecipitation, isShower, precipitationCode, SNOW_CODES } from './weather-codes.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Time constant for the model to converge from the nowcast temperature.
const BLEND_HOURS = 3;
// Thresholds for "it will rain" beyond the nowcast, where only probabilities exist.
const HOURLY_WET = { prob: 50, mm: 0.1 };
const DAILY_WET = { prob: 50, mm: 1 };

export function interpolate(series, time, key) {
  let prev = null;
  for (const item of series) {
    const value = item[key];
    if (value == null) continue;
    if (item.time >= time) {
      if (!prev) return item.time - time <= 30 * MINUTE ? value : null;
      return prev[key] + ((value - prev[key]) * (time - prev.time)) / (item.time - prev.time);
    }
    prev = item;
  }
  return prev && time - prev.time <= 30 * MINUTE ? prev[key] : null;
}

function precipitationType(code, temp) {
  if (SNOW_CODES.has(code)) return 'snow';
  if (temp == null || temp > 2) return 'rain';
  return temp <= 0.5 ? 'snow' : 'sleet';
}

const isWet = (step) => step.rate >= WET_THRESHOLD;
const hourIsWet = (h) => (h.prob ?? 100) >= HOURLY_WET.prob && h.precip >= HOURLY_WET.mm;
const dayIsWet = (d) => (d.precipProb ?? 100) >= DAILY_WET.prob && d.precipSum >= DAILY_WET.mm;

function nowcastSteps(forecast, now, until) {
  const { nowcast, minutely, hourly } = forecast;
  const step = nowcast.stepMinutes * MINUTE;
  const steps = nowcast.steps
    .filter((s) => s.rate != null && s.time > now && s.time - step < until)
    .map((s) => {
      const temp = s.temp ?? interpolate(minutely, s.time, 'temp') ?? interpolate(hourly, s.time, 'temp');
      return {
        start: Math.max(s.time - step, now),
        end: s.time,
        rate: s.rate,
        type: isWet(s) ? (s.type ?? precipitationType(s.code, temp)) : null,
      };
    });
  // Old cache: better no nowcast than one that ends in half an hour.
  if (!steps.length || steps.at(-1).end < until - step) return null;
  return steps;
}

// One sentence about precipitation, reading the timeline from the most precise
// source onwards: nowcast first, then hours, then days.
function outlook(steps, hours, days, until) {
  const upcoming = hours.filter((h) => h.time > until);
  if (steps?.some(isWet)) {
    const wet = steps.filter(isWet);
    const total = steps.reduce((sum, s) => sum + (s.rate * (s.end - s.start)) / HOUR, 0);
    const base = { type: wet[0].type, peak: Math.max(...wet.map((s) => s.rate)), total, exact: true };
    if (!isWet(steps[0])) return { ...base, kind: 'starts', at: wet[0].start };
    const dry = steps.find((s) => !isWet(s));
    if (dry) return { ...base, kind: 'stops', at: dry.start };
    const end = upcoming.find((h) => !hourIsWet(h));
    return { ...base, kind: end ? 'stops' : 'continues', at: end && end.time - HOUR, exact: false };
  }
  const next = upcoming.find(hourIsWet);
  if (next) {
    return {
      kind: 'starts',
      at: next.time - HOUR,
      type: precipitationType(next.code, next.temp),
      peak: next.precip,
      prob: next.prob,
      exact: false,
    };
  }
  const day = days.find((d) => d.time + 24 * HOUR > (hours.at(-1)?.time ?? until) && dayIsWet(d));
  if (day) return { kind: 'dry-until', day: day.time, prob: day.precipProb, total: day.precipSum };
  return { kind: 'dry' };
}

// A measured nowcast knows better than the model whether it rains right now.
function observedCode(code, step, provider) {
  if (!step || provider === 'openmeteo') return code;
  if (isWet(step) && !isPrecipitation(code)) return precipitationCode(step.rate, step.type);
  if (!isWet(step) && isPrecipitation(code)) return isShower(code) ? 2 : 3;
  return code;
}

function currentView(forecast, now, steps, today) {
  const { current, minutely, hourly, nowcast } = forecast;
  // `current` describes the moment of the fetch; for an older cache the hour is closer.
  const hour = hourly.findLast((h) => h.time <= now + 30 * MINUTE) ?? hourly[0];
  const base = Math.abs(now - current.time) < HOUR ? current : hour;

  const temp =
    interpolate(nowcast.steps, now, 'temp') ??
    interpolate(minutely, now, 'temp') ??
    interpolate(hourly, now, 'temp') ??
    current.temp;
  return {
    temp,
    feelsLike: current.feelsLike == null || temp == null ? null : temp + (current.feelsLike - current.temp),
    code: observedCode(base.code, steps?.[0], nowcast.provider),
    isDay: today?.sunrise ? now >= today.sunrise && now < today.sunset : base.isDay,
    wind: interpolate(nowcast.steps, now, 'wind') ?? base.wind,
    gust: interpolate(nowcast.steps, now, 'gust') ?? base.gust ?? null,
    uv: interpolate(hourly, now, 'uv') ?? 0,
  };
}

// Temperature points and precipitation intervals for the next 24 hours: in
// nowcast resolution up to `until`, hourly after that.
function timeline(forecast, now, until, current, steps) {
  const { hourly, minutely, nowcast } = forecast;
  const end = now + HOURLY_SPAN * HOUR;
  const fine = nowcast.steps.some((s) => s.temp != null) ? nowcast.steps : minutely;
  const hourAfter = (time) => hourly.find((h) => h.time >= time) ?? {};

  const points = [{ ...hourAfter(now), time: now, temp: current.temp, now: true }];
  for (const s of fine) {
    if (s.time > now && s.time <= until && s.temp != null) {
      points.push({ ...hourAfter(s.time), time: s.time, temp: s.temp, rate: s.rate, fine: true });
    }
  }
  const junction = points.at(-1);
  const modelAtJunction = interpolate(hourly, junction.time, 'temp');
  const bias = junction.temp != null && modelAtJunction != null ? junction.temp - modelAtJunction : 0;
  for (const h of hourly) {
    if (h.time > junction.time && h.time - HOUR < end && h.temp != null) {
      const decay = Math.exp(-(h.time - junction.time) / (BLEND_HOURS * HOUR));
      points.push({ ...h, temp: h.temp + bias * decay });
    }
  }

  const bars = (steps ?? []).map((s) => ({ start: s.start, end: s.end, rate: s.rate, prob: null }));
  const barsFrom = steps ? steps.at(-1).end : now;
  for (const h of hourly) {
    if (h.time > barsFrom && h.time - HOUR < end && h.precip != null) {
      bars.push({ start: Math.max(h.time - HOUR, barsFrom), end: h.time, rate: h.precip, prob: h.prob });
    }
  }
  return { from: now, until: points.at(-1).time, points, bars };
}

export function snapshot(forecast, now = Date.now()) {
  const until = now + NOWCAST_MINUTES * MINUTE;
  const days = forecast.daily
    .filter((d) => d.time + 24 * HOUR > now)
    .slice(0, DAYS)
    .map((d) => ({ ...d }));
  const today = days[0];
  const steps = nowcastSteps(forecast, now, until);
  const current = currentView(forecast, now, steps, today);

  if (today && current.temp != null) {
    today.tempMax = Math.max(today.tempMax, current.temp);
    today.tempMin = Math.min(today.tempMin, current.temp);
  }

  const hours = forecast.hourly.filter((h) => h.time > now);
  const moonset = [today?.moonset, days[1]?.moonset].find(
    (t) => t && (!today?.moonrise || t > today.moonrise),
  );

  return {
    now,
    timezone: forecast.timezone,
    providers: forecast.providers,
    fetchedAt: forecast.fetchedAt,
    current,
    nowcast: steps && { from: now, until, steps },
    outlook: outlook(steps, hours, days, until),
    timeline: timeline(forecast, now, until, current, steps),
    days,
    daylight: forecast.daily.map((d) => [d.sunrise, d.sunset]).filter(([a, b]) => a && b),
    astro: today && {
      sunrise: today.sunrise,
      sunset: today.sunset,
      moonrise: today.moonrise,
      moonset: moonset ?? null,
      moonPhase: today.moonPhase,
    },
  };
}
