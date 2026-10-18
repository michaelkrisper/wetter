// WMO weather interpretation codes as used by Open-Meteo.

const CODES = {
  0: ['Klar', 'clear'],
  1: ['Überwiegend klar', 'mostly-clear'],
  2: ['Teils bewölkt', 'partly-cloudy'],
  3: ['Bedeckt', 'cloudy'],
  45: ['Nebel', 'fog'],
  48: ['Reifnebel', 'fog'],
  51: ['Leichter Niesel', 'drizzle'],
  53: ['Niesel', 'drizzle'],
  55: ['Starker Niesel', 'drizzle'],
  56: ['Gefrierender Niesel', 'sleet'],
  57: ['Gefrierender Niesel', 'sleet'],
  61: ['Leichter Regen', 'rain'],
  63: ['Regen', 'rain'],
  65: ['Starker Regen', 'heavy-rain'],
  66: ['Gefrierender Regen', 'sleet'],
  67: ['Gefrierender Regen', 'sleet'],
  71: ['Leichter Schneefall', 'snow'],
  73: ['Schneefall', 'snow'],
  75: ['Starker Schneefall', 'snow'],
  77: ['Schneegriesel', 'snow'],
  80: ['Regenschauer', 'showers'],
  81: ['Regenschauer', 'showers'],
  82: ['Heftige Schauer', 'heavy-rain'],
  85: ['Schneeschauer', 'snow'],
  86: ['Schneeschauer', 'snow'],
  95: ['Gewitter', 'thunder'],
  96: ['Gewitter mit Hagel', 'thunder'],
  99: ['Gewitter mit Hagel', 'thunder'],
};

export function describe(code, isDay = true) {
  const [label, icon] = CODES[code] ?? ['–', 'cloudy'];
  if (code === 0 && isDay) return { label: 'Sonnig', icon };
  return { label, icon };
}

export const isPrecipitation = (code) => code >= 51;
export const isShower = (code) => code >= 80 && code < 95;
export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

// Turns an observed precipitation rate (mm/h) into the matching code, for when
// the nowcast contradicts the model's weather code.
export function precipitationCode(rate, type) {
  const level = rate < 1 ? 0 : rate < 4 ? 1 : 2;
  if (type === 'snow') return [71, 73, 75][level];
  if (type === 'sleet') return 66;
  return [61, 63, 65][level];
}
