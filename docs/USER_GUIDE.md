# User Guide

## First launch

The application opens a deterministic 48-hour CME-passage walkthrough. It
requires no network and is explicitly classified as illustrative. The
replay starts paused at the beginning of the interval with no event selected.
The three-page guide explains data classes, replay time, and the Earth-condition
charts.

Drag to orbit the 3D camera, scroll to zoom, and use **Reset view** to return to
the overview. Orbit drags do not select events; selection requires a short click
on a visible event marker or propagation front while Replay is paused. Scene
clicks during playback do not change the selection or replay time.

## Live and replay

**Live** requests NOAA SWPC’s active real-time solar-wind, magnetic-field, and
X-ray feeds. The current spacecraft source is shown; it is not assumed to
always be DSCOVR or ACE. The timeline and telemetry charts show the latest
three hours, while the event stream requests the preceding 48 hours. Live
refresh has a minimum 30-second interval. Entering Live preserves the current
Replay; switching back restores that Replay’s data and starts it from the
beginning instead of treating the mismatched Live telemetry and event windows
as one replay interval.

**Replay** enables the UTC timeline. Newly loaded replays begin paused at the
start of their interval. Press play, choose a playback rate, or drag the time
control. Pressing play at the end rewinds and starts the replay again. **Date
range** fields are UTC wall-clock values regardless of the computer's timezone
and load three independent streams:

1. DONKI events.
2. Routed OMNI and recent NOAA observations near Earth.
3. Available WSA-ENLIL forecast data.

A failed stream is reported without clearing successful data. Long telemetry
requests automatically move from one-minute to five-minute and then hourly
data.

Date Range provider requests run concurrently. While the telemetry request is
active, the charts and **Conditions near Earth** show a dedicated fetching
indicator; telemetry from the previous range is not reused. The completed chart
reports the returned UTC coverage, sample and gap counts, provider warnings,
and whether the response came from cache. A partial result is final for that
request—there is no hidden background fetch after the indicator and provider
loading state disappear.

NASA's finalized OMNI observations can lag the current date. For the latest 90
days, Replay also requests NOAA's active historical magnetic and plasma streams.
OMNI remains authoritative through its last usable magnetic and plasma values;
NOAA fills the recent trailing interval. NOAA values retain their original L1
timestamps rather than being described as OMNI bow-shock-shifted data. CDAWeb's
HAPI `1201` no-data response is treated as a completed empty interval rather
than a failed request.

The telemetry charts always use the same start and end as the Replay timeline.
If OMNI covers only part of the requested interval, the line occupies only that
part of the chart; missing periods remain blank rather than being stretched.
Each chart prints its UTC domain below the plot.

**Conditions near Earth** uses the latest routed observation at or before the
Replay cursor and displays that observation’s UTC timestamp and separate IMF
and plasma sources when they differ. Outside the returned coverage, or inside a
reported data gap, the cards show unavailable values instead of holding an old
endpoint observation.

Selecting an event pauses Replay and seeks to a useful view of that event:
flare selections use the reported peak, directed CME selections advance the
front into the heliosphere, and other event types use their catalog time. The
camera’s zoom and orientation do not change. The selected event keeps its normal
brightness while other active event geometry is shown at 60% brightness. Its
catalog time is also marked on the telemetry charts. Live selections do not move
the clock away from the newest observation.

Click the selected event again, press **Escape** when no dialog is open, or use
**Clear selection** in the detail panel to clear it. Clicking empty space in the
solar-system view leaves the selection unchanged. With no active selection, all
event graphics use their normal brightness.

The event list shows the full catalog for the loaded interval. Event geometry in
the Replay scene appears only while it is active at the current cursor time.

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
