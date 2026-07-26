# Physics and Visualization Model

## Product boundary

The application is an educational and exploratory visualization. It is not an
operational warning system and does not reproduce a full magnetohydrodynamic
simulation.

The word “energy” refers to measured or derived proxies:

- CME radial speed and angular width.
- Solar-wind proton speed, density, temperature, and dynamic pressure.
- Interplanetary magnetic-field magnitude and components.
- GOES X-ray flare class and flux.

The application does not calculate total CME kinetic energy because the public
event feed does not provide a sufficiently constrained CME mass. It does not
present flare class as total radiated energy.

## Units

Canonical backend units are:

| Quantity | Unit |
| --- | --- |
| Distance | astronomical units (AU) |
| CME and solar-wind speed | km/s |
| Proton density | particles/cm³ |
| Temperature | K |
| Magnetic field | nT |
| Dynamic pressure | nPa |
| X-ray flux | W/m² |
| Time | UTC, serialized as RFC 3339 |

The IAU 2012 astronomical unit is `149,597,870,700 m`. The nominal solar radius
used for visualization is `695,700,000 m`.

For proton-only solar wind, dynamic pressure is derived as:

`P = n × mₚ × v²`

where density is converted from cm⁻³ to m⁻³ and speed from km/s to m/s. The UI
labels this result as derived because alpha-particle and composition corrections
are not invented when absent.

## Coordinate frames

- DONKI CME analysis longitude and latitude are interpreted as Heliocentric
  Earth Equatorial (HEEQ), matching the DONKI analysis display.
- Flare source strings are heliographic Stonyhurst locations and are parsed only
  when the standard latitude/longitude form is present.
- NOAA and OMNI magnetic vectors remain labeled GSE or GSM. A local L1 or
  bow-shock vector is never projected as a heliosphere-wide magnetic field.
- Planet and Sun–Earth/Moon-barycenter L1 positions use geometric state vectors
  from NASA/JPL Horizons, centered on the Sun and expressed in the J2000
  ecliptic frame. Daily position and velocity samples are interpolated with a
  cubic Hermite curve; exact samples are never extrapolated across missing
  coverage.
- CME HEEQ and flare Stonyhurst directions are transformed at the event epoch,
  not the current replay cursor. The HEEQ basis uses the solar north pole and
  the contemporaneous Sun-to-Earth vector. The resulting inertial direction is
  then mapped into the common J2000 ecliptic scene.

References:

- <https://ssd-api.jpl.nasa.gov/doc/horizons.html>
- <https://stereo-ssc.nascom.nasa.gov/coordinates_explanation.shtml>

Unknown coordinates remain unknown. A CME with no usable longitude is retained
in the event list but is not assigned a directed 3D cone.

## Planet ephemeris and fallback

Horizons requests use target IDs 199, 299, 399, 499, and 31, coordinate center
`500@10`, geometric vectors without light-time or aberration corrections, and
AU/day units. Each planet carries enough samples to draw one actual trajectory
revolution centered on any replay cursor. L1 is the dynamic Sun–Earth/Moon
barycenter L1 point, not a fixed fraction of Earth's heliocentric vector.

If exact Horizons data and its cache are unavailable, the renderer uses JPL's
published element-and-rate approximation. The higher-accuracy 1800–2050 table
is used inside that interval and the 3000 BC–3000 AD table otherwise. L1 then
uses a collinear three-body approximation. Every affected label is prefixed
with `≈`, orbit lines change color, and the scene reports an analytical
fallback. Outside the formula's documented validity a body is hidden.

Reference: <https://ssd.jpl.nasa.gov/planets/approx_pos.html>

## Spatial scale

The physical scene spans 0–2 AU and includes Mercury, Venus, Earth/L1, and Mars.
Celestial-body radii are enlarged and labeled as not to scale.

Two radial displays share the same physical state:

- Linear: `r′ = r`; this is the authoritative distance view.
- Compressed: `r′ = 2 × sqrt(r / 2)`.

The compressed transform maps 0–2 physical AU onto 0–2 display units, expands
the inner heliosphere, and preserves angular direction, but it does not preserve
relative distance. The scene displays a persistent warning in compressed mode.
Simulation time and travel calculations always use physical distances.

## Event visuals

### Coronal mass ejections

The preferred DONKI analysis is the most-accurate entry with usable time, speed,
width, latitude, and longitude. Its front begins at the reported `time21_5` and
21.5 solar radii. The core renderer uses constant-speed radial propagation:

`r(t) = 21.5 R☉ + v × (t - time21_5)`

The leading surface is rendered as a curved angular cap at `r(t)`. The reported
half-angle sets its major extent; `minorHalfWidth` and `tilt`, when supplied,
make and orient an elliptical cap. A faint inner cap, contour arcs, and sparse
replay-driven tracers provide depth and motion cues. These layers do not add
mass, magnetic structure, acceleration, or an inferred uncertainty.

This is a ballistic illustration, not ENLIL output. It is not modified to make a
forecast arrival appear accurate.

### Solar flares

A flare is placed on the solar surface only when its Stonyhurst source location
can be parsed. Its class maps to the conventional GOES peak-flux decade (A
through X), and the temporal pulse follows the reported begin, peak, and end
times. The surface hotspot, tangent pulse ring, and outward plume are display
layers at that one reported location, not a reconstruction of the coronal
magnetic field.

### High-speed streams

DONKI HSS records do not provide a full coronal-hole geometry. Parker-spiral
geometry is therefore not assigned to them. HSS, SEP, shock, and storm records
without real spatial coordinates remain available in the event list and detail
views but are absent from the 3D scene.

### Local solar-wind observations

OMNI observations are anchored at Earth and NOAA observations at the
Sun–Earth/Moon L1 point. Plasma and IMF use independent anchors because their
sources can transition at different timestamps. The marker is hidden when the
cursor is in a data gap or no location is known. A local measurement is never
painted as a heliosphere-wide field.

## Data classification

Every visible layer is one of:

- **Observed** — instrument or catalog measurement.
- **Forecast** — model output or predicted impact.
- **Derived** — a transparent calculation from measured values.
- **Illustrative** — explanatory geometry or animation.
