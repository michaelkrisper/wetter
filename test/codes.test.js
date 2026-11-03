import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reverseGeocode } from '../src/js/sources/nominatim.js';
import * as storage from '../src/js/storage.js';
import { moonIcon, weatherIcon } from '../src/js/ui/icons.js';
import {
  describe as describeCode,
  isPrecipitation,
  isShower,
  precipitationCode,
  SNOW_CODES,
} from '../src/js/weather-codes.js';
import { mockFetch } from './fixtures.js';

const WMO = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
];

describe('weather codes', () => {
  it('labels clear sky as sunny by day only', () => {
    assert.equal(describeCode(0).label, 'Sonnig');
    assert.equal(describeCode(0, false).label, 'Klar');
    assert.equal(describeCode(0, false).icon, 'clear');
  });

  it('falls back to a cloud for unknown codes', () => {
    assert.deepEqual(describeCode(42), { label: '–', icon: 'cloudy' });
  });

  it('has a real icon for every WMO code', () => {
    const fallback = weatherIcon('cloudy');
    for (const code of WMO) {
      const { icon } = describeCode(code);
      if (icon !== 'cloudy') assert.notEqual(weatherIcon(icon), fallback, `code ${code} -> ${icon}`);
    }
  });

  it('classifies precipitation, showers and snow', () => {
    assert.ok(!isPrecipitation(48));
    assert.ok(isPrecipitation(51));
    assert.ok(isShower(80) && isShower(86));
    assert.ok(!isShower(95) && !isShower(65));
    for (const code of SNOW_CODES) assert.equal(describeCode(code).icon, 'snow');
  });

  it('maps an observed rate to light, moderate and heavy codes', () => {
    assert.deepEqual(
      [0.2, 1, 3.9, 4, 12].map((r) => precipitationCode(r, 'rain')),
      [61, 63, 63, 65, 65],
    );
    assert.deepEqual(
      [0.5, 2, 6].map((r) => precipitationCode(r, 'snow')),
      [71, 73, 75],
    );
    assert.equal(precipitationCode(10, 'sleet'), 66);
    assert.equal(precipitationCode(0.3), 61);
  });
});

describe('icons', () => {
  it('labels icons for screen readers only when a label is given', () => {
    assert.match(weatherIcon('rain', true, 'Regen'), /role="img" aria-label="Regen"/);
    assert.match(weatherIcon('rain'), /aria-hidden="true"/);
  });

  it('draws a new moon without a lit part and a full moon with one', () => {
    assert.doesNotMatch(moonIcon(0), /i-moon-lit/);
    assert.doesNotMatch(moonIcon(0.99), /i-moon-lit/);
    assert.match(moonIcon(0.5), /i-moon-lit/);
  });
});

describe('reverseGeocode', () => {
  it('prefers city, then town, then village', async (t) => {
    const calls = mockFetch(t, () => ({
      name: 'Rathaus',
      address: { town: 'Gleisdorf', village: 'Labuch' },
    }));
    assert.equal(await reverseGeocode(47.10449, 15.70834), 'Gleisdorf');
    assert.equal(calls[0].host, 'nominatim.openstreetmap.org');
    assert.equal(calls[0].searchParams.get('lat'), '47.104');
    assert.equal(calls[0].searchParams.get('lon'), '15.708');
    assert.equal(calls[0].searchParams.get('accept-language'), 'de');
  });

  it('falls back to the name, then null', async (t) => {
    let answer = { name: 'Schöckl' };
    mockFetch(t, () => answer);
    assert.equal(await reverseGeocode(47.2, 15.47), 'Schöckl');
    answer = {};
    assert.equal(await reverseGeocode(47.2, 15.47), null);
  });

  it('rejects on HTTP errors', async (t) => {
    mockFetch(t, () => new Response('', { status: 503 }));
    await assert.rejects(reverseGeocode(47, 15), /HTTP 503/);
  });
});

// Node has no localStorage unless started with --localstorage-file.
function fakeLocalStorage(t, impl) {
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  t.after(() => delete globalThis.localStorage);
}

describe('storage', () => {
  it('round-trips JSON under a namespace', (t) => {
    const map = new Map();
    fakeLocalStorage(t, {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
    });
    storage.set('place', { name: 'Graz' });
    assert.deepEqual([...map.keys()], ['wetter:place']);
    assert.deepEqual(storage.get('place'), { name: 'Graz' });
    assert.equal(storage.get('missing'), null);
  });

  it('survives an unavailable or full storage', (t) => {
    fakeLocalStorage(t, {
      getItem: () => '{broken',
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    assert.doesNotThrow(() => storage.set('x', 1));
    assert.equal(storage.get('x'), null);
  });
});
