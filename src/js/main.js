import { DEFAULT_LOCATION, MOVE_THRESHOLD_KM, REFRESH_MS } from './config.js';
import { loadForecast, requestsFor, VERSION } from './forecast.js';
import { distanceKm, getPosition, placeName } from './location.js';
import { snapshot } from './model.js';
import * as storage from './storage.js';
import { createChart } from './ui/chart.js';
import { clock, setOffsets } from './ui/format.js';
import { createPicker } from './ui/picker.js';
import { renderChartHead, renderDays, renderHero } from './ui/render.js';

const $ = (id) => document.getElementById(id);

let place = storage.get('location') ?? DEFAULT_LOCATION;
let forecast = storage.get('forecast');
let view = null;
let loading = false;
let failed = false;
let request = 0;
let radar = null;
// Chart state: a tapped point, and the day the chart jumped to (if any).
let point = null;
let day = null;

if (forecast?.version !== VERSION || distanceKm(forecast.location, place) > MOVE_THRESHOLD_KM)
  forecast = null;
else setOffsets(forecast.timezone, forecast.offsets);

// index.html drew the last screen from storage while the page loaded; render()
// replaces it right away, but without a forecast for here the skeleton returns.
if (!forecast && !document.body.classList.contains('is-empty')) {
  $('temp').textContent = '–';
  $('cond-icon').innerHTML = '';
  $('cond').textContent = 'Wetter wird geladen';
  $('days').innerHTML = '';
}

const chart = createChart($('chart'), {
  onSelect(next) {
    point = next;
    if (view) renderChartHead(view, { point, day });
  },
  onView({ follow, day: next }) {
    day = next;
    $('chart-now').hidden = follow;
    if (view) {
      renderChartHead(view, { point, day });
      renderDays(view, day);
    }
  },
});

function renderStatus() {
  $('place').textContent = place.name ?? 'Standort';
  $('place-btn').classList.toggle('is-gps', place.gps);
  $('reload').classList.toggle('is-loading', loading);
  const status = $('status');
  if (!forecast) {
    status.textContent = loading ? 'lädt …' : failed ? 'offline' : '';
  } else {
    const age = Date.now() - forecast.fetchedAt;
    status.textContent = failed
      ? `offline · ${clock(forecast.fetchedAt, forecast.timezone)}`
      : clock(forecast.fetchedAt, forecast.timezone);
    status.classList.toggle('is-stale', failed || age > 30 * 60_000);
  }
}

function render() {
  renderStatus();
  document.body.classList.toggle('is-empty', !forecast);
  if (!forecast) return;
  view = snapshot(forecast);
  renderHero(view);
  renderChartHead(view, { point, day });
  renderDays(view, day);
  // For index.html to show at the next start before the modules have loaded.
  storage.set('screen', {
    at: Date.now(),
    place: $('place').textContent,
    temp: $('temp').textContent,
    icon: $('cond-icon').innerHTML,
    cond: $('cond').textContent,
    glow: document.documentElement.style.getPropertyValue('--glow'),
    days: $('days').innerHTML,
  });
  chart.update(view);
  radar?.setLocation(place, view.timezone);
}

async function refresh() {
  const id = ++request;
  loading = true;
  renderStatus();
  storage.set('requests', requestsFor(place));
  const accept = (next) => {
    if (id !== request) return false;
    forecast = next;
    failed = false;
    setOffsets(forecast.timezone, forecast.offsets);
    storage.set('forecast', forecast);
    return true;
  };
  // The final forecast differs from the partial one only in its nowcast; when
  // that is the one already drawn, the screen stays as it is.
  let drawn = null;
  try {
    const next = await loadForecast(place, {
      previous: forecast,
      onPartial: (partial) => {
        if (!accept(partial)) return;
        render();
        drawn = partial.nowcast;
        started();
      },
    });
    if (!accept(next)) return;
  } catch (error) {
    if (id !== request) return;
    console.error(error);
    failed = true;
  }
  loading = false;
  const same =
    !failed && drawn?.provider === forecast.nowcast.provider && drawn.issued === forecast.nowcast.issued;
  if (same) renderStatus();
  else render();
  started();
}

const idle = (fn) =>
  window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200);

const hasWorker = 'serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname);

// What the first forecast does not need waits until it is on screen (or the
// request failed) and the page is idle: the chart's animations, which repaint
// it every frame, and the service worker, whose install fetches the whole shell.
let isStarted = false;
function started() {
  if (isStarted) return;
  isStarted = true;
  idle(() => {
    $('chart').classList.add('is-animated');
    if (hasWorker) navigator.serviceWorker.register('./sw.js');
  });
}

// A different place: its forecast replaces the old one, which is not shown
// meanwhile under the new name.
function moveTo(next) {
  place = next;
  forecast = null;
  point = null;
  chart.showNow();
  render();
  refresh();
}

// The forecast for the last known place is already on its way; the position
// only matters if it is noticeably somewhere else. A place chosen by hand
// stays until the device's position is asked for again.
async function locate() {
  if (place.manual) return;
  let here;
  try {
    here = await getPosition();
  } catch {
    return;
  }
  // Unless a place was chosen meanwhile.
  if (!place.manual) usePosition(here);
}

async function usePosition(here) {
  const moved = distanceKm(here, place) > MOVE_THRESHOLD_KM;
  if (moved) moveTo({ ...here, name: null, gps: true });
  else place = { ...place, gps: true, manual: false };
  storage.set('location', place);
  renderStatus();
  if (moved || !place.name) {
    try {
      const name = await placeName(here);
      if (name && distanceKm(here, place) < MOVE_THRESHOLD_KM) {
        place = { ...place, name };
        storage.set('location', place);
        render();
      }
    } catch (error) {
      console.warn('Place name:', error);
    }
  }
}

const isStale = () => !forecast || Date.now() - forecast.fetchedAt > REFRESH_MS;

// Tabs: the weather overview and the radar, which is loaded on first use.
async function showTab(name) {
  const isRadar = name === 'radar';
  $('view-weather').hidden = isRadar;
  $('view-radar').hidden = !isRadar;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  if (isRadar) {
    if (!radar) {
      const { createRadar } = await import('./ui/radar.js');
      radar = createRadar($('view-radar'));
      radar.setLocation(place, view?.timezone ?? 'Europe/Vienna');
    }
    radar.show();
  } else {
    radar?.hide();
  }
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    history.replaceState(null, '', tab.dataset.tab === 'radar' ? '#radar' : location.pathname);
    showTab(tab.dataset.tab);
  });
}

$('reload').addEventListener('click', () => {
  refresh();
  locate();
});
const picker = createPicker($('picker'), {
  onPick(next) {
    const chosen = { lat: next.lat, lon: next.lon, name: next.name, gps: false, manual: true };
    storage.set('location', chosen);
    if (distanceKm(chosen, place) > MOVE_THRESHOLD_KM) moveTo(chosen);
    else place = chosen;
    render();
  },
  // Resolves once the position is known; the place name follows.
  async onLocate() {
    const here = await getPosition();
    usePosition(here);
  },
});
$('place-btn').addEventListener('click', () => picker.open());
$('chart-now').addEventListener('click', () => chart.showNow());
$('days').addEventListener('click', (e) => {
  const button = e.target.closest('[data-day]');
  if (!button) return;
  const start = Number(button.dataset.day);
  if (start === day) chart.showNow();
  else chart.showDay(start);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  chart.showNow();
  render();
  radar?.refresh();
  if (isStale()) {
    refresh();
    locate();
  }
});

// Only a check; the data itself is refreshed every REFRESH_MS.
setInterval(() => {
  if (document.hidden) return;
  radar?.refresh();
  if (isStale() && !loading) refresh();
}, 60_000);

// iOS ignores user-scalable=no; block pinch and double-tap zoom explicitly.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// The deploy stamps the bare number; shown as v1.2.3, unstamped it stays "dev".
const version = $('version');
if (version.textContent !== 'dev') version.textContent = `v${version.textContent}`;

render();
refresh();
locate();
if (location.hash === '#radar') showTab('radar');

// Registered in started(); the browser may also update the worker on its own.
if (hasWorker) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => hadController && location.reload());
}
