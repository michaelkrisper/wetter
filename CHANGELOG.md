# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] - 2026-10-19

### Changed

- The temperature axis fits what the chart shows (at least 4 degrees), easing
  along while scrolling; a calm night is no longer a flat line.
- Hourly rain bars sit centred on their hour line, like the UV bars; the
  outlook names that hour.
- The spell's probability label sits above its highest bar.
- Larger weather icon and description in the header.

## [1.2.0] - 2026-10-19

### Changed

- Chart shows 12 hours per screen with a label every hour; a tapped day still
  shows its whole 24 hours. Sun and moon events moved to the bottom.
- Rain bars: height is the amount, opacity the probability; hours without an
  expected amount get no bar.
- The outlook quotes the probability and amount of the whole rain spell, the
  same numbers the chart shows.
- Header shows only temperature and condition: "feels like", wind, high/low
  and UV are gone (high/low and the daily UV maximum are labelled in the
  chart). The data credits line below the days is gone too.
- A day's high, low and precipitation sum come from the same hours as the
  chart, so the list and the chart show the same numbers.
- Data refreshes every 10 minutes (was 5) and no longer re-renders every minute.
- 20 px more space at the top, clear of the iOS status bar blur.

### Fixed

- Radar pinch zoom now zooms where the fingers are.
- Radar reloads old frames when the app returns to the foreground; a failed
  forecast no longer shows "lädt …" forever; dry forecast frames say so, and
  the forecast area is outlined.

## [1.1.0] - 2026-10-18

### Added

- One chart for the whole week: temperature, precipitation bars (amount and
  probability), UV bars, sunrise/sunset and moonrise/moonset; drag to scroll,
  tap for details, tap a day to jump to it.
- Radar forecast for the next 2.5-3 hours: INCA grid around Austria (decoded
  with the vendored jsfive), Open-Meteo model grid elsewhere.
- Radar: pinch, wheel and double-tap zoom, frame timeline.

### Changed

- Wind and UV moved next to "feels like" and high/low; the separate 90-minute
  card is merged into the chart.

### Removed

- Germany and Switzerland as dedicated regions (DWD radar nowcast, ICON-D2,
  ICON-CH1); Open-Meteo best match covers them.

## [1.0.0] - 2026-10-18

### Added

- One-screen overview: current conditions, precipitation outlook for the next
  90 minutes, 24-hour chart, 7-day forecast.
- Nowcast from GeoSphere INCA (Austria and surroundings) and the DWD radar
  nowcast (Germany), with Open-Meteo 15-minute data as fallback.
- Regional high-resolution models via Open-Meteo: GeoSphere AROME (Austria),
  DWD ICON-D2 (Germany), MeteoSwiss ICON-CH1 (Switzerland).
- Seamless blending of nowcast and model temperatures; one outlook sentence
  across nowcast, hourly and daily data.
- Rain radar tab (RainViewer) with animation, pan and zoom.
- GPS location with place names (Nominatim), Graz as instant default.
- Installable PWA with offline app shell and cached last forecast.
