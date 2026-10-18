import { BORDERS } from './borders.js';

// High-resolution models served through Open-Meteo. They override the global
// "best match" blend for temperature, precipitation, wind and weather code as
// far as they reach (~2.5 days); probability and UV always come from best match.
export const MODELS = {
  geosphere_arome_austria: { label: 'AROME', detail: '2,5 km', provider: 'geosphere' },
};

// Countries with dedicated national services. `nowcast` lists the nowcast
// providers to try; each is only asked if it covers the point, and Open-Meteo's
// 15-minute data is the fallback everywhere. Elsewhere best match already picks
// the national model where Open-Meteo has one (e.g. the Met Office UKV in the UK).
export const REGIONS = [{ id: 'at', model: 'geosphere_arome_austria', nowcast: ['inca'] }];

// INCA's domain includes the neighbouring regions (Slovenia, South Tyrol, ...).
const ELSEWHERE = { id: 'world', model: null, nowcast: ['inca'] };

function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if (latI > lat !== latJ > lat && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) {
      inside = !inside;
    }
  }
  return inside;
}

export function regionFor(lat, lon) {
  return REGIONS.find(({ id }) => BORDERS[id].some((ring) => inRing(lat, lon, ring))) ?? ELSEWHERE;
}

export function inBox(lat, lon, [south, west, north, east]) {
  return lat >= south && lat <= north && lon >= west && lon <= east;
}
