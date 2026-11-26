// Fetches every source that is relevant for a location in parallel and merges
// them into one forecast. Precision decreases with lead time:
//
//   now .. +90 min   nowcast, 15 min steps     GeoSphere INCA (AT + surroundings), else Open-Meteo 15 min
//   .. +2.5 days     hourly                    GeoSphere AROME (AT), else Open-Meteo best match
//   .. +7 days       daily                     Open-Meteo best match (ECMWF, ICON, GFS, ...)

import { NOWCAST_MINUTES } from './config.js';
import { inBox, regionFor } from './regions.js';
import { fetchInca, INCA_BOX, incaUrl } from './sources/geosphere.js';
import { fetchOpenMeteo, openMeteoUrl } from './sources/open-meteo.js';

export const NOWCASTS = {
  inca: {
    label: 'INCA',
    detail: '1 km · 15 min',
    provider: 'geosphere',
    box: INCA_BOX,
    fetch: fetchInca,
    url: incaUrl,
  },
  openmeteo: { label: 'Modell', detail: '15 min', provider: 'openmeteo' },
};

// The requests loadForecast() makes for a place, so index.html can start them
// at the next start before the modules have loaded.
export function requestsFor({ lat, lon }) {
  const region = regionFor(lat, lon);
  const nowcasts = region.nowcast.map((id) => NOWCASTS[id]).filter(({ box }) => inBox(lat, lon, box));
  return [openMeteoUrl(lat, lon, region.model), ...nowcasts.map(({ url }) => url(lat, lon))];
}

// A nowcast must still reach the end of the window and must not be stale
// (the services occasionally stop updating for a while).
function usable(nowcast) {
  const now = Date.now();
  const last = nowcast.steps.findLast((step) => step.rate != null);
  return (
    last &&
    now - nowcast.issued < 3 * 3600_000 &&
    last.time >= now + (NOWCAST_MINUTES - nowcast.stepMinutes) * 60_000
  );
}

async function fetchNowcast(lat, lon, order) {
  for (const id of order) {
    const source = NOWCASTS[id];
    if (!inBox(lat, lon, source.box)) continue;
    try {
      const nowcast = await source.fetch(lat, lon);
      if (usable(nowcast)) return nowcast;
      console.warn(`${source.label}: no current data`);
    } catch (error) {
      console.warn(`${source.label}:`, error);
    }
  }
  return null;
}

function fromModel(minutely) {
  return {
    provider: 'openmeteo',
    stepMinutes: 15,
    issued: Date.now(),
    steps: minutely.map(({ time, rate, temp, code }) => ({ time, rate, temp, code })),
  };
}

// Of the stored forecast; an older one is dropped at start. 2: zone offsets.
export const VERSION = 2;

function assemble({ lat, lon }, region, model, nowcast) {
  return {
    version: VERSION,
    fetchedAt: Date.now(),
    location: { lat, lon },
    region: region.id,
    timezone: model.timezone,
    offsets: model.offsets,
    model: model.model,
    current: model.current,
    nowcast,
    minutely: model.minutely,
    hourly: model.hourly,
    daily: model.daily,
  };
}

// Open-Meteo answers in ~200 ms, the nowcast services sometimes take seconds.
// So the model data is handed to `onPartial` as soon as it is there, paired
// with the previous nowcast while that still covers the next 90 minutes (no
// visible jump), and the result resolves once the fresh nowcast is in.
export async function loadForecast(place, { previous, onPartial } = {}) {
  const { lat, lon } = place;
  const region = regionFor(lat, lon);
  const pending = fetchNowcast(lat, lon, region.nowcast);
  const model = await fetchOpenMeteo(lat, lon, region.model);

  const kept =
    previous?.nowcast.provider !== 'openmeteo' &&
    previous?.region === region.id &&
    usable(previous.nowcast) &&
    previous.location.lat === lat &&
    previous.location.lon === lon
      ? previous.nowcast
      : null;
  onPartial?.(assemble(place, region, model, kept ?? fromModel(model.minutely)));

  const nowcast = await pending;
  return assemble(place, region, model, nowcast ?? kept ?? fromModel(model.minutely));
}
