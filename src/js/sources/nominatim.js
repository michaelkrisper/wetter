// Place name for a GPS position via OpenStreetMap Nominatim (ODbL). Called at
// most once per ~1 km grid cell; results are cached by the caller.

import { getJson, query } from './http.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export async function reverseGeocode(lat, lon) {
  const params = {
    format: 'jsonv2',
    lat: lat.toFixed(3),
    lon: lon.toFixed(3),
    zoom: 12,
    'accept-language': 'de',
  };
  const { address = {}, name } = await getJson(`${ENDPOINT}?${query(params)}`);
  return address.city ?? address.town ?? address.village ?? address.municipality ?? name ?? null;
}
