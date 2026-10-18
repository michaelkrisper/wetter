// DWD radar nowcast (RV product) through Bright Sky (https://brightsky.dev):
// 1 km grid, 5-minute steps, 2 hours ahead. Covers Germany and its border
// regions; precipitation only. Data basis: Deutscher Wetterdienst.

import { getJson, query } from './http.js';

const ENDPOINT = 'https://api.brightsky.dev/radar';

// Rough extent of the DWD composite; the API answers 400 outside of it.
export const DWD_BOX = [45.7, 1.5, 56.2, 18.8];

const STEP_MS = 5 * 60_000;

export async function fetchDwdRadar(lat, lon) {
  const start = new Date(Math.floor(Date.now() / STEP_MS) * STEP_MS);
  const params = {
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    distance: 0,
    format: 'plain',
    date: `${start.toISOString().slice(0, 19)}Z`,
  };
  const data = await getJson(`${ENDPOINT}?${query(params)}`);
  if (!data.radar?.length) throw new Error('DWD radar: empty response');

  const issued = Math.min(
    ...data.radar.map(({ source }) => Date.parse(source.split('::').at(-1))).filter(Number.isFinite),
  );
  return {
    provider: 'dwd',
    stepMinutes: 5,
    issued,
    steps: data.radar.map(({ timestamp, precipitation_5: grid }) => {
      const value = grid?.[0]?.[0];
      // Values are 0.01 mm per 5 minutes.
      return { time: Date.parse(timestamp), rate: value == null ? null : (value / 100) * 12 };
    }),
  };
}
