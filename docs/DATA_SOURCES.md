# External Data Sources

External services can change independently of the application. “Verified” dates
record the last schema inspection, not a service guarantee.

## NASA CCMC DONKI

- Purpose: CME, flare, HSS, SEP, interplanetary shock, geomagnetic storm, linked
  events, and WSA-ENLIL simulation metadata.
- Keyless base: `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get`
- Keyed base: `https://api.nasa.gov/DONKI`
- Time: UTC.
- CME direction: HEEQ.
- Important omissions: CME latitude, longitude, width, speed, or analysis arrays
  may be null or absent.
- Policy: prefer a configured personal API key; otherwise use keyless CCMC.
  DEMO_KEY is only a throttled fallback for small recent requests.
- Verified: 2026-07-25.

Reference: <https://ccmc.gsfc.nasa.gov/tools/DONKI/>

## NOAA SWPC real-time solar wind

- Compact speed:
  `https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json`
- Compact field:
  `https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json`
- One-minute plasma:
  `https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json`
- One-minute magnetometer:
  `https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json`
- Purpose: current L1 plasma and IMF plus the recent operational window.
- Selection: prefer records with `active=true`; preserve spacecraft source and
  quality flags. Multiple spacecraft may share a timestamp. Plasma and
  magnetometer streams are not assumed to be synchronized; the current
  snapshot uses the newest available value from each stream.
- Display window: the provider snapshot retains up to six recent hours; the
  default Live timeline and telemetry charts display the newest three hours.
- Nulls: alpha-particle fields and instrument-specific fields commonly contain
  JSON null.
- Compact refresh: 60 seconds.
- Full-feed refresh: 15 minutes because the JSON files are several megabytes.
- Verified: 2026-07-25; active sample source was `SOLAR1`.

Reference: <https://www.swpc.noaa.gov/products/real-time-solar-wind>

## NOAA SWPC Replay solar wind

- HAPI base: `https://tlv-swpc.woc.noaa.gov/hapi`
- Purpose: recent historical L1 plasma and IMF while finalized OMNI data is not
  yet available.
- Datasets: the active `mag` and `plasma` streams at one-minute, five-minute,
  or hourly cadence. Replay requests use the same cadence selected for OMNI.
- Window: at most the latest 90 days, clipped to the selected Replay range and
  current UTC time.
- Wire format: the data endpoint returns CSV even when HAPI advertises JSON.
  Requests therefore omit `format=json`, send the endpoint's required wildcard
  `Accept` header, and use the standard-library CSV decoder. Asking for
  `text/csv` currently returns HTTP 404. `-1e30` and the observed `-9999`
  sentinel become null.
- Precedence: OMNI remains authoritative through its last usable magnetic and
  plasma observations. NOAA fills only the trailing portion of each metric
  group. L1 timestamps are preserved and are not presented as bow-shock-shifted
  observations.
- Verified: 2026-07-25 against July 22–23, 2026 one-minute data; source code was
  `4`.

Reference: <https://www.spaceweather.gov/products/solar-wind>

## NOAA GOES X-rays

- Primary one-day feed:
  `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`
- Purpose: recent measured soft X-ray flux used alongside DONKI flare events.
- Values remain attributed to their satellite and energy band.
- Verified: 2026-07-25.

## NASA CDAWeb OMNI HAPI

- Base: `https://cdaweb.gsfc.nasa.gov/hapi`
- Purpose: historical solar-wind plasma and IMF time-shifted to Earth’s bow
  shock nose.
- Datasets:
  - `OMNI_HRO_1MIN` for viewports up to 7 days.
  - `OMNI_HRO_5MIN` for viewports over 7 and up to 90 days.
  - `OMNI2_H0_MRG1HR` for viewports over 90 days or before one-minute coverage.
- Fill values are declared in the HAPI response metadata and must become null.
- `IMF` and `PLS`/their hourly equivalents identify source spacecraft.
- Recent Replay requests are merged with NOAA SWPC history only after the final
  usable OMNI magnetic/plasma timestamps.
- Verified: 2026-07-25.

Reference: <https://cdaweb.gsfc.nasa.gov/hapi>

## NOAA WSA-ENLIL

- Earth time series:
  `https://services.swpc.noaa.gov/json/enlil_time_series.json`
- Purpose: forecast density, temperature, radial velocity, field components,
  polarity, and cloud tracer at Earth.
- DONKI `WSAEnlilSimulations` supplies run metadata and predicted impacts.
- The NOAA file is a current forecast only. It is never attached to a DONKI
  run when the selected replay ends more than seven days in the past.
- These feeds are not a full 3D MHD cube.
- Verified: 2026-07-25.

## NCEI DSCOVR archive

- Catalog:
  `https://www.ngdc.noaa.gov/next-catalogs/rest/dscovr/catalog`
- Order API: `https://www.ngdc.noaa.gov/next-web/rest/orders`
- Target products: `f1m` Faraday Cup and `m1m` magnetometer daily averages.
- Delivery is asynchronous and requires an email address.
- Files are gzip-compressed NetCDF Classic. Import must use a pure-Go reader.
- Verified: 2026-07-25.

Reference: <https://www.ngdc.noaa.gov/next-web/docs/guide/catalog.html>
