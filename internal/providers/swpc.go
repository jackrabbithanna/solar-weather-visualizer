package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const DefaultSWPCBase = "https://services.swpc.noaa.gov"

type SWPCClient struct {
	HTTP *CachedHTTP
	Base string
	Now  func() time.Time
}

func NewSWPCClient(httpClient *CachedHTTP) *SWPCClient {
	return &SWPCClient{
		HTTP: httpClient,
		Base: DefaultSWPCBase,
		Now:  time.Now,
	}
}

type speedSummary struct {
	WindSpeed   flexibleFloat `json:"WindSpeed"`
	ProtonSpeed flexibleFloat `json:"proton_speed"`
	TimeStamp   string        `json:"TimeStamp"`
	TimeTag     string        `json:"time_tag"`
}

type fieldSummary struct {
	Bt        flexibleFloat `json:"Bt"`
	Bz        flexibleFloat `json:"Bz"`
	Magnitude flexibleFloat `json:"bt"`
	BzGSM     flexibleFloat `json:"bz_gsm"`
	TimeStamp string        `json:"TimeStamp"`
	TimeTag   string        `json:"time_tag"`
}

type flexibleFloat struct {
	value *float64
}

func (f flexibleFloat) MarshalJSON() ([]byte, error) {
	if f.value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(*f.value)
}

func (f *flexibleFloat) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" || string(raw) == `""` {
		f.value = nil
		return nil
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		f.value = &number
		return nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return err
	}
	parsed, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return err
	}
	f.value = &parsed
	return nil
}

type speedSummaryFeed []speedSummary

func (f *speedSummaryFeed) UnmarshalJSON(raw []byte) error {
	if len(raw) > 0 && raw[0] == '[' {
		return json.Unmarshal(raw, (*[]speedSummary)(f))
	}
	var item speedSummary
	if err := json.Unmarshal(raw, &item); err != nil {
		return err
	}
	*f = []speedSummary{item}
	return nil
}

type fieldSummaryFeed []fieldSummary

func (f *fieldSummaryFeed) UnmarshalJSON(raw []byte) error {
	if len(raw) > 0 && raw[0] == '[' {
		return json.Unmarshal(raw, (*[]fieldSummary)(f))
	}
	var item fieldSummary
	if err := json.Unmarshal(raw, &item); err != nil {
		return err
	}
	*f = []fieldSummary{item}
	return nil
}

func (s speedSummary) speed() *float64 {
	if s.WindSpeed.value != nil {
		return s.WindSpeed.value
	}
	return s.ProtonSpeed.value
}

func (s speedSummary) observedAt() string {
	if s.TimeStamp != "" {
		return s.TimeStamp
	}
	return s.TimeTag
}

func (s fieldSummary) magnitude() *float64 {
	if s.Bt.value != nil {
		return s.Bt.value
	}
	return s.Magnitude.value
}

func (s fieldSummary) bz() *float64 {
	if s.Bz.value != nil {
		return s.Bz.value
	}
	return s.BzGSM.value
}

func (s fieldSummary) observedAt() string {
	if s.TimeStamp != "" {
		return s.TimeStamp
	}
	return s.TimeTag
}

type rawWind struct {
	TimeTag        string   `json:"time_tag"`
	Active         bool     `json:"active"`
	Source         string   `json:"source"`
	Speed          *float64 `json:"proton_speed"`
	Temperature    *float64 `json:"proton_temperature"`
	Density        *float64 `json:"proton_density"`
	OverallQuality *int     `json:"overall_quality"`
}

type rawMag struct {
	TimeTag        string   `json:"time_tag"`
	Active         bool     `json:"active"`
	Source         string   `json:"source"`
	Magnitude      *float64 `json:"bt"`
	BxGSE          *float64 `json:"bx_gse"`
	ByGSM          *float64 `json:"by_gsm"`
	BzGSM          *float64 `json:"bz_gsm"`
	OverallQuality *int     `json:"overall_quality"`
}

type rawXRay struct {
	TimeTag   string   `json:"time_tag"`
	Satellite any      `json:"satellite"`
	Flux      *float64 `json:"flux"`
	Energy    string   `json:"energy"`
}

type liveFetchResult struct {
	name string
	meta FetchMeta
	err  error
}

func (c *SWPCClient) Live(ctx context.Context) (domain.LiveSnapshotDTO, error) {
	var speeds speedSummaryFeed
	var fields fieldSummaryFeed
	var winds []rawWind
	var mags []rawMag
	var xrays []rawXRay

	results := make(chan liveFetchResult, 5)
	requests := []struct {
		name string
		path string
		key  string
		ttl  time.Duration
		dst  any
	}{
		{"speed-summary", "/products/summary/solar-wind-speed.json", "swpc:speed-summary", time.Minute, &speeds},
		{"field-summary", "/products/summary/solar-wind-mag-field.json", "swpc:field-summary", time.Minute, &fields},
		{"wind", "/json/rtsw/rtsw_wind_1m.json", "swpc:rtsw-wind-1m", 15 * time.Minute, &winds},
		{"mag", "/json/rtsw/rtsw_mag_1m.json", "swpc:rtsw-mag-1m", 15 * time.Minute, &mags},
		{"xray", "/json/goes/primary/xrays-1-day.json", "swpc:goes-xray-1d", 5 * time.Minute, &xrays},
	}
	for _, item := range requests {
		item := item
		go func() {
			meta, err := c.HTTP.GetJSON(ctx, c.Base+item.path, item.key, item.ttl, item.dst)
			results <- liveFetchResult{name: item.name, meta: meta, err: err}
		}()
	}

	metas := make(map[string]FetchMeta)
	var issues []domain.ProviderIssue
	successes := 0
	for range requests {
		result := <-results
		if result.err != nil {
			issues = append(issues, issue("NOAA SWPC", result.name, result.err, IsRetryable(result.err)))
			continue
		}
		successes++
		metas[result.name] = result.meta
		if result.meta.Warning != nil {
			issues = append(issues, issue("NOAA SWPC", "stale_"+result.name, result.meta.Warning, true))
		}
	}
	if successes == 0 {
		return domain.LiveSnapshotDTO{}, fmt.Errorf("all NOAA SWPC live feeds failed")
	}

	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	snapshot := domain.LiveSnapshotDTO{Time: domain.FormatTime(now), Issues: issues}
	if len(speeds) > 0 {
		snapshot.SpeedKMS = speeds[0].speed()
		snapshot.Time = canonicalTime(speeds[0].observedAt())
	}
	if len(fields) > 0 {
		snapshot.FieldMagnitudeNT = fields[0].magnitude()
		snapshot.BzGSMNT = fields[0].bz()
		if snapshot.Time == "" {
			snapshot.Time = canonicalTime(fields[0].observedAt())
		}
	}

	recent, plasmaSource, imfSource := mergeRecentRTSW(winds, mags, now)
	snapshot.Recent = recent
	snapshot.PlasmaSource = plasmaSource
	snapshot.IMFSource = imfSource
	if plasmaSource != "" || snapshot.SpeedKMS != nil {
		snapshot.PlasmaAnchor = domain.SpatialAnchorSEMBL1
	}
	if imfSource != "" || snapshot.FieldMagnitudeNT != nil {
		snapshot.IMFAnchor = domain.SpatialAnchorSEMBL1
	}
	fillLiveSnapshotFromRecent(&snapshot)
	snapshot.XRay = normalizeXRays(xrays, now)
	for _, name := range []string{"speed-summary", "field-summary", "wind", "mag", "xray"} {
		meta, ok := metas[name]
		if !ok {
			continue
		}
		snapshot.Provenance = append(snapshot.Provenance, domain.Provenance{
			Provider:    "NOAA SWPC",
			Dataset:     name,
			SourceURL:   c.Base,
			RetrievedAt: domain.FormatTime(meta.RetrievedAt),
			ObservedAt:  snapshot.Time,
			Class:       domain.DataObserved,
			Cached:      meta.Cached,
			Stale:       meta.Stale,
		})
	}
	return snapshot, nil
}

// fillLiveSnapshotFromRecent takes the newest available value for each
// measurement instead of assuming that plasma and magnetometer records have
// identical timestamps. NOAA's active instruments commonly publish those
// streams a minute apart.
func fillLiveSnapshotFromRecent(snapshot *domain.LiveSnapshotDTO) {
	for index := len(snapshot.Recent) - 1; index >= 0; index-- {
		point := snapshot.Recent[index]
		if snapshot.SpeedKMS == nil && point.SpeedKMS != nil {
			snapshot.SpeedKMS = point.SpeedKMS
		}
		if snapshot.DensityPerCM3 == nil && point.DensityPerCM3 != nil {
			snapshot.DensityPerCM3 = point.DensityPerCM3
		}
		if snapshot.TemperatureK == nil && point.TemperatureK != nil {
			snapshot.TemperatureK = point.TemperatureK
		}
		if snapshot.PressureNPa == nil && point.PressureNPa != nil {
			snapshot.PressureNPa = point.PressureNPa
		}
		if snapshot.FieldMagnitudeNT == nil && point.FieldMagnitudeNT != nil {
			snapshot.FieldMagnitudeNT = point.FieldMagnitudeNT
		}
		if snapshot.BzGSMNT == nil && point.BzGSMNT != nil {
			snapshot.BzGSMNT = point.BzGSMNT
		}
	}
}

func mergeRecentRTSW(winds []rawWind, mags []rawMag, now time.Time) ([]domain.TelemetryPoint, string, string) {
	cutoff := now.Add(-6 * time.Hour)
	points := make(map[string]*domain.TelemetryPoint)
	plasmaSource := ""
	imfSource := ""
	for _, record := range winds {
		if !record.Active {
			continue
		}
		parsed, err := domain.ParseTime(record.TimeTag)
		if err != nil || parsed.Before(cutoff) {
			continue
		}
		key := domain.FormatTime(parsed)
		point := points[key]
		if point == nil {
			point = &domain.TelemetryPoint{Time: key}
			points[key] = point
		}
		point.Source = record.Source
		point.PlasmaSource = record.Source
		point.PlasmaAnchor = domain.SpatialAnchorSEMBL1
		point.SpeedKMS = record.Speed
		point.DensityPerCM3 = record.Density
		point.TemperatureK = record.Temperature
		point.Quality = record.OverallQuality
		active := true
		point.Active = &active
		if record.Density != nil && record.Speed != nil {
			pressure := domain.DynamicPressureNPa(*record.Density, *record.Speed)
			point.PressureNPa = &pressure
		}
		if plasmaSource == "" {
			plasmaSource = record.Source
		}
	}
	for _, record := range mags {
		if !record.Active {
			continue
		}
		parsed, err := domain.ParseTime(record.TimeTag)
		if err != nil || parsed.Before(cutoff) {
			continue
		}
		key := domain.FormatTime(parsed)
		point := points[key]
		if point == nil {
			point = &domain.TelemetryPoint{Time: key}
			points[key] = point
		}
		point.IMFSource = record.Source
		point.IMFAnchor = domain.SpatialAnchorSEMBL1
		point.FieldMagnitudeNT = record.Magnitude
		point.BxGSENT = record.BxGSE
		point.ByGSMNT = record.ByGSM
		point.BzGSMNT = record.BzGSM
		if point.Quality == nil {
			point.Quality = record.OverallQuality
		}
		active := true
		point.Active = &active
		if imfSource == "" {
			imfSource = record.Source
		}
	}
	result := make([]domain.TelemetryPoint, 0, len(points))
	for _, point := range points {
		result = append(result, *point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Time < result[j].Time })
	if len(result) > 360 {
		result = result[len(result)-360:]
	}
	if len(result) > 0 {
		latest := result[len(result)-1]
		if latest.PlasmaSource != "" {
			plasmaSource = latest.PlasmaSource
		}
		if latest.IMFSource != "" {
			imfSource = latest.IMFSource
		}
	}
	return result, plasmaSource, imfSource
}

func normalizeXRays(input []rawXRay, now time.Time) []domain.XRayPoint {
	cutoff := now.Add(-6 * time.Hour)
	result := make([]domain.XRayPoint, 0, 360)
	for _, record := range input {
		if record.Energy != "0.1-0.8nm" {
			continue
		}
		parsed, err := domain.ParseTime(record.TimeTag)
		if err != nil || parsed.Before(cutoff) {
			continue
		}
		result = append(result, domain.XRayPoint{
			Time:        domain.FormatTime(parsed),
			FluxWattsM2: record.Flux,
			Energy:      record.Energy,
			Satellite:   fmt.Sprint(record.Satellite),
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Time < result[j].Time })
	if len(result) > 360 {
		result = result[len(result)-360:]
	}
	return result
}
