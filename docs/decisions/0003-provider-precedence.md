# ADR 0003: DONKI provider precedence

Status: accepted

When a user NASA key is configured, `api.nasa.gov` is primary and keyless NASA
CCMC is the fallback. Without a key, CCMC is primary. `DEMO_KEY` is reserved for
small recent requests after a transient CCMC failure and is guarded by stricter
local hourly/daily limits than NASA’s published maximum.

This provides zero-setup operation without embedding a shared production key.
