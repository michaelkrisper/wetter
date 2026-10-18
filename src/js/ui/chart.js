// 24-hour chart: temperature curve over precipitation bars, night shading and
// day boundaries. Drawn at the container's real pixel size (no distorted
// strokes); drag or hover to inspect a point, it snaps back to "now".

import { rainScale, tempColor } from './colors.js';
import { hour, temp, weekday } from './format.js';

const PAD = { left: 8, right: 8, top: 18, bottom: 18 };
const RESET_MS = 4000;
const f1 = (n) => n.toFixed(1);

// Monotone cubic interpolation (Fritsch-Carlson): smooth, but never overshoots
// the data, so the curve does not invent highs and lows between hours.
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6;
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] =
      m[i - 1] * m[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${f1(x0 + h)} ${f1(y0 + t[i] * h)} ${f1(x1 - h)} ${f1(y1 - t[i + 1] * h)} ${f1(x1)} ${f1(y1)}`;
  }
  return d;
}

function nightRects(daylight, from, until, x, top, height) {
  const nights = [];
  let cursor = from;
  for (const [rise, set] of daylight) {
    if (set <= from || rise >= until) continue;
    if (rise > cursor) nights.push([cursor, rise]);
    cursor = Math.max(cursor, set);
  }
  if (cursor < until) nights.push([cursor, until]);
  return nights
    .map(
      ([a, b]) =>
        `<rect class="c-night" x="${f1(x(a))}" y="${top}" width="${f1(x(b) - x(a))}" height="${height}"/>`,
    )
    .join('');
}

export function createChart(el, { onSelect }) {
  let view = null;
  let size = { w: 0, h: 0 };
  let geometry = null;
  let selected = 0;
  let resetTimer = 0;

  function draw() {
    if (!view || !size.w || !size.h) return;
    const { timeline, daylight, timezone } = view;
    const { from, until, points, bars } = timeline;
    const { w, h } = size;
    const plotTop = PAD.top;
    const plotBottom = h - PAD.bottom;
    const plotH = plotBottom - plotTop;
    const tempTop = plotTop + 2;
    const tempBottom = plotBottom - Math.max(18, plotH * 0.24);
    const x = (t) => PAD.left + ((t - from) / (until - from)) * (w - PAD.left - PAD.right);

    const temps = points.map((p) => p.temp);
    let lo = Math.min(...temps);
    let hi = Math.max(...temps);
    if (hi - lo < 4) {
      const mid = (hi + lo) / 2;
      lo = mid - 2;
      hi = mid + 2;
    }
    const y = (v) => tempBottom - ((v - lo) / (hi - lo)) * (tempBottom - tempTop);
    const xy = points.map((p) => [x(p.time), y(p.temp)]);
    geometry = { x, y, xy };

    const line = monotonePath(xy);
    const area = `${line}L${f1(xy.at(-1)[0])} ${plotBottom}L${f1(xy[0][0])} ${plotBottom}Z`;
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map((o) => `<stop offset="${o}" stop-color="${tempColor(hi - o * (hi - lo))}"/>`)
      .join('');

    const barMax = plotH * 0.36;
    const barsSvg = bars
      .filter((b) => b.rate >= 0.05)
      .map((b) => {
        const bh = Math.max(1.5, rainScale(b.rate) * barMax);
        const bx = x(b.start) + 0.75;
        const bw = Math.max(1, x(b.end) - x(b.start) - 1.5);
        const opacity = b.prob == null ? 0.9 : 0.25 + (0.65 * b.prob) / 100;
        return `<rect class="c-bar" x="${f1(bx)}" y="${f1(plotBottom - bh)}" width="${f1(bw)}" height="${f1(bh)}" rx="1.5" opacity="${opacity.toFixed(2)}"/>`;
      })
      .join('');

    // Hour labels on a fixed 3- or 6-hour grid; day changes get a line and the weekday.
    const every = w < 300 ? 6 : 3;
    let labels = `<text class="c-label" x="${PAD.left}" y="${h - 4}">jetzt</text>`;
    let midnights = '';
    for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= until; t += 3_600_000) {
      const hh = Number(hour(t, timezone));
      const px = x(t);
      if (hh === 0) {
        midnights += `<line class="c-day" x1="${f1(px)}" x2="${f1(px)}" y1="${plotTop - 12}" y2="${plotBottom}"/><text class="c-label c-weekday" x="${f1(px + 4)}" y="${plotTop - 4}">${weekday(t, timezone)}</text>`;
      }
      if (hh % every === 0 && px > PAD.left + 34 && px < w - 10) {
        labels += `<text class="c-label" x="${f1(px)}" y="${h - 4}" text-anchor="middle">${hh}</text>`;
      }
    }

    // Label the warmest and coldest point right on the curve.
    const iMax = temps.indexOf(Math.max(...temps));
    const iMin = temps.indexOf(Math.min(...temps));
    const extreme = (i, above) => {
      const [px, py] = xy[i];
      const anchor = px < 20 ? 'start' : px > w - 20 ? 'end' : 'middle';
      return `<text class="c-extreme" x="${f1(px)}" y="${f1(above ? py - 7 : py + 15)}" text-anchor="${anchor}">${temp(temps[i])}</text>`;
    };

    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
<defs>
<linearGradient id="c-line" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${f1(tempTop)}" y2="${f1(tempBottom)}">${stops}</linearGradient>
<linearGradient id="c-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempColor(hi)}" stop-opacity=".22"/><stop offset="1" stop-color="${tempColor(lo)}" stop-opacity="0"/></linearGradient>
</defs>
${nightRects(daylight, from, until, x, plotTop - 12, plotBottom - plotTop + 12)}
${midnights}
${barsSvg}
<path d="${area}" fill="url(#c-area)"/>
<path class="c-temp" d="${line}" stroke="url(#c-line)"/>
${iMax !== iMin ? extreme(iMax, true) + extreme(iMin, false) : ''}
${labels}
<g class="c-marker"><line y1="${plotTop - 12}" y2="${plotBottom}"/><circle r="4.5"/></g>
</svg>`;
    placeMarker();
  }

  function placeMarker() {
    const marker = el.querySelector('.c-marker');
    if (!marker || !geometry) return;
    const [px, py] = geometry.xy[selected] ?? geometry.xy[0];
    marker.setAttribute('transform', `translate(${f1(px)} 0)`);
    marker.querySelector('circle').setAttribute('cy', f1(py));
    marker.classList.toggle('is-now', selected === 0);
    onSelect(view.timeline.points[selected]);
  }

  function select(index) {
    const max = view.timeline.points.length - 1;
    const next = Math.max(0, Math.min(max, index));
    if (next === selected) return;
    selected = next;
    placeMarker();
  }

  function pick(event) {
    if (!geometry) return;
    const px = event.clientX - el.getBoundingClientRect().left;
    let best = 0;
    geometry.xy.forEach(([x], i) => {
      if (Math.abs(x - px) < Math.abs(geometry.xy[best][0] - px)) best = i;
    });
    clearTimeout(resetTimer);
    select(best);
  }

  const scheduleReset = (delay = RESET_MS) => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => select(0), delay);
  };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pick(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'mouse') pick(e);
  });
  el.addEventListener('pointerup', () => scheduleReset());
  el.addEventListener('pointercancel', () => scheduleReset());
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && scheduleReset(1000));
  el.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    select(selected + step);
    scheduleReset();
  });

  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    const h = Math.round(entry.contentRect.height);
    if (w !== size.w || h !== size.h) {
      size = { w, h };
      draw();
    }
  }).observe(el);

  return {
    update(next) {
      view = next;
      selected = Math.min(selected, next.timeline.points.length - 1);
      draw();
    },
  };
}
