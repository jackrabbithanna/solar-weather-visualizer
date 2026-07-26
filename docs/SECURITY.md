# Security and Privacy

## Credentials

The optional NASA key is accepted by a Wails method and written only by the Go
backend. The settings file is created with mode `0600` in an owner-only
directory. Settings DTOs expose `nasaKeyConfigured`, never the key.

Request URLs are redacted before they appear in decode errors. Cache identities
do not contain a personal key.

## Network

All external requests originate from Go, use HTTPS provider endpoints, set a
bounded timeout and response-size limit, and normalize data before it crosses
the Wails bridge. The frontend does not receive raw provider bodies.

One provider failure does not authorize silently substituting another data
class or inventing coordinates. A stale cached response is explicitly marked
stale, and the bounded JPL analytical ephemeris fallback is visibly identified
as approximate.

## Local files

Settings, cache entries, screenshots, summaries, and replay bundles are created
with owner-only permissions. Settings and cache writes use a temporary file,
sync, close, and atomic rename.

Replay imports are capped at 512 MiB and accept JSON or gzip JSON. Schema v2
includes ephemeris samples; schema v1 remains accepted with an analytical
fallback. Model metadata JSON is capped at 8 MiB. NetCDF decoding is disabled
in the current build.

## Dependency boundary

Runtime Go dependencies must remain compatible with `CGO_ENABLED=0` and normal
Go cross-builds. Native NetCDF, SQLite, graphics, or platform-library bindings
are not acceptable. A future data-format dependency requires a documented ADR
and multi-platform build verification.
