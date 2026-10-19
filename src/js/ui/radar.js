// Rain radar tab, loaded on first use: the last two hours of RainViewer's
// global radar composite, followed by a forecast for the next hours (INCA
// around Austria, model data elsewhere), over Esri's dark grey basemap.
// A small tile renderer of its own instead of a map library: pinch, wheel or
// double tap to zoom, drag to pan.

import { fetchRadarForecast } from '../sources/radar-grid.js';
import { clock } from './format.js';
import { glyph } from './icons.js';

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_MAX_ZOOM = 7; // RainViewer's free tiles stop here; higher zooms upscale.
const ZOOM = { min: 4, max: 12, start: 8 };
const TILE = 256;
const FRAME_MS = 500;
const HOLD_MS = { now: 900, end: 1600 };
const PAST_TTL = 5 * 60_000;
const FORECAST_TTL = 10 * 60_000;
const DOUBLE_TAP_MS = 300;

const dpr = Math.min(2, devicePixelRatio || 1);

const baseUrl = (layer, z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/${z}/${y}/${x}`;

// Web Mercator, normalised to 0..1.
function project(lat, lon) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}

// Forecast colours by intensity (mm/h), close to RainViewer's palette.
const RAMP = [
  [0.1, [110, 205, 255, 150]],
  [0.5, [45, 165, 250, 200]],
  [1, [20, 125, 235, 220]],
  [3, [10, 75, 205, 230]],
  [6, [250, 210, 45, 235]],
  [12, [250, 135, 25, 240]],
  [25, [230, 45, 45, 245]],
  [50, [185, 35, 165, 250]],
];

function rainColor(rate) {
  if (!(rate >= RAMP[0][0])) return null;
  for (let i = 1; i < RAMP.length; i++) {
    const [r1, c1] = RAMP[i];
    if (rate < r1) {
      const [r0, c0] = RAMP[i - 1];
      const f = (rate - r0) / (r1 - r0);
      return c0.map((v, j) => v + (c1[j] - v) * f);
    }
  }
  return RAMP.at(-1)[1];
}

function frameCanvas({ nx, ny }, rates) {
  const canvas = document.createElement('canvas');
  canvas.width = nx;
  canvas.height = ny;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(nx, ny);
  for (let i = 0; i < rates.length; i++) {
    const color = rainColor(rates[i]);
    if (color) image.data.set(color, i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function tilesHtml(z, size, left, top, w, h, url) {
  const count = 2 ** z;
  let html = '';
  for (let ty = Math.floor(top / size); ty * size < top + h; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / size); tx * size < left + w; tx++) {
      const wrapped = ((tx % count) + count) % count;
      html += `<img src="${url(z, wrapped, ty)}" style="left:${(tx * size - left).toFixed(1)}px;top:${(ty * size - top).toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px" alt="" draggable="false" onerror="this.remove()">`;
    }
  }
  return html;
}

export function createRadar(root) {
  root.innerHTML = `
<div class="map" id="map">
  <div class="map-pan">
    <div class="map-layer" data-layer="base"></div>
    <div class="map-layer map-radar" data-layer="radar"></div>
    <canvas class="map-layer map-forecast"></canvas>
    <div class="map-layer" data-layer="labels"></div>
    <div class="map-me"></div>
  </div>
</div>
<div class="radar-head card-glass"><strong id="radar-time">--:--</strong><span id="radar-age"></span></div>
<div class="radar-zoom">
  <button class="map-btn" data-zoom="1" aria-label="Vergrößern">${glyph('plus')}</button>
  <button class="map-btn" data-zoom="-1" aria-label="Verkleinern">${glyph('minus')}</button>
  <button class="map-btn" data-locate aria-label="Auf Standort zentrieren">${glyph('locate')}</button>
</div>
<div class="radar-bar card-glass">
  <button class="map-btn" id="radar-play" aria-label="Abspielen">${glyph('play')}</button>
  <div class="rt" id="radar-timeline" role="slider" aria-label="Zeitpunkt" tabindex="0">
    <div class="rt-ticks"></div>
    <div class="rt-labels"><span>−2 h</span><span class="rt-now">jetzt</span><span id="radar-end"></span></div>
  </div>
</div>
<p class="map-credits">Radar <a href="https://www.rainviewer.com">RainViewer</a> · Vorhersage <a href="https://data.hub.geosphere.at">GeoSphere</a>, <a href="https://open-meteo.com">Open-Meteo</a> · Karte © <a href="https://www.esri.com">Esri</a>, HERE, Garmin, © OpenStreetMap</p>`;

  const $ = (selector) => root.querySelector(selector);
  const map = $('#map');
  const pan = $('.map-pan');
  const layer = (name) => $(`[data-layer="${name}"]`);
  const canvas = $('.map-forecast');
  const me = $('.map-me');
  const timeline = $('#radar-timeline');
  const playButton = $('#radar-play');

  let place = null;
  let timezone;
  let zoom = ZOOM.start;
  let center = null; // normalised Mercator
  let past = [];
  let host = '';
  let forecast = null; // { grid, frames: [{ time, canvas }] }
  let frames = [];
  let frame = 0;
  let pastAt = 0;
  let forecastAt = 0;
  let forecastKey = '';
  let forecastLoading = null;
  let timer = 0;
  let playing = false;
  let visible = false;
  let size = { w: 0, h: 0 };

  const worldSize = () => TILE * 2 ** zoom;
  const toScreen = ({ x, y }) => ({
    x: (x - center.x) * worldSize() + size.w / 2,
    y: (y - center.y) * worldSize() + size.h / 2,
  });

  function drawForecast() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = frames[frame];
    if (!f?.canvas || !forecast) return;
    const { nx, ny, corners } = forecast.grid;
    const [p0, p1, p2] = corners.map(([lat, lon]) => toScreen(project(lat, lon)));
    // Affine map from grid cells to the screen; over a few hundred kilometres
    // the difference between the grid's projection and Mercator is negligible.
    const a = (p1.x - p0.x) / (nx - 1);
    const b = (p1.y - p0.y) / (nx - 1);
    const c = (p2.x - p0.x) / (ny - 1);
    const d = (p2.y - p0.y) / (ny - 1);
    ctx.setTransform(
      a * dpr,
      b * dpr,
      c * dpr,
      d * dpr,
      (p0.x - (a + c) / 2) * dpr,
      (p0.y - (b + d) / 2) * dpr,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.canvas, 0, 0);
    // Outside this area there is no forecast; outline it so empty is not mistaken for dry.
    ctx.strokeStyle = 'rgb(255 255 255 / 0.25)';
    ctx.lineWidth = 1 / Math.hypot(a, b);
    ctx.setLineDash([4 / Math.hypot(a, b), 4 / Math.hypot(a, b)]);
    ctx.strokeRect(0, 0, nx, ny);
  }

  function layout() {
    if (!center || !visible) return;
    const { width: w, height: h } = map.getBoundingClientRect();
    if (!w || !h) return;
    size = { w, h };
    pan.style.transform = '';
    const world = worldSize();
    const left = center.x * world - w / 2;
    const top = center.y * world - h / 2;

    const tz = Math.round(zoom);
    const baseZ = Math.min(16, tz + (dpr > 1 ? 1 : 0));
    layer('base').innerHTML = tilesHtml(baseZ, world / 2 ** baseZ, left, top, w, h, (z, x, y) =>
      baseUrl('World_Dark_Gray_Base', z, x, y),
    );
    layer('labels').innerHTML = tilesHtml(tz, world / 2 ** tz, left, top, w, h, (z, x, y) =>
      baseUrl('World_Dark_Gray_Reference', z, x, y),
    );
    const rz = Math.min(tz, RADAR_MAX_ZOOM);
    layer('radar').innerHTML = past
      .map(
        (f, i) =>
          `<div class="map-frame${frames[frame] === f ? ' is-active' : ''}" data-frame="${i}">${tilesHtml(rz, world / 2 ** rz, left, top, w, h, (z, x, y) => `${host}${f.path}/256/${z}/${x}/${y}/2/1_1.png`)}</div>`,
      )
      .join('');

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    drawForecast();

    const here = toScreen(project(place.lat, place.lon));
    me.style.transform = `translate(${here.x}px, ${here.y}px)`;
  }

  function renderTimeline() {
    const nowIndex = past.length - 1;
    $('.rt-ticks').innerHTML = frames
      .map((f, i) => {
        const cls = [f.canvas && 'is-forecast', i === frame && 'is-active', i === nowIndex && 'is-now'];
        return `<i class="${cls.filter(Boolean).join(' ')}"></i>`;
      })
      .join('');
    const last = frames.at(-1);
    const ahead = last?.canvas ? Math.round((last.time - Date.now()) / 60_000) : 0;
    $('#radar-end').textContent =
      ahead > 0
        ? `+${ahead >= 90 ? `${Math.round(ahead / 30) / 2} h`.replace('.', ',') : `${ahead} min`}`
        : '';
    $('.rt-now').style.left = `${frames.length > 1 ? (nowIndex / (frames.length - 1)) * 100 : 100}%`;
    timeline.setAttribute('aria-valuemax', String(frames.length - 1));
  }

  function showFrame(index) {
    frame = Math.max(0, Math.min(frames.length - 1, index));
    const f = frames[frame];
    for (const el of layer('radar').querySelectorAll('.map-frame')) {
      el.classList.toggle('is-active', past[Number(el.dataset.frame)] === f);
    }
    drawForecast();
    for (const [i, tick] of [...$('.rt-ticks').children].entries())
      tick.classList.toggle('is-active', i === frame);
    timeline.setAttribute('aria-valuenow', String(frame));
    if (!f) return;
    $('#radar-time').textContent = clock(f.time, timezone);
    const minutes = Math.round((f.time - Date.now()) / 60_000);
    const age = $('#radar-age');
    age.classList.toggle('is-forecast', Boolean(f.canvas));
    const ahead = minutes > 0 ? `in ${minutes} min` : 'jetzt';
    if (f.canvas) age.textContent = `Vorhersage · ${ahead}${f.dry ? ' · trocken' : ''}`;
    else age.textContent = minutes >= -5 ? 'aktuell' : `vor ${-minutes} min`;
  }

  function rebuildFrames() {
    const current = frames[frame]?.time;
    const latest = past.at(-1)?.time ?? 0;
    frames = [...past, ...(forecast?.frames.filter((f) => f.time > latest) ?? [])];
    const index = current == null ? past.length - 1 : frames.findIndex((f) => f.time === current);
    renderTimeline();
    layout();
    showFrame(index >= 0 ? index : past.length - 1);
  }

  function play(on) {
    playing = on && frames.length > 1;
    clearTimeout(timer);
    playButton.innerHTML = glyph(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', playing ? 'Anhalten' : 'Abspielen');
    if (!playing) return;
    const delay = (i) =>
      i === frames.length - 1 ? HOLD_MS.end : i === past.length - 1 ? HOLD_MS.now : FRAME_MS;
    const tick = () => {
      const next = (frame + 1) % frames.length;
      showFrame(next);
      timer = setTimeout(tick, delay(next));
    };
    timer = setTimeout(tick, delay(frame));
  }

  async function loadPast() {
    if (Date.now() - pastAt < PAST_TTL) return;
    try {
      const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      host = data.host;
      past = (data.radar?.past ?? []).map((f) => ({ time: f.time * 1000, path: f.path }));
      pastAt = Date.now();
      rebuildFrames();
    } catch (error) {
      console.warn('RainViewer:', error);
      $('#radar-age').textContent = 'Radar nicht erreichbar';
    }
  }

  function loadForecast() {
    const key = `${place.lat.toFixed(1)},${place.lon.toFixed(1)}`;
    if (forecastLoading?.key === key) return forecastLoading;
    if (key === forecastKey && Date.now() - forecastAt < FORECAST_TTL) return Promise.resolve();
    if (!forecast) $('#radar-end').textContent = 'lädt …';
    const loading = (async () => {
      try {
        const grid = await fetchRadarForecast(place.lat, place.lon);
        forecast = {
          grid,
          frames: grid.frames.map((f) => ({
            time: f.time,
            canvas: frameCanvas(grid, f.rates),
            dry: !f.rates.some((rate) => rate >= RAMP[0][0]),
          })),
        };
        forecastAt = Date.now();
        forecastKey = key;
      } catch (error) {
        console.warn('Radar forecast:', error);
      }
      if (forecastLoading === loading) forecastLoading = null;
      rebuildFrames();
    })();
    loading.key = key;
    forecastLoading = loading;
    return loading;
  }

  // Gestures: the layers follow the fingers through a CSS transform
  // (screen' = s * screen + t); on release the new view is committed and re-tiled.
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let wheelTimer = 0;

  function local(e) {
    const rect = map.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function preview({ s, tx, ty }) {
    pan.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  function commit({ s, tx, ty }) {
    // The point that ends up at the screen centre was at (centre - t) / s before.
    const world = worldSize();
    center = {
      x: center.x + ((size.w / 2 - tx) / s - size.w / 2) / world,
      y: Math.max(0, Math.min(1, center.y + ((size.h / 2 - ty) / s - size.h / 2) / world)),
    };
    zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, zoom + Math.log2(s)));
    layout();
  }

  function zoomAt(point, factor) {
    const s = 2 ** (Math.max(ZOOM.min, Math.min(ZOOM.max, zoom + Math.log2(factor))) - zoom);
    commit({ s, tx: point.x * (1 - s), ty: point.y * (1 - s) });
  }

  function startGesture() {
    const [a, b] = [...pointers.values()];
    const t = { s: 1, tx: 0, ty: 0 };
    gesture = b
      ? {
          pinch: true,
          d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
          m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          t,
        }
      : { pinch: false, p0: { ...a }, t, moved: false };
  }

  // Pinch beyond the zoom limits would only snap back; clamp it while moving.
  function clampScale(s) {
    return 2 ** (Math.max(ZOOM.min, Math.min(ZOOM.max, zoom + Math.log2(s))) - zoom);
  }

  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId);
    if (gesture && pointers.size) commit(gesture.t);
    pointers.set(e.pointerId, local(e));
    startGesture();
  });
  map.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    const [a, b] = [...pointers.values()];
    if (gesture.pinch && b) {
      const s = clampScale(Math.hypot(b.x - a.x, b.y - a.y) / gesture.d0);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.t = { s, tx: m.x - s * gesture.m0.x, ty: m.y - s * gesture.m0.y };
    } else if (!gesture.pinch) {
      const dx = a.x - gesture.p0.x;
      const dy = a.y - gesture.p0.y;
      if (Math.hypot(dx, dy) > 4) gesture.moved = true;
      gesture.t = { s: 1, tx: dx, ty: dy };
    }
    preview(gesture.t);
  });
  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const point = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    const tap = gesture && !gesture.pinch && !gesture.moved;
    if (gesture) commit(gesture.t);
    gesture = null;
    if (pointers.size) startGesture();
    if (!tap) return;
    const double =
      lastTap &&
      e.timeStamp - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30;
    lastTap = double ? null : { ...point, time: e.timeStamp };
    if (double) zoomAt(point, 2);
  };
  map.addEventListener('pointerup', release);
  map.addEventListener('pointercancel', release);
  map.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const point = local(e);
      const s = clampScale((gesture?.wheel ? gesture.t.s : 1) * 2 ** (-e.deltaY / 300));
      gesture = { wheel: true, t: { s, tx: point.x * (1 - s), ty: point.y * (1 - s) } };
      preview(gesture.t);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        commit(gesture.t);
        gesture = null;
      }, 150);
    },
    { passive: false },
  );

  for (const button of root.querySelectorAll('[data-zoom]')) {
    button.addEventListener('click', () =>
      zoomAt({ x: size.w / 2, y: size.h / 2 }, 2 ** Number(button.dataset.zoom)),
    );
  }
  $('[data-locate]').addEventListener('click', () => {
    center = project(place.lat, place.lon);
    layout();
  });
  playButton.addEventListener('click', () => play(!playing));

  // Scrub on the timeline: tap or drag.
  const scrub = (e) => {
    const rect = timeline.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    play(false);
    showFrame(Math.round(f * (frames.length - 1)));
  };
  timeline.addEventListener('pointerdown', (e) => {
    timeline.setPointerCapture(e.pointerId);
    scrub(e);
  });
  timeline.addEventListener('pointermove', (e) => e.buttons && scrub(e));
  timeline.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    play(false);
    showFrame(frame + step);
  });

  new ResizeObserver(() => layout()).observe(map);

  return {
    setLocation(next, tz) {
      const moved = !place || next.lat !== place.lat || next.lon !== place.lon;
      place = next;
      timezone = tz;
      if (!moved) return;
      center = project(place.lat, place.lon);
      layout();
      if (visible) loadForecast().then(() => playing || play(true));
    },
    async show() {
      visible = true;
      layout();
      // The past is there in a moment; the forecast is appended when it arrives.
      loadForecast();
      await loadPast();
      play(true);
    },
    // Back in the foreground or after a while: replace what has become old.
    refresh() {
      if (!visible) return;
      loadForecast();
      loadPast();
    },
    hide() {
      visible = false;
      play(false);
    },
  };
}
