import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {domain} from '../../wailsjs/go/models';
import {AppState, telemetryAtCursor} from '../state';
import {
    BODY_IDS,
    bodyPositionAt,
    eclipticToScene,
    heeqDirectionToEcliptic,
    orbitPositionsAt,
} from './ephemeris';
import {
    CMEStreakSeed,
    cmeAngularShape,
    createCMECapGeometry,
    createCMEContourGeometry,
    createCMEStreakSeeds,
} from './eventGeometry';

const AU_KM = 149_597_870.7;
const SOLAR_RADIUS_AU = 695_700 / AU_KM;
const CME_START_RADIUS_AU = 21.5 * SOLAR_RADIUS_AU;
const SELECTED_EVENT_COLOR = new THREE.Color(0xfff1aa);
const EVENT_AXIS = new THREE.Vector3(0, 1, 0);

interface EventMaterial {
    material: THREE.Material;
    opacity: number;
    color?: THREE.Color;
    opacityUniform?: {value: number};
    colorUniform?: {value: THREE.Color};
}

interface CMEVisualParts {
    group: THREE.Group;
    front: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    sheath: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    contours: THREE.LineSegments;
    streaks: THREE.LineSegments;
    pickProxy: THREE.Mesh;
    streakSeeds: CMEStreakSeed[];
    label: THREE.Sprite;
    forecastHalo: THREE.Sprite;
}

interface FlareVisualParts {
    group: THREE.Group;
    hotspot: THREE.Mesh;
    plume: THREE.Mesh;
    pulseRing: THREE.Mesh;
    glow: THREE.Sprite;
}

interface EventVisual {
    root: THREE.Group;
    content: THREE.Group;
    materials: EventMaterial[];
    event: domain.EventDTO;
    cme?: CMEVisualParts;
    flare?: FlareVisualParts;
}

interface PlanetVisual {
    id: string;
    name: string;
    periodDays: number;
    mesh: THREE.Mesh;
    exactLabel: THREE.Sprite;
    approximateLabel: THREE.Sprite;
    orbit: THREE.Line;
}

export class HeliosphereScene {
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.002, 50);
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;
    private readonly root = new THREE.Group();
    private readonly eventLayer = new THREE.Group();
    private readonly planets: PlanetVisual[] = [];
    private readonly eventVisuals: EventVisual[] = [];
    private readonly plasmaIndicator: THREE.Sprite;
    private readonly imfIndicator: THREE.Sprite;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private l1Marker?: THREE.Mesh;
    private l1ExactLabel?: THREE.Sprite;
    private l1ApproximateLabel?: THREE.Sprite;
    private state?: AppState;
    private eventsReference?: domain.EventSearchResult;
    private filterSignature = '';
    private scaleValue?: string;
    private selectedEventID?: string;
    private pickOrigin?: {pointerId: number; x: number; y: number};
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
        this.raycaster.params.Line.threshold = 0.02;

        this.scene.fog = new THREE.FogExp2(0x020711, 0.055);
        this.scene.add(this.root);
        this.root.add(this.eventLayer);
        this.addStars();
        this.addSun();
        this.addReferenceGrid();
        this.addPlanets();
        [this.plasmaIndicator, this.imfIndicator] = this.addLocalTelemetryIndicators();

        this.renderer.domElement.addEventListener('pointerdown', (event) => this.beginPick(event));
        this.renderer.domElement.addEventListener('pointerup', (event) => this.completePick(event));
        this.renderer.domElement.addEventListener('pointercancel', (event) => this.cancelPick(event));
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
        if (scaleChanged) this.updateScaleGeometry();
        this.selectedEventID = state.selectedEventID;
    }

    render(_time: number): void {
        if (!this.state) return;
        this.updatePlanets(this.state.cursor);
        this.updateEventVisuals(this.state.cursor);
        this.updateLocalTelemetry(this.state.cursor);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    screenshot(): string {
        this.renderer.render(this.scene, this.camera);
        return this.renderer.domElement.toDataURL('image/png');
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
        const definitions: Array<[string, string, number, number]> = [
            [BODY_IDS.Mercury, 'Mercury', 87.969, 0xa8a7a3],
            [BODY_IDS.Venus, 'Venus', 224.701, 0xe0b478],
            [BODY_IDS.Earth, 'Earth', 365.256, 0x43a9ff],
            [BODY_IDS.Mars, 'Mars', 686.98, 0xd36a4a],
        ];
        for (const [id, name, periodDays, color] of definitions) {
            const orbitGeometry = new THREE.BufferGeometry();
            orbitGeometry.setAttribute(
                'position',
                new THREE.BufferAttribute(new Float32Array(256 * 3), 3)
                    .setUsage(THREE.DynamicDrawUsage),
            );
            const orbit = new THREE.Line(
                orbitGeometry,
                new THREE.LineBasicMaterial({color: 0x35536b, transparent: true, opacity: 0.34}),
            );
            this.root.add(orbit);
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(name === 'Earth' ? 0.014 : 0.011, 20, 14),
                new THREE.MeshBasicMaterial({color}),
            );
            mesh.userData.label = name;
            this.root.add(mesh);
            const exactLabel = makeLabel(name, name === 'Earth' ? '#aee8ff' : '#b8c8d8');
            const approximateLabel = makeLabel(`≈ ${name}`, '#f0bd73');
            this.root.add(exactLabel, approximateLabel);
            this.planets.push({
                id,
                name,
                periodDays,
                mesh,
                exactLabel,
                approximateLabel,
                orbit,
            });
        }
        this.l1Marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.006, 14, 10),
            new THREE.MeshBasicMaterial({color: 0x6de8dc}),
        );
        this.l1Marker.userData.label = 'Sun–EMB L1';
        this.l1ExactLabel = makeLabel('L1 · Sun–EMB', '#6de8dc');
        this.l1ApproximateLabel = makeLabel('≈ L1 · Sun–EMB', '#f0bd73');
        this.root.add(this.l1Marker, this.l1ExactLabel, this.l1ApproximateLabel);
    }

    private addLocalTelemetryIndicators(): [THREE.Sprite, THREE.Sprite] {
        const plasma = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: radialTexture(),
                color: 0x51d6c8,
                transparent: true,
                opacity: 0.48,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        plasma.scale.setScalar(0.075);
        plasma.userData.label = 'Local plasma observation';
        const imf = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: radialTexture(),
                color: 0x8ddfff,
                transparent: true,
                opacity: 0.58,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        imf.scale.setScalar(0.048);
        imf.userData.label = 'Local IMF observation';
        this.root.add(plasma, imf);
        return [plasma, imf];
    }

    private rebuildEvents(): void {
        for (const visual of this.eventVisuals) disposeObject(visual.root);
        this.eventLayer.clear();
        this.eventVisuals.length = 0;
        const events = this.state?.events?.events ?? [];
        for (const event of events) {
            if (!this.state?.eventFilters.has(event.kind)) continue;
            const root = new THREE.Group();
            const content = new THREE.Group();
            root.userData.eventId = event.id;
            root.add(content);
            let cme: CMEVisualParts | undefined;
            let flare: FlareVisualParts | undefined;
            if (event.kind === 'cme' && event.cme?.directionKnown &&
                event.cme.speedKms && event.cme.latitudeDeg !== undefined &&
                event.cme.longitudeDeg !== undefined) {
                cme = this.createCMEVisual(event, content);
            } else if (event.kind === 'flare' && event.flare?.locationParsed &&
                event.flare.latitudeDeg !== undefined && event.flare.longitudeDeg !== undefined) {
                flare = this.createFlareVisual(event, content);
            } else {
                // Catalog records without a real spatial coordinate remain in
                // the event list, but are not assigned invented 3D geometry.
                continue;
            }
            this.eventLayer.add(root);
            this.eventVisuals.push({
                root,
                content,
                materials: collectEventMaterials(content),
                event,
                cme,
                flare,
            });
        }
    }

    private createCMEVisual(event: domain.EventDTO, content: THREE.Group): CMEVisualParts {
        const cme = event.cme;
        const shape = cmeAngularShape(
            cme?.halfAngleDeg,
            cme?.minorHalfWidthDeg,
            cme?.tiltDeg,
        );
        const capGeometry = createCMECapGeometry(shape);
        const group = new THREE.Group();
        group.userData.eventId = event.id;
        content.add(group);

        const sheathMaterial = makeCMESurfaceMaterial(0x1b566f, 0.012, 0.35);
        const sheath = new THREE.Mesh(capGeometry, sheathMaterial);
        sheath.renderOrder = 3;
        sheath.userData.eventId = event.id;
        group.add(sheath);

        const frontMaterial = makeCMESurfaceMaterial(0x3aa8c5, 0.035, 1);
        const front = new THREE.Mesh(capGeometry, frontMaterial);
        front.renderOrder = 5;
        front.userData.eventId = event.id;
        group.add(front);

        const contours = new THREE.LineSegments(
            createCMEContourGeometry(shape),
            new THREE.LineBasicMaterial({
                color: 0x8ceaff,
                transparent: true,
                opacity: 0.32,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        contours.renderOrder = 6;
        contours.userData.eventId = event.id;
        group.add(contours);

        const streakSeeds = createCMEStreakSeeds(event.id, shape, 24);
        const streakGeometry = new THREE.BufferGeometry();
        streakGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(
                new Float32Array(streakSeeds.length * 2 * 3),
                3,
            ).setUsage(THREE.DynamicDrawUsage),
        );
        const streaks = new THREE.LineSegments(
            streakGeometry,
            new THREE.LineBasicMaterial({
                color: 0x4dc8f2,
                transparent: true,
                opacity: 0.16,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        streaks.renderOrder = 2;
        group.add(streaks);

        const pickProxy = new THREE.Mesh(
            capGeometry,
            new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                depthWrite: false,
                colorWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        pickProxy.userData.eventId = event.id;
        group.add(pickProxy);

        const label = makeCMELabel(event);
        label.visible = false;
        label.renderOrder = 25;
        label.userData.eventId = event.id;
        group.add(label);

        const forecastHalo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: ringTexture(),
            color: 0xc896ff,
            transparent: true,
            opacity: 0.56,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        forecastHalo.visible = false;
        forecastHalo.scale.setScalar(0.095);
        forecastHalo.renderOrder = 7;
        forecastHalo.userData.eventId = event.id;
        content.add(forecastHalo);

        return {
            group,
            front,
            sheath,
            contours,
            streaks,
            pickProxy,
            streakSeeds,
            label,
            forecastHalo,
        };
    }

    private createFlareVisual(event: domain.EventDTO, content: THREE.Group): FlareVisualParts {
        const group = new THREE.Group();
        group.userData.eventId = event.id;
        content.add(group);

        const hotspot = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 20, 12),
            new THREE.MeshBasicMaterial({color: 0xffd37a}),
        );
        hotspot.userData.eventId = event.id;
        hotspot.renderOrder = 8;
        group.add(hotspot);

        const plume = new THREE.Mesh(
            new THREE.ConeGeometry(0.012, 0.065, 24, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0xffad4d,
                transparent: true,
                opacity: 0.2,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        plume.position.y = 0.032;
        plume.rotation.x = Math.PI;
        plume.userData.eventId = event.id;
        plume.renderOrder = 6;
        group.add(plume);

        const pulseRing = new THREE.Mesh(
            new THREE.RingGeometry(0.012, 0.016, 40),
            new THREE.MeshBasicMaterial({
                color: 0xffd98b,
                transparent: true,
                opacity: 0.48,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        pulseRing.rotation.x = -Math.PI / 2;
        pulseRing.position.y = 0.002;
        pulseRing.userData.eventId = event.id;
        pulseRing.renderOrder = 7;
        group.add(pulseRing);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: radialTexture(),
            color: 0xffcc70,
            transparent: true,
            opacity: 0.65,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        glow.scale.setScalar(0.055);
        glow.userData.eventId = event.id;
        glow.renderOrder = 9;
        group.add(glow);

        return {group, hotspot, plume, pulseRing, glow};
    }

    private updateEventVisuals(cursor: number): void {
        const statuses = this.eventVisuals.map((visual) => {
            const eventTime = Date.parse(visual.event.startTime);
            const selected = visual.event.id === this.selectedEventID;
            let active = Number.isFinite(eventTime) && cursor >= eventTime;
            if (visual.event.kind === 'cme' && visual.event.cme?.directionKnown &&
                visual.event.cme.speedKms && visual.event.cme.latitudeDeg !== undefined &&
                visual.event.cme.longitudeDeg !== undefined) {
                active = active && this.updateCME(visual, cursor);
            } else if (visual.event.kind === 'flare' && visual.event.flare?.locationParsed &&
                visual.event.flare.latitudeDeg !== undefined && visual.event.flare.longitudeDeg !== undefined) {
                active = active && this.updateFlare(visual, cursor);
            }
            return {visual, selected, active};
        });
        const hasVisibleSelection = statuses.some(({selected, active}) => selected && active);
        for (const {visual, selected, active} of statuses) {
            visual.content.visible = active;
            visual.root.visible = active;
            if (visual.cme) visual.cme.label.visible = active && selected;
            const dimmed = hasVisibleSelection && !selected;
            const opacityFactor = dimmed ? 0.24 : hasVisibleSelection && selected ? 1.35 : 1;
            visual.content.traverse((object) => {
                const baseRenderOrder = object.userData.baseRenderOrder as number | undefined;
                if (baseRenderOrder === undefined) {
                    object.userData.baseRenderOrder = object.renderOrder;
                }
                object.renderOrder = (baseRenderOrder ?? object.renderOrder) +
                    (hasVisibleSelection && selected ? 20 : 0);
            });
            for (const item of visual.materials) {
                const opacity = Math.min(1, item.opacity * opacityFactor);
                item.material.opacity = opacity;
                if (item.opacityUniform) item.opacityUniform.value = opacity;
                const colored = item.material as THREE.Material & {color?: THREE.Color};
                const color = item.color?.clone();
                if (color && hasVisibleSelection && selected) {
                    color.lerp(SELECTED_EVENT_COLOR, visual.cme ? 0.22 : 0.38);
                }
                if (color && colored.color) colored.color.copy(color);
                if (color && item.colorUniform) item.colorUniform.value.copy(color);
            }
        }
    }

    private updateCME(visual: EventVisual, cursor: number): boolean {
        const cme = visual.event.cme;
        const parts = visual.cme;
        if (!parts || !cme?.speedKms ||
            cme.latitudeDeg === undefined || cme.longitudeDeg === undefined) {
            return false;
        }
        const analysis = Date.parse(cme.analysisTime || visual.event.startTime);
        const elapsedSeconds = Math.max(0, (cursor - analysis) / 1_000);
        const physicalRadius = CME_START_RADIUS_AU + cme.speedKms * elapsedSeconds / AU_KM;
        const displayPhysicalRadius = Math.min(2, physicalRadius);
        const length = this.displayRadius(displayPhysicalRadius);
        const direction = this.eventDirection(cme.latitudeDeg, cme.longitudeDeg, analysis);
        if (!direction) return false;
        parts.group.quaternion.setFromUnitVectors(EVENT_AXIS, direction);
        parts.front.scale.setScalar(length);
        parts.contours.scale.setScalar(length * 1.002);
        parts.pickProxy.scale.setScalar(length);

        const travelAU = Math.max(0, displayPhysicalRadius - CME_START_RADIUS_AU);
        const sheathRadiusAU = Math.max(
            CME_START_RADIUS_AU,
            displayPhysicalRadius - Math.max(0.005, travelAU * 0.045),
        );
        parts.sheath.scale.setScalar(this.displayRadius(sheathRadiusAU));
        const phase = this.reducedMotion() ? 0 : physicalRadius * 3.6;
        parts.front.material.uniforms.uPhase.value = phase;
        parts.sheath.material.uniforms.uPhase.value = phase * 0.82;

        this.updateCMEStreaks(parts, travelAU);
        parts.label.position.set(0, length + 0.065, 0);
        this.updateForecastHalo(visual, cursor);
        return physicalRadius <= 2.05;
    }

    private updateCMEStreaks(parts: CMEVisualParts, travelAU: number): void {
        const positions = parts.streaks.geometry.getAttribute('position') as THREE.BufferAttribute;
        const reducedMotion = this.reducedMotion();
        parts.streaks.visible = travelAU > 0.008;
        for (let index = 0; index < parts.streakSeeds.length; index++) {
            const seed = parts.streakSeeds[index];
            const motion = reducedMotion ? 0 : travelAU * 2.8 * seed.speed;
            const cycle = fract(seed.phase + motion);
            const fraction = 0.16 + 0.76 * cycle;
            const headRadiusAU = CME_START_RADIUS_AU + travelAU * fraction;
            const tailRadiusAU = Math.max(
                CME_START_RADIUS_AU,
                headRadiusAU - Math.max(0.003, travelAU * 0.04),
            );
            const tailRadius = this.displayRadius(tailRadiusAU);
            const headRadius = this.displayRadius(headRadiusAU);
            positions.setXYZ(
                index * 2,
                seed.direction.x * tailRadius,
                seed.direction.y * tailRadius,
                seed.direction.z * tailRadius,
            );
            positions.setXYZ(
                index * 2 + 1,
                seed.direction.x * headRadius,
                seed.direction.y * headRadius,
                seed.direction.z * headRadius,
            );
        }
        positions.needsUpdate = true;
        parts.streaks.geometry.computeBoundingSphere();
    }

    private updateForecastHalo(visual: EventVisual, cursor: number): void {
        const halo = visual.cme?.forecastHalo;
        if (!halo) return;
        const forecast = this.state?.forecasts?.forecasts?.find((candidate) =>
            candidate.linkedCmeIds?.includes(visual.event.id) &&
            Boolean(candidate.earthArrivalTime),
        );
        const arrival = Date.parse(forecast?.earthArrivalTime ?? '');
        const durationMS = (forecast?.estimatedDurationHours ?? 8) * 3_600_000;
        const windowStart = arrival - 3 * 3_600_000;
        const windowEnd = arrival + durationMS;
        const earth = bodyPositionAt(this.state?.ephemeris, BODY_IDS.Earth, cursor);
        halo.visible = Number.isFinite(arrival) && cursor >= windowStart &&
            cursor <= windowEnd && Boolean(earth);
        if (!halo.visible || !earth) return;
        halo.position.copy(this.mapPhysicalVector(eclipticToScene(earth.position)));
        const distanceFromArrival = Math.abs(cursor - arrival);
        const pulse = 1 - Math.min(1, distanceFromArrival / Math.max(1, durationMS));
        halo.scale.setScalar(0.08 + pulse * 0.055);
    }

    private updateFlare(visual: EventVisual, cursor: number): boolean {
        const flare = visual.event.flare;
        const parts = visual.flare;
        if (!parts || !flare ||
            flare.latitudeDeg === undefined || flare.longitudeDeg === undefined) {
            return false;
        }
        const start = Date.parse(visual.event.startTime);
        const peak = Date.parse(flare.peakTime || visual.event.startTime);
        const end = Date.parse(flare.endTime || visual.event.endTime || flare.peakTime || visual.event.startTime);
        const direction = this.eventDirection(flare.latitudeDeg, flare.longitudeDeg, start);
        if (!direction) return false;
        parts.group.position.copy(direction).multiplyScalar(0.037);
        parts.group.quaternion.setFromUnitVectors(EVENT_AXIS, direction);
        const attack = Math.max(1, peak - start);
        const release = Math.max(1, end - peak);
        const strength = cursor <= peak ? (cursor - start) / attack : 1 - (cursor - peak) / release;
        const pulse = Math.max(0.15, Math.min(1, strength));
        const fluxStrength = flare.peakFluxWattsM2 && flare.peakFluxWattsM2 > 0
            ? THREE.MathUtils.clamp((Math.log10(flare.peakFluxWattsM2) + 8) / 5, 0, 1)
            : flareClassStrength(flare.classType);
        const baseScale = 0.72 + fluxStrength * 0.48;
        parts.hotspot.scale.setScalar(baseScale * (0.85 + pulse * 0.24));
        parts.plume.scale.set(
            baseScale * (0.78 + pulse * 0.32),
            baseScale * (0.72 + pulse * 0.72),
            baseScale * (0.78 + pulse * 0.32),
        );
        parts.pulseRing.scale.setScalar(baseScale * (0.8 + pulse * 1.7));
        parts.glow.scale.setScalar(0.038 + baseScale * pulse * 0.035);
        return cursor <= end + 90 * 60_000;
    }

    private updatePlanets(cursor: number): void {
        for (const planet of this.planets) {
            const state = bodyPositionAt(this.state?.ephemeris, planet.id, cursor);
            planet.mesh.visible = Boolean(state);
            planet.exactLabel.visible = Boolean(state?.exact);
            planet.approximateLabel.visible = Boolean(state && !state.exact);
            if (state) {
                planet.mesh.position.copy(
                    this.mapPhysicalVector(eclipticToScene(state.position)),
                );
                const labelPosition = planet.mesh.position.clone()
                    .add(new THREE.Vector3(0, 0.035, 0));
                planet.exactLabel.position.copy(labelPosition);
                planet.approximateLabel.position.copy(labelPosition);
            }
            const orbit = orbitPositionsAt(
                this.state?.ephemeris,
                planet.id,
                cursor,
                planet.periodDays,
            );
            planet.orbit.visible = orbit.positions.length === 256;
            if (planet.orbit.visible) {
                const attribute = planet.orbit.geometry
                    .getAttribute('position') as THREE.BufferAttribute;
                for (let index = 0; index < orbit.positions.length; index++) {
                    const position = this.mapPhysicalVector(
                        eclipticToScene(orbit.positions[index]),
                    );
                    attribute.setXYZ(index, position.x, position.y, position.z);
                }
                attribute.needsUpdate = true;
                const material = planet.orbit.material as THREE.LineBasicMaterial;
                material.color.set(orbit.exact ? 0x35536b : 0x7c6243);
                material.opacity = orbit.exact ? 0.34 : 0.42;
            }
        }
        const l1 = bodyPositionAt(this.state?.ephemeris, BODY_IDS.L1, cursor);
        if (this.l1Marker && this.l1ExactLabel && this.l1ApproximateLabel) {
            this.l1Marker.visible = Boolean(l1);
            this.l1ExactLabel.visible = Boolean(l1?.exact);
            this.l1ApproximateLabel.visible = Boolean(l1 && !l1.exact);
            if (l1) {
                const position = this.mapPhysicalVector(eclipticToScene(l1.position));
                this.l1Marker.position.copy(position);
                const labelPosition = position.clone().add(new THREE.Vector3(0, -0.03, 0));
                this.l1ExactLabel.position.copy(labelPosition);
                this.l1ApproximateLabel.position.copy(labelPosition);
            }
        }
    }

    private updateLocalTelemetry(cursor: number): void {
        const point = telemetryAtCursor(
            this.state?.telemetry?.points ?? this.state?.live?.recent,
            cursor,
            this.state?.telemetry?.gaps,
        );
        const live = this.state?.live;
        const speed = point?.speedKms ?? live?.speedKms;
        const bz = point?.bzGsmNt ?? live?.bzGsmNt;
        const plasmaAnchor = point?.plasmaAnchor ?? live?.plasmaAnchor;
        const imfAnchor = point?.imfAnchor ?? live?.imfAnchor;
        this.placeLocalIndicator(this.plasmaIndicator, plasmaAnchor, speed !== undefined);
        this.placeLocalIndicator(this.imfIndicator, imfAnchor, bz !== undefined);
        if (speed !== undefined) {
            this.plasmaIndicator.scale.setScalar(
                0.06 + Math.min(0.035, Math.max(0, speed - 300) / 20_000),
            );
        }
        if (bz !== undefined) {
            (this.imfIndicator.material as THREE.SpriteMaterial).color
                .set(bz < -5 ? 0xff6f76 : 0x8ddfff);
        }
    }

    private placeLocalIndicator(
        indicator: THREE.Sprite,
        anchor: string | undefined,
        hasValue: boolean,
    ): void {
        const bodyID = anchor === 'earth'
            ? BODY_IDS.Earth
            : anchor === 'semb-l1' ? BODY_IDS.L1 : undefined;
        const state = bodyID
            ? bodyPositionAt(this.state?.ephemeris, bodyID, this.state?.cursor ?? 0)
            : undefined;
        indicator.visible = hasValue && Boolean(state);
        if (state) {
            indicator.position.copy(
                this.mapPhysicalVector(eclipticToScene(state.position)),
            );
        }
    }

    private eventDirection(
        latitudeDeg: number,
        longitudeDeg: number,
        eventTime: number,
    ): THREE.Vector3 | undefined {
        if (!Number.isFinite(eventTime)) return undefined;
        const earth = bodyPositionAt(this.state?.ephemeris, BODY_IDS.Earth, eventTime);
        if (!earth) return undefined;
        const direction = heeqDirectionToEcliptic(
            latitudeDeg,
            longitudeDeg,
            earth.position,
        );
        return direction ? eclipticToScene(direction) : undefined;
    }

    private updateScaleGeometry(): void {
        for (const object of this.root.children) {
            const physical = object.userData.physicalRadius as number | undefined;
            if (physical === undefined) continue;
            if (object.userData.referenceRing) {
                const radius = this.displayRadius(physical);
                object.scale.setScalar(radius / 2);
            }
        }
    }

    private mapPhysicalVector(vector: THREE.Vector3): THREE.Vector3 {
        const radius = vector.length();
        return radius === 0
            ? vector.clone()
            : vector.clone().multiplyScalar(this.displayRadius(radius) / radius);
    }

    private displayRadius(physicalAU: number): number {
        return this.state?.scale === 'compressed'
            ? 2 * Math.sqrt(Math.max(0, physicalAU) / 2)
            : physicalAU;
    }

    private reducedMotion(): boolean {
        return this.state?.bootstrap?.settings?.reducedMotion === true ||
            document.documentElement.classList.contains('reduced-motion');
    }

    private beginPick(event: PointerEvent): void {
        if (!event.isPrimary || event.button !== 0) return;
        this.pickOrigin = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
        };
    }

    private completePick(event: PointerEvent): void {
        const origin = this.pickOrigin;
        this.pickOrigin = undefined;
        if (!origin || event.pointerId !== origin.pointerId ||
            !event.isPrimary || event.button !== 0) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) return;
        this.pick(event);
    }

    private cancelPick(event: PointerEvent): void {
        if (this.pickOrigin?.pointerId === event.pointerId) this.pickOrigin = undefined;
    }

    private pick(event: PointerEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const targets = this.eventVisuals
            .filter((visual) => visual.root.visible && visual.content.visible)
            .map((visual) => visual.content);
        const hits = this.raycaster.intersectObjects(targets, true);
        const id = hits
            .map((hit) => eventIDForObject(hit.object))
            .find((candidate) => candidate !== undefined);
        if (id) this.onEventSelected?.(id);
    }
}

let sharedRadialTexture: THREE.CanvasTexture | undefined;
let sharedRingTexture: THREE.CanvasTexture | undefined;
const sharedEventTextures = new Set<THREE.Texture>();

function radialTexture(): THREE.CanvasTexture {
    if (sharedRadialTexture) return sharedRadialTexture;
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
    sharedRadialTexture = new THREE.CanvasTexture(canvas);
    sharedRadialTexture.colorSpace = THREE.SRGBColorSpace;
    sharedEventTextures.add(sharedRadialTexture);
    return sharedRadialTexture;
}

function ringTexture(): THREE.CanvasTexture {
    if (sharedRingTexture) return sharedRingTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.48, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.65, 'rgba(255,255,255,.24)');
        gradient.addColorStop(0.73, 'rgba(255,255,255,.95)');
        gradient.addColorStop(0.82, 'rgba(255,255,255,.18)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
    }
    sharedRingTexture = new THREE.CanvasTexture(canvas);
    sharedRingTexture.colorSpace = THREE.SRGBColorSpace;
    sharedEventTextures.add(sharedRingTexture);
    return sharedRingTexture;
}

function makeCMESurfaceMaterial(
    color: number,
    opacity: number,
    structure: number,
): THREE.ShaderMaterial {
    const uniforms = {
        uColor: {value: new THREE.Color(color)},
        uOpacity: {value: opacity},
        uPhase: {value: 0},
        uStructure: {value: structure},
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;

            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uPhase;
            uniform float uStructure;
            varying vec2 vUv;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;

            void main() {
                vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
                float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 2.15);
                float boundary = smoothstep(0.82, 1.0, vUv.y);
                float filament = 0.5 + 0.5 * sin(
                    (vWorldNormal.x * 2.1 + vWorldNormal.y * 3.7 +
                    vWorldNormal.z * 1.3) * 18.0 - uPhase * 6.28318
                );
                float structure = 0.96 + (filament - 0.5) * 0.02 * uStructure;
                float alpha = uOpacity *
                    (0.025 + fresnel * 0.96 + boundary * 0.04) * structure;
                vec3 litColor = uColor * (0.84 + fresnel * 0.28);
                gl_FragColor = vec4(litColor, clamp(alpha, 0.0, 1.0));
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
    });
    material.opacity = opacity;
    material.userData.eventUniforms = {
        opacity: uniforms.uOpacity,
        color: uniforms.uColor,
    };
    return material;
}

function collectEventMaterials(root: THREE.Object3D): EventMaterial[] {
    const materials: EventMaterial[] = [];
    const seen = new Set<THREE.Material>();
    root.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        const items = Array.isArray(material) ? material : material ? [material] : [];
        for (const item of items) {
            if (seen.has(item)) continue;
            seen.add(item);
            const colored = item as THREE.Material & {color?: THREE.Color};
            const eventUniforms = item.userData.eventUniforms as {
                opacity?: {value: number};
                color?: {value: THREE.Color};
            } | undefined;
            materials.push({
                material: item,
                opacity: eventUniforms?.opacity?.value ?? item.opacity,
                color: eventUniforms?.color?.value.clone() ?? colored.color?.clone(),
                opacityUniform: eventUniforms?.opacity,
                colorUniform: eventUniforms?.color,
            });
        }
    });
    return materials;
}

function makeCMELabel(event: domain.EventDTO): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
        context.fillStyle = 'rgba(3, 12, 22, .88)';
        context.strokeStyle = 'rgba(123, 225, 244, .72)';
        context.lineWidth = 2;
        context.beginPath();
        context.roundRect(6, 6, 500, 116, 14);
        context.fill();
        context.stroke();
        const speed = Math.round(event.cme?.speedKms ?? 0).toLocaleString('en-US');
        context.font = '600 25px Nunito, sans-serif';
        context.textAlign = 'center';
        context.fillStyle = '#dffaff';
        context.fillText(`BALLISTIC · ${speed} km/s`, 256, 49);
        const shape = cmeAngularShape(
            event.cme?.halfAngleDeg,
            event.cme?.minorHalfWidthDeg,
            event.cme?.tiltDeg,
        );
        const major = Math.round(THREE.MathUtils.radToDeg(shape.majorHalfAngle));
        const minor = Math.round(THREE.MathUtils.radToDeg(shape.minorHalfAngle));
        const tilt = Math.round(THREE.MathUtils.radToDeg(shape.tilt));
        const angularShape = Math.abs(minor - major) >= 1
            ? `±${major}° × ±${minor}° · tilt ${tilt}°`
            : `±${major}° half-angle`;
        context.font = '500 20px Nunito, sans-serif';
        context.fillStyle = '#82bed0';
        context.fillText(angularShape, 256, 88);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
    }));
    sprite.scale.set(0.44, 0.11, 1);
    return sprite;
}

function disposeObject(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        const material = mesh.material;
        const items = Array.isArray(material) ? material : material ? [material] : [];
        for (const item of items) {
            materials.add(item);
            const map = (item as THREE.Material & {map?: THREE.Texture}).map;
            if (map && !sharedEventTextures.has(map)) textures.add(map);
        }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
}

function eventIDForObject(object: THREE.Object3D): string | undefined {
    let candidate: THREE.Object3D | null = object;
    while (candidate) {
        const id = candidate.userData.eventId as string | undefined;
        if (id) return id;
        candidate = candidate.parent;
    }
    return undefined;
}

function flareClassStrength(classType: string | undefined): number {
    switch (classType?.trim().charAt(0).toUpperCase()) {
        case 'X': return 1;
        case 'M': return 0.76;
        case 'C': return 0.52;
        case 'B': return 0.3;
        case 'A': return 0.14;
        default: return 0.4;
    }
}

function fract(value: number): number {
    return value - Math.floor(value);
}

function makeLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
        context.font = '500 28px Nunito, sans-serif';
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
