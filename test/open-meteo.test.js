import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchOpenMeteo } from '../src/js/sources/open-meteo.js';
import { GRAZ, HOUR, mockFetch, openMeteoResponse, TZ, temperatureAt } from './fixtures.js';

const MODEL = 'geosphere_arome_austria';
// Saturday 24 October 2026, the day before summer time ends.
const BEFORE_DST = Date.parse('2026-10-24T10:00:00Z');

const localTime = (ms) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(ms);

describe('fetchOpenMeteo', () => {
  it('asks for best match plus the regional model in unix time', async (t) => {
    const calls = mockFetch(t, () => openMeteoResponse({ now: BEFORE_DST, model: MODEL }));
    await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, MODEL);
    const params = calls[0].searchParams;
    assert.equal(params.get('models'), `best_match,${MODEL}`);
    assert.equal(params.get('timeformat'), 'unixtime');
    assert.equal(params.get('timezone'), 'auto');
  });

  it('starts every day at local midnight, also after the change from summer time', async (t) => {
    mockFetch(t, () => openMeteoResponse({ now: BEFORE_DST, model: MODEL }));
    const { daily } = await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, MODEL);
    const labels = daily.map((d) => localTime(d.time));
    assert.deepEqual(labels, [
      '2026-10-24 00:00',
      '2026-10-25 00:00',
      '2026-10-26 00:00',
      '2026-10-27 00:00',
      '2026-10-28 00:00',
      '2026-10-29 00:00',
      '2026-10-30 00:00',
    ]);
  });

  it('takes high, low and rain of a day from the hours the chart shows', async (t) => {
    mockFetch(t, () => openMeteoResponse({ now: BEFORE_DST, model: MODEL }));
    const { daily, hourly } = await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, MODEL);
    daily.slice(0, -1).forEach((day, i) => {
      const hours = hourly.filter((h) => h.time >= day.time && h.time < daily[i + 1].time);
      assert.equal(day.tempMax, Math.max(...hours.map((h) => h.temp)), `high of day ${i}`);
      assert.equal(day.tempMin, Math.min(...hours.map((h) => h.temp)), `low of day ${i}`);
      const sum = hours.reduce((s, h) => s + h.precip, 0);
      assert.ok(Math.abs(day.precipSum - sum) < 1e-9, `rain of day ${i}`);
    });
    // Sunday has 25 hours.
    assert.equal(daily[2].time - daily[1].time, 25 * HOUR);
  });

  it('lets the regional model win where it has data', async (t) => {
    mockFetch(t, () => openMeteoResponse({ now: BEFORE_DST, model: MODEL }));
    const { hourly, model } = await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, MODEL);
    assert.equal(model, MODEL);
    assert.equal(hourly[10].temp, Math.round((temperatureAt(hourly[10].time) + 0.5) * 10) / 10);
    assert.equal(hourly[100].temp, temperatureAt(hourly[100].time));
    // Probability only comes from best match.
    assert.ok(hourly.every((h) => h.prob != null));
  });

  it('reads unsuffixed columns without a regional model', async (t) => {
    mockFetch(t, () => openMeteoResponse({ now: BEFORE_DST }));
    const forecast = await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, null);
    assert.equal(forecast.model, null);
    assert.equal(forecast.hourly.length, 7 * 24);
    assert.equal(forecast.current.temp, temperatureAt(BEFORE_DST));
    assert.equal(forecast.current.time, BEFORE_DST);
    // 15-minute sums become mm/h.
    assert.ok(forecast.minutely.every((m) => m.rate === 0));
  });

  it('tries a dropped request once more', async (t) => {
    const calls = mockFetch(t, (_, n) => {
      if (n === 1) throw new TypeError('fetch failed');
      return openMeteoResponse({ now: BEFORE_DST });
    });
    const forecast = await fetchOpenMeteo(GRAZ.lat, GRAZ.lon, null);
    assert.equal(calls.length, 2);
    assert.equal(forecast.daily.length, 7);
  });
});
