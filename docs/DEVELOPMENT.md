# Development Guide

## Prerequisites

- Go version declared in `go.mod`.
- Wails v2 tooling compatible with the module version.
- Node.js and npm for the Vite frontend.
- Native WebView development packages required by Wails on the host OS.

Linux builds use the `webkit2_41` tag declared as `build:tags` in `wails.json`
and therefore require GTK 3, WebKitGTK 4.1, and libsoup 3 development metadata.
This is Wails' platform toolchain, not an added application package; the
application packages themselves remain no-CGO cross-buildable.

## Local workflows

```sh
wails dev
```

```sh
npm --prefix frontend run build
env GOCACHE=/tmp/solar-weather-visualizer-go-cache go test ./...
```

The environment used by automation may need a writable `GOCACHE`.

## No-CGO dependency policy

Application packages must compile with:

```sh
CGO_ENABLED=0 go test ./...
```

Before adding a Go package:

1. Confirm that it is implemented in Go and does not import `C`.
2. Confirm it does not shell out to a platform library or require native shared
   objects at runtime.
3. Run no-CGO tests and cross-compilation checks.
4. Record the decision in `docs/decisions/` when the dependency handles a core
   format or persistence concern.

Representative standard cross-build checks:

```sh
env GOCACHE=/tmp/solar-weather-visualizer-go-cache CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build ./...
env GOCACHE=/tmp/solar-weather-visualizer-go-cache CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build ./...
env GOCACHE=/tmp/solar-weather-visualizer-go-cache CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./...
```

Do not use `go test` directly for a foreign target because Go will try to
execute the foreign test binary. Run native tests, then use `go build` for each
cross target.

Do not use `github.com/fhs/go-netcdf/netcdf`; it binds the native NetCDF C
library. The advanced archive phase may use
`github.com/harel/go-native-netcdf` only after testing representative files.

Frontend npm packages do not affect Go CGO status, but native Node addons must
not become runtime dependencies. Build-time platform binaries used by Vite are
acceptable because they are not shipped as application runtime requirements.

## Fixtures

Provider tests use bounded recorded JSON fixtures. Each fixture must document:

- Source endpoint without secrets.
- Retrieval date.
- Why the record is retained, such as a null coordinate, fill value, source
  switch, or linked forecast.

Never record a personal API key or a URL containing it.

## Documentation completion

A change is incomplete until affected physics, provider, public API, cache, or
UI behavior is reflected in `docs/`. Relative links and required files are
checked in CI.
