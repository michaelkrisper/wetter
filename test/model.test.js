import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { interpolate, snapshot } from '../src/js/model.js';
import { HOUR, MINUTE, storedForecast, temperatureAt } from './fixtures.js';

// Wednesday 1 July 2026, 12:00 in Graz: summer time all week, no DST change.
const NOW = Date.parse('2026-07-01T10:00:00Z');
const TOMORROW_15 = Date.parse('2026-07-02T13:00:00Z');
const TOMORROW_16 = TOMORROW_15 + HOUR;

describe('interpolate', () => {
  const series = [
    { time: 0, v: 10 },
    { time: HOUR, v: 20 },
    { time: 2 * HOUR, v: null },
    { time: 3 * HOUR, v: 40 },
  ];

  it('is linear between points and skips gaps', () => {
    assert.equal(interpolate(series, 15 * MINUTE, 'v'), 12.5);
    assert.equal(interpolate(series, 2 * HOUR, 'v'), 30);
  });

  it('reaches at most half an hour beyond the ends', () => {
    assert.equal(interpolate(series, -20 * MINUTE, 'v'), 10);
    assert.equal(interpolate(series, -40 * MINUTE, 'v'), null);
    assert.equal(interpolate(series, 3 * HOUR + 20 * MINUTE, 'v'), 40);
    assert.equal(interpolate(series, 3 * HOUR + 40 * MINUTE, 'v'), null);
  });
});

describe('snapshot', () => {
  it('names the next likely rain spell, with the numbers the chart shows', () => {
    const view = snapshot(storedForecast({ now: NOW }), NOW);
    const { outlook, timeline } = view;
    assert.equal(outlook.kind, 'starts');
    assert.equal(outlook.exact, false);
    assert.equal(outlook.at, TOMORROW_15);
    assert.equal(outlook.prob, 80);
    assert.equal(Math.round(outlook.total * 10) / 10, 3.9);
    assert.equal(outlook.type, 'rain');

    // The chart labels the same spell above its wettest hour.
    const spell = timeline.spells.find((s) => s.time === TOMORROW_15);
    assert.equal(spell.prob, outlook.prob);
    assert.equal(spell.total, outlook.total);
    assert.equal(spell.wettest.time, TOMORROW_16);
    // And the day row quotes the same probability and amount.
    assert.equal(view.days[1].precipProb, outlook.prob);
    assert.equal(view.days[1].precipSum, Math.round(outlook.total * 10) / 10);
  });

  it('keeps unlikely rain in the chart but out of the outlook', () => {
    const { timeline } = snapshot(storedForecast({ now: NOW }), NOW);
    assert.equal(timeline.spells.length, 2);
    assert.deepEqual(
      timeline.spells.map((s) => s.prob),
      [80, 35],
    );
  });

  it('says when the nowcast rain starts, to the step', () => {
    const forecast = storedForecast({ now: NOW, nowcastRate: (m) => (m > 30 ? 2 : 0) });
    const { outlook } = snapshot(forecast, NOW);
    assert.equal(outlook.kind, 'starts');
    assert.equal(outlook.exact, true);
    assert.equal(outlook.at, NOW + 30 * MINUTE);
  });

  it('says when the current rain stops', () => {
    const forecast = storedForecast({ now: NOW, nowcastRate: (m) => (m <= 45 ? 2 : 0) });
    const { outlook, current } = snapshot(forecast, NOW);
    assert.equal(outlook.kind, 'stops');
    assert.equal(outlook.at, NOW + 45 * MINUTE);
    // The model saw clear sky; the measured nowcast wins.
    assert.ok(current.code >= 51, `code ${current.code} is not precipitation`);
  });

  it('trusts a dry nowcast over a rainy model code', () => {
    const { current } = snapshot(storedForecast({ now: NOW, currentCode: 61 }), NOW);
    assert.equal(current.code, 3);
  });

  it('centres hourly bars on their hour and cuts them at the nowcast', () => {
    const forecast = storedForecast({ now: NOW });
    const { bars } = snapshot(forecast, NOW).timeline;
    const nowcast = bars.filter((b) => b.prob == null);
    const hourly = bars.filter((b) => b.prob != null);
    const [cutFrom, cutTo] = [nowcast[0].start, nowcast.at(-1).end];
    assert.equal(cutFrom, NOW);
    assert.equal(cutTo, NOW + 90 * MINUTE);
    for (const bar of hourly)
      assert.ok(bar.end <= cutFrom || bar.start >= cutTo, 'model bar overlaps nowcast');

    const wettest = hourly.find((b) => b.time === TOMORROW_16);
    assert.equal(wettest.start, TOMORROW_16 - HOUR / 2);
    assert.equal(wettest.end, TOMORROW_16 + HOUR / 2);
    assert.equal(wettest.rate, 2);
  });

  it('starts the curve at the measured temperature and blends into the model', () => {
    const forecast = storedForecast({ now: NOW, nowcastBias: 3 });
    const { points } = snapshot(forecast, NOW).timeline;
    const now = points.find((p) => p.now);
    assert.equal(now.temp, temperatureAt(NOW) + 3);

    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      assert.ok(b.time > a.time, 'points out of order');
      const perHour = Math.abs(b.temp - a.temp) / ((b.time - a.time) / HOUR);
      // The wave itself changes by at most ~1.6 degrees an hour; an unblended
      // 3-degree offset would jump at the junction.
      assert.ok(
        perHour < 2.5,
        `jump of ${perHour.toFixed(1)} degrees/h at ${new Date(b.time).toISOString()}`,
      );
    }
    const later = points.find((p) => p.time === NOW + 72 * HOUR);
    assert.ok(Math.abs(later.temp - temperatureAt(later.time)) < 0.01);
  });

  it("lifts today's high to the current temperature", () => {
    const view = snapshot(storedForecast({ now: NOW, nowcastBias: 3 }), NOW);
    assert.ok(view.current.temp > storedForecast({ now: NOW }).daily[0].tempMax);
    assert.equal(view.days[0].tempMax, view.current.temp);
  });

  it('drops a nowcast that no longer covers the next 90 minutes', () => {
    const later = NOW + 2 * HOUR;
    const view = snapshot(storedForecast({ now: NOW, nowcastRate: () => 2 }), later);
    assert.ok(view.timeline.bars.every((b) => b.prob != null || b.end <= later));
    assert.notEqual(view.outlook.exact, true);
  });

  it('tells day from night by sunrise and sunset', () => {
    const forecast = storedForecast({ now: NOW });
    assert.equal(snapshot(forecast, NOW).current.isDay, true);
    assert.equal(snapshot(forecast, NOW + 10 * HOUR).current.isDay, false);
  });

  it('shows seven days from today', () => {
    const view = snapshot(storedForecast({ now: NOW }), NOW);
    assert.equal(view.days.length, 7);
    assert.ok(view.days[0].time <= NOW && NOW < view.days[1].time);
  });
});
