// Precipitation forecast grids for the radar's look ahead, as frames of mm/h
// values on a grid whose corners are given in lat/lon:
//
//   GeoSphere INCA nowcast grid (1 km, 15 min, ~2.5 h) around Austria. Comes as
//   NetCDF-4 (HDF5), decoded with the vendored jsfive, loaded only when needed.
//   Elsewhere a coarse grid of Open-Meteo 15-minute model values (~20 km).

import { inBox } from '../regions.js';
import { INCA_BOX } from './geosphere.js';
import { getJson, query } from './http.js';

const INCA_GRID = 'https://dataset.api.hub.geosphere.at/v1/grid/forecast/nowcast-v1-15min-1km';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const MINUTE = 60_000;
// Area around the location, in km from the centre. Each Open-Meteo grid point
// counts as one API call, so the model grid is kept small.
const RADIUS_KM = 150;
const MODEL_POINTS = 15;

function box(lat, lon) {
  const dLat = RADIUS_KM / 111;
  const dLon = RADIUS_KM / (111 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

async function fetchInca(lat, lon) {
  const [s, w, n, e] = box(lat, lon);
  const [S, W, N, E] = INCA_BOX;
  const bbox = [Math.max(s, S), Math.max(w, W), Math.min(n, N), Math.min(e, E)].map((v) => v.toFixed(3));
  const url = `${INCA_GRID}?${query({ parameters: 'rr', bbox: bbox.join(','), output_format: 'netcdf' })}`;
  const [res, { File }] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(30_000) }),
    import('../../vendor/jsfive/hdf5.js'),
  ]);
  if (!res.ok) throw new Error(`INCA grid: HTTP ${res.status}`);
  const file = new File(await res.arrayBuffer(), 'inca.nc');

  const rr = file.get('rr');
  const [nt, ny, nx] = rr.shape;
  const values = rr.value; // 0.01 mm per 15 minutes
  const lats = file.get('lat').value;
  const lons = file.get('lon').value;
  const time = file.get('time');
  const base = Date.parse(`${time.attrs.units.replace('minutes since ', '').replace(' ', 'T')}Z`);
  const frames = time.value.slice(0, nt).map((minutes, t) => {
    const rates = new Float32Array(nx * ny);
    const offset = t * nx * ny;
    for (let i = 0; i < rates.length; i++) rates[i] = Math.max(0, values[offset + i]) * 0.04;
    return { time: base + minutes * MINUTE, rates };
  });
  return {
    nx,
    ny,
    // Grid corners: first cell, last cell of the first row, first cell of the last row.
    corners: [
      [lats[0], lons[0]],
      [lats[nx - 1], lons[nx - 1]],
      [lats[(ny - 1) * nx], lons[(ny - 1) * nx]],
    ],
    frames,
  };
}

async function fetchModel(lat, lon) {
  const [s, w, n, e] = box(lat, lon);
  const steps = MODEL_POINTS - 1;
  const lats = [];
  const lons = [];
  for (let row = 0; row <= steps; row++) {
    for (let col = 0; col <= steps; col++) {
      lats.push((s + ((n - s) * row) / steps).toFixed(3));
      lons.push((w + ((e - w) * col) / steps).toFixed(3));
    }
  }
  const params = {
    latitude: lats.join(','),
    longitude: lons.join(','),
    minutely_15: 'precipitation',
    forecast_minutely_15: 13,
    timeformat: 'unixtime',
  };
  const points = await getJson(`${OPEN_METEO}?${query(params)}`, 15_000);
  const times = points[0].minutely_15.time.map((t) => t * 1000);
  const frames = times.map((time, t) => ({
    time,
    rates: Float32Array.from(points, (p) => (p.minutely_15.precipitation[t] ?? 0) * 4),
  }));
  return {
    nx: MODEL_POINTS,
    ny: MODEL_POINTS,
    corners: [
      [Number(lats[0]), Number(lons[0])],
      [Number(lats[steps]), Number(lons[steps])],
      [Number(lats[steps * MODEL_POINTS]), Number(lons[steps * MODEL_POINTS])],
    ],
    frames,
  };
}

// Frames from now on; INCA where it covers the location, the model elsewhere
// or when INCA does not answer.
export async function fetchRadarForecast(lat, lon) {
  const now = Date.now();
  let grid = null;
  if (inBox(lat, lon, INCA_BOX)) {
    try {
      grid = await fetchInca(lat, lon);
    } catch (error) {
      console.warn('INCA grid:', error);
    }
  }
  grid ??= await fetchModel(lat, lon);
  return { ...grid, frames: grid.frames.filter((f) => f.time > now) };
}
