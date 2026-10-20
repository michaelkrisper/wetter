// Synthetic but realistic weather for the tests: one week around a given
// moment, rendered in the formats of the APIs (Open-Meteo, GeoSphere INCA,
// geocoding) and of the forecast the app stores.
//
// Temperature follows a daily wave (4 degrees at 03:00, 16 at 15:00), UV a
// curve over the day, and it rains in two spells (RAIN).

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const TZ = 'Europe/Vienna';
export const GRAZ = { lat: 47.0707, lon: 15.4395 };
export const EDINBURGH = { lat: 55.9521, lon: -3.1965 };
const STEP = 15 * MINUTE;

// By local day (0 = today) and hour: a likely spell tomorrow afternoon and an
// unlikely one the day after.
export const RAIN = [
  { day: 1, hour: 15, mm: 0.4, prob: 60 },
  { day: 1, hour: 16, mm: 2, prob: 80 },
  { day: 1, hour: 17, mm: 1.2, prob: 70 },
  { day: 1, hour: 18, mm: 0.3, prob: 40 },
  { day: 2, hour: 10, mm: 1, prob: 35 },
  { day: 2, hour: 11, mm: 0.5, prob: 30 },
];
const DRY_PROB = 5;

const round1 = (v) => Math.round(v * 10) / 10;
const unix = (t) => Math.round(t / 1000);
const iso = (t) => new Date(t).toISOString().replace('.000Z', '+00:00');

const formatters = new Map();

export function zoneOffset(time, timeZone = TZ) {
  if (!formatters.has(timeZone)) {
    const options = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' };
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', { ...options, minute: 'numeric', timeZone }));
  }
  const parts = formatters.get(timeZone).formatToParts(time);
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute) - (time - (time % MINUTE));
}

function local(time, tz = TZ) {
  const shifted = new Date(time + zoneOffset(time, tz));
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours() + shifted.getUTCMinutes() / 60,
  };
}

// Local midnight of the day `time` falls on.
export function midnight(time, tz = TZ) {
  const utc = Date.parse(`${local(time, tz).date}T00:00:00Z`);
  return utc - zoneOffset(utc - zoneOffset(time, tz), tz);
}

// Local midnights of the seven days from the one `now` falls on.
export function dayStarts(now, tz = TZ) {
  const first = midnight(now, tz);
  return Array.from({ length: 7 }, (_, i) => midnight(first + i * 24 * HOUR + 12 * HOUR, tz));
}

export const temperatureAt = (time, tz = TZ) =>
  round1(10 + 6 * Math.sin(((local(time, tz).hour - 9) / 12) * Math.PI));

function uvAt(time, tz) {
  const { hour } = local(time, tz);
  return hour >= 8 && hour <= 17 ? round1(4 * Math.sin(((hour - 7) / 11) * Math.PI)) : 0;
}

// The hours of the week, as the truth all formats are rendered from.
export function week(now, tz = TZ) {
  const starts = dayStarts(now, tz);
  const hours = [];
  for (let time = starts[0]; time < starts[0] + 7 * 24 * HOUR; time += HOUR) {
    const day = starts.findLastIndex((start) => start <= time);
    const { hour } = local(time, tz);
    const rain = RAIN.find((r) => r.day === day && r.hour === Math.round(hour));
    hours.push({
      time,
      temp: temperatureAt(time, tz),
      precip: rain?.mm ?? 0,
      prob: rain?.prob ?? DRY_PROB,
      code: rain ? 61 : 1,
      wind: 10,
      uv: uvAt(time, tz),
      isDay: hour >= 7 && hour < 18,
    });
  }
  return hours;
}

function days(now, tz) {
  const hours = week(now, tz);
  const starts = dayStarts(now, tz);
  return starts.map((start, i) => {
    const inDay = hours.filter((h) => h.time >= start && h.time < (starts[i + 1] ?? start + 24 * HOUR));
    const temps = inDay.map((h) => h.temp);
    return {
      start,
      code: inDay.some((h) => h.code === 61) ? 61 : 1,
      tempMax: Math.max(...temps),
      tempMin: Math.min(...temps),
      precipSum: round1(inDay.reduce((sum, h) => sum + h.precip, 0)),
      precipProb: Math.max(...inDay.map((h) => h.prob)),
      uvMax: Math.max(...inDay.map((h) => h.uv)),
      sunrise: start + 7 * HOUR,
      sunset: start + 18 * HOUR,
    };
  });
}

// What the Open-Meteo forecast API answers (timeformat=unixtime,
// timezone=auto). With a regional `model`, every column is suffixed as with
// several `models=`, and the model covers the first 60 hours, 0.5 degrees
// warmer than best match. Daily times are midnights at today's UTC offset,
// as Open-Meteo sends them, which is an hour off after a DST change.
export function openMeteoResponse({ now = Date.now(), model = null, tz = TZ } = {}) {
  const hours = week(now, tz);
  const daily = days(now, tz);
  const suffix = model ? '_best_match' : '';
  const block = (columns) =>
    Object.fromEntries(Object.entries(columns).map(([k, v]) => [k === 'time' ? k : k + suffix, v]));
  const quarter = Math.floor(now / STEP) * STEP;
  const minutes = Array.from({ length: 13 }, (_, i) => quarter + (i - 1) * STEP);

  const hourly = block({
    time: hours.map((h) => unix(h.time)),
    temperature_2m: hours.map((h) => h.temp),
    precipitation: hours.map((h) => h.precip),
    precipitation_probability: hours.map((h) => h.prob),
    weather_code: hours.map((h) => h.code),
    wind_speed_10m: hours.map((h) => h.wind),
    uv_index: hours.map((h) => h.uv),
    is_day: hours.map((h) => (h.isDay ? 1 : 0)),
  });
  if (model) {
    hourly[`temperature_2m_${model}`] = hours.map((h, i) => (i < 60 ? round1(h.temp + 0.5) : null));
    hourly[`precipitation_${model}`] = hours.map((h, i) => (i < 60 ? h.precip : null));
  }
  const nullDays = daily.map(() => null);
  return {
    latitude: GRAZ.lat,
    longitude: GRAZ.lon,
    timezone: tz,
    utc_offset_seconds: zoneOffset(now, tz) / 1000,
    current: {
      time: unix(quarter),
      temperature_2m: temperatureAt(now, tz),
      weather_code: 1,
      is_day: hours.find((h) => h.time > now - HOUR)?.isDay ? 1 : 0,
    },
    minutely_15: block({
      time: minutes.map(unix),
      temperature_2m: minutes.map((t) => temperatureAt(t, tz)),
      precipitation: minutes.map(() => 0),
      weather_code: minutes.map(() => 1),
    }),
    hourly,
    daily: block({
      time: daily.map((_, i) => unix(daily[0].start + i * 24 * HOUR)),
      weather_code: daily.map((d) => d.code),
      temperature_2m_max: daily.map((d) => d.tempMax),
      temperature_2m_min: daily.map((d) => d.tempMin),
      precipitation_sum: daily.map((d) => d.precipSum),
      precipitation_probability_max: daily.map((d) => d.precipProb),
      uv_index_max: daily.map((d) => d.uvMax),
      sunrise: daily.map((d) => unix(d.sunrise)),
      sunset: daily.map((d) => unix(d.sunset)),
      moonrise: nullDays,
      moonset: nullDays,
      moon_phase: daily.map(() => 0.5),
    }),
  };
}

// The Open-Meteo answer for the radar's coarse grid: one entry per point.
export function radarGridResponse(url, now = Date.now()) {
  const count = url.searchParams.get('latitude').split(',').length;
  const quarter = Math.floor(now / STEP) * STEP;
  const time = Array.from({ length: 13 }, (_, i) => unix(quarter + (i - 1) * STEP));
  return Array.from({ length: count }, (_, i) => ({
    minutely_15: { time, precipitation: time.map((_, t) => (i === 0 ? t * 0.1 : 0)) },
  }));
}

// What the GeoSphere INCA point nowcast answers: 15-minute steps for 3 hours.
// `rate(minutes)` gives mm/h for the step ending that many minutes from now.
export function incaResponse({ now = Date.now(), rate = () => 0, issued, tz = TZ } = {}) {
  const reference = issued ?? Math.floor(now / STEP) * STEP - STEP;
  const times = Array.from({ length: 13 }, (_, i) => reference + i * STEP);
  const rr = times.map((t) => rate((t - now) / MINUTE) / 4);
  return {
    reference_time: iso(reference),
    timestamps: times.map(iso),
    features: [
      {
        properties: {
          parameters: {
            t2m: { data: times.map((t) => temperatureAt(t, tz)) },
            rr: { data: rr },
            pt: { data: rr.map((v) => (v > 0 ? 1 : 255)) },
          },
        },
      },
    ],
  };
}

// What the Open-Meteo geocoding API answers for "Klagen": exact names first.
export const GEOCODING = {
  results: [
    {
      name: 'Klagen',
      latitude: -7.1,
      longitude: 110.4,
      country_code: 'ID',
      country: 'Indonesien',
      admin1: 'Jawa Tengah',
    },
    {
      name: 'Klagen',
      latitude: -7.2,
      longitude: 110.5,
      country_code: 'ID',
      country: 'Indonesien',
      admin1: 'Jawa Tengah',
    },
    {
      name: 'Klagen',
      latitude: -7.6,
      longitude: 112.1,
      country_code: 'ID',
      country: 'Indonesien',
      admin1: 'Jawa Timur',
    },
    {
      name: 'Klagenfurter Spitze',
      latitude: 46.43806,
      longitude: 14.18056,
      country_code: 'AT',
      country: 'Österreich',
      admin1: 'Kärnten',
    },
    {
      name: 'Klagenfurt am Wörthersee',
      latitude: 46.62472,
      longitude: 14.30528,
      country_code: 'AT',
      country: 'Österreich',
      admin1: 'Kärnten',
      population: 100316,
    },
  ],
};

// The forecast as the app stores it (see forecast.js), with an INCA nowcast
// whose rate is `nowcastRate(minutes)` and whose temperature is `nowcastBias`
// off the model.
export function storedForecast({ now, nowcastRate = () => 0, nowcastBias = 0, currentCode = 1, tz = TZ }) {
  const quarter = Math.floor(now / STEP) * STEP;
  const steps = Array.from({ length: 13 }, (_, k) => {
    const time = quarter + k * STEP;
    const rate = nowcastRate((time - now) / MINUTE);
    return {
      time,
      temp: round1(temperatureAt(time, tz) + nowcastBias),
      rate,
      type: rate > 0 ? 'rain' : null,
    };
  });
  return {
    version: 1,
    fetchedAt: now,
    location: GRAZ,
    region: 'at',
    timezone: tz,
    model: null,
    current: { time: quarter, temp: temperatureAt(now, tz), code: currentCode, isDay: true },
    nowcast: { provider: 'inca', stepMinutes: 15, issued: quarter - 10 * MINUTE, steps },
    minutely: Array.from({ length: 13 }, (_, k) => {
      const time = quarter + (k - 1) * STEP;
      return { time, temp: temperatureAt(time, tz), rate: 0, code: 1 };
    }),
    hourly: week(now, tz),
    daily: days(now, tz).map(({ start, ...d }) => ({
      time: start,
      ...d,
      moonrise: null,
      moonset: null,
      moonPhase: 0.5,
    })),
  };
}

// Routes `fetch` to `handler(url)` for the duration of test `t`. The handler
// returns a body (sent as JSON), a Response, or throws. Returns the URLs asked for.
export function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = await handler(url, calls.length);
    return result instanceof Response ? result : Response.json(result);
  });
  return calls;
}
