# ADR 0004: OMNI level-of-detail thresholds

Status: accepted

Historical telemetry uses:

- One-minute OMNI for viewports up to 7 days.
- Five-minute OMNI for viewports over 7 and up to 90 days.
- Hourly OMNI for viewports over 90 days.

The frontend requests finer data when the user zooms. The backend returns no
more than the requested point budget using spike-preserving decimation. This
allows arbitrary dates without loading decades of one-minute samples.
