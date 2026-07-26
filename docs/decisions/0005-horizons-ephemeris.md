# ADR 0005: JPL Horizons vectors with a marked analytical fallback

Status: accepted

Planet and L1 placement uses NASA/JPL Horizons geometric state vectors in the
J2000 ecliptic frame. The Go backend parses the API's JSON envelope and CSV
vector table with the standard library, caches normalized responses, and
returns position plus velocity samples for frontend Hermite interpolation.

The application does not embed CSPICE, a native SPK reader, or another
CGO-backed ephemeris dependency. This preserves ordinary no-CGO cross-builds
and avoids shipping large planetary kernels.

When Horizons and its exact cache are unavailable, the renderer may use JPL's
published approximate planetary elements only within their documented validity
interval. Approximate bodies and trajectories are visibly marked and are never
reported as exact Horizons output.
