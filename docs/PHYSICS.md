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
- Planet positions use JPL’s approximate J2000 Keplerian elements. Mean anomaly
  advances by the documented sidereal period, Kepler’s equation is solved
  iteratively, and the orbital-plane result is rotated into the J2000 ecliptic
  frame. The coordinate module is responsible for explicit conversion before
  comparisons with HEEQ event directions.

Reference: <https://ssd.jpl.nasa.gov/planets/approx_pos.html>

Unknown coordinates remain unknown. A CME with no usable longitude is retained
in the event list but is not assigned a directed 3D cone.

## Spatial scale

The physical scene spans 0–2 AU and includes Mercury, Venus, Earth/L1, and Mars.
Celestial-body radii are enlarged and labeled as not to scale.

Two radial displays share the same physical state:

- Linear: `r′ = r`.
- Compressed: `r′ = 2 × sqrt(r / 2)`.

The compressed transform maps 0–2 physical AU onto 0–2 display units, expands
the inner heliosphere, and preserves angular direction. Simulation time and
travel calculations always use physical distances.

## Event visuals

### Coronal mass ejections

The preferred DONKI analysis is the most-accurate entry with usable time, speed,
width, latitude, and longitude. Its front begins at the reported `time21_5` and
21.5 solar radii. The core renderer uses constant-speed radial propagation:

`r(t) = 21.5 R☉ + v × (t - time21_5)`

This is a ballistic illustration, not ENLIL output. It is not modified to make a
forecast arrival appear accurate.

### Solar flares

A flare is placed on the solar surface only when its Stonyhurst source location
can be parsed. Its class maps to the conventional GOES peak-flux decade (A
through X), and the temporal pulse follows the reported begin, peak, and end
times.

### High-speed streams

DONKI HSS records do not provide a full coronal-hole geometry. Parker-spiral
bands are therefore illustrative and driven by measured or forecast wind speed.
An HSS annotation marks where and when the stream was observed or forecast; it
does not claim a reconstructed coronal-hole boundary.

## Data classification

Every visible layer is one of:

- **Observed** — instrument or catalog measurement.
- **Forecast** — model output or predicted impact.
- **Derived** — a transparent calculation from measured values.
- **Illustrative** — explanatory geometry or animation.
