# Wetter

**A minimalist weather app that fits on one screen.** Minute-precise for the
next 90 minutes, hourly for the next days, daily for the week, stitched
together from several weather services into one continuous forecast.

[**Open the app →**](https://michaelkrisper.github.io/wetter/)

[![Deploy](https://github.com/michaelkrisper/wetter/actions/workflows/deploy.yml/badge.svg)](https://github.com/michaelkrisper/wetter/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<p align="center">
  <img src="docs/screenshot-weather.webp" width="300" alt="Weather overview: current conditions, combined temperature, rain and UV chart, 7-day forecast">
  &nbsp;&nbsp;
  <img src="docs/screenshot-radar.webp" width="300" alt="Rain radar tab showing a forecast frame over a dark map">
</p>

## Features

- **Everything at a glance.** Current conditions, a one-line precipitation
  outlook, a combined chart and 7 days on a single screen. No scrolling, no
  zooming, no settings.
- **One chart for the whole week.** Temperature curve with each day's high
  and low over precipitation bars (height = amount, opacity = probability,
  each spell labelled with its amount) and UV bars with the daily maximum,
  on a sky that is light blue by day and dark with stars by night, with
  sunrise/sunset and moonrise/moonset marked at their time. 12 hours wide
  with hourly labels; drag sideways to scroll, tap a point for its values,
  tap a day in the list to see its 00-24 h.
- **Precision where it matters.** The closer the time, the finer the data:
  1 km / 15-minute nowcast for the next 90 minutes, a 2.5 km national model
  for the next days, global models for the rest of the week.
- **Seamless.** Sources are blended, not stacked: the curve starts at the
  observed temperature and converges smoothly to the model, the rain outlook
  reads one timeline from nowcast to daily forecast ("Rain from 19:10",
  "Dry until Wednesday").
- **Rain radar** on a second tab: the last two hours plus a forecast for the
  next 2.5-3 hours, animated. Pinch, wheel or double tap to zoom, drag to pan.
- **Location aware.** Starts instantly with Graz (or the last known position),
  then switches services if GPS says you are somewhere else. Tap the place
  name to search for another one; a place chosen by hand stays until you pick
  "Mein Standort" again.
- **Fast.** No framework, no build, ~30 kB of compressed code for the main
  screen; the radar and its HDF5 decoder load on first use. The last
  forecast is shown immediately from cache, the app shell works offline.
- **Private.** No backend, no analytics, no cookies. The position is only
  sent to the weather services that need it.

## Data sources

The app picks the best available service for each lead time and location.

| Lead time | Resolution | Austria and surroundings | Elsewhere (e.g. Edinburgh) |
| --- | --- | --- | --- |
| now to +90 min | 15 min, 1 km | GeoSphere **INCA** nowcast | Open-Meteo 15-minute data |
| then up to ~2.5 days | 1 h, 2.5 km | GeoSphere **AROME** | Open-Meteo best match (national models where available, e.g. Met Office UKV) |
| up to 7 days | 1 h / 1 day | Open-Meteo best match (ECMWF IFS, ICON, GFS, ...) | same |
| Radar, past 2 h | 10 min | RainViewer composite | same |
| Radar, next 2.5-3 h | 15 min | INCA grid, 1 km | Open-Meteo grid, ~20 km |

- Austria is detected offline from a simplified border
  ([Natural Earth](https://www.naturalearthdata.com), public domain), so no
  extra request is needed before the forecast starts loading. INCA also covers
  the neighbouring regions (Slovenia, South Tyrol, Bavaria, ...).
- AROME overrides the global blend for temperature, precipitation, wind and
  weather code as far as it reaches; precipitation probability and UV index
  always come from the ensemble-based best match. Its daily values are only
  used for days it covers completely.
- A measured nowcast overrides the model's weather code: if INCA says it is
  dry right now, the app does not show rain, and vice versa.
- Open-Meteo usually answers in ~200 ms, GeoSphere sometimes takes seconds.
  The app renders the model data immediately (keeping the previous nowcast
  while it is still valid) and refines the view when the nowcast arrives.
- The INCA grid comes as NetCDF-4 (HDF5) and is decoded in the browser with
  [jsfive](https://github.com/usnistgov/jsfive), vendored in `src/vendor/`.

All services are free and keyless. Data © their providers, see
[Credits](#credits).

## Install

Open <https://michaelkrisper.github.io/wetter/> on your phone and add it to
the home screen (Safari: *Share → Add to Home Screen*, Chrome: *Install app*).
Allow location access to get the forecast for where you are; without it the
app shows Graz.

## Development

There is no build step: `src/` is the app, served as-is.

```sh
npm ci            # dev tools (Biome)
npm run serve     # http://localhost:8080, gzip like GitHub Pages
npm run check     # lint and format check
npm run lint:fix  # format and fix
```

The service worker is not registered on `localhost`, so a reload always shows
the current files.

### Project structure

```
src/
├── index.html            static skeleton, rendered into by the modules
├── styles.css            mobile-first layout, one screen without scrolling
├── sw.js                 app shell cache (versioned per commit)
├── vendor/jsfive/        HDF5 reader for the INCA grid (public domain)
└── js/
    ├── main.js           startup, location, refresh cycle, tabs
    ├── config.js         default location, refresh intervals, thresholds
    ├── regions.js        which services to use where
    ├── borders.js        generated country outlines (scripts/build-borders.mjs)
    ├── forecast.js       fetches all sources in parallel and assembles them
    ├── model.js          pure: stored forecast + time -> what the screen shows
    ├── sources/          one module per API (Open-Meteo, GeoSphere, Nominatim, geocoding, radar grids)
    └── ui/               rendering, week chart, radar tab (lazy-loaded), icons
```

`model.js` is deliberately free of I/O and DOM: a cached forecast can be
re-evaluated at any time as time passes, and the merging logic is easy to
test.

### Adding a region

Add the country to `COUNTRIES` in `scripts/build-borders.mjs`, run
`npm run borders`, and add an entry to `REGIONS` in `src/js/regions.js` with
the [Open-Meteo model](https://open-meteo.com/en/docs) and the nowcast order.

## Deployment

Every push to `main` runs the checks and publishes `src/` to GitHub Pages via
[GitHub Actions](.github/workflows/deploy.yml). The workflow stamps the commit
hash into `sw.js`, so installed apps pick up the new version on their next
start, and finishes with a smoke test against the live site.

## Roadmap

- Polish the design further
- Tests for the merging logic in `model.js` and an end-to-end check

## Credits

- [GeoSphere Austria](https://data.hub.geosphere.at): INCA nowcast (point and
  grid) and AROME, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Open-Meteo](https://open-meteo.com): forecast and geocoding API,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); place search data
  from [GeoNames](https://www.geonames.org), CC BY 4.0
- [RainViewer](https://www.rainviewer.com): radar tiles
- [Esri](https://www.esri.com): dark grey basemap (Esri, HERE, Garmin,
  © OpenStreetMap contributors)
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org): place names,
  [ODbL](https://www.openstreetmap.org/copyright)
- [Natural Earth](https://www.naturalearthdata.com): country borders, public domain
- [jsfive](https://github.com/usnistgov/jsfive): HDF5 reader, public domain

## License

[MIT](LICENSE) © Michael Krisper
