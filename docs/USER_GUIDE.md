# User Guide

## First launch

The application opens a deterministic 48-hour CME-passage walkthrough. It
requires no network and is explicitly classified as illustrative. The
replay starts paused at the beginning of the interval with no event selected.
The three-page guide explains data classes, replay time, and the Earth-condition
charts.

Drag to orbit the 3D camera, scroll to zoom, and use **Reset view** to return to
the overview.

## Live and replay

**Live** requests NOAA SWPC’s active real-time solar-wind, magnetic-field, and
X-ray feeds. The current spacecraft source is shown; it is not assumed to
always be DSCOVR or ACE. The timeline and telemetry charts show the latest
three hours, while the event stream requests the preceding 24 hours. Live
refresh has a minimum 30-second interval. Entering Live preserves the current
Replay; switching back restores that Replay’s data and starts it from the
beginning instead of treating the mismatched Live telemetry and event windows
as one replay interval.

**Replay** enables the UTC timeline. Newly loaded replays begin paused at the
start of their interval. Press play, choose a playback rate, or drag the time
control. Pressing play at the end rewinds and starts the replay again. **Date
range** loads three independent streams:

1. DONKI events.
2. OMNI observations near Earth.
3. Available WSA-ENLIL forecast data.

A failed stream is reported without clearing successful data. Long OMNI
requests automatically move from one-minute to five-minute and then hourly
data.

Selecting an event pauses Replay and seeks to a useful view of that event:
flare selections use the reported peak, directed CME selections advance the
front into the heliosphere, and other event types use their catalog time. The
selected event receives a bright scene marker while other event geometry is
dimmed. Its catalog time is also marked on the telemetry charts. Live selections
do not move the clock away from the newest observation.

The event list shows the full catalog for the loaded interval. Event geometry
and selection beacons in the Replay scene appear only while they are active at
the current cursor time.

## The heliosphere view

The scene covers a physical 0–2 AU and shows Mercury, Venus, Earth/L1, and Mars.
Planet and Sun display radii are enlarged.

- **1:1 AU** uses linear radial distance.
- **√ compressed** expands the inner heliosphere while keeping 0 and 2 AU
  fixed. Time and propagation still use physical distance.

An expanding CME cone appears only when DONKI supplies a usable analysis time,
speed, latitude, longitude, and width. Its front is a constant-speed
illustration. Unknown coordinates remain unknown.

Flare markers appear only for parseable Stonyhurst source locations.
High-speed-stream spirals are illustrative because DONKI does not supply full
coronal-hole geometry.

## Reading the data

Select an event to inspect its values and provenance:

- **Observed**: instrument or catalog measurement.
- **Forecast**: model output or predicted impact.
- **Derived**: a documented calculation, such as proton dynamic pressure.
- **Illustrative**: explanatory geometry or demo data.

The lower charts show solar-wind speed, proton density, and IMF Bz. Gaps are not
interpolated by the backend. Bz remains labeled GSM, and local L1/bow-shock
vectors are not painted across the entire heliosphere.

## Settings and credentials

A personal NASA API key is optional. When supplied, `api.nasa.gov` is tried
first and keyless CCMC is its fallback. The Go backend writes the key to the
platform user-config directory with owner-only file permissions. The frontend
can learn only whether a key is configured.

Cached provider responses have a 1 GiB default budget and can be cleared from
settings. If a provider is unavailable, an expired cache entry may be displayed
with an explicit stale label.

## Import and export

- **Export image** saves the current Three.js canvas as PNG.
- **Text** saves a readable event, telemetry, forecast, and provenance summary.
- **Bundle** writes a gzip-compressed schema-versioned replay file.
- **Import** restores a bundle and its view time, scale, data, and selection.

Files are created with owner-only permissions. Imports are size-limited and
schema-validated.

The advanced model inspector accepts metadata JSON. NetCDF cube parsing and
NCEI archive ordering remain gated until a pure-Go reader passes representative
fixture and standard cross-build validation. The application does not bundle a
CGO NetCDF library.

## Safety boundary

This is an educational and exploratory application. Do not use it as a source
of operational alerts, navigation decisions, infrastructure protection
actions, or personal safety guidance.
