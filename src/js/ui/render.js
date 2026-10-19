// Renders a snapshot (see model.js) into the static skeleton of index.html.

import { describe } from '../weather-codes.js';
import { tempColor } from './colors.js';
import { clock, dayDiff, dayOfMonth, decimal, temp, weekday, when } from './format.js';
import { weatherIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

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
          : `${outlook.prob} % · ${decimal(outlook.total, outlook.total < 10 ? 1 : 0)} mm`,
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
  const { current, days } = view;
  const { label, icon } = describe(current.code, current.isDay);
  $('temp').textContent = temp(current.temp);
  $('cond-icon').innerHTML = weatherIcon(icon, current.isDay);
  $('cond').textContent = label;
  $('hi').textContent = temp(days[0]?.tempMax);
  $('lo').textContent = temp(days[0]?.tempMin);

  $('uv').textContent = Math.round(current.uv ?? 0);
  document.documentElement.style.setProperty('--glow', glow(current.code, current.isDay));
}

function dayName(start, now, tz, style = 'long') {
  const diff = dayDiff(start, now, tz);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return weekday(start, tz, style);
}

// The chart card's header: the precipitation outlook by default, the values
// of a tapped point, or a summary of the day the chart jumped to.
export function renderChartHead(view, { point, day }) {
  const { now, timezone: tz } = view;
  const title = $('chart-title');
  const detail = $('chart-detail');
  const head = $('chart-head');
  head.classList.remove('is-wet', 'is-point');

  if (point) {
    const sameDay = dayDiff(point.time, now, tz) === 0;
    const time = point.now
      ? 'Jetzt'
      : `${sameDay ? '' : `${weekday(point.time, tz)} `}${clock(point.time, tz)}`;
    title.innerHTML = `<span class="accent">${time}</span> ${temp(point.temp)}`;
    detail.textContent = point.fine
      ? `${decimal(point.rate ?? 0)} mm/h · ${Math.round(point.wind ?? 0)} km/h`
      : `${point.prob ?? 0} % · ${decimal(point.precip ?? 0)} mm · ${Math.round(point.wind ?? 0)} km/h`;
    head.classList.add('is-point');
    return;
  }

  const d = day != null && view.days.find((x) => x.time === day);
  if (d) {
    title.textContent = dayName(d.time, now, tz);
    const rain = (d.precipProb ?? 0) >= 20 && d.precipSum >= 0.1;
    detail.textContent = `${temp(d.tempMin)} / ${temp(d.tempMax)}${rain ? ` · ${d.precipProb} % · ${decimal(d.precipSum)} mm` : ' · trocken'}`;
    return;
  }

  const text = outlookText(view.outlook, now, tz);
  title.textContent = text.title;
  detail.textContent = text.detail;
  head.classList.toggle('is-wet', text.wet);
}

export function renderDays(view, activeDay) {
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
      return `<li><button type="button" data-day="${d.time}"${d.time === activeDay ? ' class="is-active"' : ''} aria-label="${dayName(d.time, view.now, tz)} im Diagramm zeigen">
<span class="d-name">${name}${i === 0 ? '' : `<small>${dayOfMonth(d.time, tz)}.</small>`}</span>
<span class="d-icon">${weatherIcon(icon, true, label)}</span>
<span class="d-rain">${rainy ? `${prob} %` : ''}</span>
<span class="d-mm">${rainy ? `${decimal(d.precipSum, d.precipSum < 10 ? 1 : 0)} mm` : ''}</span>
<span class="d-lo">${temp(d.tempMin)}</span>
<span class="d-bar"><i style="left:${pos(d.tempMin).toFixed(1)}%;right:${(100 - pos(d.tempMax)).toFixed(1)}%;background:linear-gradient(90deg,${tempColor(d.tempMin)},${tempColor(d.tempMax)})"></i>${dot}</span>
<span class="d-hi">${temp(d.tempMax)}</span>
</button></li>`;
    })
    .join('');
}
