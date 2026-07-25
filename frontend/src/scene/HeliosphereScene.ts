import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {domain} from '../../wailsjs/go/models';
import {AppState, nearestTelemetry} from '../state';

const AU_KM = 149_597_870.7;
const SOLAR_RADIUS_AU = 695_700 / AU_KM;

interface EventVisual {
    root: THREE.Object3D;
    event: domain.EventDTO;
}

interface PlanetVisual {
    name: string;
    elements: OrbitalElements;
    mesh: THREE.Mesh;
    label: THREE.Sprite;
}

interface OrbitalElements {
    semiMajorAU: number;
    eccentricity: number;
    inclinationDeg: number;
    meanLongitudeDeg: number;
    longitudePerihelionDeg: number;
    longitudeNodeDeg: number;
    periodDays: number;
}

export class HeliosphereScene {
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.002, 50);
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;
    private readonly root = new THREE.Group();
    private readonly eventLayer = new THREE.Group();
    private readonly windParticles: THREE.Points;
    private readonly planets: PlanetVisual[] = [];
    private readonly eventVisuals: EventVisual[] = [];
    private readonly windPhysicalRadii = new Float32Array(900);
    private readonly windAngles = new Float32Array(900);
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private state?: AppState;
    private eventsReference?: domain.EventSearchResult;
    private filterSignature = '';
    private scaleValue?: string;
    private lastWindTime = performance.now();
    private selectedEventID?: string;
    onEventSelected?: (id: string) => void;

    constructor(private readonly host: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.host.append(this.renderer.domElement);

        this.camera.position.set(1.8, 1.5, 2.5);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.055;
        this.controls.minDistance = 0.35;
        this.controls.maxDistance = 8;
        this.controls.target.set(0, 0, 0);

        this.scene.fog = new THREE.FogExp2(0x020711, 0.055);
        this.scene.add(this.root);
        this.root.add(this.eventLayer);
        this.addStars();
        this.addSun();
        this.addReferenceGrid();
        this.addPlanets();
        this.windParticles = this.addWindParticles();

        this.renderer.domElement.addEventListener('pointerdown', (event) => this.pick(event));
        new ResizeObserver(() => this.resize()).observe(host);
        this.resize();
    }

    setState(state: AppState): void {
        const nextFilterSignature = [...state.eventFilters].sort().join(',');
        const eventsChanged = this.eventsReference !== state.events ||
            this.filterSignature !== nextFilterSignature;
        const scaleChanged = this.scaleValue !== state.scale;
        this.state = state;
        this.eventsReference = state.events;
        this.filterSignature = nextFilterSignature;
        this.scaleValue = state.scale;
        if (eventsChanged) this.rebuildEvents();
        if (scaleChanged) this.updateOrbitGeometry();
        this.selectedEventID = state.selectedEventID;
    }

    render(time: number): void {
        if (!this.state) return;
        this.updatePlanets(this.state.cursor);
        this.updateEventVisuals(this.state.cursor);
        this.updateWind(time);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    screenshot(): string {
        this.renderer.render(this.scene, this.camera);
        return this.renderer.domElement.toDataURL('image/png');
    }

    focusEvent(id: string): void {
        const visual = this.eventVisuals.find((item) => item.event.id === id);
        if (!visual) return;
        const target = new THREE.Vector3();
        visual.root.getWorldPosition(target);
        if (target.length() < 0.08) target.set(0.1, 0, 0);
        this.controls.target.copy(target);
        const direction = this.camera.position.clone().sub(target).normalize();
        this.camera.position.copy(target).add(direction.multiplyScalar(0.65));
    }

    resetCamera(): void {
        this.camera.position.set(1.8, 1.5, 2.5);
        this.controls.target.set(0, 0, 0);
    }

    private resize(): void {
        const width = Math.max(1, this.host.clientWidth);
        const height = Math.max(1, this.host.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    private addStars(): void {
        const positions = new Float32Array(2_500 * 3);
        let seed = 7183;
        const random = (): number => {
            seed = (seed * 16_807) % 2_147_483_647;
            return seed / 2_147_483_647;
        };
        for (let index = 0; index < positions.length; index += 3) {
            const radius = 8 + random() * 12;
            const theta = random() * Math.PI * 2;
            const phi = Math.acos(2 * random() - 1);
            positions[index] = radius * Math.sin(phi) * Math.cos(theta);
            positions[index + 1] = radius * Math.cos(phi);
            positions[index + 2] = radius * Math.sin(phi) * Math.sin(theta);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.scene.add(new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
                color: 0xaecdf2,
                size: 0.018,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.7,
            }),
        ));
    }

    private addSun(): void {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: radialTexture(),
            color: 0xffa229,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        glow.scale.setScalar(0.22);
        this.root.add(glow);
        const sun = new THREE.Mesh(
            new THREE.SphereGeometry(0.036, 48, 32),
            new THREE.MeshBasicMaterial({color: 0xffc35a}),
        );
        sun.userData.label = 'Sun';
        this.root.add(sun);
        this.root.add(new THREE.PointLight(0xffbd71, 4, 10, 0.5));
    }

    private addReferenceGrid(): void {
        const geometry = new THREE.RingGeometry(1.995, 2.005, 160);
        const ring = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                color: 0x22445f,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide,
            }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.userData.physicalRadius = 2;
        ring.userData.referenceRing = true;
        this.root.add(ring);
        const axes = new THREE.AxesHelper(0.18);
        const material = axes.material as THREE.LineBasicMaterial;
        material.transparent = true;
        material.opacity = 0.25;
        this.root.add(axes);
    }

    private addPlanets(): void {
        const definitions: Array<[string, OrbitalElements, number]> = [
            ['Mercury', {
                semiMajorAU: 0.38709927, eccentricity: 0.20563593, inclinationDeg: 7.00497902,
                meanLongitudeDeg: 252.2503235, longitudePerihelionDeg: 77.45779628,
                longitudeNodeDeg: 48.33076593, periodDays: 87.969,
            }, 0xa8a7a3],
            ['Venus', {
                semiMajorAU: 0.72333566, eccentricity: 0.00677672, inclinationDeg: 3.39467605,
                meanLongitudeDeg: 181.9790995, longitudePerihelionDeg: 131.60246718,
                longitudeNodeDeg: 76.67984255, periodDays: 224.701,
            }, 0xe0b478],
            ['Earth', {
                semiMajorAU: 1.00000261, eccentricity: 0.01671123, inclinationDeg: -0.00001531,
                meanLongitudeDeg: 100.46457166, longitudePerihelionDeg: 102.93768193,
                longitudeNodeDeg: 0, periodDays: 365.256,
            }, 0x43a9ff],
            ['Mars', {
                semiMajorAU: 1.52371034, eccentricity: 0.0933941, inclinationDeg: 1.84969142,
                meanLongitudeDeg: -4.55343205, longitudePerihelionDeg: -23.94362959,
                longitudeNodeDeg: 49.55953891, periodDays: 686.98,
            }, 0xd36a4a],
        ];
        for (const [name, elements, color] of definitions) {
            const orbit = new THREE.LineLoop(
                this.planetOrbitGeometry(elements),
                new THREE.LineBasicMaterial({color: 0x35536b, transparent: true, opacity: 0.34}),
            );
            orbit.userData.planetOrbit = elements;
            this.root.add(orbit);
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(name === 'Earth' ? 0.014 : 0.011, 20, 14),
                new THREE.MeshBasicMaterial({color}),
            );
            mesh.userData.label = name;
            this.root.add(mesh);
            const label = makeLabel(name, name === 'Earth' ? '#aee8ff' : '#b8c8d8');
            this.root.add(label);
            this.planets.push({name, elements, mesh, label});
        }
        const l1 = makeLabel('L1', '#6de8dc');
        l1.userData.l1 = true;
        this.root.add(l1);
    }

    private addWindParticles(): THREE.Points {
        const count = 900;
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        for (let index = 0; index < count; index++) {
            seeds[index] = Math.random();
            const radius = Math.random() * 2;
            const angle = Math.random() * Math.PI * 2;
            this.windPhysicalRadii[index] = radius;
            this.windAngles[index] = angle;
            positions[index * 3] = Math.cos(angle) * this.displayRadius(radius);
            positions[index * 3 + 1] = (Math.random() - 0.5) * 0.08;
            positions[index * 3 + 2] = Math.sin(angle) * this.displayRadius(radius);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        const points = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
                color: 0x51d6c8,
                size: 0.007,
                transparent: true,
                opacity: 0.38,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        points.userData.wind = true;
        this.root.add(points);
        return points;
    }

    private rebuildEvents(): void {
        this.eventLayer.clear();
        this.eventVisuals.length = 0;
        const events = this.state?.events?.events ?? [];
        for (const event of events) {
            if (!this.state?.eventFilters.has(event.kind)) continue;
            const root = new THREE.Group();
            root.userData.eventId = event.id;
            if (event.kind === 'cme' && event.cme?.directionKnown) {
                const shell = new THREE.Mesh(
                    new THREE.ConeGeometry(1, 1, 48, 1, true),
                    new THREE.MeshBasicMaterial({
                        color: 0x4bd9ff,
                        transparent: true,
                        opacity: 0.19,
                        wireframe: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    }),
                );
                shell.userData.eventId = event.id;
                root.add(shell);
                const front = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialTexture(),
                    color: 0x77e6ff,
                    transparent: true,
                    opacity: 0.52,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                }));
                front.userData.eventId = event.id;
                root.add(front);
            } else if (event.kind === 'flare' && event.flare?.locationParsed) {
                const flare = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialTexture(),
                    color: 0xffd37a,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                }));
                flare.scale.setScalar(0.09);
                flare.userData.eventId = event.id;
                root.add(flare);
            } else if (event.kind === 'hss') {
                const spiral = new THREE.Line(
                    this.parkerSpiralGeometry(),
                    new THREE.LineBasicMaterial({
                        color: 0x81e78c,
                        transparent: true,
                        opacity: 0.5,
                    }),
                );
                spiral.userData.eventId = event.id;
                spiral.userData.hssSpiral = true;
                root.add(spiral);
            } else {
                const marker = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialTexture(),
                    color: event.kind === 'storm' ? 0xe785ff : 0xff8f61,
                    transparent: true,
                    opacity: 0.75,
                }));
                marker.scale.setScalar(0.06);
                marker.position.set(this.displayRadius(1), 0, 0);
                marker.userData.eventId = event.id;
                marker.userData.physicalRadius = 1;
                root.add(marker);
            }
            this.eventLayer.add(root);
            this.eventVisuals.push({root, event});
        }
    }

    private updateEventVisuals(cursor: number): void {
        for (const visual of this.eventVisuals) {
            const eventTime = Date.parse(visual.event.startTime);
            const active = cursor >= eventTime;
            visual.root.visible = active;
            if (!active) continue;
            visual.root.scale.setScalar(visual.event.id === this.selectedEventID ? 1.14 : 1);
            if (visual.event.kind === 'cme' && visual.event.cme) {
                this.updateCME(visual, cursor);
            } else if (visual.event.kind === 'flare' && visual.event.flare) {
                this.updateFlare(visual, cursor);
            } else if (visual.event.kind === 'hss') {
                visual.root.rotation.y = cursor / 86_400_000 * 0.24;
            }
        }
    }

    private updateCME(visual: EventVisual, cursor: number): void {
        const cme = visual.event.cme;
        if (!cme?.speedKms || cme.latitudeDeg === undefined || cme.longitudeDeg === undefined) return;
        const analysis = Date.parse(cme.analysisTime || visual.event.startTime);
        const elapsedSeconds = Math.max(0, (cursor - analysis) / 1_000);
        const physicalRadius = Math.min(2.2, 21.5 * SOLAR_RADIUS_AU + cme.speedKms * elapsedSeconds / AU_KM);
        if (physicalRadius > 2.05) {
            visual.root.visible = false;
            return;
        }
        const length = this.displayRadius(physicalRadius);
        const halfAngle = THREE.MathUtils.degToRad(Math.min(80, cme.halfAngleDeg ?? 24));
        const base = Math.max(0.015, Math.tan(halfAngle) * length);
        const direction = sphericalDirection(cme.latitudeDeg, cme.longitudeDeg);
        const shell = visual.root.children[0];
        shell.scale.set(base, length, base);
        shell.position.copy(direction).multiplyScalar(length / 2);
        // ConeGeometry's tip is +Y. Aim that tip back at the Sun so the broad
        // edge is the outward-moving front.
        shell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().negate());
        const front = visual.root.children[1] as THREE.Sprite | undefined;
        if (front) {
            front.position.copy(direction).multiplyScalar(length);
            front.scale.setScalar(Math.max(0.035, base * 1.7));
        }
    }

    private updateFlare(visual: EventVisual, cursor: number): void {
        const flare = visual.event.flare;
        if (!flare || flare.latitudeDeg === undefined || flare.longitudeDeg === undefined) return;
        const start = Date.parse(visual.event.startTime);
        const peak = Date.parse(flare.peakTime || visual.event.startTime);
        const end = Date.parse(flare.endTime || visual.event.endTime || flare.peakTime || visual.event.startTime);
        if (cursor > end + 90 * 60_000) {
            visual.root.visible = false;
            return;
        }
        const direction = sphericalDirection(flare.latitudeDeg, flare.longitudeDeg);
        visual.root.position.copy(direction).multiplyScalar(0.042);
        const attack = Math.max(1, peak - start);
        const release = Math.max(1, end - peak);
        const strength = cursor <= peak ? (cursor - start) / attack : 1 - (cursor - peak) / release;
        const pulse = Math.max(0.15, Math.min(1, strength));
        visual.root.scale.setScalar(0.6 + pulse * 0.7);
    }

    private updatePlanets(cursor: number): void {
        for (const planet of this.planets) {
            const physicalPosition = orbitalPosition(planet.elements, cursor);
            planet.mesh.position.copy(this.mapPhysicalVector(physicalPosition));
            planet.label.position.copy(planet.mesh.position).add(new THREE.Vector3(0, 0.035, 0));
        }
        const earth = this.planets.find((planet) => planet.name === 'Earth');
        const l1 = this.root.children.find((item) => item.userData.l1);
        if (earth && l1) {
            l1.position.copy(earth.mesh.position).multiplyScalar(0.99).add(new THREE.Vector3(0, -0.03, 0));
        }
    }

    private updateWind(time: number): void {
        const points = nearestTelemetry(this.state?.telemetry?.points ?? this.state?.live?.recent, this.state?.cursor ?? 0);
        const speed = points?.speedKms ?? this.state?.live?.speedKms ?? 400;
        const positions = this.windParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
        const elapsed = Math.min(0.1, Math.max(0, (time - this.lastWindTime) / 1_000));
        this.lastWindTime = time;
        // The visual flow is accelerated, but radial motion remains outward and
        // its relative rate follows the selected measured speed.
        const velocity = (speed / 400) * 0.025 * elapsed;
        for (let index = 0; index < positions.count; index++) {
            const next = (this.windPhysicalRadii[index] + velocity) % 2;
            this.windPhysicalRadii[index] = next;
            const angle = this.windAngles[index];
            positions.setX(index, Math.cos(angle) * this.displayRadius(next));
            positions.setZ(index, Math.sin(angle) * this.displayRadius(next));
        }
        positions.needsUpdate = true;
        const material = this.windParticles.material as THREE.PointsMaterial;
        const bz = points?.bzGsmNt ?? this.state?.live?.bzGsmNt ?? 0;
        material.color.set(bz < -5 ? 0xff6f76 : 0x51d6c8);
    }

    private updateOrbitGeometry(): void {
        for (const object of this.root.children) {
            const elements = object.userData.planetOrbit as OrbitalElements | undefined;
            if (elements) {
                (object as THREE.Line).geometry.dispose();
                (object as THREE.Line).geometry = this.planetOrbitGeometry(elements);
                continue;
            }
            const physical = object.userData.physicalRadius as number | undefined;
            if (physical === undefined) continue;
            if (object.userData.referenceRing) {
                const radius = this.displayRadius(physical);
                object.scale.setScalar(radius / 2);
            }
        }
        for (const visual of this.eventVisuals) {
            for (const object of visual.root.children) {
                if (object.userData.hssSpiral) {
                    (object as THREE.Line).geometry.dispose();
                    (object as THREE.Line).geometry = this.parkerSpiralGeometry();
                }
                const physical = object.userData.physicalRadius as number | undefined;
                if (physical !== undefined) object.position.set(this.displayRadius(physical), 0, 0);
            }
        }
    }

    private planetOrbitGeometry(elements: OrbitalElements): THREE.BufferGeometry {
        const points: THREE.Vector3[] = [];
        for (let index = 0; index < 180; index++) {
            points.push(this.mapPhysicalVector(orbitalPositionFromMean(
                elements,
                index / 180 * Math.PI * 2,
            )));
        }
        return new THREE.BufferGeometry().setFromPoints(points);
    }

    private mapPhysicalVector(vector: THREE.Vector3): THREE.Vector3 {
        const radius = vector.length();
        return radius === 0
            ? vector.clone()
            : vector.clone().multiplyScalar(this.displayRadius(radius) / radius);
    }

    private parkerSpiralGeometry(): THREE.BufferGeometry {
        const points: THREE.Vector3[] = [];
        for (let index = 0; index <= 180; index++) {
            const physicalRadius = 0.07 + index / 180 * 1.65;
            const radius = this.displayRadius(physicalRadius);
            const angle = index / 180 * Math.PI * 1.7;
            points.push(new THREE.Vector3(
                Math.cos(angle) * radius,
                0.018 * Math.sin(angle * 3),
                Math.sin(angle) * radius,
            ));
        }
        return new THREE.BufferGeometry().setFromPoints(points);
    }

    private displayRadius(physicalAU: number): number {
        return this.state?.scale === 'compressed'
            ? 2 * Math.sqrt(Math.max(0, physicalAU) / 2)
            : physicalAU;
    }

    private pick(event: PointerEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.eventLayer.children, true);
        const id = hits.find((hit) => hit.object.userData.eventId)?.object.userData.eventId as string | undefined;
        if (id) this.onEventSelected?.(id);
    }
}

function orbitalPosition(elements: OrbitalElements, cursor: number): THREE.Vector3 {
    const j2000 = Date.UTC(2000, 0, 1, 12);
    const days = (cursor - j2000) / 86_400_000;
    const meanLongitude = THREE.MathUtils.degToRad(
        elements.meanLongitudeDeg + days / elements.periodDays * 360,
    );
    const meanAnomaly = meanLongitude - THREE.MathUtils.degToRad(elements.longitudePerihelionDeg);
    return orbitalPositionFromMean(elements, meanAnomaly);
}

function orbitalPositionFromMean(elements: OrbitalElements, meanAnomaly: number): THREE.Vector3 {
    let eccentricAnomaly = meanAnomaly;
    for (let iteration = 0; iteration < 8; iteration++) {
        eccentricAnomaly -= (
            eccentricAnomaly - elements.eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly
        ) / (1 - elements.eccentricity * Math.cos(eccentricAnomaly));
    }
    const xOrbital = elements.semiMajorAU * (Math.cos(eccentricAnomaly) - elements.eccentricity);
    const yOrbital = elements.semiMajorAU * Math.sqrt(1 - elements.eccentricity ** 2) * Math.sin(eccentricAnomaly);
    const node = THREE.MathUtils.degToRad(elements.longitudeNodeDeg);
    const inclination = THREE.MathUtils.degToRad(elements.inclinationDeg);
    const argumentPerihelion = THREE.MathUtils.degToRad(
        elements.longitudePerihelionDeg - elements.longitudeNodeDeg,
    );
    const cosArgument = Math.cos(argumentPerihelion);
    const sinArgument = Math.sin(argumentPerihelion);
    const xPerihelion = xOrbital * cosArgument - yOrbital * sinArgument;
    const yPerihelion = xOrbital * sinArgument + yOrbital * cosArgument;
    const xEcliptic = xPerihelion * Math.cos(node) - yPerihelion * Math.cos(inclination) * Math.sin(node);
    const yEcliptic = xPerihelion * Math.sin(node) + yPerihelion * Math.cos(inclination) * Math.cos(node);
    const zEcliptic = yPerihelion * Math.sin(inclination);
    // Three.js uses Y as scene-up; J2000 ecliptic X/Y map to scene X/Z.
    return new THREE.Vector3(xEcliptic, zEcliptic, yEcliptic);
}

function sphericalDirection(latitudeDegrees: number, longitudeDegrees: number): THREE.Vector3 {
    const latitude = THREE.MathUtils.degToRad(latitudeDegrees);
    const longitude = THREE.MathUtils.degToRad(longitudeDegrees);
    return new THREE.Vector3(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
    ).normalize();
}

function radialTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.18, 'rgba(255,255,255,.8)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,.18)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(canvas);
}

function makeLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
        context.font = '500 28px Inter, sans-serif';
        context.textAlign = 'center';
        context.fillStyle = color;
        context.fillText(text, 128, 38);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
    }));
    sprite.scale.set(0.13, 0.0325, 1);
    return sprite;
}
