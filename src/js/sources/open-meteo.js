// Open-Meteo (https://open-meteo.com, CC BY 4.0): the backbone for hourly and
// daily values. One request fetches the global "best match" blend plus the
// regional high-resolution model, which then wins wherever it has data.

import { getJson, query } from './http.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const CURRENT = ['temperature_2m', 'weather_code', 'is_day'];
const MINUTELY = ['temperature_2m', 'precipitation', 'weather_code'];
const HOURLY = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'uv_index',
  'is_day',
];
const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'uv_index_max',
  'sunrise',
  'sunset',
  'moonrise',
  'moonset',
  'moon_phase',
];
// Variables the regional model may override. Probability and UV are not
// produced by the deterministic regional models.
const REGIONAL = new Set([
  'temperature_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
]);

export async function fetchOpenMeteo(lat, lon, model) {
  const params = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(','),
    minutely_15: MINUTELY.join(','),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    forecast_minutely_15: 12,
    past_minutely_15: 1,
    forecast_days: 7,
    timezone: 'auto',
    timeformat: 'unixtime',
  };
  if (model) params.models = `best_match,${model}`;
  const url = `${ENDPOINT}?${query(params)}`;
  // Without this source there is nothing to show, so a dropped request gets a second chance.
  const data = await getJson(url).catch(() => getJson(url));
  return normalize(data, model);
}

// With several models every column is suffixed (`temperature_2m_icon_d2`),
// except for `current`, which only ever reports best match.
function column(block, name, model) {
  return block?.[`${name}_${model}`] ?? (model === 'best_match' ? block?.[name] : undefined);
}

function series(block, name, model, useRegional = REGIONAL.has(name)) {
  const base = column(block, name, 'best_match') ?? [];
  const regional = model && useRegional ? column(block, name, model) : null;
  return regional ? base.map((value, i) => regional[i] ?? value) : base;
}

const ms = (unix) => (unix == null ? null : unix * 1000);

function normalize(data, model) {
  const { current: c, minutely_15: m, hourly: h, daily: d } = data;

  const minutelyTime = m.time.map(ms);
  const minutelyTemp = series(m, 'temperature_2m', model);
  const minutelyPrecip = series(m, 'precipitation', model);
  const minutelyCode = series(m, 'weather_code', model);
  const minutely = minutelyTime.map((time, i) => ({
    time,
    temp: minutelyTemp[i],
    // Open-Meteo reports the sum of the preceding 15 minutes.
    rate: minutelyPrecip[i] == null ? null : minutelyPrecip[i] * 4,
    code: minutelyCode[i],
  }));

  const hourlyTime = h.time.map(ms);
  const hourlyColumns = Object.fromEntries(HOURLY.map((name) => [name, series(h, name, model)]));
  const hourly = hourlyTime.map((time, i) => ({
    time,
    temp: hourlyColumns.temperature_2m[i],
    precip: hourlyColumns.precipitation[i],
    prob: hourlyColumns.precipitation_probability[i],
    code: hourlyColumns.weather_code[i],
    wind: hourlyColumns.wind_speed_10m[i],
    uv: hourlyColumns.uv_index[i],
    isDay: hourlyColumns.is_day[i] === 1,
  }));

  // Daily aggregates of the regional model are only trustworthy for days it
  // covers completely; a model ending at 02:00 would report a 2-hour "maximum".
  const regionalTemp = model ? column(h, 'temperature_2m', model) : null;
  const covered = new Set(regionalTemp ? hourlyTime.filter((_, i) => regionalTemp[i] != null) : []);
  const fullyCovered = (dayStart) =>
    covered.has(dayStart) && covered.has(dayStart + 23 * 3600_000) && covered.size > 0;

  const daily = d.time.map(ms).map((time, i, starts) => {
    const regional = model && fullyCovered(time);
    const pick = (name) => (regional ? (column(d, name, model)?.[i] ?? null) : null);
    const base = (name) => column(d, name, 'best_match')?.[i] ?? null;
    // The day's rain from the same hours the chart shows, so both agree also on
    // days the regional model covers only partly.
    const hours = hourly.filter((x) => x.time >= time && x.time < (starts[i + 1] ?? time + 24 * 3600_000));
    const hourlySum =
      hours.length >= 23 && hours.every((x) => x.precip != null)
        ? hours.reduce((sum, x) => sum + x.precip, 0)
        : null;
    return {
      time,
      code: base('weather_code'),
      tempMax: pick('temperature_2m_max') ?? base('temperature_2m_max'),
      tempMin: pick('temperature_2m_min') ?? base('temperature_2m_min'),
      precipSum: hourlySum ?? pick('precipitation_sum') ?? base('precipitation_sum'),
      precipProb: base('precipitation_probability_max'),
      uvMax: base('uv_index_max'),
      sunrise: ms(base('sunrise')),
      sunset: ms(base('sunset')),
      moonrise: ms(base('moonrise')),
      moonset: ms(base('moonset')),
      moonPhase: base('moon_phase'),
    };
  });

  return {
    timezone: data.timezone,
    model: model && covered.size > 0 ? model : null,
    current: {
      time: ms(c.time),
      temp: c.temperature_2m,
      code: c.weather_code,
      isDay: c.is_day === 1,
    },
    minutely,
    hourly,
    daily,
  };
}
