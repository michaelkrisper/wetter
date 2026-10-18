# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
