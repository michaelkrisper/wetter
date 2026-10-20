import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadForecast } from '../src/js/forecast.js';
import { EDINBURGH, GRAZ, HOUR, incaResponse, mockFetch, openMeteoResponse } from './fixtures.js';

// Answers like the real services for "now"; `inca` replaces the nowcast answer.
function services(t, { inca } = {}) {
  t.mock.method(console, 'warn', () => {});
  return mockFetch(t, (url) => {
    if (url.host === 'api.open-meteo.com') {
      return openMeteoResponse({ model: url.searchParams.get('models')?.split(',')[1] });
    }
    if (url.host === 'dataset.api.hub.geosphere.at') return inca ? inca() : incaResponse();
    throw new Error(`unexpected request to ${url}`);
  });
}

describe('loadForecast', () => {
  it('uses INCA and AROME in Austria, showing the model first', async (t) => {
    const calls = services(t);
    const partial = [];
    const forecast = await loadForecast(GRAZ, { onPartial: (f) => partial.push(f) });
    assert.equal(forecast.region, 'at');
    assert.equal(forecast.model, 'geosphere_arome_austria');
    assert.equal(forecast.nowcast.provider, 'inca');
    assert.equal(forecast.timezone, 'Europe/Vienna');
    assert.deepEqual(forecast.location, { lat: GRAZ.lat, lon: GRAZ.lon });
    assert.equal(partial.length, 1);
    assert.equal(partial[0].nowcast.provider, 'openmeteo');
    assert.deepEqual(
      new Set(calls.map((u) => u.host)),
      new Set(['api.open-meteo.com', 'dataset.api.hub.geosphere.at']),
    );
  });

  it('falls back to the model when INCA fails', async (t) => {
    services(t, { inca: () => new Response('', { status: 503 }) });
    const forecast = await loadForecast(GRAZ);
    assert.equal(forecast.nowcast.provider, 'openmeteo');
    assert.ok(forecast.nowcast.steps.length > 0);
  });

  it('ignores an INCA run that stopped updating', async (t) => {
    services(t, { inca: () => incaResponse({ issued: Date.now() - 4 * HOUR }) });
    const forecast = await loadForecast(GRAZ);
    assert.equal(forecast.nowcast.provider, 'openmeteo');
  });

  it('keeps the previous nowcast on screen until the new one is in', async (t) => {
    services(t);
    const previous = await loadForecast(GRAZ);
    const partial = [];
    await loadForecast(GRAZ, { previous, onPartial: (f) => partial.push(f) });
    assert.equal(partial[0].nowcast, previous.nowcast);
  });

  it('but not for another place', async (t) => {
    services(t);
    const previous = await loadForecast(GRAZ);
    const partial = [];
    await loadForecast({ lat: 47.2, lon: 15.6 }, { previous, onPartial: (f) => partial.push(f) });
    assert.equal(partial[0].nowcast.provider, 'openmeteo');
  });

  it('uses best match alone outside Austria and INCA', async (t) => {
    const calls = services(t);
    const forecast = await loadForecast(EDINBURGH);
    assert.equal(forecast.region, 'world');
    assert.equal(forecast.model, null);
    assert.equal(forecast.nowcast.provider, 'openmeteo');
    assert.deepEqual(
      calls.map((u) => u.host),
      ['api.open-meteo.com'],
    );
    assert.equal(calls[0].searchParams.has('models'), false);
  });
});
