import './style.css';
import './app.css';

import {domain} from '../wailsjs/go/models';
import {backend} from './api';
import {renderTelemetryCharts} from './charts';
import {HeliosphereScene} from './scene/HeliosphereScene';
import {AppState, AppStore, RadialScale, telemetryAtCursor} from './state';
import {utcInput, utcInputDate} from './utc';

const HOUR_MS = 3_600_000;
const LIVE_TELEMETRY_WINDOW_MS = 3 * HOUR_MS;
const LIVE_EVENT_WINDOW_MS = 48 * HOUR_MS;
const AU_KM = 149_597_870.7;
const INITIAL_CME_RADIUS_AU = 21.5 * 695_700 / AU_KM;
const SELECTED_CME_FOCUS_AU = 0.7;

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root is missing');

app.innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div><h1>Heliosphere</h1><p>Solar weather visualizer</p></div>
    </div>
    <nav class="mode-switch" aria-label="Data mode">
      <button class="mode-button" data-mode="live"><span class="live-dot"></span> Live</button>
      <button class="mode-button active" data-mode="replay">Replay</button>
    </nav>
    <div class="top-actions">
      <span id="provider-status" class="connection-state">Starting</span>
      <button id="guide-button" class="icon-button" title="Guided tour" aria-label="Guided tour">?</button>
      <button id="settings-button" class="icon-button" title="Settings" aria-label="Settings">⚙</button>
    </div>
  </header>

  <main class="workspace">
    <aside class="event-panel panel">
      <div class="panel-heading">
        <div><span class="eyebrow">Phenomena</span><h2>Event stream</h2></div>
        <span id="event-count" class="count-badge">0</span>
      </div>
      <div id="event-filters" class="filter-row" aria-label="Event filters"></div>
      <div id="event-list" class="event-list"></div>
      <div class="panel-footer">
        <button id="demo-button" class="secondary-button">Load guided demo</button>
      </div>
    </aside>

    <section class="viewport-panel">
      <div id="scene-host" class="scene-host" aria-label="Three-dimensional heliosphere view"></div>
      <div class="scene-top-left glass">
        <span id="scene-mode" class="eyebrow">REPLAY · ILLUSTRATIVE</span>
        <strong id="scene-time">—</strong>
      </div>
      <div class="scene-top-right glass">
        <button id="reset-camera" class="compact-button">Reset view</button>
        <div class="scale-switch" role="group" aria-label="Radial scale">
          <button data-scale="linear" class="active">1:1 AU</button>
          <button data-scale="compressed">√ compressed</button>
        </div>
      </div>
      <div class="scene-legend glass">
        <span><i class="legend-dot observed"></i> Observed</span>
        <span><i class="legend-dot forecast"></i> Forecast</span>
        <span><i class="legend-dot illustrative"></i> Illustrative</span>
        <small>Body sizes enlarged</small>
      </div>
      <div class="au-scale"><span>Sun</span><i></i><span id="scale-label">2 AU</span></div>
    </section>

    <aside class="inspector panel">
      <div class="panel-heading">
        <div><span class="eyebrow">At cursor</span><h2>Conditions near Earth</h2></div>
        <time id="conditions-time" class="conditions-time" aria-live="polite">—</time>
      </div>
      <div id="readouts" class="readout-grid"></div>
      <section id="event-detail" class="event-detail"></section>
      <section id="forecast-card" class="forecast-card"></section>
    </aside>

    <section class="bottom-dock panel">
      <div class="timeline-controls">
        <button id="play-button" class="play-button" aria-label="Play replay">▶</button>
        <select id="playback-rate" aria-label="Playback speed">
          <option value="60">60×</option>
          <option value="600">600×</option>
          <option value="3600" selected>1 hour/sec</option>
          <option value="21600">6 hours/sec</option>
          <option value="86400">1 day/sec</option>
        </select>
        <div class="timeline-track">
          <input id="timeline" type="range" min="0" max="10000" value="10000" aria-label="Replay time"/>
          <div class="timeline-labels"><span id="range-start">—</span><strong id="cursor-label">—</strong><span id="range-end">—</span></div>
        </div>
        <button id="range-button" class="secondary-button">Date range</button>
      </div>
      <div id="charts" class="charts"></div>
    </section>
  </main>

  <footer class="statusbar">
    <span id="status-message">Preparing the heliosphere…</span>
    <span>UTC · Educational view, not operational guidance</span>
    <div class="export-actions">
      <button id="import-button">Import</button>
      <button id="export-text-button">Text</button>
      <button id="export-bundle-button">Bundle</button>
      <button id="export-image-button" class="primary-button">Export image</button>
    </div>
  </footer>
</div>

<dialog id="range-dialog">
  <form method="dialog" class="dialog-card" id="range-form">
    <header><div><span class="eyebrow">Historical search</span><h2>Explore a UTC interval</h2></div><button value="cancel" class="icon-button">×</button></header>
    <p>DONKI events, routed OMNI/NOAA observations, and available WSA-ENLIL forecasts load independently. All values below are interpreted as UTC.</p>
    <label>Start (UTC) <input id="range-start-input" type="datetime-local" step="60" required/></label>
    <label>End (UTC) <input id="range-end-input" type="datetime-local" step="60" required/></label>
    <fieldset>
      <legend>Include event types</legend>
      <div id="dialog-event-filters" class="check-grid"></div>
    </fieldset>
    <footer><button value="cancel" class="secondary-button">Cancel</button><button id="search-button" value="default" class="primary-button">Load interval</button></footer>
  </form>
</dialog>

<dialog id="settings-dialog">
  <form method="dialog" class="dialog-card wide" id="settings-form">
    <header><div><span class="eyebrow">Application</span><h2>Settings & data</h2></div><button value="cancel" class="icon-button">×</button></header>
    <div class="settings-grid">
      <section>
        <h3>NASA access</h3>
        <label>Personal API key <input id="nasa-key" type="password" autocomplete="off" placeholder="Leave blank to keep current key"/></label>
        <label class="checkbox"><input id="clear-key" type="checkbox"/> Remove saved key</label>
        <small>The key is stored by the Go backend in an owner-only settings file and is never returned to this view.</small>
      </section>
      <section>
        <h3>Display</h3>
        <label>Default radial scale
          <select id="default-scale"><option value="linear">Linear 0–2 AU</option><option value="compressed">Compressed inner heliosphere</option></select>
        </label>
        <label class="checkbox"><input id="reduced-motion" type="checkbox"/> Reduce animation</label>
      </section>
      <section>
        <h3>Local data</h3>
        <p id="cache-summary">Cache: —</p>
        <button id="clear-cache-button" type="button" class="danger-button">Clear cached provider data</button>
      </section>
      <section>
        <h3>Advanced imports</h3>
        <button id="model-import-button" type="button" class="secondary-button">Inspect ENLIL model file</button>
        <p id="model-status" class="muted">Full NetCDF cubes remain gated until a pure-Go reader is validated.</p>
      </section>
    </div>
    <footer><button value="cancel" class="secondary-button">Cancel</button><button id="save-settings-button" value="default" class="primary-button">Save settings</button></footer>
  </form>
</dialog>

<div id="guide" class="guide hidden" role="dialog" aria-modal="true" aria-labelledby="guide-title">
  <div class="guide-card">
    <span id="guide-step" class="eyebrow">1 of 3</span>
    <h2 id="guide-title">Read the layers honestly</h2>
    <p id="guide-copy"></p>
    <div class="guide-progress"><i></i><i></i><i></i></div>
    <footer><button id="guide-skip" class="secondary-button">Skip</button><button id="guide-next" class="primary-button">Next</button></footer>
  </div>
</div>
<div id="toast-region" class="toast-region" aria-live="polite"></div>`;

const store = new AppStore();
const sceneHost = required<HTMLElement>('scene-host');
const scene = new HeliosphereScene(sceneHost);
type ReplaySnapshot = Pick<
    AppState,
    'events' | 'telemetry' | 'telemetryError' | 'forecasts' | 'rangeStart' | 'rangeEnd' | 'status'
>;
let lastEventRender = '';
let lastChartRender = '';
let lastDetailRender = '';
let lastReadoutRender = '';
let lastForecastRender = '';
let renderQueued = false;
let liveTimer: number | undefined;
let liveRequestVersion = 0;
let replaySnapshot: ReplaySnapshot | undefined;

const eventKinds = [
    ['cme', 'CME'],
    ['flare', 'Flare'],
    ['hss', 'HSS'],
    ['sep', 'SEP'],
    ['ips', 'Shock'],
    ['storm', 'Storm'],
] as const;

function required<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element #${id}`);
    return element as T;
}

function queueRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        renderUI();
    });
}

store.addEventListener('change', queueRender);
scene.onEventSelected = (id) => {
    if (store.state.mode === 'replay' && store.state.playing) return;
    selectEvent(id);
};

function renderUI(): void {
    const state = store.state;
    scene.setState(state);
    required('status-message').textContent = state.status;
    required('scene-time').textContent = longUTC(state.cursor);
    required('scene-mode').textContent = `${state.mode.toUpperCase()} · ${state.mode === 'live' ? 'OBSERVED' : 'MIXED DATA'}`;
    required('range-start').textContent = shortUTC(state.rangeStart);
    required('range-end').textContent = shortUTC(state.rangeEnd);
    required('cursor-label').textContent = longUTC(state.cursor);
    required<HTMLInputElement>('timeline').value = String(
        Math.round((state.cursor - state.rangeStart) / (state.rangeEnd - state.rangeStart) * 10_000),
    );
    const playButton = required<HTMLButtonElement>('play-button');
    playButton.textContent = state.playing ? '❚❚' : '▶';
    playButton.setAttribute('aria-label', state.playing ? 'Pause replay' : 'Play replay');
    playButton.toggleAttribute('disabled', state.mode === 'live');
    required('provider-status').textContent = state.loading.size ? `Loading ${state.loading.size}` : providerLabel();
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) =>
        button.classList.toggle('active', button.dataset.mode === state.mode));
    document.querySelectorAll<HTMLElement>('[data-scale]').forEach((button) =>
        button.classList.toggle('active', button.dataset.scale === state.scale));
    required('scale-label').textContent = state.scale === 'linear' ? '2 AU' : '2 AU · compressed';

    renderReadouts();
    renderEvents();
    renderDetail();
    renderForecast();
    renderCharts();
}

function providerLabel(): string {
    const live = store.state.live;
    if (live) return live.provenance?.some((item) => item.stale) ? 'Cached · stale' : 'Data ready';
    if (store.state.telemetry?.provenance?.stale) return 'Cached · stale';
    if (store.state.telemetry?.provenance?.cached) return 'Cached data';
    return store.state.bootstrap?.offlineReady ? 'Offline cache ready' : 'Ready';
}

function renderReadouts(): void {
    const state = store.state;
    const telemetry = state.telemetry;
    const telemetryLoading = state.loading.has('telemetry');
    const live = state.mode === 'live' ? state.live : undefined;
    const point = telemetryAtCursor(
        telemetry?.points ?? live?.recent,
        state.cursor,
        telemetry?.gaps,
    );
    const signature = [
        point?.time,
        point?.speedKms,
        point?.densityPerCm3,
        point?.pressureNPa,
        point?.bzGsmNt,
        point?.fieldMagnitudeNt,
        point?.source,
        live?.time,
        telemetryLoading,
        state.telemetryError,
    ].join('|');
    if (signature === lastReadoutRender) return;
    lastReadoutRender = signature;
    const observedTime = point?.time ?? live?.time;
    const parsedObservedTime = Date.parse(observedTime ?? '');
    const conditionsTime = required('conditions-time');
    conditionsTime.classList.toggle('loading', telemetryLoading);
    conditionsTime.textContent = telemetryLoading
        ? 'Fetching Replay telemetry…'
        : state.telemetryError
            ? 'Telemetry unavailable'
            : Number.isFinite(parsedObservedTime)
                ? `Observation ${longUTC(parsedObservedTime)}`
                : 'No observation at cursor';
    const values: Array<{
        label: string;
        value?: number;
        text?: string;
        unit?: string;
        className: string;
    }> = [
        {label: 'Solar wind', value: point?.speedKms ?? live?.speedKms, unit: 'km/s', className: 'speed'},
        {label: 'Density', value: point?.densityPerCm3 ?? live?.densityPerCm3, unit: 'p/cm³', className: 'density'},
        {label: 'Pressure', value: point?.pressureNPa ?? live?.pressureNPa, unit: 'nPa', className: 'pressure'},
        {label: 'IMF Bz', value: point?.bzGsmNt ?? live?.bzGsmNt, unit: 'nT GSM', className: 'bz'},
        {label: 'Field |B|', value: point?.fieldMagnitudeNt ?? live?.fieldMagnitudeNt, unit: 'nT', className: 'field'},
        {label: 'Source', text: telemetrySourceText(point, live), className: 'source'},
    ];
    required('readouts').innerHTML = values.map((item) => `
      <div class="readout ${item.className}">
        <span>${item.label}</span>
        <strong>${item.text !== undefined
            ? escapeHTML(item.text)
            : item.value === undefined ? '—' : formatValue(item.value)}</strong>
        ${item.text === undefined && item.unit ? `<small>${item.unit}</small>` : ''}
      </div>`).join('');
}

function telemetrySourceText(
    point: domain.TelemetryPoint | undefined,
    live: domain.LiveSnapshotDTO | undefined,
): string {
    const imf = point?.imfSource ?? live?.imfSource;
    const plasma = point?.plasmaSource ?? live?.plasmaSource;
    if (imf && plasma && imf !== plasma) return `IMF ${imf} · Plasma ${plasma}`;
    return imf ?? plasma ?? point?.source ?? '—';
}

function renderEvents(): void {
    const state = store.state;
    const signature = [
        state.events?.generatedAt,
        state.selectedEventID,
        [...state.eventFilters].join(','),
    ].join('|');
    if (signature === lastEventRender) return;
    lastEventRender = signature;
    required('event-filters').innerHTML = eventKinds.map(([kind, label]) => `
      <button class="filter-chip ${state.eventFilters.has(kind) ? 'active' : ''}" data-kind="${kind}">
        <i class="${kind}"></i>${label}
      </button>`).join('');
    required('dialog-event-filters').innerHTML = eventKinds.map(([kind, label]) => `
      <label class="checkbox"><input type="checkbox" value="${kind}" ${state.eventFilters.has(kind) ? 'checked' : ''}/> ${label}</label>`).join('');
    document.querySelectorAll<HTMLButtonElement>('#event-filters [data-kind]').forEach((button) => {
        button.onclick = () => {
            const kind = button.dataset.kind;
            if (!kind) return;
            store.toggleFilter(kind);
            const selectedEventID = retainedEventID(store.state.events?.events ?? [], store.state.selectedEventID);
            if (selectedEventID !== store.state.selectedEventID) store.change({selectedEventID});
        };
    });
    const events = (state.events?.events ?? []).filter((event) => state.eventFilters.has(event.kind));
    required('event-count').textContent = String(events.length);
    required('event-list').innerHTML = events.length ? events.map((event) => `
      <button class="event-item ${event.id === state.selectedEventID ? 'selected' : ''}" data-event-id="${escapeHTML(event.id)}"
              aria-pressed="${event.id === state.selectedEventID}">
        <i class="event-symbol ${event.kind}">${symbolFor(event.kind)}</i>
        <span><strong>${escapeHTML(event.title)}</strong><small>${shortUTC(Date.parse(event.startTime))}</small></span>
        <em>${event.provenance?.class?.slice(0, 3).toUpperCase() ?? '—'}</em>
      </button>`).join('') : '<div class="empty-state"><strong>No matching events</strong><span>Load a range or enable another phenomenon.</span></div>';
    document.querySelectorAll<HTMLButtonElement>('[data-event-id]').forEach((button) => {
        button.onclick = () => {
            const id = button.dataset.eventId;
            if (!id) return;
            selectEvent(id);
        };
    });
}

function renderDetail(): void {
    const event = store.state.events?.events.find((item) => item.id === store.state.selectedEventID);
    const signature = event?.id ?? 'none';
    if (signature === lastDetailRender) return;
    lastDetailRender = signature;
    if (!event) {
        required('event-detail').innerHTML = `
          <span class="eyebrow">Selected event</span>
          <div class="empty-detail"><span class="orbit-icon">◎</span><p>Select an event to inspect its measurements, links, and provenance.</p></div>`;
        return;
    }
    const facts: Array<[string, string]> = [];
    if (event.cme) {
        facts.push(['Speed', numberUnit(event.cme.speedKms, 'km/s')]);
        facts.push(['Half-angle', numberUnit(event.cme.halfAngleDeg, '°')]);
        facts.push(['Direction', event.cme.directionKnown
            ? `${formatValue(event.cme.latitudeDeg)}° lat · ${formatValue(event.cme.longitudeDeg)}° lon`
            : 'Unknown — no cone direction assigned']);
    }
    if (event.flare) {
        facts.push(['GOES class', event.flare.classType || '—']);
        facts.push(['Location', event.flare.locationParsed ? event.flare.sourceLocation || '—' : 'Unparsed']);
        facts.push(['Peak flux', event.flare.peakFluxWattsM2?.toExponential(2) + ' W/m²']);
    }
    if (event.storm) facts.push(['Maximum Kp', numberUnit(event.storm.kpMax, '')]);
    required('event-detail').innerHTML = `
      <span class="eyebrow">Selected ${escapeHTML(event.kind)}</span>
      <h3>${escapeHTML(event.title)}</h3>
      <time>${longUTC(Date.parse(event.startTime))}</time>
      <dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
      ${event.note ? `<p class="event-note">${escapeHTML(event.note)}</p>` : ''}
      <div class="provenance">
        <i class="${event.provenance?.class ?? ''}"></i>
        <span><strong>${escapeHTML(event.provenance?.class ?? 'unknown')}</strong>${escapeHTML(event.provenance?.provider)} · ${escapeHTML(event.provenance?.dataset)}${event.provenance?.stale ? ' · STALE CACHE' : event.provenance?.cached ? ' · cached' : ''}</span>
      </div>
      <button id="clear-selection" class="secondary-button clear-selection-button">Clear selection</button>`;
    required('clear-selection').onclick = () => clearEventSelection();
}

function renderForecast(): void {
    const forecasts = store.state.forecasts?.forecasts ?? [];
    const forecast = forecasts
        .filter((item) => item.earthArrivalTime)
        .sort((a, b) => Date.parse(b.completionTime || '0') - Date.parse(a.completionTime || '0'))[0] ?? forecasts[0];
    const signature = `${forecast?.id}|${forecast?.earthArrivalTime}|${forecast?.points?.length}`;
    if (signature === lastForecastRender) return;
    lastForecastRender = signature;
    required('forecast-card').innerHTML = forecast ? `
      <div><span class="eyebrow">Model forecast</span><span class="forecast-pill">FORECAST</span></div>
      <h3>${escapeHTML(forecast.model)}</h3>
      <dl>
        <div><dt>Earth arrival</dt><dd>${forecast.earthArrivalTime ? longUTC(Date.parse(forecast.earthArrivalTime)) : 'No predicted impact'}</dd></div>
        <div><dt>Run completed</dt><dd>${forecast.completionTime ? longUTC(Date.parse(forecast.completionTime)) : 'Current SWPC series'}</dd></div>
      </dl>
      <p class="muted">${escapeHTML(forecast.provenance?.provider)} · ${escapeHTML(forecast.provenance?.dataset)}${forecast.provenance?.stale ? ' · STALE CACHE' : forecast.provenance?.cached ? ' · cached' : ''}</p>` : '';
}

function renderCharts(): void {
    const state = store.state;
    const telemetry = state.telemetry;
    const telemetryLoading = state.loading.has('telemetry');
    const points = telemetry?.points ?? state.live?.recent ?? [];
    const event = selectedEvent();
    const markerTime = event ? eventCatalogTime(event) : undefined;
    const signature = [
        points.length,
        points[0]?.time,
        points[points.length - 1]?.time,
        telemetry?.query?.start,
        telemetry?.query?.end,
        telemetry?.provenance?.retrievedAt,
        telemetry?.gaps?.map((gap) => `${gap.start}:${gap.end}`).join(','),
        telemetry?.issues?.map((issue) => `${issue.provider}:${issue.code}:${issue.message}`).join('|'),
        state.rangeStart,
        state.rangeEnd,
        Math.round(state.cursor / 60_000),
        telemetryLoading,
        state.telemetryError,
        event?.id,
        markerTime,
    ].join('|');
    if (signature === lastChartRender) return;
    lastChartRender = signature;
    if (telemetryLoading) {
        renderTelemetryState(
            'loading',
            'Fetching OMNI and recent NOAA telemetry…',
            `${longUTC(state.rangeStart)} – ${longUTC(state.rangeEnd)}`,
        );
        return;
    }
    if (state.telemetryError) {
        renderTelemetryState(
            'error',
            'Telemetry request finished with an error',
            `${state.telemetryError} No background retry is running.`,
        );
        return;
    }
    if (!points.length && telemetry?.issues?.length) {
        renderTelemetryState(
            'error',
            'Replay telemetry providers returned no usable data',
            `${telemetry.issues.map((issue) =>
                `${issue.provider}: ${issue.message}`).join(' ')} No background retry is running.`,
        );
        return;
    }
    renderTelemetryCharts(
        required('charts'),
        points,
        {
            start: state.rangeStart,
            end: state.rangeEnd,
            cursor: state.cursor,
            gaps: telemetry?.gaps,
            dataset: telemetry?.dataset,
            issueCount: telemetry?.issues?.length,
            cached: telemetry?.provenance?.cached,
            stale: telemetry?.provenance?.stale,
            selectedEvent: event && markerTime !== undefined
                ? {time: markerTime, label: event.title}
                : undefined,
        },
    );
}

function renderTelemetryState(kind: 'loading' | 'error', title: string, detail: string): void {
    required('charts').innerHTML = `
      <div class="telemetry-state ${kind}" role="status">
        <i aria-hidden="true"></i>
        <span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></span>
      </div>`;
}

function selectedEvent(): domain.EventDTO | undefined {
    return store.state.events?.events.find((event) => event.id === store.state.selectedEventID);
}

function selectEvent(id: string): void {
    const event = store.state.events?.events.find((item) => item.id === id);
    if (!event) return;
    if (store.state.selectedEventID === id) {
        clearEventSelection();
        return;
    }
    const patch: Partial<AppState> = {selectedEventID: id};
    if (store.state.mode === 'replay') {
        patch.cursor = eventFocusTime(event);
        patch.playing = false;
    }
    store.change(patch);
}

function clearEventSelection(): void {
    if (store.state.selectedEventID === undefined) return;
    store.change({selectedEventID: undefined});
}

function eventCatalogTime(event: domain.EventDTO): number | undefined {
    const kindTime = event.kind === 'cme'
        ? event.cme?.analysisTime
        : event.kind === 'flare'
            ? event.flare?.peakTime
            : event.kind === 'hss'
                ? event.hss?.eventTime
                : event.kind === 'sep'
                    ? event.sep?.eventTime
                    : event.kind === 'ips'
                        ? event.ips?.eventTime
                        : undefined;
    return firstValidTime(kindTime, event.startTime);
}

function eventFocusTime(event: domain.EventDTO): number {
    const catalogTime = eventCatalogTime(event) ?? store.state.cursor;
    let focusTime = catalogTime;
    if (event.kind === 'cme' && event.cme?.directionKnown &&
        event.cme.speedKms && event.cme.speedKms > 0) {
        const travelAU = Math.max(0, SELECTED_CME_FOCUS_AU - INITIAL_CME_RADIUS_AU);
        focusTime += travelAU * AU_KM / event.cme.speedKms * 1_000;
    }
    return Math.max(store.state.rangeStart, Math.min(store.state.rangeEnd, focusTime));
}

function firstValidTime(...values: Array<string | undefined>): number | undefined {
    for (const value of values) {
        if (!value) continue;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

async function loadDemo(): Promise<void> {
    store.setLoading('demo', true);
    try {
        const demo = await backend.demo();
        store.change({
            mode: 'replay',
            events: demo.events,
            telemetry: demo.telemetry,
            telemetryError: undefined,
            forecasts: demo.forecasts,
            selectedEventID: undefined,
            playing: false,
            status: demo.description,
        });
        store.setRange(Date.parse(demo.start), Date.parse(demo.end), Date.parse(demo.cursor));
    } catch (error) {
        fail(error);
    } finally {
        store.setLoading('demo', false);
    }
}

async function loadRange(start: Date, end: Date): Promise<void> {
    store.change({
        mode: 'replay',
        live: undefined,
        telemetry: undefined,
        telemetryError: undefined,
        selectedEventID: undefined,
        playing: false,
        status: 'Loading independent provider streams…',
    });
    store.setRange(start.getTime(), end.getTime(), start.getTime());
    const query = new domain.EventQuery({
        start: start.toISOString(),
        end: end.toISOString(),
        kinds: [...store.state.eventFilters],
    });
    const telemetryQuery = new domain.TelemetryQuery({
        start: start.toISOString(),
        end: end.toISOString(),
        maxPoints: 4_000,
    });
    const range = new domain.TimeRange({start: start.toISOString(), end: end.toISOString()});
    store.setLoading('events', true);
    store.setLoading('telemetry', true);
    store.setLoading('forecast', true);
    const [events, telemetry, forecasts] = await Promise.allSettled([
        backend.events(query),
        backend.telemetry(telemetryQuery),
        backend.forecasts(range),
    ]);
    if (events.status === 'fulfilled') {
        store.change({events: events.value, selectedEventID: undefined});
        reportIssues(events.value.issues);
    }
    else toast(`Events: ${errorText(events.reason)}`);
    if (telemetry.status === 'fulfilled') {
        store.change({telemetry: telemetry.value, telemetryError: undefined});
        reportIssues(telemetry.value.issues);
    } else {
        const message = errorText(telemetry.reason);
        store.change({telemetryError: message});
        toast(`Telemetry: ${message}`);
    }
    if (forecasts.status === 'fulfilled') {
        store.change({forecasts: forecasts.value});
        reportIssues(forecasts.value.issues);
    }
    else toast(`Forecast: ${errorText(forecasts.reason)}`);
    store.setLoading('events', false);
    store.setLoading('telemetry', false);
    store.setLoading('forecast', false);
    const successes = [events, telemetry, forecasts].filter((result) => result.status === 'fulfilled').length;
    store.change({status: `${successes}/3 data streams loaded. Missing streams do not blank the view.`});
}

async function enterLive(): Promise<void> {
    if (!backend.available()) {
        toast('Live feeds require the Wails desktop runtime.');
        return;
    }
    rememberReplay();
    const requestVersion = ++liveRequestVersion;
    const end = new Date();
    const start = new Date(end.getTime() - LIVE_EVENT_WINDOW_MS);
    store.change({
        mode: 'live',
        telemetryError: undefined,
        playing: false,
        status: 'Contacting NOAA SWPC…',
    });
    store.setLoading('live', true);
    const livePromise = backend.live();
    const eventPromise = backend.events(new domain.EventQuery({
        start: start.toISOString(),
        end: end.toISOString(),
        kinds: [...store.state.eventFilters],
    }));
    const [live, events] = await Promise.allSettled([livePromise, eventPromise]);
    if (requestVersion !== liveRequestVersion || store.state.mode !== 'live') {
        store.setLoading('live', false);
        return;
    }
    if (live.status === 'fulfilled') {
        applyLiveSnapshot(
            live.value,
            `Live NOAA observations · ${live.value.plasmaSource || 'active spacecraft'}`,
            end.getTime(),
        );
        reportIssues(live.value.issues);
    } else {
        toast(errorText(live.reason));
        store.change({mode: 'replay', status: 'Live data unavailable; the existing replay remains visible.'});
    }
    if (events.status === 'fulfilled' && live.status === 'fulfilled') {
        store.change({
            events: events.value,
            selectedEventID: retainedEventID(events.value.events, store.state.selectedEventID),
        });
        reportIssues(events.value.issues);
    }
    store.setLoading('live', false);
    scheduleLiveRefresh();
}

function rememberReplay(): void {
    if (store.state.mode !== 'replay') return;
    replaySnapshot = {
        events: store.state.events,
        telemetry: store.state.telemetry,
        telemetryError: store.state.telemetryError,
        forecasts: store.state.forecasts,
        rangeStart: store.state.rangeStart,
        rangeEnd: store.state.rangeEnd,
        status: store.state.status,
    };
}

function enterReplay(): void {
    liveRequestVersion++;
    if (liveTimer !== undefined) {
        window.clearInterval(liveTimer);
        liveTimer = undefined;
    }
    store.setLoading('live', false);
    if (!replaySnapshot) {
        store.change({
            mode: 'replay',
            live: undefined,
            selectedEventID: undefined,
            playing: false,
            cursor: store.state.rangeStart,
        });
        return;
    }
    store.change({
        ...replaySnapshot,
        mode: 'replay',
        live: undefined,
        selectedEventID: undefined,
        playing: false,
        cursor: replaySnapshot.rangeStart,
    });
}

function applyLiveSnapshot(snapshot: domain.LiveSnapshotDTO, status: string, fallbackEnd = Date.now()): void {
    const timedPoints = (snapshot.recent ?? [])
        .map((point) => ({point, time: Date.parse(point.time)}))
        .filter((item) => Number.isFinite(item.time));
    const snapshotTime = Date.parse(snapshot.time);
    const observedTimes = timedPoints.map((item) => item.time);
    if (Number.isFinite(snapshotTime)) observedTimes.push(snapshotTime);
    const end = observedTimes.length ? Math.max(...observedTimes) : fallbackEnd;
    const start = end - LIVE_TELEMETRY_WINDOW_MS;
    const points = timedPoints
        .filter((item) => item.time >= start && item.time <= end)
        .map((item) => item.point);
    const telemetry = new domain.TelemetrySeriesDTO({
        query: {start: new Date(start).toISOString(), end: new Date(end).toISOString()},
        dataset: 'NOAA RTSW',
        location: 'L1',
        coordinateFrame: 'GSE/GSM',
        cadenceSeconds: 60,
        points,
        provenance: snapshot.provenance?.[0],
        contributors: snapshot.provenance,
    });
    store.change({
        live: snapshot,
        telemetry,
        telemetryError: undefined,
        rangeStart: start,
        rangeEnd: end,
        cursor: end,
        playing: false,
        status,
    });
}

function retainedEventID(events: domain.EventDTO[], preferred?: string): string | undefined {
    if (!preferred) return undefined;
    return events.some((event) =>
        event.id === preferred && store.state.eventFilters.has(event.kind))
        ? preferred
        : undefined;
}

function scheduleLiveRefresh(): void {
    if (liveTimer !== undefined) window.clearInterval(liveTimer);
    const seconds = store.state.bootstrap?.settings.liveRefreshSeconds ?? 60;
    liveTimer = window.setInterval(async () => {
        if (store.state.mode !== 'live') return;
        try {
            const snapshot = await backend.live();
            applyLiveSnapshot(snapshot, 'Live NOAA observations updated');
            reportIssues(snapshot.issues);
        } catch (error) {
            store.change({status: `Live refresh failed · ${errorText(error)}`});
        }
    }, Math.max(30, seconds) * 1_000);
}

function currentBundle(): domain.ExportBundle {
    return new domain.ExportBundle({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        view: {
            cursor: new Date(store.state.cursor).toISOString(),
            start: new Date(store.state.rangeStart).toISOString(),
            end: new Date(store.state.rangeEnd).toISOString(),
            scale: store.state.scale,
            selectedEventID: store.state.selectedEventID,
        },
        events: store.state.events?.events ?? [],
        telemetry: store.state.telemetry,
        forecasts: store.state.forecasts?.forecasts ?? [],
    });
}

function toggleReplayPlayback(): void {
    if (store.state.mode === 'live') return;
    if (store.state.playing) {
        store.change({playing: false});
        return;
    }
    store.change({
        cursor: store.state.cursor >= store.state.rangeEnd
            ? store.state.rangeStart
            : store.state.cursor,
        playing: true,
    });
}

function wireInteractions(): void {
    required('demo-button').onclick = () => void loadDemo();
    required('guide-button').onclick = () => showGuide(0);
    required('reset-camera').onclick = () => scene.resetCamera();
    required('range-button').onclick = () => openRangeDialog();
    required('settings-button').onclick = () => openSettings();
    required('play-button').onclick = () => toggleReplayPlayback();
    required<HTMLSelectElement>('playback-rate').onchange = (event) =>
        store.change({playbackRate: Number((event.target as HTMLSelectElement).value)});
    required<HTMLInputElement>('timeline').oninput = (event) => {
        const fraction = Number((event.target as HTMLInputElement).value) / 10_000;
        store.change({
            cursor: store.state.rangeStart + fraction * (store.state.rangeEnd - store.state.rangeStart),
            playing: false,
        });
    };
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
        button.onclick = () => button.dataset.mode === 'live'
            ? void enterLive()
            : enterReplay();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((button) => {
        button.onclick = () => store.change({scale: button.dataset.scale as RadialScale});
    });
    required<HTMLFormElement>('range-form').addEventListener('submit', (event) => {
        const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value !== 'default') return;
        event.preventDefault();
        const start = utcInputDate(required<HTMLInputElement>('range-start-input').value);
        const end = utcInputDate(required<HTMLInputElement>('range-end-input').value);
        if (!start || !end || end <= start) {
            toast('Choose an end time after the start time.');
            return;
        }
        const checked = Array.from(document.querySelectorAll<HTMLInputElement>('#dialog-event-filters input:checked'))
            .map((input) => input.value);
        store.state.eventFilters = new Set(checked);
        required<HTMLDialogElement>('range-dialog').close();
        void loadRange(start, end);
    });
    required('export-image-button').onclick = () => void runExport(async () =>
        backend.exportPNG(scene.screenshot()), 'Image exported');
    required('export-text-button').onclick = () => void runExport(async () =>
        backend.exportText(currentBundle()), 'Text summary exported');
    required('export-bundle-button').onclick = () => void runExport(async () =>
        backend.exportBundle(currentBundle()), 'Replay bundle exported');
    required('import-button').onclick = () => void importBundle();
    required('clear-cache-button').onclick = () => void clearCache();
    required('model-import-button').onclick = () => void inspectModel();
    required<HTMLFormElement>('settings-form').addEventListener('submit', (event) => {
        const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value !== 'default') return;
        event.preventDefault();
        void saveSettings();
    });
    required('guide-skip').onclick = () => closeGuide();
    required('guide-next').onclick = () => advanceGuide();
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
        clearEventSelection();
    });
}

function openRangeDialog(): void {
    required<HTMLInputElement>('range-start-input').value = utcInput(store.state.rangeStart);
    required<HTMLInputElement>('range-end-input').value = utcInput(store.state.rangeEnd);
    required<HTMLDialogElement>('range-dialog').showModal();
}

function openSettings(): void {
    const settings = store.state.bootstrap?.settings;
    required<HTMLSelectElement>('default-scale').value = settings?.preferredScale ?? store.state.scale;
    required<HTMLInputElement>('reduced-motion').checked = settings?.reducedMotion ?? false;
    required<HTMLInputElement>('nasa-key').value = '';
    required<HTMLInputElement>('clear-key').checked = false;
    const cacheBytes = store.state.bootstrap?.cacheBytes ?? 0;
    required('cache-summary').textContent = `Cache: ${formatBytes(cacheBytes)} · limit ${formatBytes(settings?.cacheLimitBytes ?? 0)}`;
    required<HTMLDialogElement>('settings-dialog').showModal();
}

async function saveSettings(): Promise<void> {
    if (!backend.available()) {
        toast('Settings persistence requires the desktop runtime.');
        return;
    }
    const key = required<HTMLInputElement>('nasa-key').value.trim();
    const update = new domain.SettingsUpdate({
        clearNasaApiKey: required<HTMLInputElement>('clear-key').checked,
        preferredScale: required<HTMLSelectElement>('default-scale').value,
        reducedMotion: required<HTMLInputElement>('reduced-motion').checked,
    });
    if (key) update.nasaApiKey = key;
    try {
        const settings = await backend.saveSettings(update);
        if (store.state.bootstrap) store.state.bootstrap.settings = settings;
        store.change({
            scale: settings.preferredScale as RadialScale,
            status: 'Settings saved securely by the Go backend.',
        });
        document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
        required<HTMLDialogElement>('settings-dialog').close();
    } catch (error) {
        toast(errorText(error));
    }
}

async function clearCache(): Promise<void> {
    try {
        await backend.clearCache();
        if (store.state.bootstrap) store.state.bootstrap.cacheBytes = 0;
        required('cache-summary').textContent = 'Cache: empty';
        toast('Cached provider responses cleared.');
    } catch (error) {
        toast(errorText(error));
    }
}

async function inspectModel(): Promise<void> {
    try {
        const result = await backend.importModel();
        required('model-status').textContent = result.ready
            ? `${result.name}: ${result.timeSteps} steps, ${result.gridShape?.join(' × ')}`
            : result.message || 'Model is not ready to render.';
    } catch (error) {
        toast(errorText(error));
    }
}

async function importBundle(): Promise<void> {
    try {
        const bundle = await backend.importBundle();
        const importedEvents = bundle.events ?? [];
        const importedForecasts = bundle.forecasts ?? [];
        const times = bundle.telemetry?.points?.map((point) => Date.parse(point.time)) ?? [];
        const eventTimes = importedEvents.map((event) => Date.parse(event.startTime));
        const allTimes = [...times, ...eventTimes].filter(Number.isFinite);
        const view = bundle.view ?? {};
        const fallbackEnd = allTimes.length ? Math.max(...allTimes) : Date.now();
        const fallbackStart = allTimes.length ? Math.min(...allTimes) : fallbackEnd - 86_400_000;
        const start = typeof view.start === 'string' ? Date.parse(view.start) : fallbackStart;
        const end = typeof view.end === 'string' ? Date.parse(view.end) : fallbackEnd;
        const cursor = typeof view.cursor === 'string' ? Date.parse(view.cursor) : end;
        store.change({
            mode: 'replay',
            events: new domain.EventSearchResult({
                query: {start: new Date(start).toISOString(), end: new Date(end).toISOString()},
                events: importedEvents,
                complete: true,
                fromCache: true,
                generatedAt: bundle.createdAt,
            }),
            telemetry: bundle.telemetry,
            telemetryError: undefined,
            forecasts: new domain.ForecastResult({
                forecasts: importedForecasts,
                generatedAt: bundle.createdAt,
            }),
            scale: view.scale === 'compressed' ? 'compressed' : 'linear',
            selectedEventID: retainedEventID(
                importedEvents,
                typeof view.selectedEventID === 'string' ? view.selectedEventID : undefined,
            ),
            status: 'Imported replay bundle.',
        });
        store.setRange(start, end, cursor);
    } catch (error) {
        toast(errorText(error));
    }
}

async function runExport(action: () => Promise<string>, label: string): Promise<void> {
    if (!backend.available()) {
        toast('File dialogs are available in the Wails desktop runtime.');
        return;
    }
    try {
        const path = await action();
        if (path) toast(`${label}: ${path}`);
    } catch (error) {
        toast(errorText(error));
    }
}

const guidePages = [
    {
        title: 'Read the layers honestly',
        copy: 'Teal observations come from instruments, violet layers are model forecasts, and amber geometry is illustrative. Every selected event carries its provider and classification.',
    },
    {
        title: 'Move through physical time',
        copy: 'Drag the UTC timeline or press play. CME fronts use their measured speed and reported direction; the animation does not bend them to match a forecast arrival.',
    },
    {
        title: 'Compare the signal at Earth',
        copy: 'The charts follow solar-wind speed, proton density, and IMF Bz. A sustained negative Bz can matter for coupling, but this app is an educational explorer—not an alert service.',
    },
];
let guideIndex = 0;

function showGuide(index: number): void {
    guideIndex = index;
    const page = guidePages[index];
    required('guide-step').textContent = `${index + 1} of ${guidePages.length}`;
    required('guide-title').textContent = page.title;
    required('guide-copy').textContent = page.copy;
    required('guide-next').textContent = index === guidePages.length - 1 ? 'Explore' : 'Next';
    document.querySelectorAll('.guide-progress i').forEach((item, position) =>
        item.classList.toggle('active', position <= index));
    required('guide').classList.remove('hidden');
}

function advanceGuide(): void {
    if (guideIndex >= guidePages.length - 1) {
        closeGuide();
        localStorage.setItem('solar-weather-guide', 'complete');
        return;
    }
    showGuide(guideIndex + 1);
}

function closeGuide(): void {
    required('guide').classList.add('hidden');
}

function toast(message: string): void {
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    required('toast-region').append(item);
    window.setTimeout(() => item.remove(), 5_500);
}

function reportIssues(issues: domain.ProviderIssue[] | undefined): void {
    if (!issues?.length) return;
    const shown = issues.slice(0, 3);
    for (const issue of shown) toast(`${issue.provider}: ${issue.message}`);
    if (issues.length > shown.length) toast(`${issues.length - shown.length} additional provider warnings`);
}

function fail(error: unknown): void {
    const message = errorText(error);
    store.change({status: message});
    toast(message);
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : 'Unexpected application error';
}

function symbolFor(kind: string): string {
    return ({cme: '◉', flare: '✦', hss: '≈', sep: '•', ips: '⌁', storm: '⌾'} as Record<string, string>)[kind] ?? '•';
}

function formatValue(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) < 0.01 && value !== 0) return value.toExponential(1);
    return value.toFixed(1);
}

function numberUnit(value: number | undefined, unit: string): string {
    return value === undefined ? '—' : `${formatValue(value)} ${unit}`.trim();
}

function longUTC(milliseconds: number): string {
    if (!Number.isFinite(milliseconds)) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(milliseconds) + ' UTC';
}

function shortUTC(milliseconds: number): string {
    if (!Number.isFinite(milliseconds)) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(milliseconds);
}

function formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    const level = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, level)).toFixed(level ? 1 : 0)} ${units[level]}`;
}

function escapeHTML(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function start(): Promise<void> {
    wireInteractions();
    try {
        const bootstrap = await backend.bootstrap();
        store.change({
            bootstrap,
            scale: bootstrap.settings.preferredScale as RadialScale,
            status: backend.available() ? 'Backend ready. Loading the guided replay…' : 'Browser preview · built-in replay',
        });
        document.documentElement.classList.toggle('reduced-motion', bootstrap.settings.reducedMotion);
    } catch (error) {
        fail(error);
    }
    await loadDemo();
    if (!localStorage.getItem('solar-weather-guide') &&
        !new URLSearchParams(location.search).has('skipGuide')) {
        showGuide(0);
    }
}

function animate(now: number): void {
    store.tick(now);
    scene.render(now);
    requestAnimationFrame(animate);
}

void start();
requestAnimationFrame(animate);
