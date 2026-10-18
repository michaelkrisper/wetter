// Start location until (and unless) the device reports its position. The app
// fetches this immediately instead of waiting for GPS, so it is fast at home.
export const DEFAULT_LOCATION = { lat: 47.0707, lon: 15.4395, name: 'Graz', gps: false };

export const LOCALE = 'de-AT';

// A position change smaller than this keeps the current forecast: the finest
// grids (INCA, ICON-CH1) are 1 km, so nothing would change.
export const MOVE_THRESHOLD_KM = 1.5;

export const NOWCAST_MINUTES = 90;
export const HOURLY_SPAN = 24;
export const DAYS = 7;

// Refresh while visible, and when the app comes back to the foreground with
// data older than STALE_MS. INCA and the DWD radar update every 5-15 minutes.
export const REFRESH_MS = 5 * 60_000;
export const STALE_MS = 2 * 60_000;
export const REQUEST_TIMEOUT_MS = 8000;

// Precipitation rate (mm/h) below which a nowcast step counts as dry.
export const WET_THRESHOLD = 0.1;
