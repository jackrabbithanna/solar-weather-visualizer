# Solar Weather Visualizer

A Wails desktop application for exploring solar-weather events and measured
conditions from the Sun to 2 AU. The view combines:

- NASA DONKI CME, flare, high-speed-stream, particle, shock, storm, and
  WSA-ENLIL metadata.
- NOAA SWPC real-time solar wind, IMF, GOES X-ray, and ENLIL Earth time series.
- NASA CDAWeb OMNI historical observations with automatic cadence selection.
- NASA/JPL Horizons geometric ephemerides for Mercury through Mars and the
  Sun–Earth/Moon-barycenter L1 point.
- A deterministic offline walkthrough for learning the controls.

Every record and visual is labeled observed, forecast, derived, or illustrative.
The application is educational and is not an operational warning product.

## Run

```sh
wails dev
```

The browser-only Vite preview works without the Go bridge and automatically
uses the built-in demo:

```sh
npm --prefix frontend run dev
```

## Verify

```sh
npm --prefix frontend run build
npm --prefix frontend test
env GOCACHE=/tmp/solar-weather-visualizer-go-cache go test ./...
env GOCACHE=/tmp/solar-weather-visualizer-go-cache CGO_ENABLED=0 go test ./...
```

See [the documentation index](docs/README.md), especially
[PHYSICS.md](docs/PHYSICS.md) before changing propagation or coordinate
behavior and [DEVELOPMENT.md](docs/DEVELOPMENT.md) before adding dependencies.
