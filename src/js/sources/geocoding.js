// Place search by name via the Open-Meteo geocoding API (GeoNames), while
// typing. Its own ranking puts exact names first ("Klagen" in Indonesia before
// Klagenfurt), so results are re-ranked: names starting with the query, places
// in Austria, then larger places first.

import { getJson, query } from './http.js';

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const SHOWN = 8;

export async function searchPlaces(name) {
  const params = { name, count: 30, language: 'de', format: 'json' };
  const url = `${ENDPOINT}?${query(params)}`;
  // New connections sometimes hang; a second one usually gets through.
  const { results = [] } = await getJson(url, 4000).catch(() => getJson(url, 4000));
  const q = name.toLocaleLowerCase('de');
  const score = (r) => {
    const n = r.name.toLocaleLowerCase('de');
    return (n.startsWith(q) ? 0 : 2) + (r.country_code === 'AT' ? 0 : 1);
  };
  results.sort((a, b) => score(a) - score(b) || (b.population ?? 0) - (a.population ?? 0));
  const seen = new Set();
  return results
    .map((r) => ({
      lat: r.latitude,
      lon: r.longitude,
      name: r.name,
      area: [r.admin1, r.country].filter(Boolean).join(', '),
    }))
    .filter((p) => !seen.has(`${p.name}|${p.area}`) && seen.add(`${p.name}|${p.area}`))
    .slice(0, SHOWN);
}
