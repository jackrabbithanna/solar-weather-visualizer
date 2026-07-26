# Codebase Architecture

## Runtime shape

The application is a Wails v2 desktop process:

1. The Go backend owns networking, credentials, normalization, cache files,
   archive imports, and filesystem exports.
2. Wails methods expose typed DTOs to the frontend.
3. Vanilla TypeScript owns application state, controls, charts, and the
   Three.js scene.
4. The renderer consumes normalized domain data and does not parse provider
   responses.

The frontend does not call NASA or NOAA directly. This keeps credentials out of
browser requests and gives every provider the same timeout, caching, quality,
and provenance behavior.

## Go packages

- `internal/domain` contains wire-safe domain types, time validation, units, and
  small physical derivations.
- `internal/store` owns the owner-only settings file and compressed response
  cache.
- `internal/providers` contains external API adapters and raw schemas.
- `internal/service` coordinates providers, fallback, range chunking,
  normalization, downsampling, and partial failure.
- `app.go` is the thin Wails facade. It must not accumulate provider logic.

Provider code depends on `domain`; domain code never imports providers or Wails.

## Storage

Settings live under `os.UserConfigDir()/solar-weather-visualizer/settings.json`
with mode `0600`. Only the backend reads the NASA API key. DTOs expose a
configured boolean, never the key.

Cache entries live under `os.UserCacheDir()/solar-weather-visualizer`. Keys are
SHA-256 hashes of canonical provider/query identifiers. Each gzip-compressed
JSON envelope stores retrieval time, expiry, optional ETag, and payload.
Writes use a temporary file, sync, close, and atomic rename. The default cache
budget is 1 GiB with least-recently-used eviction based on access-modified time.

SQLite is intentionally not used. This avoids native database drivers and keeps
the data portable and inspectable.

## Error model

Network requests have bounded timeouts. A multi-provider request returns usable
data plus a list of `ProviderIssue` values; one provider failure does not blank
the scene.

Expired cache entries can be returned explicitly as stale when the network is
unavailable. Provider, dataset, retrieval time, observation time, coordinate
frame, cache state, and data classification travel with normalized records.

## Frontend boundaries

The frontend is organized into:

- API bridge and DTO types.
- Central immutable-ish application store.
- UTC timeline controller.
- Physics and coordinate transforms.
- Three.js scene plus independent phenomenon layers.
- DOM panels for search, status, charts, settings, guidance, and export.

WebGL is the baseline renderer. WebGPU may be enabled only through later
capability detection and must not replace the WebGL path.

## Public Wails interface

The facade currently exposes:

- `Bootstrap`
- `RefreshLive`
- `SearchEvents`
- `LoadTelemetry`
- `LoadForecasts`
- `GetSettings`
- `SaveSettings`
- `ClearCache`
- `LoadDemoScenario`
- `ExportPNG`
- `ExportText`
- `ExportBundle`
- `ImportBundle`
- `PreviewNCEIArchive`
- `RequestNCEIArchive`
- `CheckNCEIOrder`
- `ImportModel`

Methods return domain DTOs or errors suitable for display; raw credentials and
provider response bodies are never returned.

`PreviewNCEIArchive`, `RequestNCEIArchive`, `CheckNCEIOrder`, and
`ImportModel` deliberately expose the advanced-workflow gate. JSON model
metadata can be inspected, but NetCDF files are not decoded in the current
build. NCEI ordering is not sent until a pure-Go importer has passed fixture and
cross-build validation.

## Frontend implementation

- `src/api.ts` isolates generated Wails calls and supplies a browser-preview
  demo.
- `src/state.ts` owns replay time, filters, mode, selection, loaded DTOs, and
  typed telemetry request state.
- `src/layout.ts` owns pane resizing, collapse behavior, accessibility, bounds,
  and versioned local layout persistence.
- `src/activity.ts` owns the bounded session activity stream and its DOM view;
  messages are stored as text rather than injected markup.
- `src/scene/HeliosphereScene.ts` owns Three.js resources, transforms, picking,
  CME/flare/HSS visuals, planets, and measured-condition particles.
- `src/charts.ts` renders dependency-free telemetry SVGs, including independent
  empty metric frames that preserve the requested time domain.
- `src/main.ts` composes the controllers, panels, dialogs, provider workflows,
  exports, and guidance.

Provider strings inserted into DOM markup are HTML-escaped. The WebView makes no
provider request directly.

Layout state is the only new persistent frontend state. The activity log remains
in memory for the current session, while the latest message is also reflected
in the footer. No frontend layout or logging operation crosses the Wails API.
