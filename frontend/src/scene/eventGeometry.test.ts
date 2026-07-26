import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {
    cmeAngularShape,
    cmeLocalDirection,
    createCMECapGeometry,
    createCMEContourGeometry,
    createCMEStreakSeeds,
} from './eventGeometry';

describe('CME event geometry', () => {
    it('preserves the reported major and minor angular extents', () => {
        const shape = cmeAngularShape(48, 22, 31);
        const major = cmeLocalDirection(shape, 1, 0);
        const minor = cmeLocalDirection(shape, 1, Math.PI / 2);
        const axis = new THREE.Vector3(0, 1, 0);

        expect(THREE.MathUtils.radToDeg(axis.angleTo(major))).toBeCloseTo(48, 10);
        expect(THREE.MathUtils.radToDeg(axis.angleTo(minor))).toBeCloseTo(22, 10);
        expect(shape.tilt).toBeCloseTo(THREE.MathUtils.degToRad(31), 12);
    });

    it('uses bounded circular fallback values for incomplete analyses', () => {
        const fallback = cmeAngularShape(undefined, undefined, undefined);
        expect(THREE.MathUtils.radToDeg(fallback.majorHalfAngle)).toBeCloseTo(24, 12);
        expect(fallback.minorHalfAngle).toBe(fallback.majorHalfAngle);
        expect(fallback.tilt).toBe(0);

        const bounded = cmeAngularShape(120, 95, Number.NaN);
        expect(THREE.MathUtils.radToDeg(bounded.majorHalfAngle)).toBeCloseTo(80, 12);
        expect(bounded.minorHalfAngle).toBe(bounded.majorHalfAngle);
        expect(bounded.tilt).toBe(0);
    });

    it('builds a curved indexed cap and a sparse contour overlay', () => {
        const shape = cmeAngularShape(40, 20, -15);
        const cap = createCMECapGeometry(shape, 4, 16);
        const contours = createCMEContourGeometry(shape, 24);
        const capPositions = cap.getAttribute('position');
        const contourPositions = contours.getAttribute('position');

        expect(capPositions.count).toBe(1 + 4 * 17);
        expect(cap.index?.count).toBe(16 * 3 + 3 * 16 * 6);
        expect(contourPositions.count).toBeGreaterThan(24 * 3 * 2);

        for (let index = 0; index < capPositions.count; index++) {
            const radius = new THREE.Vector3().fromBufferAttribute(capPositions, index).length();
            expect(radius).toBeCloseTo(1, 6);
        }
        const indices = cap.index;
        expect(indices).toBeDefined();
        const a = new THREE.Vector3().fromBufferAttribute(capPositions, indices?.getX(0) ?? 0);
        const b = new THREE.Vector3().fromBufferAttribute(capPositions, indices?.getX(1) ?? 0);
        const c = new THREE.Vector3().fromBufferAttribute(capPositions, indices?.getX(2) ?? 0);
        const faceNormal = new THREE.Vector3()
            .crossVectors(b.clone().sub(a), c.clone().sub(a))
            .normalize();
        expect(faceNormal.dot(a.clone().add(b).add(c).normalize())).toBeGreaterThan(0);
    });

    it('creates stable event-specific tracer layouts', () => {
        const shape = cmeAngularShape(50, 28, 12);
        const first = createCMEStreakSeeds('2026-07-25T00:00:00-CME-001', shape, 8);
        const second = createCMEStreakSeeds('2026-07-25T00:00:00-CME-001', shape, 8);
        const other = createCMEStreakSeeds('different-event', shape, 8);

        expect(first.map(seedValues)).toEqual(second.map(seedValues));
        expect(first.map(seedValues)).not.toEqual(other.map(seedValues));
        for (const seed of first) {
            expect(seed.direction.length()).toBeCloseTo(1, 12);
            expect(seed.direction.angleTo(new THREE.Vector3(0, 1, 0)))
                .toBeLessThanOrEqual(shape.majorHalfAngle);
        }
    });
});

function seedValues(seed: {
    direction: THREE.Vector3;
    phase: number;
    speed: number;
}): number[] {
    return [
        seed.direction.x,
        seed.direction.y,
        seed.direction.z,
        seed.phase,
        seed.speed,
    ];
}
