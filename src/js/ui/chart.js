// The forecast chart: temperature curve over precipitation bars for the whole
// week, 24 hours wide on screen. Drag (or wheel) to scroll, tap a point to
// inspect it. Bar height is the amount, bar opacity the probability. Sun and
// moon rise/set are marked at their time. Drawn at the container's real pixel
// size; scrolling only moves a transform, so it stays smooth.

import { rainScale, tempColor } from './colors.js';
import { hour, temp, weekday } from './format.js';

const HOUR = 3_600_000;
const WINDOW = 24 * HOUR;
const LEAD = HOUR; // the default view starts one hour before now
const PAD = { top: 28, bottom: 18 };
const DESELECT_MS = 8000;
const TAP_SLOP = 6;
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

function nights(daylight, from, until) {
  const result = [];
  let cursor = from;
  for (const [rise, set] of daylight) {
    if (set <= from || rise >= until) continue;
    if (rise > cursor) result.push([cursor, rise]);
    cursor = Math.max(cursor, set);
  }
  if (cursor < until) result.push([cursor, until]);
  return result;
}

const EVENT_ICONS = {
  sunrise: '<circle class="c-ev-sun" r="3.2"/><path class="c-ev-arrow" d="M-3 -6 0 -9 3 -6"/>',
  sunset: '<circle class="c-ev-sun" r="3.2"/><path class="c-ev-arrow" d="M-3 6 0 9 3 6"/>',
  moonrise:
    '<path class="c-ev-moon" d="M2.6 2A3.6 3.6 0 1 1-1 -3.4 2.8 2.8 0 0 0 2.6 2Z"/><path class="c-ev-arrow" d="M-3 -6 0 -9 3 -6"/>',
  moonset:
    '<path class="c-ev-moon" d="M2.6 2A3.6 3.6 0 1 1-1 -3.4 2.8 2.8 0 0 0 2.6 2Z"/><path class="c-ev-arrow" d="M-3 6 0 9 3 6"/>',
};

// Precipitation: height = amount, opacity = probability (measured nowcast:
// full). UV bars sit underneath in yellow, so rain covers them where both occur.
function barsSvg({ bars, uv }, { x, plotBottom, barMax }) {
  const rect = (cls, start, end, height, opacity) =>
    `<rect class="${cls}" x="${f1(x(start) + 0.6)}" y="${f1(plotBottom - height)}" width="${f1(Math.max(1, x(end) - x(start) - 1.2))}" height="${f1(height)}" rx="1.5" opacity="${opacity.toFixed(2)}"/>`;
  const uvSvg = uv
    .map((u) => rect('c-uv', u.start, u.end, (Math.min(u.uv, 11) / 11) * barMax * 0.8, 0.55))
    .join('');
  const rainSvg = bars
    .filter((b) => b.rate >= 0.05 || (b.prob ?? 0) >= 20)
    .map((b) => {
      const height = b.rate >= 0.05 ? Math.max(2, rainScale(b.rate) * barMax) : 2;
      return rect('c-bar', b.start, b.end, height, b.prob == null ? 0.95 : 0.15 + (0.85 * b.prob) / 100);
    })
    .join('');
  return uvSvg + rainSvg;
}

// One probability label per rain spell, on its most likely hour.
function probabilityLabels(bars, { x, plotBottom, barMax }) {
  let svg = '';
  let spell = [];
  const flush = () => {
    const top = spell.reduce((a, b) => (b.prob > a.prob ? b : a), spell[0]);
    if (top) {
      const height = Math.max(2, rainScale(top.rate) * barMax);
      svg += `<text class="c-prob" x="${f1((x(top.start) + x(top.end)) / 2)}" y="${f1(plotBottom - height - 4)}" text-anchor="middle">${top.prob} %</text>`;
    }
    spell = [];
  };
  for (const b of bars) {
    if (b.prob != null && b.prob >= 30 && b.rate >= 0.05) spell.push(b);
    else flush();
  }
  flush();
  return svg;
}

// Hour labels every 3 hours, day changes with a line and the weekday, and the
// sun and moon events in the top band (moved down a row where a weekday is).
function axisSvg({ from, until, now, events }, { x, h, plotBottom, timezone }) {
  let labels = '';
  let midnights = '';
  const taken = [];
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= until; t += HOUR) {
    const hh = Number(hour(t, timezone));
    const px = x(t);
    if (hh === 0) {
      midnights += `<line class="c-day" x1="${f1(px)}" x2="${f1(px)}" y1="0" y2="${plotBottom}"/><text class="c-label c-weekday" x="${f1(px + 4)}" y="11">${weekday(t, timezone)}</text>`;
      taken.push([px, px + 26]);
    }
    if (hh % 3 === 0 && Math.abs(px - x(now)) > 16) {
      labels += `<text class="c-label" x="${f1(px)}" y="${h - 4}" text-anchor="middle">${hh}</text>`;
    }
  }
  const icons = events
    .map(({ time, kind }) => {
      const px = x(time);
      const row = taken.some(([a, b]) => px + 7 > a && px - 7 < b) ? 22 : 12;
      return `<g class="c-ev" transform="translate(${f1(px)} ${row})">${EVENT_ICONS[kind]}</g>`;
    })
    .join('');
  return { midnights, labels: labels + icons };
}

// Warmest and coldest point of every day, right on the curve.
function extremesSvg(points, xy, days) {
  let svg = '';
  for (const { time: start } of days) {
    const inDay = [];
    points.forEach((p, i) => {
      if (p.time >= start && p.time < start + 24 * HOUR) inDay.push(i);
    });
    if (inDay.length < 2) continue;
    const iMax = inDay.reduce((a, b) => (points[b].temp > points[a].temp ? b : a));
    const iMin = inDay.reduce((a, b) => (points[b].temp < points[a].temp ? b : a));
    if (points[iMax].temp - points[iMin].temp < 1) continue;
    svg += `<text class="c-extreme" x="${f1(xy[iMax][0])}" y="${f1(xy[iMax][1] - 7)}" text-anchor="middle">${temp(points[iMax].temp)}</text>`;
    svg += `<text class="c-extreme" x="${f1(xy[iMin][0])}" y="${f1(xy[iMin][1] + 15)}" text-anchor="middle">${temp(points[iMin].temp)}</text>`;
  }
  return svg;
}

export function createChart(el, { onSelect, onView }) {
  let view = null;
  let size = { w: 0, h: 0 };
  let scale = 0; // px per ms
  let geometry = null;
  let viewStart = 0; // time at the left edge
  let follow = true; // keep "now" in view as time passes
  let activeDay = null;
  let selected = null;
  let deselectTimer = 0;
  let animation = 0;

  const x = (t) => (t - view.timeline.from) * scale;
  const maxStart = () => Math.max(view.timeline.from, view.timeline.until - WINDOW);
  const clampStart = (t) => Math.min(maxStart(), Math.max(view.timeline.from, t));

  function applyScroll() {
    const group = el.querySelector('.c-scroll');
    if (group) group.setAttribute('transform', `translate(${f1(-x(viewStart))} 0)`);
  }

  function setStart(t) {
    viewStart = clampStart(t);
    applyScroll();
  }

  function notifyView() {
    onView({ follow, day: activeDay });
  }

  function draw() {
    if (!view || !size.w || !size.h) return;
    const { timeline, daylight, timezone, days } = view;
    const { from, until, now, points, bars } = timeline;
    const { w, h } = size;
    scale = w / WINDOW;
    const plotTop = PAD.top;
    const plotBottom = h - PAD.bottom;
    const plotH = plotBottom - plotTop;
    const tempTop = plotTop + 14;
    const tempBottom = plotBottom - Math.max(20, plotH * 0.3);

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
    geometry = { xy };

    const line = monotonePath(xy);
    const area = `${line}L${f1(xy.at(-1)[0])} ${plotBottom}L${f1(xy[0][0])} ${plotBottom}Z`;
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map((o) => `<stop offset="${o}" stop-color="${tempColor(hi - o * (hi - lo))}"/>`)
      .join('');
    const shade = nights(daylight, from, until)
      .map(
        ([a, b]) =>
          `<rect class="c-night" x="${f1(x(a))}" y="0" width="${f1(x(b) - x(a))}" height="${plotBottom}"/>`,
      )
      .join('');
    const layout = { x, h, plotBottom, barMax: plotH * 0.42, timezone };
    const { midnights, labels } = axisSvg(timeline, layout);

    const nowX = x(now);
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
<defs>
<linearGradient id="c-line" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${f1(tempTop)}" y2="${f1(tempBottom)}">${stops}</linearGradient>
<linearGradient id="c-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempColor(hi)}" stop-opacity=".2"/><stop offset="1" stop-color="${tempColor(lo)}" stop-opacity="0"/></linearGradient>
</defs>
<g class="c-scroll">
${shade}${midnights}${barsSvg(timeline, layout)}
<path d="${area}" fill="url(#c-area)"/>
<path class="c-temp" d="${line}" stroke="url(#c-line)"/>
<rect class="c-past" x="0" y="0" width="${f1(nowX)}" height="${h}"/>
${probabilityLabels(bars, layout)}${extremesSvg(points, xy, days)}${labels}
<line class="c-now" x1="${f1(nowX)}" x2="${f1(nowX)}" y1="${plotTop - 2}" y2="${plotBottom}"/>
<text class="c-label c-now-label" x="${f1(nowX)}" y="${h - 4}" text-anchor="middle">jetzt</text>
<g class="c-marker" hidden><line y1="0" y2="${plotBottom}"/><circle r="4.5"/></g>
</g>
</svg>`;
    if (follow) viewStart = now - LEAD;
    setStart(viewStart);
    placeMarker();
  }

  function placeMarker() {
    const marker = el.querySelector('.c-marker');
    if (!marker || !geometry) return;
    marker.toggleAttribute('hidden', selected == null);
    if (selected == null) return;
    const [px, py] = geometry.xy[selected];
    marker.setAttribute('transform', `translate(${f1(px)} 0)`);
    marker.querySelector('circle').setAttribute('cy', f1(py));
  }

  function select(index) {
    selected = index;
    placeMarker();
    onSelect(index == null ? null : view.timeline.points[index]);
    clearTimeout(deselectTimer);
    if (index != null) deselectTimer = setTimeout(() => select(null), DESELECT_MS);
  }

  function nearest(clientX) {
    const px = clientX - el.getBoundingClientRect().left + x(viewStart);
    let best = 0;
    geometry.xy.forEach(([gx], i) => {
      if (Math.abs(gx - px) < Math.abs(geometry.xy[best][0] - px)) best = i;
    });
    return best;
  }

  function animateTo(target, done) {
    cancelAnimationFrame(animation);
    const start = viewStart;
    const goal = clampStart(target);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 280);
      setStart(start + (goal - start) * (1 - (1 - k) ** 3));
      if (k < 1) animation = requestAnimationFrame(step);
      else done?.();
    };
    animation = requestAnimationFrame(step);
  }

  function manualScroll() {
    if (!follow && activeDay == null) return;
    follow = false;
    activeDay = null;
    notifyView();
  }

  // Drag to scroll with a little inertia; a tap without movement selects.
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (!view) return;
    cancelAnimationFrame(animation);
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, start: viewStart, moved: false, last: e.clientX, time: e.timeStamp, v: 0 };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (e.pointerType === 'mouse' && geometry) select(nearest(e.clientX));
      return;
    }
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < TAP_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      manualScroll();
    }
    const dt = Math.max(1, e.timeStamp - drag.time);
    drag.v = (e.clientX - drag.last) / dt;
    drag.last = e.clientX;
    drag.time = e.timeStamp;
    setStart(drag.start - dx / scale);
  });
  const release = (e) => {
    if (!drag) return;
    const { moved, v } = drag;
    drag = null;
    if (!moved) {
      const index = nearest(e.clientX);
      select(index === selected && e.pointerType !== 'mouse' ? null : index);
      return;
    }
    let velocity = v;
    let last = performance.now();
    const glide = (t) => {
      const dt = t - last;
      last = t;
      velocity *= 0.95 ** (dt / 16);
      setStart(viewStart - (velocity * dt) / scale);
      if (Math.abs(velocity) > 0.02) animation = requestAnimationFrame(glide);
    };
    animation = requestAnimationFrame(glide);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', () => {
    drag = null;
  });
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && !drag && select(null));
  el.addEventListener(
    'wheel',
    (e) => {
      if (!view) return;
      e.preventDefault();
      manualScroll();
      setStart(viewStart + (e.deltaX || e.deltaY) / scale);
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 3, ArrowLeft: -3 }[e.key];
    if (!step || !view) return;
    e.preventDefault();
    manualScroll();
    animateTo(viewStart + step * HOUR);
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
      const keep = selected != null ? view?.timeline.points[selected]?.time : null;
      view = next;
      const index = keep == null ? -1 : next.timeline.points.findIndex((p) => p.time === keep);
      selected = index >= 0 ? index : null;
      draw();
    },
    showDay(start) {
      if (!view) return;
      select(null);
      follow = false;
      activeDay = start;
      notifyView();
      animateTo(start);
    },
    showNow() {
      if (!view) return;
      select(null);
      follow = true;
      activeDay = null;
      notifyView();
      animateTo(view.timeline.now - LEAD);
    },
  };
}
