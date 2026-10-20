import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { searchPlaces } from '../src/js/sources/geocoding.js';
import { fetchInca } from '../src/js/sources/geosphere.js';
import { fetchRadarForecast } from '../src/js/sources/radar-grid.js';
import {
  EDINBURGH,
  GEOCODING,
  GRAZ,
  incaResponse,
  MINUTE,
  mockFetch,
  radarGridResponse,
} from './fixtures.js';

describe('searchPlaces', () => {
  it('puts names starting with the query, Austria and larger places first', async (t) => {
    const calls = mockFetch(t, () => GEOCODING);
    const places = await searchPlaces('Klagen');
    assert.deepEqual(
      places.map((p) => `${p.name} (${p.area})`),
      [
        'Klagenfurt am Wörthersee (Kärnten, Österreich)',
        'Klagenfurter Spitze (Kärnten, Österreich)',
        'Klagen (Jawa Tengah, Indonesien)',
        'Klagen (Jawa Timur, Indonesien)',
      ],
    );
    assert.deepEqual(places[0], {
      lat: 46.62472,
      lon: 14.30528,
      name: 'Klagenfurt am Wörthersee',
      area: 'Kärnten, Österreich',
    });
    assert.equal(calls[0].searchParams.get('name'), 'Klagen');
    assert.equal(calls[0].searchParams.get('language'), 'de');
  });

  it('tries a hanging request once more', async (t) => {
    const calls = mockFetch(t, (_, n) => {
      if (n === 1) throw new DOMException('timed out', 'TimeoutError');
      return GEOCODING;
    });
    assert.equal((await searchPlaces('Klagen')).length, 4);
    assert.equal(calls.length, 2);
  });

  it('copes with no results', async (t) => {
    mockFetch(t, () => ({ generationtime_ms: 0.1 }));
    assert.deepEqual(await searchPlaces('Xyzzy'), []);
  });
});

describe('fetchInca', () => {
  it('turns 15-minute sums into mm/h and keeps only verified rain types', async (t) => {
    const now = Date.parse('2026-07-01T10:00:00Z');
    mockFetch(t, () => incaResponse({ now, rate: (m) => (m >= 30 ? 2 : 0) }));
    const nowcast = await fetchInca(GRAZ.lat, GRAZ.lon);
    assert.equal(nowcast.provider, 'inca');
    assert.equal(nowcast.stepMinutes, 15);
    assert.equal(nowcast.issued, now - 15 * MINUTE);
    const step = nowcast.steps.find((s) => s.time === now + 30 * MINUTE);
    assert.equal(step.rate, 2);
    assert.equal(step.type, 'rain');
    assert.equal(nowcast.steps[0].type, null);
  });

  it('rejects an empty answer', async (t) => {
    mockFetch(t, () => ({ timestamps: [], features: [] }));
    await assert.rejects(fetchInca(GRAZ.lat, GRAZ.lon), /empty/);
  });
});

describe('fetchRadarForecast', () => {
  it('uses a coarse Open-Meteo grid outside the INCA domain', async (t) => {
    const calls = mockFetch(t, (url) => radarGridResponse(url));
    const grid = await fetchRadarForecast(EDINBURGH.lat, EDINBURGH.lon);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].host, 'api.open-meteo.com');
    assert.equal(grid.nx, 15);
    assert.equal(grid.ny, 15);
    assert.ok(grid.frames.length > 0);
    assert.ok(grid.frames.every((f) => f.time > Date.now() && f.rates.length === 225));
    // South-west corner first, rows run north.
    const [first, rowEnd, lastRow] = grid.corners;
    assert.ok(first[0] < EDINBURGH.lat && first[1] < EDINBURGH.lon);
    assert.equal(rowEnd[0], first[0]);
    assert.equal(lastRow[1], first[1]);
    // 15-minute sums become mm/h.
    const frame = grid.frames.at(-1);
    assert.ok(Math.abs(frame.rates[0] - 1.2 * 4) < 1e-6);
  });
});
