# CLAUDE.md

Wetter: one-screen weather app (installable PWA) that stitches several free, keyless
weather services into one continuous forecast: GeoSphere INCA nowcast and AROME for
Austria and surroundings, Open-Meteo everywhere else, plus a rain radar tab. Vanilla
JS ES modules, no framework, no build: `src/` is the app and is deployed as is to
GitHub Pages (https://michaelkrisper.github.io/wetter/). UI German.

## Commands

Node 26 (`.nvmrc`).

```sh
npm ci                 # dev tools only (Biome)
npm run serve          # src/ on http://localhost:8080 with gzip like Pages (PORT to change)
npm test               # node:test unit tests + test/app.test.js in headless Chrome
npm run check          # lint + tests = CI job "check"
npm run lint:fix       # Biome format and fix
npm run borders        # regenerate src/js/borders.js from Natural Earth
```

- `app.test.js` runs the whole app in headless Chrome with every service answered
  from `test/fixtures.js` (offline); it skips when no Chrome is found (`CHROME=path`).
- CI (`deploy.yml`, workflow "Deploy"): `check` on every push/PR; on `main` "Version
  tag", then `deploy` stamps the commit into `src/sw.js`, publishes `src/` and curls
  the live site, including that `sw.js` carries the commit.
- Layout check before PRs: small (375x667) and large (412x915) phone in the device
  toolbar; nothing may scroll or overflow.

## Architecture

- `src/js/main.js`: startup, location, 10-minute refresh, tabs. `config.js`: default
  place (Graz), intervals, thresholds. `regions.js`: which services apply where;
  Austria is detected offline from `borders.js` (generated, never edit by hand).
- `forecast.js` loads all sources in parallel (`sources/`: Open-Meteo, GeoSphere,
  Nominatim, geocoding, radar grids) and assembles one stored forecast.
- `model.js` is pure (no I/O, no DOM): stored forecast + time -> what the screen
  shows, so a cached forecast can be re-evaluated as time passes. Keep it that way.
- `ui/`: rendering, week chart, place picker, radar tab (lazy-loaded with
  `vendor/jsfive/hdf5.js`, which decodes the INCA grid from NetCDF-4/HDF5).
- The last forecast lives in `localStorage` (`storage.js`), never in the SW cache.
- New modules under `src/js/` go into `SHELL` in `src/sw.js` and, if loaded at
  startup, into the `modulepreload` list in `src/index.html`.

## Service worker (`src/sw.js`)

- One shell cache `wetter-<commit>`; the deploy replaces `__VERSION__` with the first
  8 characters of the commit SHA, so every deploy installs a fresh shell. It is not
  registered on localhost, so local reloads always show current files.
- michaelkrisper.github.io is shared with other apps, and so is CacheStorage: activate
  deletes only outdated `wetter-` caches (`test/sw.test.js`). Never delete caches by
  any other pattern; that used to wipe the other apps' offline caches.

## Rules and pitfalls

- Scope: Austria (INCA/AROME) plus Open-Meteo best match elsewhere. Germany and
  Switzerland were removed on purpose; do not add DE/CH services back. Places to check
  results with: Graz, Vienna, Klagenfurt, Edinburgh.
- Numbers must agree everywhere: daily high/low and rain amounts come from the same
  hours as the chart; the outlook names the highest probability of the whole spell.
- Design decisions: header shows only temperature and condition (feels-like, wind,
  H/L and UV live in the chart); no data-source line on the main screen (attribution
  in the radar tab and README); one screen, no scrolling, no settings.
- GeoSphere answers in 0.4-12 s, Open-Meteo sometimes in 3-6 s instead of <1 s: render
  Open-Meteo first and keep the previous nowcast until a new one arrives. That is the
  services, not the code.
- Open-Meteo: `daily.time` is midnight with today's UTC offset, so it is an hour off
  after a DST change (corrected in `open-meteo.js`); with several `models=` the columns
  get suffixes, `current` does not. Geocoding ranks tiny exact matches first
  ("Klagen" in Indonesia) and new connections can hang 8-20 s: results are re-ranked,
  requests use a 4 s timeout with retry.
- INCA `pt`: only 1 (rain) and 255 (none) are verified; otherwise temperature decides.
- Basemap: CARTO without key serves "API KEY REQUIRED" tiles and
  tile.openstreetmap.org blocks apps (418), hence Esri World Dark Gray. RainViewer's
  free tiles stop at zoom 7 (upscaled beyond), have no forecast frames and ignore the
  colour scheme; forecast frames come from the INCA grid (Open-Meteo grid elsewhere).
- `.map-pan` needs `transform-origin: 0 0`, otherwise pinch zoom drifts to a corner.
- In `app.test.js` the Chrome profile can only be deleted after Chrome exited
  (ENOTEMPTY otherwise), and the DevTools URL must be read from a complete line.

## Conventions

- Biome (single quotes, 110 columns) covers `src/` JS/CSS, `scripts/`, `test/` and root
  JSON, not `src/vendor/`. `src/js/borders.js` and `src/vendor/` are never edited by hand. Zero runtime dependencies; jsfive is vendored (public domain).
- UI text German; code, comments, identifiers and commits English.

## Workflow

- Every change starts with a GitHub issue. Branch `<issue>-<slug>` from `main`,
  open a PR with `Closes #<issue>`. Never push to `main` directly.
- PRs auto-merge (squash) once CI and the "Linked ticket" check pass; drafts are not merged.
- Versions exist only as git tags `vX.Y.Z`. Every merge to `main` tags the next patch;
  never edit version numbers in files. Minor/major releases: Actions -> Release.
- Merging to `main` deploys to GitHub Pages automatically (Deploy workflow).
- Details: CONTRIBUTING.md.
