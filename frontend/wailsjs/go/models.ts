export namespace domain {
	
	export class ProviderStatus {
	    provider: string;
	    available: boolean;
	    lastSuccess?: string;
	    lastError?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.available = source["available"];
	        this.lastSuccess = source["lastSuccess"];
	        this.lastError = source["lastError"];
	    }
	}
	export class SettingsDTO {
	    nasaKeyConfigured: boolean;
	    cacheLimitBytes: number;
	    liveRefreshSeconds: number;
	    fullRtswRefreshSeconds: number;
	    eventRefreshSeconds: number;
	    preferredScale: string;
	    reducedMotion: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SettingsDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nasaKeyConfigured = source["nasaKeyConfigured"];
	        this.cacheLimitBytes = source["cacheLimitBytes"];
	        this.liveRefreshSeconds = source["liveRefreshSeconds"];
	        this.fullRtswRefreshSeconds = source["fullRtswRefreshSeconds"];
	        this.eventRefreshSeconds = source["eventRefreshSeconds"];
	        this.preferredScale = source["preferredScale"];
	        this.reducedMotion = source["reducedMotion"];
	    }
	}
	export class BootstrapDTO {
	    version: string;
	    generatedAt: string;
	    settings: SettingsDTO;
	    providers: ProviderStatus[];
	    cacheBytes: number;
	    offlineReady: boolean;
	
	    static createFrom(source: any = {}) {
	        return new BootstrapDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.generatedAt = source["generatedAt"];
	        this.settings = this.convertValues(source["settings"], SettingsDTO);
	        this.providers = this.convertValues(source["providers"], ProviderStatus);
	        this.cacheBytes = source["cacheBytes"];
	        this.offlineReady = source["offlineReady"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CMEData {
	    analysisTime?: string;
	    latitudeDeg?: number;
	    longitudeDeg?: number;
	    halfAngleDeg?: number;
	    minorHalfWidthDeg?: number;
	    tiltDeg?: number;
	    speedKms?: number;
	    speedClass?: string;
	    featureCode?: string;
	    dataLevel?: number;
	    measurement?: string;
	    isMostAccurate: boolean;
	    directionKnown: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CMEData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.analysisTime = source["analysisTime"];
	        this.latitudeDeg = source["latitudeDeg"];
	        this.longitudeDeg = source["longitudeDeg"];
	        this.halfAngleDeg = source["halfAngleDeg"];
	        this.minorHalfWidthDeg = source["minorHalfWidthDeg"];
	        this.tiltDeg = source["tiltDeg"];
	        this.speedKms = source["speedKms"];
	        this.speedClass = source["speedClass"];
	        this.featureCode = source["featureCode"];
	        this.dataLevel = source["dataLevel"];
	        this.measurement = source["measurement"];
	        this.isMostAccurate = source["isMostAccurate"];
	        this.directionKnown = source["directionKnown"];
	    }
	}
	export class DataGap {
	    start: string;
	    end: string;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new DataGap(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.reason = source["reason"];
	    }
	}
	export class ForecastPoint {
	    time: string;
	    densityPerCm3?: number;
	    temperatureK?: number;
	    speedKms?: number;
	    brNt?: number;
	    bThetaNt?: number;
	    bPhiNt?: number;
	    polarity?: number;
	    cloud?: number;
	
	    static createFrom(source: any = {}) {
	        return new ForecastPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.densityPerCm3 = source["densityPerCm3"];
	        this.temperatureK = source["temperatureK"];
	        this.speedKms = source["speedKms"];
	        this.brNt = source["brNt"];
	        this.bThetaNt = source["bThetaNt"];
	        this.bPhiNt = source["bPhiNt"];
	        this.polarity = source["polarity"];
	        this.cloud = source["cloud"];
	    }
	}
	export class ImpactDTO {
	    location: string;
	    arrivalTime?: string;
	    glancingBlow: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ImpactDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.location = source["location"];
	        this.arrivalTime = source["arrivalTime"];
	        this.glancingBlow = source["glancingBlow"];
	    }
	}
	export class ForecastDTO {
	    id: string;
	    model: string;
	    completionTime?: string;
	    domainAu?: number;
	    earthArrivalTime?: string;
	    estimatedDurationHours?: number;
	    minMagnetopauseRe?: number;
	    kp18?: number;
	    kp90?: number;
	    kp135?: number;
	    kp180?: number;
	    earthGlancingBlow: boolean;
	    impacts?: ImpactDTO[];
	    linkedCmeIds?: string[];
	    points?: ForecastPoint[];
	    provenance: Provenance;
	
	    static createFrom(source: any = {}) {
	        return new ForecastDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.model = source["model"];
	        this.completionTime = source["completionTime"];
	        this.domainAu = source["domainAu"];
	        this.earthArrivalTime = source["earthArrivalTime"];
	        this.estimatedDurationHours = source["estimatedDurationHours"];
	        this.minMagnetopauseRe = source["minMagnetopauseRe"];
	        this.kp18 = source["kp18"];
	        this.kp90 = source["kp90"];
	        this.kp135 = source["kp135"];
	        this.kp180 = source["kp180"];
	        this.earthGlancingBlow = source["earthGlancingBlow"];
	        this.impacts = this.convertValues(source["impacts"], ImpactDTO);
	        this.linkedCmeIds = source["linkedCmeIds"];
	        this.points = this.convertValues(source["points"], ForecastPoint);
	        this.provenance = this.convertValues(source["provenance"], Provenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ForecastResult {
	    forecasts: ForecastDTO[];
	    issues?: ProviderIssue[];
	    generatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ForecastResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.forecasts = this.convertValues(source["forecasts"], ForecastDTO);
	        this.issues = this.convertValues(source["issues"], ProviderIssue);
	        this.generatedAt = source["generatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TelemetryPoint {
	    time: string;
	    source?: string;
	    imfSource?: string;
	    plasmaSource?: string;
	    speedKms?: number;
	    densityPerCm3?: number;
	    temperatureK?: number;
	    pressureNPa?: number;
	    fieldMagnitudeNt?: number;
	    bxGseNt?: number;
	    byGsmNt?: number;
	    bzGsmNt?: number;
	    quality?: number;
	    active?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TelemetryPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.source = source["source"];
	        this.imfSource = source["imfSource"];
	        this.plasmaSource = source["plasmaSource"];
	        this.speedKms = source["speedKms"];
	        this.densityPerCm3 = source["densityPerCm3"];
	        this.temperatureK = source["temperatureK"];
	        this.pressureNPa = source["pressureNPa"];
	        this.fieldMagnitudeNt = source["fieldMagnitudeNt"];
	        this.bxGseNt = source["bxGseNt"];
	        this.byGsmNt = source["byGsmNt"];
	        this.bzGsmNt = source["bzGsmNt"];
	        this.quality = source["quality"];
	        this.active = source["active"];
	    }
	}
	export class TelemetryQuery {
	    start: string;
	    end: string;
	    maxPoints?: number;
	
	    static createFrom(source: any = {}) {
	        return new TelemetryQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.maxPoints = source["maxPoints"];
	    }
	}
	export class TelemetrySeriesDTO {
	    query: TelemetryQuery;
	    dataset: string;
	    location: string;
	    coordinateFrame: string;
	    cadenceSeconds: number;
	    points: TelemetryPoint[];
	    gaps?: DataGap[];
	    provenance: Provenance;
	    issues?: ProviderIssue[];
	
	    static createFrom(source: any = {}) {
	        return new TelemetrySeriesDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = this.convertValues(source["query"], TelemetryQuery);
	        this.dataset = source["dataset"];
	        this.location = source["location"];
	        this.coordinateFrame = source["coordinateFrame"];
	        this.cadenceSeconds = source["cadenceSeconds"];
	        this.points = this.convertValues(source["points"], TelemetryPoint);
	        this.gaps = this.convertValues(source["gaps"], DataGap);
	        this.provenance = this.convertValues(source["provenance"], Provenance);
	        this.issues = this.convertValues(source["issues"], ProviderIssue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProviderIssue {
	    provider: string;
	    code: string;
	    message: string;
	    retryable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProviderIssue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.code = source["code"];
	        this.message = source["message"];
	        this.retryable = source["retryable"];
	    }
	}
	export class Provenance {
	    provider: string;
	    dataset: string;
	    sourceUrl?: string;
	    retrievedAt: string;
	    observedAt?: string;
	    coordinateFrame?: string;
	    class: string;
	    cached: boolean;
	    stale: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Provenance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.dataset = source["dataset"];
	        this.sourceUrl = source["sourceUrl"];
	        this.retrievedAt = source["retrievedAt"];
	        this.observedAt = source["observedAt"];
	        this.coordinateFrame = source["coordinateFrame"];
	        this.class = source["class"];
	        this.cached = source["cached"];
	        this.stale = source["stale"];
	    }
	}
	export class StormData {
	    kpMax?: number;
	
	    static createFrom(source: any = {}) {
	        return new StormData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kpMax = source["kpMax"];
	    }
	}
	export class IPSData {
	    eventTime: string;
	    location?: string;
	
	    static createFrom(source: any = {}) {
	        return new IPSData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventTime = source["eventTime"];
	        this.location = source["location"];
	    }
	}
	export class SEPData {
	    eventTime: string;
	
	    static createFrom(source: any = {}) {
	        return new SEPData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventTime = source["eventTime"];
	    }
	}
	export class HSSData {
	    eventTime: string;
	
	    static createFrom(source: any = {}) {
	        return new HSSData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventTime = source["eventTime"];
	    }
	}
	export class FlareData {
	    peakTime?: string;
	    endTime?: string;
	    classType?: string;
	    sourceLocation?: string;
	    activeRegion?: number;
	    longitudeDeg?: number;
	    latitudeDeg?: number;
	    locationParsed: boolean;
	    peakFluxWattsM2?: number;
	
	    static createFrom(source: any = {}) {
	        return new FlareData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.peakTime = source["peakTime"];
	        this.endTime = source["endTime"];
	        this.classType = source["classType"];
	        this.sourceLocation = source["sourceLocation"];
	        this.activeRegion = source["activeRegion"];
	        this.longitudeDeg = source["longitudeDeg"];
	        this.latitudeDeg = source["latitudeDeg"];
	        this.locationParsed = source["locationParsed"];
	        this.peakFluxWattsM2 = source["peakFluxWattsM2"];
	    }
	}
	export class LinkedEvent {
	    id: string;
	    kind?: string;
	
	    static createFrom(source: any = {}) {
	        return new LinkedEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	    }
	}
	export class EventDTO {
	    id: string;
	    kind: string;
	    catalog?: string;
	    title: string;
	    startTime: string;
	    endTime?: string;
	    sourceLocation?: string;
	    note?: string;
	    link?: string;
	    instruments?: string[];
	    linkedEvents?: LinkedEvent[];
	    cme?: CMEData;
	    flare?: FlareData;
	    hss?: HSSData;
	    sep?: SEPData;
	    ips?: IPSData;
	    storm?: StormData;
	    provenance: Provenance;
	
	    static createFrom(source: any = {}) {
	        return new EventDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.catalog = source["catalog"];
	        this.title = source["title"];
	        this.startTime = source["startTime"];
	        this.endTime = source["endTime"];
	        this.sourceLocation = source["sourceLocation"];
	        this.note = source["note"];
	        this.link = source["link"];
	        this.instruments = source["instruments"];
	        this.linkedEvents = this.convertValues(source["linkedEvents"], LinkedEvent);
	        this.cme = this.convertValues(source["cme"], CMEData);
	        this.flare = this.convertValues(source["flare"], FlareData);
	        this.hss = this.convertValues(source["hss"], HSSData);
	        this.sep = this.convertValues(source["sep"], SEPData);
	        this.ips = this.convertValues(source["ips"], IPSData);
	        this.storm = this.convertValues(source["storm"], StormData);
	        this.provenance = this.convertValues(source["provenance"], Provenance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EventQuery {
	    start: string;
	    end: string;
	    kinds?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EventQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.kinds = source["kinds"];
	    }
	}
	export class EventSearchResult {
	    query: EventQuery;
	    events: EventDTO[];
	    issues?: ProviderIssue[];
	    fromCache: boolean;
	    complete: boolean;
	    generatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new EventSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = this.convertValues(source["query"], EventQuery);
	        this.events = this.convertValues(source["events"], EventDTO);
	        this.issues = this.convertValues(source["issues"], ProviderIssue);
	        this.fromCache = source["fromCache"];
	        this.complete = source["complete"];
	        this.generatedAt = source["generatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DemoScenarioDTO {
	    name: string;
	    description: string;
	    start: string;
	    end: string;
	    cursor: string;
	    events: EventSearchResult;
	    telemetry: TelemetrySeriesDTO;
	    forecasts: ForecastResult;
	
	    static createFrom(source: any = {}) {
	        return new DemoScenarioDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.start = source["start"];
	        this.end = source["end"];
	        this.cursor = source["cursor"];
	        this.events = this.convertValues(source["events"], EventSearchResult);
	        this.telemetry = this.convertValues(source["telemetry"], TelemetrySeriesDTO);
	        this.forecasts = this.convertValues(source["forecasts"], ForecastResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class ExportBundle {
	    schemaVersion: number;
	    createdAt: string;
	    view?: Record<string, any>;
	    events?: EventDTO[];
	    telemetry?: TelemetrySeriesDTO;
	    forecasts?: ForecastDTO[];
	
	    static createFrom(source: any = {}) {
	        return new ExportBundle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schemaVersion = source["schemaVersion"];
	        this.createdAt = source["createdAt"];
	        this.view = source["view"];
	        this.events = this.convertValues(source["events"], EventDTO);
	        this.telemetry = this.convertValues(source["telemetry"], TelemetrySeriesDTO);
	        this.forecasts = this.convertValues(source["forecasts"], ForecastDTO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	
	
	export class XRayPoint {
	    time: string;
	    fluxWattsM2?: number;
	    energy?: string;
	    satellite?: string;
	
	    static createFrom(source: any = {}) {
	        return new XRayPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.fluxWattsM2 = source["fluxWattsM2"];
	        this.energy = source["energy"];
	        this.satellite = source["satellite"];
	    }
	}
	export class LiveSnapshotDTO {
	    time: string;
	    speedKms?: number;
	    densityPerCm3?: number;
	    temperatureK?: number;
	    pressureNPa?: number;
	    fieldMagnitudeNt?: number;
	    bzGsmNt?: number;
	    plasmaSource?: string;
	    imfSource?: string;
	    provenance: Provenance[];
	    recent?: TelemetryPoint[];
	    xray?: XRayPoint[];
	    issues?: ProviderIssue[];
	
	    static createFrom(source: any = {}) {
	        return new LiveSnapshotDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = source["time"];
	        this.speedKms = source["speedKms"];
	        this.densityPerCm3 = source["densityPerCm3"];
	        this.temperatureK = source["temperatureK"];
	        this.pressureNPa = source["pressureNPa"];
	        this.fieldMagnitudeNt = source["fieldMagnitudeNt"];
	        this.bzGsmNt = source["bzGsmNt"];
	        this.plasmaSource = source["plasmaSource"];
	        this.imfSource = source["imfSource"];
	        this.provenance = this.convertValues(source["provenance"], Provenance);
	        this.recent = this.convertValues(source["recent"], TelemetryPoint);
	        this.xray = this.convertValues(source["xray"], XRayPoint);
	        this.issues = this.convertValues(source["issues"], ProviderIssue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModelImportSummary {
	    name: string;
	    format: string;
	    timeSteps: number;
	    gridShape?: number[];
	    variables?: string[];
	    firstTime?: string;
	    lastTime?: string;
	    ready: boolean;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelImportSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.format = source["format"];
	        this.timeSteps = source["timeSteps"];
	        this.gridShape = source["gridShape"];
	        this.variables = source["variables"];
	        this.firstTime = source["firstTime"];
	        this.lastTime = source["lastTime"];
	        this.ready = source["ready"];
	        this.message = source["message"];
	    }
	}
	export class NCEIArchivePreview {
	    files: number;
	    bytes: number;
	    start?: string;
	    end?: string;
	    available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NCEIArchivePreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = source["files"];
	        this.bytes = source["bytes"];
	        this.start = source["start"];
	        this.end = source["end"];
	        this.available = source["available"];
	    }
	}
	export class NCEIArchiveQuery {
	    start: string;
	    end: string;
	
	    static createFrom(source: any = {}) {
	        return new NCEIArchiveQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	    }
	}
	export class NCEIArchiveRequest {
	    start: string;
	    end: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new NCEIArchiveRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.email = source["email"];
	    }
	}
	export class NCEIOrderStatus {
	    id: number;
	    status: string;
	    url?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new NCEIOrderStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.status = source["status"];
	        this.url = source["url"];
	        this.error = source["error"];
	    }
	}
	
	
	
	
	
	export class SettingsUpdate {
	    nasaApiKey?: string;
	    clearNasaApiKey: boolean;
	    cacheLimitBytes?: number;
	    liveRefreshSeconds?: number;
	    fullRtswRefreshSeconds?: number;
	    eventRefreshSeconds?: number;
	    preferredScale?: string;
	    reducedMotion?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SettingsUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nasaApiKey = source["nasaApiKey"];
	        this.clearNasaApiKey = source["clearNasaApiKey"];
	        this.cacheLimitBytes = source["cacheLimitBytes"];
	        this.liveRefreshSeconds = source["liveRefreshSeconds"];
	        this.fullRtswRefreshSeconds = source["fullRtswRefreshSeconds"];
	        this.eventRefreshSeconds = source["eventRefreshSeconds"];
	        this.preferredScale = source["preferredScale"];
	        this.reducedMotion = source["reducedMotion"];
	    }
	}
	
	
	
	
	export class TimeRange {
	    start: string;
	    end: string;
	
	    static createFrom(source: any = {}) {
	        return new TimeRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	    }
	}

}

