// Fetches every source that is relevant for a location in parallel and merges
// them into one forecast. Precision decreases with lead time:
//
//   now .. +90 min   nowcast, 5-15 min steps   INCA (AT) / DWD radar (DE) / Open-Meteo 15 min
//   .. +24 h         hourly                    national model via Open-Meteo, else best match
//   .. +7 days       daily                     Open-Meteo best match (ECMWF, ICON, GFS, ...)

import { NOWCAST_MINUTES } from './config.js';
import { inBox, MODELS, regionFor } from './regions.js';
import { DWD_BOX, fetchDwdRadar } from './sources/bright-sky.js';
import { fetchInca, INCA_BOX } from './sources/geosphere.js';
import { fetchOpenMeteo } from './sources/open-meteo.js';

export const NOWCASTS = {
  inca: { label: 'INCA', detail: '1 km · 15 min', provider: 'geosphere', box: INCA_BOX, fetch: fetchInca },
  dwd: { label: 'DWD-Radar', detail: '1 km · 5 min', provider: 'dwd', box: DWD_BOX, fetch: fetchDwdRadar },
  openmeteo: { label: 'Modell', detail: '15 min', provider: 'openmeteo' },
};

export const PROVIDERS = {
  geosphere: { label: 'GeoSphere Austria', url: 'https://data.hub.geosphere.at' },
  dwd: { label: 'DWD', url: 'https://www.dwd.de' },
  meteoswiss: { label: 'MeteoSwiss', url: 'https://www.meteoswiss.admin.ch' },
  openmeteo: { label: 'Open-Meteo', url: 'https://open-meteo.com' },
};

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

function assemble({ lat, lon }, region, model, nowcast) {
  const used = new Set(['openmeteo', NOWCASTS[nowcast.provider].provider]);
  if (model.model) used.add(MODELS[model.model].provider);
  return {
    version: 1,
    fetchedAt: Date.now(),
    location: { lat, lon },
    region: region.id,
    timezone: model.timezone,
    model: model.model,
    current: model.current,
    nowcast,
    minutely: model.minutely,
    hourly: model.hourly,
    daily: model.daily,
    providers: [...used],
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
