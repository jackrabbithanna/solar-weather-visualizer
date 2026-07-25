import {domain} from '../wailsjs/go/models';

export type Mode = 'live' | 'replay';
export type RadialScale = 'linear' | 'compressed';

export interface AppState {
    mode: Mode;
    bootstrap?: domain.BootstrapDTO;
    live?: domain.LiveSnapshotDTO;
    events?: domain.EventSearchResult;
    telemetry?: domain.TelemetrySeriesDTO;
    forecasts?: domain.ForecastResult;
    rangeStart: number;
    rangeEnd: number;
    cursor: number;
    playing: boolean;
    playbackRate: number;
    scale: RadialScale;
    selectedEventID?: string;
    eventFilters: Set<string>;
    loading: Set<string>;
    status: string;
}

export class AppStore extends EventTarget {
    readonly state: AppState;
    private lastTick = performance.now();

    constructor() {
        super();
        const end = Date.now();
        this.state = {
            mode: 'replay',
            rangeStart: end - 7 * 86_400_000,
            rangeEnd: end,
            cursor: end,
            playing: false,
            playbackRate: 3_600,
            scale: 'linear',
            eventFilters: new Set(['cme', 'flare', 'hss', 'sep', 'ips', 'storm']),
            loading: new Set(),
            status: 'Starting…',
        };
    }

    change(patch: Partial<AppState>): void {
        Object.assign(this.state, patch);
        this.emit();
    }

    setLoading(key: string, active: boolean): void {
        if (active) this.state.loading.add(key);
        else this.state.loading.delete(key);
        this.emit();
    }

    setRange(start: number, end: number, cursor = end): void {
        this.state.rangeStart = start;
        this.state.rangeEnd = Math.max(start + 1_000, end);
        this.state.cursor = Math.min(this.state.rangeEnd, Math.max(start, cursor));
        this.emit();
    }

    toggleFilter(kind: string): void {
        if (this.state.eventFilters.has(kind)) this.state.eventFilters.delete(kind);
        else this.state.eventFilters.add(kind);
        this.emit();
    }

    tick(now: number): void {
        const elapsed = Math.min(0.25, (now - this.lastTick) / 1_000);
        this.lastTick = now;
        if (!this.state.playing || this.state.mode === 'live') return;
        const next = this.state.cursor + elapsed * this.state.playbackRate * 1_000;
        if (next >= this.state.rangeEnd) {
            this.state.cursor = this.state.rangeEnd;
            this.state.playing = false;
        } else {
            this.state.cursor = next;
        }
        this.emit();
    }

    private emit(): void {
        this.dispatchEvent(new Event('change'));
    }
}

export function nearestTelemetry(
    points: domain.TelemetryPoint[] | undefined,
    cursor: number,
): domain.TelemetryPoint | undefined {
    if (!points?.length) return undefined;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (Date.parse(points[middle].time) < cursor) low = middle + 1;
        else high = middle;
    }
    if (low > 0) {
        const left = Math.abs(Date.parse(points[low - 1].time) - cursor);
        const right = Math.abs(Date.parse(points[low].time) - cursor);
        return left < right ? points[low - 1] : points[low];
    }
    return points[low];
}
