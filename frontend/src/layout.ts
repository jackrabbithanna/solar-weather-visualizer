export interface LayoutState {
    eventWidth: number;
    inspectorWidth: number;
    graphHeight: number;
    logHeight: number;
    graphCollapsed: boolean;
    logCollapsed: boolean;
}

type ResizerKind = 'event' | 'inspector' | 'graph' | 'log';

const STORAGE_KEY = 'solar-weather-layout-v1';
const DEFAULT_LAYOUT: LayoutState = {
    eventWidth: 254,
    inspectorWidth: 280,
    graphHeight: 238,
    logHeight: 160,
    graphCollapsed: false,
    logCollapsed: true,
};
const MIN_EVENT_WIDTH = 190;
const MIN_INSPECTOR_WIDTH = 220;
const MIN_SCENE_WIDTH = 420;
const MIN_TOP_HEIGHT = 260;
const MIN_GRAPH_HEIGHT = 150;
const MIN_LOG_HEIGHT = 110;
const COLLAPSED_HEIGHT = 34;
const RESIZER_SIZE = 6;
const KEYBOARD_STEP = 10;

export class WorkspaceLayout extends EventTarget {
    readonly state: LayoutState;
    private readonly graphToggle: HTMLButtonElement;
    private readonly logToggle: HTMLButtonElement;
    private readonly resizeObserver: ResizeObserver;

    constructor(private readonly workspace: HTMLElement) {
        super();
        this.state = loadLayout();
        this.graphToggle = requiredButton('graph-toggle');
        this.logToggle = requiredButton('activity-toggle');
        this.graphToggle.onclick = () => {
            this.state.graphCollapsed = !this.state.graphCollapsed;
            this.apply(true, true);
        };
        this.logToggle.onclick = () => {
            this.state.logCollapsed = !this.state.logCollapsed;
            this.apply(true, true);
        };
        this.wireResizer(requiredElement('event-resizer'), 'event');
        this.wireResizer(requiredElement('inspector-resizer'), 'inspector');
        this.wireResizer(requiredElement('graph-resizer'), 'graph');
        this.wireResizer(requiredElement('activity-resizer'), 'log');
        this.resizeObserver = new ResizeObserver(() => this.apply(false, false));
        this.resizeObserver.observe(workspace);
        this.apply(false, false);
    }

    reset(): void {
        Object.assign(this.state, DEFAULT_LAYOUT);
        this.apply(true, true);
    }

    private wireResizer(element: HTMLElement, kind: ResizerKind): void {
        element.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || this.resizerDisabled(kind)) return;
            event.preventDefault();
            element.setPointerCapture(event.pointerId);
            element.classList.add('dragging');
            const startX = event.clientX;
            const startY = event.clientY;
            const startValue = this.valueFor(kind);
            const move = (moveEvent: PointerEvent): void => {
                const delta = kind === 'event'
                    ? moveEvent.clientX - startX
                    : kind === 'inspector'
                        ? startX - moveEvent.clientX
                        : startY - moveEvent.clientY;
                this.setValue(kind, startValue + delta);
                this.apply(false, false);
            };
            const finish = (): void => {
                element.classList.remove('dragging');
                element.removeEventListener('pointermove', move);
                element.removeEventListener('pointerup', finish);
                element.removeEventListener('pointercancel', finish);
                this.apply(true, true);
            };
            element.addEventListener('pointermove', move);
            element.addEventListener('pointerup', finish, {once: true});
            element.addEventListener('pointercancel', finish, {once: true});
        });
        element.addEventListener('keydown', (event) => {
            if (this.resizerDisabled(kind)) return;
            const delta = keyboardDelta(kind, event.key);
            if (!delta) return;
            event.preventDefault();
            this.setValue(kind, this.valueFor(kind) + delta);
            this.apply(true, true);
        });
    }

    private resizerDisabled(kind: ResizerKind): boolean {
        return (kind === 'graph' && this.state.graphCollapsed) ||
            (kind === 'log' && this.state.logCollapsed);
    }

    private valueFor(kind: ResizerKind): number {
        if (kind === 'event') return this.state.eventWidth;
        if (kind === 'inspector') return this.state.inspectorWidth;
        if (kind === 'graph') return this.state.graphHeight;
        return this.state.logHeight;
    }

    private setValue(kind: ResizerKind, value: number): void {
        if (kind === 'event') this.state.eventWidth = value;
        else if (kind === 'inspector') this.state.inspectorWidth = value;
        else if (kind === 'graph') this.state.graphHeight = value;
        else this.state.logHeight = value;
    }

    private apply(save: boolean, emit: boolean): void {
        this.clamp();
        this.workspace.style.setProperty('--event-pane-width', `${this.state.eventWidth}px`);
        this.workspace.style.setProperty('--inspector-pane-width', `${this.state.inspectorWidth}px`);
        this.workspace.style.setProperty(
            '--graph-pane-height',
            `${this.state.graphCollapsed ? COLLAPSED_HEIGHT : this.state.graphHeight}px`,
        );
        this.workspace.style.setProperty(
            '--activity-pane-height',
            `${this.state.logCollapsed ? COLLAPSED_HEIGHT : this.state.logHeight}px`,
        );
        this.workspace.classList.toggle('graph-collapsed', this.state.graphCollapsed);
        this.workspace.classList.toggle('activity-collapsed', this.state.logCollapsed);
        this.updateToggle(this.graphToggle, 'graph-pane', 'Telemetry graphs', this.state.graphCollapsed);
        this.updateToggle(this.logToggle, 'activity-pane', 'Application messages', this.state.logCollapsed);
        this.updateResizerARIA();
        if (save) saveLayout(this.state);
        if (emit) this.dispatchEvent(new Event('change'));
    }

    private clamp(): void {
        const width = Math.max(
            MIN_EVENT_WIDTH + MIN_INSPECTOR_WIDTH + MIN_SCENE_WIDTH + RESIZER_SIZE * 2,
            this.workspace.clientWidth,
        );
        this.state.eventWidth = clamp(
            finite(this.state.eventWidth, DEFAULT_LAYOUT.eventWidth),
            MIN_EVENT_WIDTH,
            width - MIN_INSPECTOR_WIDTH - MIN_SCENE_WIDTH - RESIZER_SIZE * 2,
        );
        this.state.inspectorWidth = clamp(
            finite(this.state.inspectorWidth, DEFAULT_LAYOUT.inspectorWidth),
            MIN_INSPECTOR_WIDTH,
            width - this.state.eventWidth - MIN_SCENE_WIDTH - RESIZER_SIZE * 2,
        );

        this.state.graphHeight = Math.max(
            MIN_GRAPH_HEIGHT,
            finite(this.state.graphHeight, DEFAULT_LAYOUT.graphHeight),
        );
        this.state.logHeight = Math.max(
            MIN_LOG_HEIGHT,
            finite(this.state.logHeight, DEFAULT_LAYOUT.logHeight),
        );
        const graphResizer = this.state.graphCollapsed ? 0 : RESIZER_SIZE;
        const logResizer = this.state.logCollapsed ? 0 : RESIZER_SIZE;
        const fixedGraph = this.state.graphCollapsed ? COLLAPSED_HEIGHT : 0;
        const fixedLog = this.state.logCollapsed ? COLLAPSED_HEIGHT : 0;
        let available = Math.max(
            0,
            this.workspace.clientHeight - MIN_TOP_HEIGHT - graphResizer - logResizer - fixedGraph - fixedLog,
        );
        if (!this.state.logCollapsed) {
            const graphMinimum = this.state.graphCollapsed ? 0 : MIN_GRAPH_HEIGHT;
            this.state.logHeight = clamp(this.state.logHeight, MIN_LOG_HEIGHT, Math.max(MIN_LOG_HEIGHT, available - graphMinimum));
            available -= this.state.logHeight;
        }
        if (!this.state.graphCollapsed) {
            this.state.graphHeight = clamp(this.state.graphHeight, MIN_GRAPH_HEIGHT, Math.max(MIN_GRAPH_HEIGHT, available));
        }
    }

    private updateToggle(
        button: HTMLButtonElement,
        controls: string,
        label: string,
        collapsed: boolean,
    ): void {
        button.setAttribute('aria-controls', controls);
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${label}`);
        button.title = `${collapsed ? 'Expand' : 'Collapse'} ${label}`;
        button.textContent = collapsed ? '▸' : '▾';
    }

    private updateResizerARIA(): void {
        const width = this.workspace.clientWidth;
        const height = this.workspace.clientHeight;
        const graphOther = (this.state.logCollapsed ? COLLAPSED_HEIGHT : this.state.logHeight) +
            (this.state.logCollapsed ? 0 : RESIZER_SIZE) + RESIZER_SIZE;
        const logOther = (this.state.graphCollapsed ? COLLAPSED_HEIGHT : this.state.graphHeight) +
            (this.state.graphCollapsed ? 0 : RESIZER_SIZE) + RESIZER_SIZE;
        const values: Array<[string, number, number, number, boolean]> = [
            [
                'event-resizer',
                this.state.eventWidth,
                MIN_EVENT_WIDTH,
                width - this.state.inspectorWidth - MIN_SCENE_WIDTH - RESIZER_SIZE * 2,
                false,
            ],
            [
                'inspector-resizer',
                this.state.inspectorWidth,
                MIN_INSPECTOR_WIDTH,
                width - this.state.eventWidth - MIN_SCENE_WIDTH - RESIZER_SIZE * 2,
                false,
            ],
            [
                'graph-resizer',
                this.state.graphHeight,
                MIN_GRAPH_HEIGHT,
                height - MIN_TOP_HEIGHT - graphOther,
                this.state.graphCollapsed,
            ],
            [
                'activity-resizer',
                this.state.logHeight,
                MIN_LOG_HEIGHT,
                height - MIN_TOP_HEIGHT - logOther,
                this.state.logCollapsed,
            ],
        ];
        for (const [id, value, minimum, maximum, disabled] of values) {
            const element = requiredElement(id);
            element.setAttribute('aria-valuemin', String(minimum));
            element.setAttribute('aria-valuemax', String(Math.max(minimum, maximum, value)));
            element.setAttribute('aria-valuenow', String(Math.round(value)));
            element.setAttribute('aria-valuetext', `${Math.round(value)} pixels`);
            element.setAttribute('aria-disabled', String(disabled));
            element.tabIndex = disabled ? -1 : 0;
        }
    }
}

function keyboardDelta(kind: ResizerKind, key: string): number {
    if (kind === 'event') {
        if (key === 'ArrowLeft') return -KEYBOARD_STEP;
        if (key === 'ArrowRight') return KEYBOARD_STEP;
    } else if (kind === 'inspector') {
        if (key === 'ArrowLeft') return KEYBOARD_STEP;
        if (key === 'ArrowRight') return -KEYBOARD_STEP;
    } else {
        if (key === 'ArrowUp') return KEYBOARD_STEP;
        if (key === 'ArrowDown') return -KEYBOARD_STEP;
    }
    return 0;
}

function loadLayout(): LayoutState {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (!value) return {...DEFAULT_LAYOUT};
        const parsed = JSON.parse(value) as Partial<LayoutState>;
        return {
            eventWidth: finite(parsed.eventWidth, DEFAULT_LAYOUT.eventWidth),
            inspectorWidth: finite(parsed.inspectorWidth, DEFAULT_LAYOUT.inspectorWidth),
            graphHeight: finite(parsed.graphHeight, DEFAULT_LAYOUT.graphHeight),
            logHeight: finite(parsed.logHeight, DEFAULT_LAYOUT.logHeight),
            graphCollapsed: typeof parsed.graphCollapsed === 'boolean'
                ? parsed.graphCollapsed
                : DEFAULT_LAYOUT.graphCollapsed,
            logCollapsed: typeof parsed.logCollapsed === 'boolean'
                ? parsed.logCollapsed
                : DEFAULT_LAYOUT.logCollapsed,
        };
    } catch {
        return {...DEFAULT_LAYOUT};
    }
}

function saveLayout(state: LayoutState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // A read-only WebView storage area should not prevent layout changes.
    }
}

function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}

function requiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing layout element #${id}`);
    return element;
}

function requiredButton(id: string): HTMLButtonElement {
    return requiredElement(id) as HTMLButtonElement;
}
