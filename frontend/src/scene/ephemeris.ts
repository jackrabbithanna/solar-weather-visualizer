import * as THREE from 'three';
import {domain} from '../../wailsjs/go/models';

export const DAY_MS = 86_400_000;
export const BODY_IDS = {
    Mercury: '199',
    Venus: '299',
    Earth: '399',
    Mars: '499',
    L1: '31',
} as const;

export interface BodyPosition {
    position: THREE.Vector3;
    exact: boolean;
    source: string;
}

interface PreparedSample {
    time: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
}

interface PreparedTrajectory {
    samples: PreparedSample[];
    source: string;
}

interface ElementSet {
    semiMajorAU: [number, number];
    eccentricity: [number, number];
    inclinationDeg: [number, number];
    meanLongitudeDeg: [number, number];
    longitudePerihelionDeg: [number, number];
    longitudeNodeDeg: [number, number];
}

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const FALLBACK_MIN_MS = Date.UTC(-3000, 0, 1);
const FALLBACK_MAX_MS = Date.UTC(3001, 0, 1);
const MODERN_MIN_MS = Date.UTC(1800, 0, 1);
const MODERN_MAX_MS = Date.UTC(2051, 0, 1);
const MAX_EXACT_SAMPLE_GAP_MS = 1.5 * DAY_MS;
const EARTH_MOON_TO_SUN_MASS_RATIO = 3.040432648e-6;
const SEMB_L1_RADIAL_FRACTION = Math.cbrt(EARTH_MOON_TO_SUN_MASS_RATIO / 3);
const OBLIQUITY_J2000 = THREE.MathUtils.degToRad(84_381.448 / 3_600);
const SOLAR_NORTH_ECLIPTIC = solarNorthEcliptic();
const preparedTrajectories = new WeakMap<object, PreparedTrajectory>();

const modernElements: Record<string, ElementSet> = {
    [BODY_IDS.Mercury]: elements(
        [0.38709927, 0.00000037], [0.20563593, 0.00001906],
        [7.00497902, -0.00594749], [252.25032350, 149472.67411175],
        [77.45779628, 0.16047689], [48.33076593, -0.12534081],
    ),
    [BODY_IDS.Venus]: elements(
        [0.72333566, 0.00000390], [0.00677672, -0.00004107],
        [3.39467605, -0.00078890], [181.97909950, 58517.81538729],
        [131.60246718, 0.00268329], [76.67984255, -0.27769418],
    ),
    [BODY_IDS.Earth]: elements(
        [1.00000261, 0.00000562], [0.01671123, -0.00004392],
        [-0.00001531, -0.01294668], [100.46457166, 35999.37244981],
        [102.93768193, 0.32327364], [0, 0],
    ),
    [BODY_IDS.Mars]: elements(
        [1.52371034, 0.00001847], [0.09339410, 0.00007882],
        [1.84969142, -0.00813131], [-4.55343205, 19140.30268499],
        [-23.94362959, 0.44441088], [49.55953891, -0.29257343],
    ),
};

const longRangeElements: Record<string, ElementSet> = {
    [BODY_IDS.Mercury]: elements(
        [0.38709843, 0], [0.20563661, 0.00002123],
        [7.00559432, -0.00590158], [252.25166724, 149472.67486623],
        [77.45771895, 0.15940013], [48.33961819, -0.12214182],
    ),
    [BODY_IDS.Venus]: elements(
        [0.72332102, -0.00000026], [0.00676399, -0.00005107],
        [3.39777545, 0.00043494], [181.97970850, 58517.81560260],
        [131.76755713, 0.05679648], [76.67261496, -0.27274174],
    ),
    [BODY_IDS.Earth]: elements(
        [1.00000018, -0.00000003], [0.01673163, -0.00003661],
        [-0.00054346, -0.01337178], [100.46691572, 35999.37306329],
        [102.93005885, 0.31795260], [-5.11260389, -0.24123856],
    ),
    [BODY_IDS.Mars]: elements(
        [1.52371243, 0.00000097], [0.09336511, 0.00009149],
        [1.85181869, -0.00724757], [-4.56813164, 19140.29934243],
        [-23.91744784, 0.45223625], [49.71320984, -0.26852431],
    ),
};

export function bodyPositionAt(
    ephemeris: domain.EphemerisResult | undefined,
    bodyID: string,
    cursor: number,
): BodyPosition | undefined {
    const body = ephemeris?.bodies?.find((candidate) => candidate.id === bodyID);
    if (body) {
        const exact = interpolateBody(body, cursor);
        if (exact) {
            return {
                position: exact,
                exact: true,
                source: body.provenance?.dataset || 'NASA/JPL Horizons',
            };
        }
    }
    const fallback = approximateBodyPosition(bodyID, cursor);
    if (!fallback) return undefined;
    return {
        position: fallback,
        exact: false,
        source: 'JPL approximate elements',
    };
}

export function orbitPositionsAt(
    ephemeris: domain.EphemerisResult | undefined,
    bodyID: string,
    cursor: number,
    periodDays: number,
    pointCount = 256,
): {positions: THREE.Vector3[]; exact: boolean} {
    const positions: THREE.Vector3[] = [];
    let exact = true;
    const start = cursor - periodDays * DAY_MS / 2;
    const intervals = Math.max(1, pointCount - 1);
    for (let index = 0; index < pointCount; index++) {
        const time = start + periodDays * DAY_MS * index / intervals;
        const state = bodyPositionAt(ephemeris, bodyID, time);
        if (!state) continue;
        positions.push(state.position);
        exact = exact && state.exact;
    }
    return {positions, exact: exact && positions.length === pointCount};
}

export function heeqDirectionToEcliptic(
    latitudeDeg: number,
    longitudeDeg: number,
    earthPosition: THREE.Vector3,
): THREE.Vector3 | undefined {
    if (earthPosition.lengthSq() === 0) return undefined;
    const zAxis = SOLAR_NORTH_ECLIPTIC;
    const earthDirection = earthPosition.clone().normalize();
    const xAxis = earthDirection
        .addScaledVector(zAxis, -earthDirection.dot(zAxis));
    if (xAxis.lengthSq() < 1e-12) return undefined;
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const latitude = THREE.MathUtils.degToRad(latitudeDeg);
    const longitude = THREE.MathUtils.degToRad(longitudeDeg);
    const equatorialRadius = Math.cos(latitude);
    return xAxis.clone().multiplyScalar(equatorialRadius * Math.cos(longitude))
        .addScaledVector(yAxis, equatorialRadius * Math.sin(longitude))
        .addScaledVector(zAxis, Math.sin(latitude))
        .normalize();
}

export function eclipticToScene(vector: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(vector.x, vector.z, vector.y);
}

export function sceneToEcliptic(vector: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(vector.x, vector.z, vector.y);
}

function interpolateBody(
    body: domain.BodyEphemerisDTO,
    cursor: number,
): THREE.Vector3 | undefined {
    const trajectory = prepareTrajectory(body);
    const samples = trajectory.samples;
    if (samples.length < 2 || cursor < samples[0].time ||
        cursor > samples[samples.length - 1].time) {
        return undefined;
    }
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (samples[middle].time < cursor) low = middle + 1;
        else high = middle;
    }
    if (samples[low].time === cursor) return samples[low].position.clone();
    const right = samples[low];
    const left = samples[Math.max(0, low - 1)];
    const intervalMS = right.time - left.time;
    if (intervalMS <= 0 || intervalMS > MAX_EXACT_SAMPLE_GAP_MS) return undefined;
    const intervalDays = intervalMS / DAY_MS;
    const u = (cursor - left.time) / intervalMS;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return left.position.clone().multiplyScalar(h00)
        .addScaledVector(left.velocity, h10 * intervalDays)
        .addScaledVector(right.position, h01)
        .addScaledVector(right.velocity, h11 * intervalDays);
}

function prepareTrajectory(body: domain.BodyEphemerisDTO): PreparedTrajectory {
    const cached = preparedTrajectories.get(body);
    if (cached) return cached;
    const samples = (body.samples ?? [])
        .map((sample) => ({
            time: Date.parse(sample.time),
            position: new THREE.Vector3(sample.xAu, sample.yAu, sample.zAu),
            velocity: new THREE.Vector3(
                sample.vxAuPerDay,
                sample.vyAuPerDay,
                sample.vzAuPerDay,
            ),
        }))
        .filter((sample) =>
            Number.isFinite(sample.time) &&
            sample.position.toArray().every(Number.isFinite) &&
            sample.velocity.toArray().every(Number.isFinite))
        .sort((left, right) => left.time - right.time);
    const prepared = {
        samples,
        source: body.provenance?.dataset || 'NASA/JPL Horizons',
    };
    preparedTrajectories.set(body, prepared);
    return prepared;
}

function approximateBodyPosition(
    bodyID: string,
    cursor: number,
): THREE.Vector3 | undefined {
    if (cursor < FALLBACK_MIN_MS || cursor >= FALLBACK_MAX_MS) return undefined;
    if (bodyID === BODY_IDS.L1) {
        const earth = approximateBodyPosition(BODY_IDS.Earth, cursor);
        return earth?.multiplyScalar(1 - SEMB_L1_RADIAL_FRACTION);
    }
    const table = cursor >= MODERN_MIN_MS && cursor < MODERN_MAX_MS
        ? modernElements
        : longRangeElements;
    const definition = table[bodyID];
    if (!definition) return undefined;
    const centuries = (cursor - J2000_MS) / (DAY_MS * 36_525);
    const semiMajor = atCentury(definition.semiMajorAU, centuries);
    const eccentricity = atCentury(definition.eccentricity, centuries);
    const inclination = THREE.MathUtils.degToRad(
        atCentury(definition.inclinationDeg, centuries),
    );
    const meanLongitude = THREE.MathUtils.degToRad(
        atCentury(definition.meanLongitudeDeg, centuries),
    );
    const longitudePerihelion = THREE.MathUtils.degToRad(
        atCentury(definition.longitudePerihelionDeg, centuries),
    );
    const longitudeNode = THREE.MathUtils.degToRad(
        atCentury(definition.longitudeNodeDeg, centuries),
    );
    const meanAnomaly = normalizeRadians(meanLongitude - longitudePerihelion);
    let eccentricAnomaly = meanAnomaly;
    for (let iteration = 0; iteration < 12; iteration++) {
        eccentricAnomaly -= (
            eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly
        ) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    }
    const xOrbital = semiMajor * (Math.cos(eccentricAnomaly) - eccentricity);
    const yOrbital = semiMajor * Math.sqrt(1 - eccentricity ** 2) *
        Math.sin(eccentricAnomaly);
    const argumentPerihelion = longitudePerihelion - longitudeNode;
    const cosArgument = Math.cos(argumentPerihelion);
    const sinArgument = Math.sin(argumentPerihelion);
    const xPerihelion = xOrbital * cosArgument - yOrbital * sinArgument;
    const yPerihelion = xOrbital * sinArgument + yOrbital * cosArgument;
    return new THREE.Vector3(
        xPerihelion * Math.cos(longitudeNode) -
            yPerihelion * Math.cos(inclination) * Math.sin(longitudeNode),
        xPerihelion * Math.sin(longitudeNode) +
            yPerihelion * Math.cos(inclination) * Math.cos(longitudeNode),
        yPerihelion * Math.sin(inclination),
    );
}

function elements(
    semiMajorAU: [number, number],
    eccentricity: [number, number],
    inclinationDeg: [number, number],
    meanLongitudeDeg: [number, number],
    longitudePerihelionDeg: [number, number],
    longitudeNodeDeg: [number, number],
): ElementSet {
    return {
        semiMajorAU,
        eccentricity,
        inclinationDeg,
        meanLongitudeDeg,
        longitudePerihelionDeg,
        longitudeNodeDeg,
    };
}

function atCentury(pair: [number, number], centuries: number): number {
    return pair[0] + pair[1] * centuries;
}

function normalizeRadians(value: number): number {
    return ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) %
        (Math.PI * 2) - Math.PI;
}

function solarNorthEcliptic(): THREE.Vector3 {
    const rightAscension = THREE.MathUtils.degToRad(286.13);
    const declination = THREE.MathUtils.degToRad(63.87);
    const equatorial = new THREE.Vector3(
        Math.cos(declination) * Math.cos(rightAscension),
        Math.cos(declination) * Math.sin(rightAscension),
        Math.sin(declination),
    );
    return new THREE.Vector3(
        equatorial.x,
        Math.cos(OBLIQUITY_J2000) * equatorial.y +
            Math.sin(OBLIQUITY_J2000) * equatorial.z,
        -Math.sin(OBLIQUITY_J2000) * equatorial.y +
            Math.cos(OBLIQUITY_J2000) * equatorial.z,
    ).normalize();
}
