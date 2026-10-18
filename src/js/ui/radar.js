// Rain radar tab, loaded on first use. RainViewer's global composite (last two
// hours, 10-minute frames) over Esri's dark grey basemap. A tiny tile renderer of
// its own instead of a map library keeps the app small: drag to pan, buttons
// to zoom, nothing else.

import { clock } from './format.js';
import { glyph } from './icons.js';

const INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_MAX_ZOOM = 7; // RainViewer's free tiles stop here; higher zooms upscale.
const ZOOM = { min: 5, max: 10, start: 8 };
const TILE = 256;
const FRAME_MS = 550;
const HOLD_MS = 1800;
const INDEX_TTL = 5 * 60_000;

const retina = devicePixelRatio > 1;

// Keyless dark basemap; labels are a separate layer so they stay above the radar.
const baseUrl = (layer, z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/${z}/${y}/${x}`;

function project({ lat, lon }, z) {
  const size = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function tiles(z, scale, left, top, w, h, url) {
  const size = TILE * scale;
  const count = 2 ** z;
  let html = '';
  for (let ty = Math.floor(top / size); ty * size < top + h; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / size); tx * size < left + w; tx++) {
      const wrapped = ((tx % count) + count) % count;
      html += `<img src="${url(z, wrapped, ty)}" style="left:${tx * size - left}px;top:${ty * size - top}px;width:${size}px;height:${size}px" alt="" draggable="false" onerror="this.remove()">`;
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
  <input id="radar-slider" type="range" min="0" max="0" value="0" aria-label="Zeitpunkt">
</div>
<p class="map-credits">Radar <a href="https://www.rainviewer.com">RainViewer</a> · Karte © <a href="https://www.esri.com">Esri</a>, HERE, Garmin, © OpenStreetMap</p>`;

  const map = root.querySelector('#map');
  const pan = root.querySelector('.map-pan');
  const layer = (name) => root.querySelector(`[data-layer="${name}"]`);
  const me = root.querySelector('.map-me');
  const slider = root.querySelector('#radar-slider');
  const playButton = root.querySelector('#radar-play');

  let location = null;
  let timezone;
  let zoom = ZOOM.start;
  let center = null;
  let frames = [];
  let host = '';
  let frame = 0;
  let fetchedAt = 0;
  let timer = 0;
  let playing = false;
  let visible = false;

  function layout() {
    if (!center || !visible) return;
    const { width: w, height: h } = map.getBoundingClientRect();
    if (!w || !h) return;
    const left = Math.round(center.x - w / 2);
    const top = Math.round(center.y - h / 2);
    pan.style.transform = '';
    layer('base').innerHTML = tiles(zoom, 1, left, top, w, h, (z, x, y) =>
      baseUrl('World_Dark_Gray_Base', z, x, y),
    );
    layer('labels').innerHTML = tiles(zoom, 1, left, top, w, h, (z, x, y) =>
      baseUrl('World_Dark_Gray_Reference', z, x, y),
    );

    const rz = Math.min(zoom, RADAR_MAX_ZOOM);
    const scale = 2 ** (zoom - rz);
    const size = retina ? 512 : 256;
    layer('radar').innerHTML = frames
      .map(
        (f, i) =>
          `<div class="map-frame${i === frame ? ' is-active' : ''}">${tiles(rz, scale, left, top, w, h, (z, x, y) => `${host}${f.path}/${size}/${z}/${x}/${y}/2/1_1.png`)}</div>`,
      )
      .join('');

    const here = project(location, zoom);
    me.style.transform = `translate(${here.x - left}px, ${here.y - top}px)`;
  }

  function showFrame(index) {
    frame = index;
    slider.value = String(index);
    layer('radar')
      .querySelectorAll('.map-frame')
      .forEach((el, i) => {
        el.classList.toggle('is-active', i === index);
      });
    const f = frames[index];
    if (!f) return;
    const time = f.time * 1000;
    root.querySelector('#radar-time').textContent = clock(time, timezone);
    const minutes = Math.round((Date.now() - time) / 60_000);
    root.querySelector('#radar-age').textContent = minutes <= 5 ? 'aktuell' : `vor ${minutes} min`;
  }

  function play(on) {
    playing = on && frames.length > 1;
    clearTimeout(timer);
    playButton.innerHTML = glyph(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', playing ? 'Anhalten' : 'Abspielen');
    if (!playing) return;
    const tick = () => {
      const next = (frame + 1) % frames.length;
      showFrame(next);
      timer = setTimeout(tick, next === frames.length - 1 ? HOLD_MS : FRAME_MS);
    };
    timer = setTimeout(tick, frame === frames.length - 1 ? HOLD_MS : FRAME_MS);
  }

  async function loadFrames() {
    if (Date.now() - fetchedAt < INDEX_TTL) return;
    try {
      const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      host = data.host;
      frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
      fetchedAt = Date.now();
      slider.max = String(Math.max(0, frames.length - 1));
      frame = Math.max(0, frames.length - 1);
      layout();
      showFrame(frame);
    } catch (error) {
      console.warn('RainViewer:', error);
      root.querySelector('#radar-age').textContent = 'Radar nicht erreichbar';
    }
  }

  // Drag to pan: move the layers with a transform, re-tile on release.
  let drag = null;
  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    pan.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    center = { x: center.x - drag.dx, y: center.y - drag.dy };
    drag = null;
    layout();
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);

  root.querySelectorAll('[data-zoom]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = Math.max(ZOOM.min, Math.min(ZOOM.max, zoom + Number(button.dataset.zoom)));
      if (next === zoom) return;
      const factor = 2 ** (next - zoom);
      center = { x: center.x * factor, y: center.y * factor };
      zoom = next;
      layout();
    });
  });
  root.querySelector('[data-locate]').addEventListener('click', () => {
    center = project(location, zoom);
    layout();
  });
  playButton.addEventListener('click', () => play(!playing));
  slider.addEventListener('input', () => {
    play(false);
    showFrame(Number(slider.value));
  });
  new ResizeObserver(() => layout()).observe(map);

  return {
    setLocation(next, tz) {
      const moved = !location || next.lat !== location.lat || next.lon !== location.lon;
      location = next;
      timezone = tz;
      if (moved) center = project(location, zoom);
      layout();
    },
    async show() {
      visible = true;
      layout();
      await loadFrames();
      play(true);
    },
    hide() {
      visible = false;
      play(false);
    },
  };
}
