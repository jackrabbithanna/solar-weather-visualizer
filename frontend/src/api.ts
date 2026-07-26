import {
    Bootstrap,
    ClearCache,
    ExportBundle,
    ExportPNG,
    ExportText,
    GetSettings,
    ImportBundle,
    ImportModel,
    LoadDemoScenario,
    LoadEphemeris,
    LoadForecasts,
    LoadTelemetry,
    PreviewNCEIArchive,
    RefreshLive,
    SaveSettings,
    SearchEvents,
} from '../wailsjs/go/main/App';
import {domain} from '../wailsjs/go/models';

const hasWails = (): boolean =>
    typeof window !== 'undefined' &&
    'go' in window &&
    typeof (window as Window & {go?: unknown}).go === 'object';

export const backend = {
    available: hasWails,

    async bootstrap(): Promise<domain.BootstrapDTO> {
        if (hasWails()) return Bootstrap();
        return new domain.BootstrapDTO({
            version: 'browser preview',
            generatedAt: new Date().toISOString(),
            settings: {
                nasaKeyConfigured: false,
                cacheLimitBytes: 1_073_741_824,
                liveRefreshSeconds: 60,
                fullRtswRefreshSeconds: 900,
                eventRefreshSeconds: 900,
                preferredScale: 'linear',
                reducedMotion: false,
            },
            providers: [],
            cacheBytes: 0,
            offlineReady: true,
        });
    },

    async demo(): Promise<domain.DemoScenarioDTO> {
        if (hasWails()) return LoadDemoScenario();
        return browserDemo();
    },

    events(query: domain.EventQuery): Promise<domain.EventSearchResult> {
        if (!hasWails()) return Promise.reject(new Error('Live providers are available in the Wails desktop app.'));
        return SearchEvents(query);
    },

    telemetry(query: domain.TelemetryQuery): Promise<domain.TelemetrySeriesDTO> {
        if (!hasWails()) return Promise.reject(new Error('Historical Replay telemetry is available in the Wails desktop app.'));
        return LoadTelemetry(query);
    },

    forecasts(range: domain.TimeRange): Promise<domain.ForecastResult> {
        if (!hasWails()) return Promise.reject(new Error('Forecast feeds are available in the Wails desktop app.'));
        return LoadForecasts(range);
    },

    ephemeris(range: domain.TimeRange): Promise<domain.EphemerisResult> {
        if (!hasWails()) return Promise.reject(new Error('Exact JPL ephemerides are available in the Wails desktop app.'));
        return LoadEphemeris(range);
    },

    live: RefreshLive,
    settings: GetSettings,
    saveSettings: SaveSettings,
    clearCache: ClearCache,
    exportPNG: ExportPNG,
    exportText: ExportText,
    exportBundle: ExportBundle,
    importBundle: ImportBundle,
    previewArchive: PreviewNCEIArchive,
    importModel: ImportModel,
};

function browserDemo(): domain.DemoScenarioDTO {
    const start = new Date('2025-11-11T00:00:00Z');
    const end = new Date('2025-11-14T00:00:00Z');
    const telemetry: domain.TelemetryPoint[] = [];
    const sampleCount = (end.getTime() - start.getTime()) / (15 * 60_000);
    for (let index = 0; index <= sampleCount; index++) {
        const time = new Date(start.getTime() + index * 15 * 60_000);
        const hours = (time.getTime() - start.getTime()) / 3_600_000;
        const pulse = Math.exp(-Math.pow((hours - 27) / 5.5, 2));
        const speed = 385 + 390 * pulse + 24 * Math.sin(hours / 2.7);
        const density = 4.2 + 15 * Math.exp(-Math.pow((hours - 24.5) / 1.5, 2));
        const bz = 2.2 * Math.sin(hours / 3.2) - 15 * Math.exp(-Math.pow((hours - 28) / 3.8, 2));
        telemetry.push(new domain.TelemetryPoint({
            time: time.toISOString(),
            source: 'DEMO',
            imfAnchor: 'earth',
            plasmaAnchor: 'earth',
            speedKms: speed,
            densityPerCm3: density,
            pressureNPa: density * 1.67262192369e-6 * speed * speed,
            fieldMagnitudeNt: 5 + 17 * pulse,
            bzGsmNt: bz,
        }));
    }
    const provenance = {
        provider: 'Built-in browser demo',
        dataset: 'Illustrative walkthrough',
        retrievedAt: start.toISOString(),
        class: 'illustrative',
        cached: false,
        stale: false,
    };
    return new domain.DemoScenarioDTO({
        name: 'CME passage walkthrough',
        description: 'A deterministic 72-hour replay for learning the controls.',
        start: start.toISOString(),
        end: end.toISOString(),
        cursor: start.toISOString(),
        events: {
            query: {start: start.toISOString(), end: end.toISOString()},
            complete: true,
            fromCache: false,
            generatedAt: new Date().toISOString(),
            events: [
                {
                    id: 'demo-cme',
                    kind: 'cme',
                    title: 'Fast Earth-directed CME',
                    startTime: new Date(start.getTime() + 90 * 60_000).toISOString(),
                    cme: {
                        analysisTime: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
                        latitudeDeg: 8,
                        longitudeDeg: -12,
                        halfAngleDeg: 48,
                        speedKms: 1180,
                        isMostAccurate: true,
                        directionKnown: true,
                    },
                    provenance,
                },
                {
                    id: 'demo-flare',
                    kind: 'flare',
                    title: 'M3.4 solar flare',
                    startTime: new Date(start.getTime() + 60 * 60_000).toISOString(),
                    endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
                    flare: {
                        peakTime: new Date(start.getTime() + 80 * 60_000).toISOString(),
                        classType: 'M3.4',
                        sourceLocation: 'N08E12',
                        latitudeDeg: 8,
                        longitudeDeg: -12,
                        locationParsed: true,
                        peakFluxWattsM2: 3.4e-5,
                    },
                    provenance,
                },
                {
                    id: 'demo-hss',
                    kind: 'hss',
                    title: 'High-speed stream',
                    startTime: new Date(start.getTime() + 32 * 3_600_000).toISOString(),
                    hss: {eventTime: new Date(start.getTime() + 32 * 3_600_000).toISOString()},
                    provenance,
                },
            ],
        },
        telemetry: {
            query: {start: start.toISOString(), end: end.toISOString()},
            dataset: 'DEMO_15MIN',
            location: 'Earth',
            coordinateFrame: 'GSM',
            cadenceSeconds: 900,
            points: telemetry,
            provenance,
            contributors: [provenance],
        },
        forecasts: {
            forecasts: [],
            generatedAt: new Date().toISOString(),
        },
    });
}
