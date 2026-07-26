import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {domain} from '../../wailsjs/go/models';
import {
    BODY_IDS,
    bodyPositionAt,
    heeqDirectionToEcliptic,
} from './ephemeris';

const AU_KM = 149_597_870.7;
const START = '2026-07-24T00:00:00Z';
const MIDDLE = '2026-07-24T12:00:00Z';
const END = '2026-07-25T00:00:00Z';

interface ValidationVector {
    id: string;
    start: number[];
    middle: number[];
    end: number[];
}

const validationVectors: ValidationVector[] = [
    {
        id: BODY_IDS.Mercury,
        start: [
            3.323967256971490e-1, -2.167662401047300e-1, -4.820126765261849e-2,
            9.838288461631093e-3, 2.485937704981047e-2, 1.129268220757566e-3,
        ],
        middle: [3.371211347550873e-1, -2.042126081822706e-1, -4.760864391050600e-2],
        end: [
            3.414469978056129e-1, -1.914176187620651e-1, -4.695974211766032e-2,
            8.244079720914411e-3, 2.582456950794211e-2, 1.354363277968522e-3,
        ],
    },
    {
        id: BODY_IDS.Venus,
        start: [
            -3.157358331748283e-1, -6.527848340076789e-1, 9.249153763907662e-3,
            1.806903123744560e-2, -8.896578792705180e-3, -1.164797420024465e-3,
        ],
        middle: [-3.066709900701229e-1, -6.571696741550028e-1, 8.665876918830027e-3],
        end: [
            -2.975466763355738e-1, -6.614270750958186e-1, 8.080919568298005e-3,
            1.830691025129615e-2, -8.386830278955492e-3, -1.171519353781349e-3,
        ],
    },
    {
        id: BODY_IDS.Earth,
        start: [
            5.197950505732578e-1, -8.727550396189715e-1, 5.227851329283125e-5,
            1.449692973544260e-2, 8.742311630387599e-3, -5.886472102371760e-7,
        ],
        middle: [5.270249970090380e-1, -8.683532993795791e-1, 5.196538107426309e-5],
        end: [
            5.342175867725815e-1, -8.638906031480599e-1, 5.161487547797100e-5,
            1.434750423178016e-2, 8.986135283636006e-3, -7.380355393487712e-7,
        ],
    },
    {
        id: BODY_IDS.Mars,
        start: [
            9.672768403501301e-1, 1.106357125551283, -5.328564859901772e-4,
            -1.000215523187036e-2, 1.040389155358357e-2, 4.632887359475137e-4,
        ],
        middle: [9.622645134141594e-1, 1.111546162477012, -3.012068054279303e-4],
        end: [
            9.572297848295890e-1, 1.116709323251035, -6.955011056286688e-5,
            -1.009176178293353e-2, 1.030038725483831e-2, 4.633168121136643e-4,
        ],
    },
    {
        id: BODY_IDS.L1,
        start: [
            5.145747650534199e-1, -8.640456634680860e-1, 4.880744841967376e-5,
            1.435750280615808e-2, 8.651208320058532e-3, -6.039164953557268e-7,
        ],
        middle: [5.217352740730239e-1, -8.596896201986830e-1, 4.850376832431650e-5],
        end: [
            5.288589586113670e-1, -8.552728990583095e-1, 4.819665865050445e-5,
            1.421020566153621e-2, 8.893918417210760e-3, -6.176347275026152e-7,
        ],
    },
];

describe('ephemeris interpolation', () => {
    it.each(validationVectors)(
        'stays within 100 km of a withheld Horizons midpoint for $id',
        (vector) => {
            const ephemeris = resultFor(vector);
            const state = bodyPositionAt(ephemeris, vector.id, Date.parse(MIDDLE));
            expect(state?.exact).toBe(true);
            const expected = new THREE.Vector3(
                vector.middle[0],
                vector.middle[1],
                vector.middle[2],
            );
            const errorKM = (state?.position.distanceTo(expected) ?? Infinity) * AU_KM;
            expect(errorKM).toBeLessThan(100);
        },
    );

    it('uses a marked analytical fallback when exact samples are absent', () => {
        const state = bodyPositionAt(undefined, BODY_IDS.Earth, Date.parse(MIDDLE));
        expect(state?.exact).toBe(false);
        expect(state?.source).toContain('approximate');
        expect(state?.position.length()).toBeGreaterThan(0.98);
        expect(state?.position.length()).toBeLessThan(1.02);
    });

    it('constructs an orthonormal, Earth-referenced HEEQ basis', () => {
        const earth = new THREE.Vector3(0.6, -0.8, 0.01);
        const x = heeqDirectionToEcliptic(0, 0, earth);
        const y = heeqDirectionToEcliptic(0, 90, earth);
        const north = heeqDirectionToEcliptic(90, 0, earth);
        expect(x?.length()).toBeCloseTo(1, 12);
        expect(y?.length()).toBeCloseTo(1, 12);
        expect(north?.length()).toBeCloseTo(1, 12);
        expect(Math.abs(x?.dot(y as THREE.Vector3) as number)).toBeLessThan(1e-12);
        expect(Math.abs(x?.dot(north as THREE.Vector3) as number)).toBeLessThan(1e-12);
        expect(new THREE.Vector3().crossVectors(
            x as THREE.Vector3,
            y as THREE.Vector3,
        ).dot(north as THREE.Vector3)).toBeCloseTo(1, 12);
    });
});

function resultFor(vector: ValidationVector): domain.EphemerisResult {
    return new domain.EphemerisResult({
        query: {start: START, end: END},
        center: 'Sun body center (10)',
        coordinateFrame: 'J2000 ecliptic',
        bodies: [new domain.BodyEphemerisDTO({
            id: vector.id,
            name: vector.id,
            kind: vector.id === BODY_IDS.L1 ? 'lagrange-point' : 'planet',
            coverageStart: START,
            coverageEnd: END,
            samples: [
                sample(START, vector.start),
                sample(END, vector.end),
            ],
            provenance: {
                provider: 'NASA/JPL Horizons',
                dataset: 'Horizons DE441',
                retrievedAt: '2026-07-25T00:00:00Z',
                class: 'derived',
                cached: false,
                stale: false,
            },
        })],
        generatedAt: '2026-07-25T00:00:00Z',
    });
}

function sample(time: string, vector: number[]): domain.EphemerisSample {
    return new domain.EphemerisSample({
        time,
        xAu: vector[0],
        yAu: vector[1],
        zAu: vector[2],
        vxAuPerDay: vector[3],
        vyAuPerDay: vector[4],
        vzAuPerDay: vector[5],
    });
}
