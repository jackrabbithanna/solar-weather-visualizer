package domain

// DataClass describes how a value or visual was produced.
type DataClass string

const (
	DataObserved     DataClass = "observed"
	DataForecast     DataClass = "forecast"
	DataDerived      DataClass = "derived"
	DataIllustrative DataClass = "illustrative"
)

// EventKind is the normalized event taxonomy exposed to the frontend.
type EventKind string

const (
	EventCME   EventKind = "cme"
	EventFlare EventKind = "flare"
	EventHSS   EventKind = "hss"
	EventSEP   EventKind = "sep"
	EventIPS   EventKind = "ips"
	EventStorm EventKind = "storm"
)

type Provenance struct {
	Provider        string    `json:"provider"`
	Dataset         string    `json:"dataset"`
	SourceURL       string    `json:"sourceUrl,omitempty"`
	RetrievedAt     string    `json:"retrievedAt"`
	ObservedAt      string    `json:"observedAt,omitempty"`
	CoordinateFrame string    `json:"coordinateFrame,omitempty"`
	Class           DataClass `json:"class"`
	Cached          bool      `json:"cached"`
	Stale           bool      `json:"stale"`
}

type ProviderIssue struct {
	Provider  string `json:"provider"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type LinkedEvent struct {
	ID   string    `json:"id"`
	Kind EventKind `json:"kind,omitempty"`
}

type CMEData struct {
	AnalysisTime      string   `json:"analysisTime,omitempty"`
	LatitudeDeg       *float64 `json:"latitudeDeg,omitempty"`
	LongitudeDeg      *float64 `json:"longitudeDeg,omitempty"`
	HalfAngleDeg      *float64 `json:"halfAngleDeg,omitempty"`
	MinorHalfWidthDeg *float64 `json:"minorHalfWidthDeg,omitempty"`
	TiltDeg           *float64 `json:"tiltDeg,omitempty"`
	SpeedKMS          *float64 `json:"speedKms,omitempty"`
	SpeedClass        string   `json:"speedClass,omitempty"`
	FeatureCode       string   `json:"featureCode,omitempty"`
	DataLevel         *int     `json:"dataLevel,omitempty"`
	Measurement       string   `json:"measurement,omitempty"`
	IsMostAccurate    bool     `json:"isMostAccurate"`
	DirectionKnown    bool     `json:"directionKnown"`
}

type FlareData struct {
	PeakTime        string   `json:"peakTime,omitempty"`
	EndTime         string   `json:"endTime,omitempty"`
	ClassType       string   `json:"classType,omitempty"`
	SourceLocation  string   `json:"sourceLocation,omitempty"`
	ActiveRegion    *int     `json:"activeRegion,omitempty"`
	LongitudeDeg    *float64 `json:"longitudeDeg,omitempty"`
	LatitudeDeg     *float64 `json:"latitudeDeg,omitempty"`
	LocationParsed  bool     `json:"locationParsed"`
	PeakFluxWattsM2 *float64 `json:"peakFluxWattsM2,omitempty"`
}

type HSSData struct {
	EventTime string `json:"eventTime"`
}

type SEPData struct {
	EventTime string `json:"eventTime"`
}

type IPSData struct {
	EventTime string `json:"eventTime"`
	Location  string `json:"location,omitempty"`
}

type StormData struct {
	KpMax *float64 `json:"kpMax,omitempty"`
}

type EventDTO struct {
	ID             string        `json:"id"`
	Kind           EventKind     `json:"kind"`
	Catalog        string        `json:"catalog,omitempty"`
	Title          string        `json:"title"`
	StartTime      string        `json:"startTime"`
	EndTime        string        `json:"endTime,omitempty"`
	SourceLocation string        `json:"sourceLocation,omitempty"`
	Note           string        `json:"note,omitempty"`
	Link           string        `json:"link,omitempty"`
	Instruments    []string      `json:"instruments,omitempty"`
	LinkedEvents   []LinkedEvent `json:"linkedEvents,omitempty"`
	CME            *CMEData      `json:"cme,omitempty"`
	Flare          *FlareData    `json:"flare,omitempty"`
	HSS            *HSSData      `json:"hss,omitempty"`
	SEP            *SEPData      `json:"sep,omitempty"`
	IPS            *IPSData      `json:"ips,omitempty"`
	Storm          *StormData    `json:"storm,omitempty"`
	Provenance     Provenance    `json:"provenance"`
}

type EventQuery struct {
	Start string      `json:"start"`
	End   string      `json:"end"`
	Kinds []EventKind `json:"kinds,omitempty"`
}

type TimeRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type EventSearchResult struct {
	Query       EventQuery      `json:"query"`
	Events      []EventDTO      `json:"events"`
	Issues      []ProviderIssue `json:"issues,omitempty"`
	FromCache   bool            `json:"fromCache"`
	Complete    bool            `json:"complete"`
	GeneratedAt string          `json:"generatedAt"`
}

type TelemetryPoint struct {
	Time             string   `json:"time"`
	Source           string   `json:"source,omitempty"`
	IMFSource        string   `json:"imfSource,omitempty"`
	PlasmaSource     string   `json:"plasmaSource,omitempty"`
	SpeedKMS         *float64 `json:"speedKms,omitempty"`
	DensityPerCM3    *float64 `json:"densityPerCm3,omitempty"`
	TemperatureK     *float64 `json:"temperatureK,omitempty"`
	PressureNPa      *float64 `json:"pressureNPa,omitempty"`
	FieldMagnitudeNT *float64 `json:"fieldMagnitudeNt,omitempty"`
	BxGSENT          *float64 `json:"bxGseNt,omitempty"`
	ByGSMNT          *float64 `json:"byGsmNt,omitempty"`
	BzGSMNT          *float64 `json:"bzGsmNt,omitempty"`
	Quality          *int     `json:"quality,omitempty"`
	Active           *bool    `json:"active,omitempty"`
}

type DataGap struct {
	Start  string `json:"start"`
	End    string `json:"end"`
	Reason string `json:"reason"`
}

type TelemetryQuery struct {
	Start     string `json:"start"`
	End       string `json:"end"`
	MaxPoints int    `json:"maxPoints,omitempty"`
}

type TelemetrySeriesDTO struct {
	Query           TelemetryQuery   `json:"query"`
	Dataset         string           `json:"dataset"`
	Location        string           `json:"location"`
	CoordinateFrame string           `json:"coordinateFrame"`
	CadenceSeconds  int              `json:"cadenceSeconds"`
	Points          []TelemetryPoint `json:"points"`
	Gaps            []DataGap        `json:"gaps,omitempty"`
	Provenance      Provenance       `json:"provenance"`
	Contributors    []Provenance     `json:"contributors,omitempty"`
	Issues          []ProviderIssue  `json:"issues,omitempty"`
}

type LiveSnapshotDTO struct {
	Time             string           `json:"time"`
	SpeedKMS         *float64         `json:"speedKms,omitempty"`
	DensityPerCM3    *float64         `json:"densityPerCm3,omitempty"`
	TemperatureK     *float64         `json:"temperatureK,omitempty"`
	PressureNPa      *float64         `json:"pressureNPa,omitempty"`
	FieldMagnitudeNT *float64         `json:"fieldMagnitudeNt,omitempty"`
	BzGSMNT          *float64         `json:"bzGsmNt,omitempty"`
	PlasmaSource     string           `json:"plasmaSource,omitempty"`
	IMFSource        string           `json:"imfSource,omitempty"`
	Provenance       []Provenance     `json:"provenance"`
	Recent           []TelemetryPoint `json:"recent,omitempty"`
	XRay             []XRayPoint      `json:"xray,omitempty"`
	Issues           []ProviderIssue  `json:"issues,omitempty"`
}

type XRayPoint struct {
	Time        string   `json:"time"`
	FluxWattsM2 *float64 `json:"fluxWattsM2,omitempty"`
	Energy      string   `json:"energy,omitempty"`
	Satellite   string   `json:"satellite,omitempty"`
}

type ImpactDTO struct {
	Location     string `json:"location"`
	ArrivalTime  string `json:"arrivalTime,omitempty"`
	GlancingBlow bool   `json:"glancingBlow"`
}

type ForecastPoint struct {
	Time          string   `json:"time"`
	DensityPerCM3 *float64 `json:"densityPerCm3,omitempty"`
	TemperatureK  *float64 `json:"temperatureK,omitempty"`
	SpeedKMS      *float64 `json:"speedKms,omitempty"`
	BRNT          *float64 `json:"brNt,omitempty"`
	BThetaNT      *float64 `json:"bThetaNt,omitempty"`
	BPhiNT        *float64 `json:"bPhiNt,omitempty"`
	Polarity      *float64 `json:"polarity,omitempty"`
	Cloud         *float64 `json:"cloud,omitempty"`
}

type ForecastDTO struct {
	ID                     string          `json:"id"`
	Model                  string          `json:"model"`
	CompletionTime         string          `json:"completionTime,omitempty"`
	DomainAU               *float64        `json:"domainAu,omitempty"`
	EarthArrivalTime       string          `json:"earthArrivalTime,omitempty"`
	EstimatedDurationHours *float64        `json:"estimatedDurationHours,omitempty"`
	MinMagnetopauseRE      *float64        `json:"minMagnetopauseRe,omitempty"`
	Kp18                   *int            `json:"kp18,omitempty"`
	Kp90                   *int            `json:"kp90,omitempty"`
	Kp135                  *int            `json:"kp135,omitempty"`
	Kp180                  *int            `json:"kp180,omitempty"`
	EarthGlancingBlow      bool            `json:"earthGlancingBlow"`
	Impacts                []ImpactDTO     `json:"impacts,omitempty"`
	LinkedCMEIDs           []string        `json:"linkedCmeIds,omitempty"`
	Points                 []ForecastPoint `json:"points,omitempty"`
	Provenance             Provenance      `json:"provenance"`
}

type ForecastResult struct {
	Forecasts   []ForecastDTO   `json:"forecasts"`
	Issues      []ProviderIssue `json:"issues,omitempty"`
	GeneratedAt string          `json:"generatedAt"`
}

type ProviderStatus struct {
	Provider    string `json:"provider"`
	Available   bool   `json:"available"`
	LastSuccess string `json:"lastSuccess,omitempty"`
	LastError   string `json:"lastError,omitempty"`
}

type SettingsDTO struct {
	NASAKeyConfigured      bool   `json:"nasaKeyConfigured"`
	CacheLimitBytes        int64  `json:"cacheLimitBytes"`
	LiveRefreshSeconds     int    `json:"liveRefreshSeconds"`
	FullRTSWRefreshSeconds int    `json:"fullRtswRefreshSeconds"`
	EventRefreshSeconds    int    `json:"eventRefreshSeconds"`
	PreferredScale         string `json:"preferredScale"`
	ReducedMotion          bool   `json:"reducedMotion"`
}

type SettingsUpdate struct {
	NASAAPIKey             *string `json:"nasaApiKey,omitempty"`
	ClearNASAAPIKey        bool    `json:"clearNasaApiKey"`
	CacheLimitBytes        *int64  `json:"cacheLimitBytes,omitempty"`
	LiveRefreshSeconds     *int    `json:"liveRefreshSeconds,omitempty"`
	FullRTSWRefreshSeconds *int    `json:"fullRtswRefreshSeconds,omitempty"`
	EventRefreshSeconds    *int    `json:"eventRefreshSeconds,omitempty"`
	PreferredScale         *string `json:"preferredScale,omitempty"`
	ReducedMotion          *bool   `json:"reducedMotion,omitempty"`
}

type BootstrapDTO struct {
	Version      string           `json:"version"`
	GeneratedAt  string           `json:"generatedAt"`
	Settings     SettingsDTO      `json:"settings"`
	Providers    []ProviderStatus `json:"providers"`
	CacheBytes   int64            `json:"cacheBytes"`
	OfflineReady bool             `json:"offlineReady"`
}

type ExportBundle struct {
	SchemaVersion int                 `json:"schemaVersion"`
	CreatedAt     string              `json:"createdAt"`
	View          map[string]any      `json:"view,omitempty"`
	Events        []EventDTO          `json:"events,omitempty"`
	Telemetry     *TelemetrySeriesDTO `json:"telemetry,omitempty"`
	Forecasts     []ForecastDTO       `json:"forecasts,omitempty"`
}

type DemoScenarioDTO struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Start       string             `json:"start"`
	End         string             `json:"end"`
	Cursor      string             `json:"cursor"`
	Events      EventSearchResult  `json:"events"`
	Telemetry   TelemetrySeriesDTO `json:"telemetry"`
	Forecasts   ForecastResult     `json:"forecasts"`
}

type NCEIArchiveQuery struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type NCEIArchivePreview struct {
	Files     int64  `json:"files"`
	Bytes     int64  `json:"bytes"`
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"`
	Available bool   `json:"available"`
}

type NCEIArchiveRequest struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Email string `json:"email"`
}

type NCEIOrderStatus struct {
	ID     int64  `json:"id"`
	Status string `json:"status"`
	URL    string `json:"url,omitempty"`
	Error  string `json:"error,omitempty"`
}

type ModelImportSummary struct {
	Name      string   `json:"name"`
	Format    string   `json:"format"`
	TimeSteps int      `json:"timeSteps"`
	GridShape []int    `json:"gridShape,omitempty"`
	Variables []string `json:"variables,omitempty"`
	FirstTime string   `json:"firstTime,omitempty"`
	LastTime  string   `json:"lastTime,omitempty"`
	Ready     bool     `json:"ready"`
	Message   string   `json:"message,omitempty"`
}
