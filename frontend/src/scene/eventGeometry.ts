import * as THREE from 'three';

export interface CMEAngularShape {
    majorHalfAngle: number;
    minorHalfAngle: number;
    tilt: number;
}

export interface CMEStreakSeed {
    direction: THREE.Vector3;
    phase: number;
    speed: number;
}

const MIN_HALF_ANGLE_DEG = 2;
const MAX_HALF_ANGLE_DEG = 80;

export function cmeAngularShape(
    halfAngleDeg: number | undefined,
    minorHalfWidthDeg: number | undefined,
    tiltDeg: number | undefined,
): CMEAngularShape {
    const majorDeg = THREE.MathUtils.clamp(
        finiteOr(halfAngleDeg, 24),
        MIN_HALF_ANGLE_DEG,
        MAX_HALF_ANGLE_DEG,
    );
    const minorDeg = THREE.MathUtils.clamp(
        finiteOr(minorHalfWidthDeg, majorDeg),
        MIN_HALF_ANGLE_DEG,
        majorDeg,
    );
    return {
        majorHalfAngle: THREE.MathUtils.degToRad(majorDeg),
        minorHalfAngle: THREE.MathUtils.degToRad(minorDeg),
        tilt: THREE.MathUtils.degToRad(finiteOr(tiltDeg, 0)),
    };
}

export function cmeLocalDirection(
    shape: CMEAngularShape,
    radialFraction: number,
    azimuth: number,
): THREE.Vector3 {
    const radius = THREE.MathUtils.clamp(radialFraction, 0, 1);
    const majorOffset = Math.tan(shape.majorHalfAngle) * radius * Math.cos(azimuth);
    const minorOffset = Math.tan(shape.minorHalfAngle) * radius * Math.sin(azimuth);
    const cosTilt = Math.cos(shape.tilt);
    const sinTilt = Math.sin(shape.tilt);
    const x = majorOffset * cosTilt + minorOffset * sinTilt;
    const z = -majorOffset * sinTilt + minorOffset * cosTilt;
    return new THREE.Vector3(x, 1, z).normalize();
}

export function createCMECapGeometry(
    shape: CMEAngularShape,
    radialSegments = 9,
    angularSegments = 48,
): THREE.BufferGeometry {
    const rings = Math.max(1, Math.floor(radialSegments));
    const segments = Math.max(8, Math.floor(angularSegments));
    const positions: number[] = [0, 1, 0];
    const normals: number[] = [0, 1, 0];
    const uvs: number[] = [0.5, 0];
    const indices: number[] = [];

    for (let ring = 1; ring <= rings; ring++) {
        const radialFraction = ring / rings;
        for (let segment = 0; segment <= segments; segment++) {
            const azimuth = segment / segments * Math.PI * 2;
            const direction = cmeLocalDirection(shape, radialFraction, azimuth);
            positions.push(direction.x, direction.y, direction.z);
            normals.push(direction.x, direction.y, direction.z);
            uvs.push(segment / segments, radialFraction);
        }
    }

    for (let segment = 0; segment < segments; segment++) {
        indices.push(0, 1 + segment + 1, 1 + segment);
    }
    const stride = segments + 1;
    for (let ring = 1; ring < rings; ring++) {
        const innerStart = 1 + (ring - 1) * stride;
        const outerStart = innerStart + stride;
        for (let segment = 0; segment < segments; segment++) {
            const innerLeft = innerStart + segment;
            const innerRight = innerLeft + 1;
            const outerLeft = outerStart + segment;
            const outerRight = outerLeft + 1;
            indices.push(
                innerLeft, outerRight, outerLeft,
                innerLeft, innerRight, outerRight,
            );
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(uvs, 2),
    );
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

export function createCMEContourGeometry(
    shape: CMEAngularShape,
    angularSegments = 64,
): THREE.BufferGeometry {
    const segments = Math.max(16, Math.floor(angularSegments));
    const positions: number[] = [];
    const rings = [0.5, 0.76, 1];

    for (const radialFraction of rings) {
        for (let segment = 0; segment < segments; segment++) {
            const start = cmeLocalDirection(
                shape,
                radialFraction,
                segment / segments * Math.PI * 2,
            );
            const end = cmeLocalDirection(
                shape,
                radialFraction,
                (segment + 1) / segments * Math.PI * 2,
            );
            positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        }
    }

    for (let spoke = 0; spoke < 4; spoke++) {
        const azimuth = spoke / 4 * Math.PI * 2;
        for (let step = 0; step < 2; step++) {
            const start = cmeLocalDirection(shape, 0.18 + step * 0.4, azimuth);
            const end = cmeLocalDirection(shape, 0.18 + (step + 1) * 0.4, azimuth);
            positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeBoundingSphere();
    return geometry;
}

export function createCMEStreakSeeds(
    eventID: string,
    shape: CMEAngularShape,
    count = 30,
): CMEStreakSeed[] {
    const random = seededRandom(hashString(eventID));
    const seeds: CMEStreakSeed[] = [];
    for (let index = 0; index < count; index++) {
        const radialFraction = 0.14 + Math.sqrt(random()) * 0.76;
        const azimuth = random() * Math.PI * 2;
        seeds.push({
            direction: cmeLocalDirection(shape, radialFraction, azimuth),
            phase: random(),
            speed: 0.75 + random() * 0.5,
        });
    }
    return seeds;
}

function finiteOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function hashString(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0 || 1;
}

function seededRandom(initialSeed: number): () => number {
    let seed = initialSeed >>> 0;
    return () => {
        seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
        seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
        return ((seed ^ seed >>> 14) >>> 0) / 4_294_967_296;
    };
}
