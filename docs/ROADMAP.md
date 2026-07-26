# Phased Roadmap

This document is updated as phases move from architecture to usable behavior.

## Phase 1 — Foundation: complete

- Normalized, wire-safe event, telemetry, forecast, settings, and provenance
  DTOs.
- UTC validation, canonical units, dynamic pressure, flare-flux mapping, and
  radial display transforms.
- Owner-only settings and gzip JSON cache with atomic writes, stale fallback,
  and a 1 GiB LRU budget.
- Running documentation and architecture decisions.

## Phase 2 — Provider layer: complete

- Keyed NASA Open APIs with CCMC fallback and a locally throttled DEMO_KEY last
  resort.
- DONKI CME, flare, HSS, SEP, shock, storm, and WSA-ENLIL normalization.
- NOAA active-source live wind, field, X-ray, and ENLIL Earth time series.
- NOAA active-source Replay history as a rolling 90-day bridge for OMNI
  publication lag, decoded with pure-Go HTTP/CSV.
- CDAWeb OMNI range chunking, automatic cadence selection, fill-value handling,
  gap detection, deduplication, and spike-preserving point budgets.
- Unit coverage for malformed/partial scientific records and cache fallback.

## Phase 3 — Desktop API: complete

- Thin Wails methods for bootstrap, live refresh, range search, telemetry,
  forecasts, settings, cache control, and offline demo.
- Partial-failure behavior and provider health state.
- Arbitrary DONKI ranges chunked into bounded calendar requests.
- PNG, readable text, and schema-versioned replay bundle import/export.

## Phase 4 — Interactive visualization: complete

- Vanilla TypeScript state and UI modules with a Three.js/WebGL renderer.
- 0–2 AU solar system, linear/compressed scale, camera controls, picking,
  physical replay clock, event filtering, and source inspection.
- Ballistic CME fronts, flare pulses, illustrative HSS spirals, condition-driven
  particles, SVG telemetry charts, and responsive panels.
- Guided onboarding and a deterministic browser/desktop demo.

## Phase 5 — Forecast and capture: complete for public feeds

- DONKI WSA-ENLIL run metadata merged with NOAA’s current Earth time series.
- Forecast/observation/illustration visual labels.
- Image, text, and portable replay capture.

The public feeds do not expose a complete 3D MHD volume. No synthetic cube is
invented.

## Phase 6 — Exact archives and full model cubes: gated

The UI and Wails contracts expose capability boundaries, preview estimates, and
metadata inspection. Activation requires:

- Representative NCEI `f1m` and `m1m` NetCDF Classic fixtures.
- A pure-Go reader evaluation and ADR; `github.com/fhs/go-netcdf/netcdf` is
  prohibited because it requires CGO.
- Exact NCEI catalog/order schemas, polling/backoff, download integrity checks,
  and resumable import.
- A documented WSA-ENLIL cube convention, coordinate transform, variable
  mapping, memory/LOD plan, and test file with redistribution permission.

Until those gates pass, order methods return `feature-gated` and `.nc` model
inspection explains why it cannot decode the file.

## Phase 7 — Release hardening: active

- Native unit tests and no-CGO tests pass.
- Standard `go build` cross checks pass for Windows amd64, macOS amd64/arm64,
  and Linux arm64.
- TypeScript and Vite production builds pass.
- Remaining work: representative live-provider integration fixtures, packaged
  Wails smoke tests on each desktop OS, accessibility audit, and signed release
  artifacts.
