import { BORDERS } from './borders.js';

// High-resolution models served through Open-Meteo. They override the global
// "best match" blend for temperature, precipitation, wind and weather code as
// far as they reach (2-3 days); probability and UV always come from best match.
export const MODELS = {
  geosphere_arome_austria: { label: 'AROME', detail: '2,5 km', provider: 'geosphere' },
  icon_d2: { label: 'ICON-D2', detail: '2 km', provider: 'dwd' },
  meteoswiss_icon_ch1: { label: 'ICON-CH1', detail: '1 km', provider: 'meteoswiss' },
};

// Countries with dedicated national services. `nowcast` is the order in which
// nowcast providers are tried; each one is only asked if it covers the point,
// and Open-Meteo's 15-minute data is the final fallback everywhere. The DWD
// radar is only trusted inside Germany: towards its edges the composite has no
// radar coverage and would report "dry" during rain.
export const REGIONS = [
  { id: 'at', model: 'geosphere_arome_austria', nowcast: ['inca'] },
  { id: 'de', model: 'icon_d2', nowcast: ['dwd', 'inca'] },
  { id: 'ch', model: 'meteoswiss_icon_ch1', nowcast: ['inca'] },
];

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
