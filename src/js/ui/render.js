// Renders a snapshot (see model.js) into the static skeleton of index.html.

import { PROVIDERS } from '../forecast.js';
import { describe } from '../weather-codes.js';
import { rainScale, tempColor } from './colors.js';
import { clock, dayDiff, dayOfMonth, decimal, temp, weekday, when } from './format.js';
import { moonIcon, weatherIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const MINUTE = 60_000;

const NOUN = { rain: 'Regen', snow: 'Schneefall', sleet: 'Schneeregen' };

function precipitationLabel(type, peak) {
  const noun = NOUN[type] ?? NOUN.rain;
  if (peak < 1) return `Leichter ${noun}`;
  if (peak >= 4) return `Starker ${noun}`;
  return noun;
}

function outlookText(outlook, now, tz) {
  const at = (t) => when(t, now, tz, outlook.exact);
  switch (outlook.kind) {
    case 'starts':
      return {
        title: `${precipitationLabel(outlook.type, outlook.peak)} ab ${outlook.exact ? '' : 'ca. '}${at(outlook.at)}`,
        detail: outlook.exact
          ? `≈ ${decimal(outlook.total)} mm in 90 min`
          : `${outlook.prob ?? '–'} % Wahrscheinlichkeit`,
        wet: outlook.exact,
      };
    case 'stops':
      return {
        title: `${precipitationLabel(outlook.type, outlook.peak)}, endet ${outlook.exact ? 'gegen' : 'ca.'} ${at(outlook.at)}`,
        detail: `≈ ${decimal(outlook.total)} mm in 90 min`,
        wet: true,
      };
    case 'continues':
      return {
        title: `${precipitationLabel(outlook.type, outlook.peak)} hält an`,
        detail: `≈ ${decimal(outlook.total)} mm in 90 min`,
        wet: true,
      };
    case 'dry-until': {
      const days = dayDiff(outlook.day, now, tz);
      const day = days === 1 ? 'morgen' : weekday(outlook.day, tz, 'long');
      return {
        title: `Trocken bis ${day}`,
        detail: `dann ${outlook.prob} % · ${decimal(outlook.total)} mm`,
        wet: false,
      };
    }
    default:
      return { title: 'Trocken, kein Regen in Sicht', detail: 'die nächsten 7 Tage', wet: false };
  }
}

function glow(code, isDay) {
  if (code >= 95) return 'var(--glow-storm)';
  if (code >= 71 && code <= 77) return 'var(--glow-snow)';
  if (code >= 51) return 'var(--glow-rain)';
  if (code >= 45) return 'var(--glow-fog)';
  if (code >= 2) return isDay ? 'var(--glow-cloud)' : 'var(--glow-night-cloud)';
  return isDay ? 'var(--glow-sun)' : 'var(--glow-night)';
}

export function renderHero(view) {
  const { current, days, astro, timezone: tz } = view;
  const { label, icon } = describe(current.code, current.isDay);
  $('temp').textContent = temp(current.temp);
  $('cond-icon').innerHTML = weatherIcon(icon, current.isDay);
  $('cond').textContent = label;
  $('feels').textContent = current.feelsLike == null ? '' : `Gefühlt ${temp(current.feelsLike)}`;
  $('hi').textContent = temp(days[0]?.tempMax);
  $('lo').textContent = temp(days[0]?.tempMin);

  const wind = Math.round(current.wind ?? 0);
  const gust = Math.round(current.gust ?? 0);
  $('wind').textContent = `${wind} km/h`;
  $('wind-label').textContent = gust >= 30 && gust > wind + 10 ? `Böen ${gust}` : 'Wind';
  $('uv').textContent = Math.round(current.uv ?? 0);
  if (astro) {
    $('sun').textContent = `${clock(astro.sunrise, tz)}–${clock(astro.sunset, tz)}`;
    $('moon').textContent = `${clock(astro.moonrise, tz)}–${clock(astro.moonset, tz)}`;
    $('moon-icon').innerHTML = moonIcon(astro.moonPhase ?? 0.5);
  }
  document.documentElement.style.setProperty('--glow', glow(current.code, current.isDay));
}

export function renderNowcast(view) {
  const { nowcast, outlook, now, timezone: tz } = view;
  const text = outlookText(outlook, now, tz);
  $('outlook').textContent = text.title;
  $('outlook-detail').textContent = text.detail;
  $('nowcast').classList.toggle('is-wet', text.wet);

  const bars = $('nowcast-bars');
  if (!nowcast) {
    bars.innerHTML = '<p class="nc-empty">Keine aktuellen Kurzfristdaten</p>';
    return;
  }
  const span = nowcast.until - nowcast.from;
  bars.innerHTML = nowcast.steps
    .map((s) => {
      const left = ((s.start - nowcast.from) / span) * 100;
      const width = ((Math.min(s.end, nowcast.until) - s.start) / span) * 100;
      const height = rainScale(s.rate) * 100;
      const cls = s.type ? `nc-bar nc-${s.type}` : 'nc-bar nc-dry';
      return `<i class="${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;height:${height.toFixed(1)}%"></i>`;
    })
    .join('');
  const ticks = [0, 30, 60, 90].map((m, i) => (i === 0 ? 'jetzt' : clock(now + m * MINUTE, tz)));
  $('nowcast-ticks').innerHTML = ticks.map((t) => `<span>${t}</span>`).join('');
}

export function renderPoint(point, view) {
  if (!point) return;
  const tz = view.timezone;
  $('point-time').textContent = point.now ? 'Jetzt' : clock(point.time, tz);
  $('point-temp').textContent = temp(point.temp);
  const rain = point.fine
    ? `${decimal(point.rate ?? 0)} mm/h`
    : `${point.prob ?? 0} % · ${decimal(point.precip ?? 0)} mm`;
  $('point-rain').textContent = rain;
  $('point-wind').textContent = `${Math.round(point.wind ?? 0)} km/h`;
}

export function renderDays(view) {
  const { days, current, timezone: tz } = view;
  if (!days.length) return;
  const lo = Math.min(...days.map((d) => d.tempMin));
  const hi = Math.max(...days.map((d) => d.tempMax));
  const pos = (t) => ((t - lo) / Math.max(1, hi - lo)) * 100;

  $('days').innerHTML = days
    .map((d, i) => {
      const { label, icon } = describe(d.code, true);
      const name = i === 0 ? 'Heute' : weekday(d.time, tz);
      const prob = d.precipProb ?? 0;
      const rainy = prob >= 20 && d.precipSum >= 0.1;
      const dot =
        i === 0 && current.temp != null ? `<b style="left:${pos(current.temp).toFixed(1)}%"></b>` : '';
      return `<li>
<span class="d-name">${name}${i === 0 ? '' : `<small>${dayOfMonth(d.time, tz)}.</small>`}</span>
<span class="d-icon">${weatherIcon(icon, true, label)}</span>
<span class="d-rain">${rainy ? `${prob} %` : ''}</span>
<span class="d-mm">${rainy ? `${decimal(d.precipSum, d.precipSum < 10 ? 1 : 0)} mm` : ''}</span>
<span class="d-lo">${temp(d.tempMin)}</span>
<span class="d-bar"><i style="left:${pos(d.tempMin).toFixed(1)}%;right:${(100 - pos(d.tempMax)).toFixed(1)}%;background:linear-gradient(90deg,${tempColor(d.tempMin)},${tempColor(d.tempMax)})"></i>${dot}</span>
<span class="d-hi">${temp(d.tempMax)}</span>
</li>`;
    })
    .join('');
}

export function renderCredits(view, geocoded) {
  const links = view.providers
    .map((id) => PROVIDERS[id])
    .map(({ label, url }) => `<a href="${url}">${label}</a>`);
  if (geocoded) links.push('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>');
  $('credits').innerHTML = `Daten: ${links.join(' · ')}`;
}
