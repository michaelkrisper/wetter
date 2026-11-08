// The forecast chart: temperature curve under a sky of clouds, rain and wind for
// the whole week, 12 hours wide on screen (a day jumped to shows all 24). Drag
// (or wheel) to scroll, tap a point to inspect it. Rain hangs from the clouds,
// as deep as the amount and as opaque as the probability. Sun and moon rise/set
// are marked at their time along the bottom. Drawn at the container's real pixel
// size; scrolling only moves a transform, so it stays smooth.

import { WIND_KMH } from '../config.js';
import { rainScale, tempColor } from './colors.js';
import { decimal, hour, temp, weekday } from './format.js';

const HOUR = 3_600_000;
const SPAN = { now: 12 * HOUR, day: 24 * HOUR };
const LEAD = HOUR; // the default view starts one hour before now
const PAD = { top: 18, bottom: 36 };
// Cloud band just below the wind row.
const CLOUD_TOP = 14;
const CLOUD_H = 30;
// Rain starts at the base of the puffs.
const RAIN_TOP = CLOUD_TOP + CLOUD_H * 0.8;
// The least precipitation (mm/h) that is drawn.
const WET_MM = 0.05;
// Hour labels every hour where they fit, every 3 hours otherwise.
const HOURLY_LABEL_PX = 24;
// The temperature axis fits what is on screen, but spans at least this many
// degrees, so a calm night stays calm.
const MIN_SPAN = 4;
// ... plus what lies up to this share of a screen beyond either edge, fading
// with distance, so the axis glides instead of jumping while scrolling.
const FIT_MARGIN = 0.5;
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

// Sky behind the chart: light by day, dark by night, with twilight fading
// over this long around sunrise and sunset, and stars in the dark hours.
const TWILIGHT = 60 * 60_000;
const STAR_PX = 1600; // one star per this many square px of night sky

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

// Stops of a left-to-right gradient that is `night` at night and `day` by day.
function skyStops(daylight, from, until, x, night, day) {
  const width = x(until);
  const stop = (t, cls) =>
    `<stop offset="${Math.min(1, Math.max(0, x(t) / width)).toFixed(4)}" class="${cls}"/>`;
  let stops = stop(from, night);
  for (const [rise, set] of daylight) {
    if (set + TWILIGHT <= from || rise - TWILIGHT >= until) continue;
    stops += stop(rise - TWILIGHT, night) + stop(rise + TWILIGHT, day);
    stops += stop(set - TWILIGHT, day) + stop(set + TWILIGHT, night);
  }
  return stops + stop(until, night);
}

// Cloud cover as puffs in a band across the top of the sky, below the wind row:
// per hour more, bigger and denser puffs the more cover, so an overcast sky closes
// into one layer and a clear one leaves the blue or the stars. A veil over the
// whole chart only washed it out. Soft edges come from a radial gradient, not a
// blur or mask: Safari repaints those on every scroll frame. Scattered by a
// fixed hash of the time, so the clouds stay put across redraws.
// Where it rains or snows the puffs turn grey, and below every precipitation
// interval rain (falling dashes) or snow (dots) hangs from the cloud base like
// an upside-down bar: as deep as the amount (to the ground from 10 mm/h, the
// same scale the bars had) and as opaque as the probability. A wet hour without
// cover still gets clouds. The puffs sway, faster and wider in more wind; from a
// fresh breeze on they stretch, the rain slants and grey gusts sweep through and
// curl, bigger and faster in strong wind. Animated in CSS (transforms and dash
// offsets of a few grouped paths), no masks or filters.
function cloudSvg({ sky, bars }, daylight, x, hourPx, ground) {
  const isDay = (t) => daylight.some(([rise, set]) => t >= rise && t < set);
  const puffs = new Map();
  const gusts = new Map();
  for (const { time, cloud, wind } of sky) {
    const wet = wetAt(bars, time);
    const level = windLevel(wind);
    if (level) {
      const key = `c-gust c-gust-${level}${Math.round(time / HOUR) % 2 ? ' c-gust-alt' : ''}`;
      append(gusts, key, gustPath(time, level, x, hourPx));
    }
    const c = Math.max(cloud ?? 0, wet ? 70 : 0) / 100;
    if (!c) continue;
    const cls = `c-puff-${wet ? 'rain' : 'day'}`;
    puffsSvg(puffs, time, c, isDay(time) ? cls : `${cls}-night`, level, x, hourPx);
  }
  // Rain first, so it comes out of the cloud.
  let svg = rainSvg(sky, bars, x, hourPx, ground);
  for (const [cls, group] of puffs) svg += `<g class="${cls}">${group}</g>`;
  for (const [cls, d] of gusts) svg += `<path class="${cls}" d="${d}"/>`;
  if (!svg) return { defs: '', svg: '' };
  const puff = (id) =>
    `<radialGradient id="${id}"><stop offset="0" class="${id}" stop-opacity=".95"/><stop offset=".55" class="${id}" stop-opacity=".7"/><stop offset="1" class="${id}" stop-opacity="0"/></radialGradient>`;
  return {
    defs: ['c-puff-day', 'c-puff-day-night', 'c-puff-rain', 'c-puff-rain-night'].map(puff).join(''),
    svg,
  };
}

const append = (map, key, svg) => map.set(key, (map.get(key) ?? '') + svg);

// One path per look instead of an element per drop.
function rainSvg(sky, bars, x, hourPx, ground) {
  const paths = new Map();
  for (const bar of bars) {
    if (bar.rate < WET_MM) continue;
    const key = `${dropClass(bar)} ${rainOpacity(bar.prob).toFixed(1)}`;
    append(paths, key, rainPath(bar, windAt(sky, bar), x, hourPx, ground));
  }
  let svg = '';
  for (const [key, d] of paths) {
    const [cls, opacity] = key.split(' ');
    svg += `<path class="${cls}" d="${d}" opacity="${opacity}"/>`;
  }
  return svg;
}

const dropClass = (bar) => (bar.type === 'snow' ? 'c-flake' : 'c-drop');
const windLevel = (wind) => (wind >= WIND_KMH.strong ? 2 : wind >= WIND_KMH.fresh ? 1 : 0);
const windAt = (sky, bar) => sky.find((s) => Math.abs(s.time - (bar.start + bar.end) / 2) <= HOUR / 2)?.wind;

// The heaviest precipitation drawn within this hour.
const wetAt = (bars, time) =>
  bars
    .filter((b) => b.rate >= WET_MM && b.start < time + HOUR / 2 && b.end > time - HOUR / 2)
    .reduce((a, b) => (a && a.rate >= b.rate ? a : b), null);

// Puffs go into groups that sway alike: by wind level, every other one the
// opposite way.
function puffsSvg(groups, time, c, cls, gust, x, hourPx) {
  const t = time / HOUR;
  const stretch = 1.6 * (1 + 0.3 * gust);
  for (let i = 0, count = Math.max(1, Math.round(c * 4)); i < count; i++) {
    const r1 = hash(t + i * 0.37);
    const r2 = hash(t + i * 0.71 + 0.5);
    const r3 = hash(t + i * 0.13 + 0.25);
    const ry = CLOUD_H * (0.25 + 0.3 * c) * (0.7 + 0.6 * r3);
    const cx = x(time) + (r1 - 0.5) * hourPx * 1.2;
    const cy = CLOUD_TOP + CLOUD_H * (0.35 + 0.3 * r2);
    const group = `c-sway c-sway-${gust}${i % 2 ? ' c-sway-alt' : ''}`;
    const puff = `<ellipse fill="url(#${cls})" cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(ry * stretch)}" ry="${f1(ry)}" opacity="${(0.45 + 0.55 * c).toFixed(2)}"/>`;
    append(groups, group, puff);
  }
}

// Straight lines a few pixels apart across the interval (closer the heavier),
// along which the dashes or dots fall (CSS). Each starts a random bit up inside
// the cloud, so the drops do not fall in rows. In wind the column leans, at most
// a little over half an hour, so the rain stays at its time.
function rainPath(bar, wind, x, hourPx, ground) {
  const s = rainScale(bar.rate);
  const bottom = RAIN_TOP + s * (ground - RAIN_TOP);
  const left = x(bar.start);
  const width = x(bar.end) - left;
  const lean = Math.min(Math.min(0.8, (wind ?? 0) / 60) * (bottom - RAIN_TOP), hourPx * 0.6);
  const slope = lean / Math.max(1, bottom - RAIN_TOP);
  const t = bar.start / HOUR;
  let d = '';
  for (let i = 0, n = Math.max(1, Math.round(width / (9 - 5 * s))); i < n; i++) {
    const top = RAIN_TOP - hash(t + i * 0.43 + 0.3) * 15;
    const mid = left + ((i + hash(t + i * 0.61 + 0.9)) / n) * width;
    const x0 = mid - lean / 2 - slope * (RAIN_TOP - top);
    d += `M${f1(x0)} ${f1(top)}l${f1(slope * (bottom - top))} ${f1(bottom - top)}`;
  }
  return d;
}

// A streak that ends in a curl, drawn on and wiped off along its length (CSS).
// The strong-wind one is bigger; both stay within the 56 px dash in styles.css.
const GUSTS = [null, { len: 14, r: 3.5 }, { len: 24, r: 6 }];

function gustPath(time, level, x, hourPx) {
  const t = time / HOUR;
  const { len, r } = GUSTS[level];
  let d = '';
  for (let i = 0; i < level; i++) {
    const gx = x(time) + (hash(t + i * 0.53 + 0.1) - 0.5) * hourPx - len / 2;
    const gy = CLOUD_TOP + CLOUD_H * (0.45 + 0.45 * hash(t + i * 0.29 + 0.6));
    d += `M${f1(gx)} ${f1(gy)}h${len}a${r} ${r} 0 1 0 0 ${-2 * r}a${r * 0.55} ${r * 0.55} 0 1 0 0 ${f1(r * 1.1)}`;
  }
  return d;
}

// Wind speed every 3 hours along the top, highlighted from a fresh breeze on.
function windSvg(sky, x, timezone) {
  let svg = '';
  for (const { time, wind } of sky) {
    const hh = Number(hour(time, timezone));
    // Not at midnight, where the weekday label sits.
    if (wind == null || hh % 3 !== 0 || hh === 0) continue;
    const level = wind >= WIND_KMH.strong ? ' is-strong' : wind >= WIND_KMH.fresh ? ' is-fresh' : '';
    svg += `<text class="c-wind${level}" x="${f1(x(time))}" y="11" text-anchor="middle">${Math.round(wind)}<tspan class="c-wind-unit"> km/h</tspan></text>`;
  }
  return svg;
}

// Scattered by a fixed hash of the time, so the stars stay put across redraws.
function starsSvg(daylight, from, until, x, top, bottom, sky = []) {
  let svg = '';
  for (const [a, b] of nights(daylight, from, until)) {
    const start = a + TWILIGHT;
    const end = b - TWILIGHT;
    if (end <= start) continue;
    const count = Math.round(((x(end) - x(start)) * (bottom - top)) / STAR_PX);
    for (let i = 0; i < count; i++) {
      const r1 = hash(start + i * 7919);
      const r2 = hash(start + i * 104_729 + 1);
      const r3 = hash(start + i * 15_485_863 + 2);
      const time = start + r1 * (end - start);
      const cx = x(time);
      // Clouds hide the stars: nearest hour's cover.
      const cover = sky.reduce((a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a), {
        time: Number.POSITIVE_INFINITY,
        cloud: null,
      }).cloud;
      const clear = 1 - ((cover ?? 0) / 100) * 0.9;
      const cy = top + r2 ** 1.6 * (bottom - top);
      svg += `<circle class="c-star" cx="${f1(cx)}" cy="${f1(cy)}" r="${(0.5 + r3 * 0.7).toFixed(2)}" opacity="${((0.25 + r3 * 0.55) * clear).toFixed(2)}"/>`;
    }
  }
  return svg;
}

function hash(n) {
  const v = Math.sin(n * 12.9898 + 78.233) * 43_758.5453;
  return v - Math.floor(v);
}

const EVENT_ICONS = {
  sunrise: '<circle class="c-ev-sun" r="3.2"/><path class="c-ev-arrow" d="M-3 -6 0 -9 3 -6"/>',
  sunset: '<circle class="c-ev-sun" r="3.2"/><path class="c-ev-arrow" d="M-3 6 0 9 3 6"/>',
  moonrise:
    '<path class="c-ev-moon" d="M2.6 2A3.6 3.6 0 1 1-1 -3.4 2.8 2.8 0 0 0 2.6 2Z"/><path class="c-ev-arrow" d="M-3 -6 0 -9 3 -6"/>',
  moonset:
    '<path class="c-ev-moon" d="M2.6 2A3.6 3.6 0 1 1-1 -3.4 2.8 2.8 0 0 0 2.6 2Z"/><path class="c-ev-arrow" d="M-3 6 0 9 3 6"/>',
};

// The week's highest UV index fills the bar area.
const uvHeight = (uv, { barMax, uvMax }) => (uv / uvMax) * barMax;
// Unlikely rain fades out quickly: 10 % is just visible, 50 % still pale.
const rainOpacity = (prob) => (prob == null ? 1 : 0.07 + 0.93 * (prob / 100) ** 2);

// UV bars along the bottom in yellow; the rain falls behind them.
function uvBarsSvg({ uv }, layout) {
  const { x, plotBottom } = layout;
  return uv
    .map((u) => {
      const height = uvHeight(u.uv, layout);
      return `<rect class="c-uv" x="${f1(x(u.start) + 0.6)}" y="${f1(plotBottom - height)}" width="${f1(Math.max(1, x(u.end) - x(u.start) - 1.2))}" height="${f1(height)}" rx="1.5" opacity="0.55"/>`;
    })
    .join('');
}

// The amount of every rain spell (see model.js) just below the cloud, over its
// heaviest interval; the probability is in the drops' opacity.
function amountLabels(spells, { x }) {
  return spells
    .map(
      ({ wettest, prob, total }) =>
        `<text class="c-amount" x="${f1((x(wettest.start) + x(wettest.end)) / 2)}" y="${f1(RAIN_TOP + 11)}" text-anchor="middle" fill-opacity="${Math.max(0.5, rainOpacity(prob)).toFixed(2)}">${decimal(total, total < 10 ? 1 : 0)} mm</text>`,
    )
    .join('');
}

// Day changes with a line and the weekday on top; along the bottom the sun and
// moon events, and below them the hours.
function axisSvg({ from, until, now, events }, { x, h, plotBottom, timezone, hourPx }) {
  const every = hourPx >= HOURLY_LABEL_PX ? 1 : 3;
  let labels = '';
  let midnights = '';
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= until; t += HOUR) {
    const hh = Number(hour(t, timezone));
    const px = x(t);
    if (hh === 0) {
      midnights += `<line class="c-day" x1="${f1(px)}" x2="${f1(px)}" y1="0" y2="${plotBottom}"/><text class="c-label c-weekday" x="${f1(px + 4)}" y="11">${weekday(t, timezone)}</text>`;
    }
    if (hh % every === 0 && Math.abs(px - x(now)) > 22) {
      labels += `<text class="c-label" x="${f1(px)}" y="${h - 4}" text-anchor="middle">${hh}</text>`;
    }
  }
  const icons = events
    .map(
      ({ time, kind }) =>
        `<g class="c-ev" transform="translate(${f1(x(time))} ${plotBottom + 11})">${EVENT_ICONS[kind]}</g>`,
    )
    .join('');
  return { midnights, labels: labels + icons };
}

// Highest UV index of every day, above its bar.
function uvLabels(uv, days, layout) {
  const { x, plotBottom } = layout;
  let svg = '';
  for (const { time: start } of days) {
    const inDay = uv.filter((u) => u.start + HOUR / 2 >= start && u.start + HOUR / 2 < start + 24 * HOUR);
    if (!inDay.length) continue;
    const top = inDay.reduce((a, b) => (b.uv > a.uv ? b : a));
    if (Math.round(top.uv) < 1) continue;
    svg += `<text class="c-uv-max" x="${f1((x(top.start) + x(top.end)) / 2)}" y="${f1(plotBottom - uvHeight(top.uv, layout) - 4)}" text-anchor="middle">UV ${Math.round(top.uv)}</text>`;
  }
  return svg;
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
    // Placed by applyY() as the temperature axis follows the view.
    svg += `<text class="c-extreme" x="${f1(xy[iMax][0])}" data-y="${f1(xy[iMax][1])}" data-dy="-7" text-anchor="middle">${temp(points[iMax].temp)}</text>`;
    svg += `<text class="c-extreme" x="${f1(xy[iMin][0])}" data-y="${f1(xy[iMin][1])}" data-dy="15" text-anchor="middle">${temp(points[iMin].temp)}</text>`;
  }
  return svg;
}

export function createChart(el, { onSelect, onView }) {
  let view = null;
  let size = { w: 0, h: 0 };
  let span = SPAN.now; // time across the screen
  let scale = 0; // px per ms
  let geometry = null;
  let viewStart = 0; // time at the left edge
  let follow = true; // keep "now" in view as time passes
  let activeDay = null;
  let selected = null;
  let deselectTimer = 0;
  let animation = 0;
  // The curve is drawn once for the whole week's range; the vertical fit to
  // the visible part is an affine map y' = a * y + b applied on top.
  let fit = { a: 1, b: 0 };
  let fitAnimation = 0;

  const x = (t) => (t - view.timeline.from) * scale;
  const maxStart = () => Math.max(view.timeline.from, view.timeline.until - span);
  const clampStart = (t) => Math.min(maxStart(), Math.max(view.timeline.from, t));

  function applyScroll() {
    const group = el.querySelector('.c-scroll');
    if (group) group.setAttribute('transform', `translate(${f1(-x(viewStart))} 0)`);
  }

  function setStart(t) {
    viewStart = clampStart(t);
    applyScroll();
    refit();
  }

  function targetFit() {
    const { points, lo, hi, tempBottom, tempH } = geometry;
    const from = viewStart;
    const to = viewStart + span;
    const margin = span * FIT_MARGIN;
    const visible = points.filter((p) => p.time >= from && p.time <= to).map((p) => p.temp);
    if (!visible.length) return { a: 1, b: 0 };
    let vlo = Math.min(...visible);
    let vhi = Math.max(...visible);
    const [inLo, inHi] = [vlo, vhi];
    for (const p of points) {
      const distance = Math.max(from - p.time, p.time - to);
      if (distance <= 0 || distance >= margin) continue;
      const weight = 1 - distance / margin;
      vlo = Math.min(vlo, inLo + (p.temp - inLo) * weight);
      vhi = Math.max(vhi, inHi + (p.temp - inHi) * weight);
    }
    const minSpan = Math.min(MIN_SPAN, hi - lo);
    if (vhi - vlo < minSpan) {
      const mid = Math.min(hi - minSpan / 2, Math.max(lo + minSpan / 2, (vhi + vlo) / 2));
      vlo = mid - minSpan / 2;
      vhi = mid + minSpan / 2;
    }
    const a = (hi - lo) / (vhi - vlo);
    return { a, b: tempBottom * (1 - a) - ((lo - vlo) * tempH) / (vhi - vlo) };
  }

  function applyFit() {
    const { a, b } = fit;
    el.querySelector('.c-curve')?.setAttribute(
      'transform',
      `matrix(1 0 0 ${a.toFixed(4)} 0 ${b.toFixed(2)})`,
    );
    for (const label of el.querySelectorAll('.c-extreme')) {
      label.setAttribute('y', f1(a * Number(label.dataset.y) + b + Number(label.dataset.dy)));
    }
    placeMarker();
  }

  // Eases towards the fit for the current view; `now` jumps there.
  function refit(now = false) {
    if (!geometry) return;
    const target = targetFit();
    cancelAnimationFrame(fitAnimation);
    if (now) {
      fit = target;
      applyFit();
      return;
    }
    const step = () => {
      fit = { a: fit.a + (target.a - fit.a) * 0.25, b: fit.b + (target.b - fit.b) * 0.25 };
      if (Math.abs(target.a - fit.a) < 0.002 && Math.abs(target.b - fit.b) < 0.2) fit = target;
      applyFit();
      if (fit !== target) fitAnimation = requestAnimationFrame(step);
    };
    fitAnimation = requestAnimationFrame(step);
  }

  function notifyView() {
    onView({ follow, day: activeDay });
  }

  function draw() {
    if (!view || !size.w || !size.h) return;
    const { timeline, daylight, timezone, days } = view;
    const { from, until, now, points, spells } = timeline;
    const { w, h } = size;
    scale = w / span;
    const plotTop = PAD.top;
    const plotBottom = h - PAD.bottom;
    const plotH = plotBottom - plotTop;
    const tempTop = plotTop + 14;
    const tempBottom = plotBottom - Math.max(20, plotH * 0.2);

    const temps = points.map((p) => p.temp);
    let lo = Math.min(...temps);
    let hi = Math.max(...temps);
    if (hi - lo < 4) {
      const mid = (hi + lo) / 2;
      lo = mid - 2;
      hi = mid + 2;
    }
    const tempH = tempBottom - tempTop;
    const y = (v) => tempBottom - ((v - lo) / (hi - lo)) * tempH;
    const xy = points.map((p) => [x(p.time), y(p.temp)]);
    geometry = { xy, points, lo, hi, tempBottom, tempH };

    const line = monotonePath(xy);
    const area = `${line}L${f1(xy.at(-1)[0])} ${plotBottom}L${f1(xy[0][0])} ${plotBottom}Z`;
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map((o) => `<stop offset="${o}" stop-color="${tempColor(hi - o * (hi - lo))}"/>`)
      .join('');
    // Night: a dark veil. Day: a blue sky, deeper on top, shown through a mask
    // with the same fades.
    const box = `x="0" y="0" width="${f1(x(until))}" height="${plotBottom}"`;
    const clouds = cloudSvg(timeline, daylight, x, HOUR * scale, plotBottom);
    const sky = `<rect fill="url(#c-night)" ${box}/><rect fill="url(#c-day)" mask="url(#c-daylight)" ${box}/>${starsSvg(daylight, from, until, x, 4, plotBottom * 0.7, timeline.sky)}`;
    // Without a card around it the sky fades in at the top instead of ending in
    // an edge: page colour laid over it, cheaper to scroll than a mask. Only behind
    // the wind row, so the cloud band below shows the full sky.
    const fadeH = f1(Math.min(plotBottom, CLOUD_TOP + 6));
    const skyFade = `<linearGradient id="c-sky-fade" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="${fadeH}"><stop offset="0" class="c-page" stop-opacity="1"/><stop offset=".4" class="c-page" stop-opacity=".55"/><stop offset="1" class="c-page" stop-opacity="0"/></linearGradient>`;
    const uvMax = Math.max(1, ...timeline.uv.map((u) => u.uv));
    const layout = { x, h, plotBottom, barMax: plotH * 0.42, uvMax, timezone, hourPx: HOUR * scale };
    const { midnights, labels } = axisSvg(timeline, layout);

    const nowX = x(now);
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
<defs>
<linearGradient id="c-line" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${f1(tempTop)}" y2="${f1(tempBottom)}">${stops}</linearGradient>
<linearGradient id="c-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempColor(hi)}" stop-opacity=".2"/><stop offset="1" stop-color="${tempColor(lo)}" stop-opacity="0"/></linearGradient>
<linearGradient id="c-night" gradientUnits="userSpaceOnUse" x1="0" x2="${f1(x(until))}" y1="0" y2="0">${skyStops(daylight, from, until, x, 'c-sky-night', 'c-sky-none')}</linearGradient>
<linearGradient id="c-daylight-fade" gradientUnits="userSpaceOnUse" x1="0" x2="${f1(x(until))}" y1="0" y2="0">${skyStops(daylight, from, until, x, 'c-mask-off', 'c-mask-on')}</linearGradient>
<mask id="c-daylight" maskUnits="userSpaceOnUse" ${box}><rect fill="url(#c-daylight-fade)" ${box}/></mask>
<linearGradient id="c-day" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="${plotBottom}"><stop offset="0" class="c-sky-top"/><stop offset="1" class="c-sky-horizon"/></linearGradient>
${skyFade}
${clouds.defs}
<clipPath id="c-clip"><rect x="0" y="0" width="${f1(x(until))}" height="${plotBottom}"/></clipPath>
</defs>
<g class="c-scroll">
${sky}<rect fill="url(#c-sky-fade)" x="0" y="0" width="${f1(x(until))}" height="${fadeH}"/>${clouds.svg}${midnights}${uvBarsSvg(timeline, layout)}
<g clip-path="url(#c-clip)"><g class="c-curve">
<path d="${area}" fill="url(#c-area)"/>
<path class="c-temp" d="${line}" stroke="url(#c-line)" vector-effect="non-scaling-stroke"/>
</g></g>
<rect class="c-past" x="0" y="0" width="${f1(nowX)}" height="${h}"/>
${uvLabels(timeline.uv, days, layout)}${amountLabels(spells, layout)}${extremesSvg(points, xy, days)}${windSvg(timeline.sky, x, timezone)}${labels}
<line class="c-now" x1="${f1(nowX)}" x2="${f1(nowX)}" y1="${plotTop - 2}" y2="${plotBottom}"/>
<text class="c-label c-now-label" x="${f1(nowX)}" y="${h - 4}" text-anchor="middle">jetzt</text>
<g class="c-marker" hidden><line y1="0" y2="${plotBottom}"/><circle r="4.5"/></g>
</g>
</svg>`;
    if (follow) viewStart = now - LEAD;
    setStart(viewStart);
    refit(true);
  }

  function placeMarker() {
    const marker = el.querySelector('.c-marker');
    if (!marker || !geometry) return;
    marker.toggleAttribute('hidden', selected == null);
    if (selected == null) return;
    const [px, py] = geometry.xy[selected];
    marker.setAttribute('transform', `translate(${f1(px)} 0)`);
    marker.querySelector('circle').setAttribute('cy', f1(fit.a * py + fit.b));
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
      if (span === SPAN.day) return animateTo(start);
      cancelAnimationFrame(animation);
      span = SPAN.day;
      viewStart = start;
      draw();
    },
    showNow() {
      if (!view) return;
      select(null);
      follow = true;
      activeDay = null;
      notifyView();
      if (span === SPAN.now) return animateTo(view.timeline.now - LEAD);
      cancelAnimationFrame(animation);
      span = SPAN.now;
      draw();
    },
  };
}
