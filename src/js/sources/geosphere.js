// GeoSphere Austria INCA nowcast (https://data.hub.geosphere.at, CC BY 4.0):
// 1 km grid, 15-minute steps, 3 hours ahead, updated every 15 minutes. It
// blends station observations, radar and satellite, which makes it the most
// precise short-term source for Austria and the neighbouring border regions.

import { getJson, query } from './http.js';

const ENDPOINT = 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nowcast-v1-15min-1km';

// [south, west, north, east] from the dataset metadata.
export const INCA_BOX = [45.5, 8.1, 49.48, 17.74];

const NO_PRECIPITATION = 255;
// The API is usually fast but sometimes takes 10 s; the app does not wait for it.
const TIMEOUT_MS = 20_000;
const RAIN = 1;

export async function fetchInca(lat, lon) {
  const params = {
    parameters: 't2m,rr,pt,ff,fx,rh2m',
    lat_lon: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    output_format: 'geojson',
  };
  const data = await getJson(`${ENDPOINT}?${query(params)}`, TIMEOUT_MS);
  const p = data.features?.[0]?.properties?.parameters;
  if (!p) throw new Error('INCA: empty response');

  return {
    provider: 'inca',
    stepMinutes: 15,
    issued: Date.parse(data.reference_time),
    steps: data.timestamps.map((timestamp, i) => {
      const temp = p.t2m.data[i];
      const rr = p.rr.data[i];
      const pt = p.pt.data[i];
      return {
        time: Date.parse(timestamp),
        temp,
        // `rr` is the sum over the 15 minutes ending at `time`.
        rate: rr == null ? null : rr * 4,
        // Only "rain" is a verified code; for anything else the temperature decides.
        type: pt === RAIN ? 'rain' : pt === NO_PRECIPITATION ? null : undefined,
        wind: p.ff.data[i] == null ? null : p.ff.data[i] * 3.6,
        gust: p.fx.data[i] == null ? null : p.fx.data[i] * 3.6,
      };
    }),
  };
}
