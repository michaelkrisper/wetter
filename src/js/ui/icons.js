// Inline SVG icons (24x24 grid, stroked). Colours come from CSS classes so
// the same markup works in every context.

const CLOUD = 'M7 19a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.7-1.03A4 4 0 0 1 17 19Z';
const SUN_RAYS =
  'M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4';
const SMALL_SUN =
  '<circle class="i-sun" cx="9" cy="8" r="3"/><path class="i-sun" d="M9 2v1.4M3 8h1.4M4.8 3.8l1 1M13.2 3.8l-1 1M4.8 12.2l1-1"/>';
const MOON = 'M19.5 14.2A7.8 7.8 0 1 1 9.8 4.5a6.2 6.2 0 0 0 9.7 9.7Z';
const SMALL_MOON = '<path class="i-moon" d="M13 8.6A5 5 0 1 1 6.9 2.5a4 4 0 0 0 6.1 6.1Z"/>';

const cloud = (cls = '', transform = '') =>
  `<path class="i-cloud ${cls}" d="${CLOUD}"${transform ? ` transform="${transform}"` : ''}/>`;
const raised = (cls) => cloud(cls, 'translate(0 -4)');

const WEATHER = {
  clear: (day) =>
    day
      ? `<circle class="i-sun" cx="12" cy="12" r="4.2"/><path class="i-sun" d="${SUN_RAYS}"/>`
      : `<path class="i-moon" d="${MOON}"/>`,
  'mostly-clear': (day) => `${day ? SMALL_SUN : SMALL_MOON}${cloud('i-fill', 'translate(6 7) scale(.75)')}`,
  'partly-cloudy': (day) =>
    `${day ? SMALL_SUN : SMALL_MOON}${cloud('i-fill', 'translate(3.6 3.6) scale(.85)')}`,
  cloudy: () => cloud(),
  fog: () => '<path class="i-cloud" d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  drizzle: () =>
    `${raised()}<path class="i-rain i-dot" d="M8.5 18.5v.01M12 20.5v.01M15.5 18.5v.01M10 22v.01M14 22v.01"/>`,
  rain: () => `${raised()}<path class="i-rain" d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`,
  'heavy-rain': () =>
    `${raised()}<path class="i-rain" d="M7.5 17l-1.5 4.5M11 17l-1.5 4.5M14.5 17l-1.5 4.5M18 17l-1.5 4.5"/>`,
  showers: (day) =>
    `${day ? SMALL_SUN : SMALL_MOON}${cloud('i-fill', 'translate(3.6 0) scale(.85)')}<path class="i-rain" d="M10 18.5l-1 3M14 18.5l-1 3M18 18.5l-1 3"/>`,
  snow: () =>
    `${raised()}<path class="i-snow i-dot" d="M8.5 18.5v.01M12 20v.01M15.5 18.5v.01M10 22.5v.01M14 22.5v.01"/>`,
  sleet: () =>
    `${raised()}<path class="i-rain" d="M9 17.5l-1 3M15 17.5l-1 3"/><path class="i-snow i-dot" d="M12 19.5v.01"/>`,
  thunder: () => `${raised()}<path class="i-bolt" d="M13 14.5l-3 4h3.5l-2.5 4"/>`,
};

export function weatherIcon(name, isDay = true, label = '') {
  const body = (WEATHER[name] ?? WEATHER.cloudy)(isDay);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="wx" viewBox="0 0 24 24" ${a11y}>${body}</svg>`;
}

// Moon disc with the lit part for a phase in [0, 1): 0 new, .25 first quarter,
// .5 full, .75 last quarter (northern hemisphere view).
export function moonIcon(phase = 0.5) {
  const r = 8;
  const k = Math.cos(2 * Math.PI * phase);
  const rx = Math.abs(k) * r;
  const waxing = phase < 0.5;
  const limb = waxing ? 1 : 0;
  const terminator = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
  const lit =
    phase < 0.02 || phase > 0.98
      ? ''
      : `<path class="i-moon-lit" d="M12 4A${r} ${r} 0 0 ${limb} 12 20A${rx.toFixed(2)} ${r} 0 0 ${terminator} 12 4Z"/>`;
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><circle class="i-moon-disc" cx="12" cy="12" r="${r}"/>${lit}</svg>`;
}

const GLYPHS = {
  reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  gps: '<path d="M3 11.5 21 3l-8.5 18-2-7.5Z"/>',
  sunrise: '<path d="M4 18h16M7.5 18a4.5 4.5 0 0 1 9 0M12 4v6M9 7l3-3 3 3"/>',
  sun: `<circle cx="12" cy="12" r="4"/><path d="${SUN_RAYS}"/>`,
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z"/>',
  forecast: `<path d="${CLOUD}" transform="translate(1 0) scale(.92)"/><path d="M8 2.8v1.4M3.5 7.5h1.4M4.8 4.3l1 1M11.2 4.3l-1 1"/>`,
  radar:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r=".6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate:
    '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="7"/>',
};

export function glyph(name) {
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name]}</svg>`;
}
