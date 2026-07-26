# Solar Weather Visualizer Documentation

This directory is the running source of truth for the application. The original
brief remains in [INITIAL_PROMPT.md](INITIAL_PROMPT.md); the documents below
describe the current architecture and implemented behavior.

- [PHYSICS.md](PHYSICS.md) — units, frames, transforms, propagation models, and
  scientific limitations.
- [CODEBASE.md](CODEBASE.md) — package boundaries, runtime data flow, Wails
  interface, storage, and error behavior.
- [DATA_SOURCES.md](DATA_SOURCES.md) — external APIs, datasets, cadence,
  credentials, fill values, and attribution.
- [DEVELOPMENT.md](DEVELOPMENT.md) — local setup, testing, cross-build rules,
  fixtures, and releases.
- [USER_GUIDE.md](USER_GUIDE.md) — controls and interpretation of the
  visualization.
- [ROADMAP.md](ROADMAP.md) — phased delivery status, active work, and gated
  advanced features.
- [SECURITY.md](SECURITY.md) — credential, network, cache, import, and export
  boundaries.
- [decisions/](decisions/) — consequential architecture decisions.

## Current phase

The end-to-end core is usable: normalized providers, secure settings, stale
cache fallback, live and historical workflows, guided offline replay, Three.js
layers, cached JPL ephemerides, frame-correct event geometry, charts, provenance
inspection, and exports. Exact NCEI daily-file import and full ENLIL cube
rendering remain feature-gated; see the roadmap.

## Documentation policy

Code changes that alter physics, provider behavior, public interfaces, cache
formats, controls, or build requirements must update the corresponding document
in the same change. External data entries include a verification date because
their schemas and operational spacecraft can change.
