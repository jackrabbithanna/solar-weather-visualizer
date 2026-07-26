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

const AU_KM = 149_597_870.7;
const SOLAR_RADIUS_AU = 695_700 / AU_KM;
const SELECTED_EVENT_COLOR = new THREE.Color(0xfff1aa);

interface EventVisual {
    root: THREE.Group;
    content: THREE.Group;
    materials: Array<{material: THREE.Material; opacity: number; color?: THREE.Color}>;
    event: domain.EventDTO;
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
        this.eventLayer.clear();
        this.eventVisuals.length = 0;
        const events = this.state?.events?.events ?? [];
        for (const event of events) {
            if (!this.state?.eventFilters.has(event.kind)) continue;
            const root = new THREE.Group();
            const content = new THREE.Group();
            root.userData.eventId = event.id;
            root.add(content);
            if (event.kind === 'cme' && event.cme?.directionKnown &&
                event.cme.speedKms && event.cme.latitudeDeg !== undefined &&
                event.cme.longitudeDeg !== undefined) {
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
                content.add(shell);
                const front = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialTexture(),
                    color: 0x77e6ff,
                    transparent: true,
                    opacity: 0.52,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                }));
                front.userData.eventId = event.id;
                content.add(front);
            } else if (event.kind === 'flare' && event.flare?.locationParsed &&
                event.flare.latitudeDeg !== undefined && event.flare.longitudeDeg !== undefined) {
                const flare = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: radialTexture(),
                    color: 0xffd37a,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                }));
                flare.scale.setScalar(0.09);
                flare.userData.eventId = event.id;
                content.add(flare);
            } else {
                // Catalog records without a real spatial coordinate remain in
                // the event list, but are not assigned invented 3D geometry.
                continue;
            }
            const materials: EventVisual['materials'] = [];
            content.traverse((object) => {
                const material = (object as THREE.Mesh).material;
                const items = Array.isArray(material) ? material : material ? [material] : [];
                for (const item of items) {
                    const colored = item as THREE.Material & {color?: THREE.Color};
                    materials.push({
                        material: item,
                        opacity: item.opacity,
                        color: colored.color?.clone(),
                    });
                }
            });
            this.eventLayer.add(root);
            this.eventVisuals.push({root, content, materials, event});
        }
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
            const dimmed = hasVisibleSelection && !selected;
            const opacityFactor = dimmed ? 0.24 : hasVisibleSelection && selected ? 1.35 : 1;
            visual.content.traverse((object) => {
                object.renderOrder = hasVisibleSelection && selected ? 20 : 0;
            });
            for (const item of visual.materials) {
                item.material.opacity = Math.min(1, item.opacity * opacityFactor);
                const colored = item.material as THREE.Material & {color?: THREE.Color};
                if (item.color && colored.color) {
                    colored.color.copy(item.color);
                    if (hasVisibleSelection && selected) {
                        colored.color.lerp(SELECTED_EVENT_COLOR, 0.38);
                    }
                }
            }
        }
    }

    private updateCME(visual: EventVisual, cursor: number): boolean {
        const cme = visual.event.cme;
        if (!cme?.speedKms || cme.latitudeDeg === undefined || cme.longitudeDeg === undefined) return false;
        const analysis = Date.parse(cme.analysisTime || visual.event.startTime);
        const elapsedSeconds = Math.max(0, (cursor - analysis) / 1_000);
        const physicalRadius = 21.5 * SOLAR_RADIUS_AU + cme.speedKms * elapsedSeconds / AU_KM;
        const displayPhysicalRadius = Math.min(2, physicalRadius);
        const length = this.displayRadius(displayPhysicalRadius);
        const halfAngle = THREE.MathUtils.degToRad(Math.min(80, cme.halfAngleDeg ?? 24));
        const base = Math.max(0.015, Math.tan(halfAngle) * length);
        const direction = this.eventDirection(cme.latitudeDeg, cme.longitudeDeg, analysis);
        if (!direction) return false;
        const shell = visual.content.children[0];
        shell.scale.set(base, length, base);
        shell.position.copy(direction).multiplyScalar(length / 2);
        // ConeGeometry's tip is +Y. Aim that tip back at the Sun so the broad
        // edge is the outward-moving front.
        shell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().negate());
        const front = visual.content.children[1] as THREE.Sprite | undefined;
        if (front) {
            front.position.copy(direction).multiplyScalar(length);
            front.scale.setScalar(Math.max(0.035, base * 1.7));
        }
        return physicalRadius <= 2.05;
    }

    private updateFlare(visual: EventVisual, cursor: number): boolean {
        const flare = visual.event.flare;
        if (!flare || flare.latitudeDeg === undefined || flare.longitudeDeg === undefined) return false;
        const start = Date.parse(visual.event.startTime);
        const peak = Date.parse(flare.peakTime || visual.event.startTime);
        const end = Date.parse(flare.endTime || visual.event.endTime || flare.peakTime || visual.event.startTime);
        const direction = this.eventDirection(flare.latitudeDeg, flare.longitudeDeg, start);
        if (!direction) return false;
        visual.root.position.copy(direction).multiplyScalar(0.042);
        const attack = Math.max(1, peak - start);
        const release = Math.max(1, end - peak);
        const strength = cursor <= peak ? (cursor - start) / attack : 1 - (cursor - peak) / release;
        const pulse = Math.max(0.15, Math.min(1, strength));
        visual.content.scale.setScalar(0.6 + pulse * 0.7);
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
        const id = hits.find((hit) => hit.object.userData.eventId)?.object.userData.eventId as string | undefined;
        if (id) this.onEventSelected?.(id);
    }
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
