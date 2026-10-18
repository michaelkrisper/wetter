import { DEFAULT_LOCATION } from './config.js';
import { reverseGeocode } from './sources/nominatim.js';
import * as storage from './storage.js';

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      reject,
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15_000 },
    );
  });
}

// Place names are cached per ~1 km cell, so moving around town does not
// hit Nominatim again.
export async function placeName({ lat, lon }) {
  if (distanceKm({ lat, lon }, DEFAULT_LOCATION) < 4) return DEFAULT_LOCATION.name;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const names = storage.get('places') ?? {};
  if (names[key]) return names[key];
  const name = await reverseGeocode(lat, lon);
  if (name) storage.set('places', { ...names, [key]: name });
  return name;
}
