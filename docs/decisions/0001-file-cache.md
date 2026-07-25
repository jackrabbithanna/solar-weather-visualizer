# ADR 0001: Compressed file cache instead of SQLite

Status: accepted

The application stores provider/time chunks as gzip-compressed JSON envelopes
under the operating system user cache directory. Settings use a separate
owner-only JSON file.

This keeps the backend pure Go, avoids CGO database drivers, supports ordinary
cross-compilation, and makes cache corruption isolated to a single query chunk.
Atomic replacement prevents partially written entries.
