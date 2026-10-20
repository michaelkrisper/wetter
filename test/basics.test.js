import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceKm } from '../src/js/location.js';
import { inBox, regionFor } from '../src/js/regions.js';
import { INCA_BOX } from '../src/js/sources/geosphere.js';
import { rainScale, tempColor } from '../src/js/ui/colors.js';
import { dayDiff, decimal, temp, when } from '../src/js/ui/format.js';
import { HOUR, TZ } from './fixtures.js';

describe('regions', () => {
  const places = {
    Graz: [47.0707, 15.4395],
    Wien: [48.2082, 16.3738],
    Klagenfurt: [46.6247, 14.3053],
    Innsbruck: [47.2692, 11.4041],
    Bregenz: [47.5031, 9.7471],
    München: [48.1374, 11.5755],
    Zürich: [47.3769, 8.5417],
    Ljubljana: [46.0569, 14.5058],
    Edinburgh: [55.9521, -3.1965],
  };

  it('finds Austria by its border, everything else is the world', () => {
    const region = (name) => regionFor(...places[name]).id;
    for (const name of ['Graz', 'Wien', 'Klagenfurt', 'Innsbruck', 'Bregenz'])
      assert.equal(region(name), 'at', name);
    for (const name of ['München', 'Zürich', 'Ljubljana', 'Edinburgh'])
      assert.equal(region(name), 'world', name);
  });

  it('asks INCA for Austria and its neighbours, not for Scotland', () => {
    assert.ok(inBox(...places.Ljubljana, INCA_BOX));
    assert.ok(inBox(...places.Bregenz, INCA_BOX));
    assert.ok(!inBox(...places.Edinburgh, INCA_BOX));
  });

  it('measures distances on the sphere', () => {
    const km = distanceKm({ lat: 47.0707, lon: 15.4395 }, { lat: 48.2082, lon: 16.3738 });
    assert.ok(Math.abs(km - 145) < 3, `${km} km`);
  });
});

describe('format', () => {
  // Tuesday 20 October 2026, 12:00 in Vienna.
  const now = Date.parse('2026-10-20T10:00:00Z');

  it('names times relative to today', () => {
    assert.equal(when(now + 6 * HOUR, now, TZ), '18 Uhr');
    assert.equal(when(now + 18 * HOUR, now, TZ), 'morgen 6 Uhr');
    assert.equal(when(now + 50 * HOUR, now, TZ), 'Do 14 Uhr');
    assert.equal(when(now + 65 * 60_000, now, TZ, true), '13:05');
  });

  it('counts calendar days across the change from summer time', () => {
    const monday = Date.parse('2026-10-25T23:30:00Z'); // 00:30 CET
    assert.equal(dayDiff(monday, Date.parse('2026-10-24T10:00:00Z'), TZ), 2);
  });

  it('rounds temperatures without a negative zero', () => {
    assert.equal(temp(-0.4), '0°');
    assert.equal(temp(12.5), '13°');
    assert.equal(temp(-2.6), '-3°');
  });

  it('writes decimals the Austrian way', () => {
    assert.equal(decimal(9.06), '9,1');
    assert.equal(decimal(12.4, 0), '12');
  });
});

describe('colors', () => {
  it('scales rain from nothing to full at 10 mm/h, monotonically', () => {
    assert.equal(rainScale(0), 0);
    assert.equal(rainScale(null), 0);
    assert.equal(rainScale(10), 1);
    assert.equal(rainScale(40), 1);
    let previous = 0;
    for (const rate of [0.05, 0.1, 0.5, 1, 2, 5, 9]) {
      assert.ok(rainScale(rate) > previous, `${rate} mm/h`);
      previous = rainScale(rate);
    }
  });

  it('colours temperatures from cold to hot', () => {
    assert.match(tempColor(-10), /^(#|rgb|hsl)/);
    assert.notEqual(tempColor(-10), tempColor(30));
  });
});
