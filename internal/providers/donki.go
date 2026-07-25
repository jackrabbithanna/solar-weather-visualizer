package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const (
	DefaultCCMCBase = "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get"
	DefaultNASABase = "https://api.nasa.gov/DONKI"
)

type DonkiClient struct {
	HTTP     *CachedHTTP
	CCMCBase string
	NASABase string
	Now      func() time.Time
	demo     *demoLimiter
}

func NewDonkiClient(httpClient *CachedHTTP) *DonkiClient {
	return &DonkiClient{
		HTTP:     httpClient,
		CCMCBase: DefaultCCMCBase,
		NASABase: DefaultNASABase,
		Now:      time.Now,
		demo:     newDemoLimiter(),
	}
}

type demoLimiter struct {
	mu        sync.Mutex
	hourStart time.Time
	dayStart  time.Time
	hourCount int
	dayCount  int
}

func newDemoLimiter() *demoLimiter {
	now := time.Now().UTC()
	return &demoLimiter{hourStart: now.Truncate(time.Hour), dayStart: dayFloor(now)}
}

func (l *demoLimiter) Allow(now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now = now.UTC()
	hour := now.Truncate(time.Hour)
	day := dayFloor(now)
	if hour.After(l.hourStart) {
		l.hourStart = hour
		l.hourCount = 0
	}
	if day.After(l.dayStart) {
		l.dayStart = day
		l.dayCount = 0
	}
	if l.hourCount >= 20 || l.dayCount >= 40 {
		return false
	}
	l.hourCount++
	l.dayCount++
	return true
}

func dayFloor(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

type donkiInstrument struct {
	DisplayName string `json:"displayName"`
}

type donkiLinkedEvent struct {
	ActivityID string `json:"activityID"`
}

type rawCMEAnalysis struct {
	IsMostAccurate bool     `json:"isMostAccurate"`
	Time215        string   `json:"time21_5"`
	Latitude       *float64 `json:"latitude"`
	Longitude      *float64 `json:"longitude"`
	HalfAngle      *float64 `json:"halfAngle"`
	MinorHalfWidth *float64 `json:"minorHalfWidth"`
	Tilt           *float64 `json:"tilt"`
	Speed          *float64 `json:"speed"`
	Type           string   `json:"type"`
	FeatureCode    string   `json:"featureCode"`
	Measurement    string   `json:"measurementTechnique"`
	LevelOfData    *int     `json:"levelOfData"`
}

type rawCME struct {
	ActivityID      string             `json:"activityID"`
	Catalog         string             `json:"catalog"`
	StartTime       string             `json:"startTime"`
	Instruments     []donkiInstrument  `json:"instruments"`
	SourceLocation  string             `json:"sourceLocation"`
	ActiveRegionNum *int               `json:"activeRegionNum"`
	Note            string             `json:"note"`
	Link            string             `json:"link"`
	Analyses        []rawCMEAnalysis   `json:"cmeAnalyses"`
	LinkedEvents    []donkiLinkedEvent `json:"linkedEvents"`
}

type rawFlare struct {
	ID              string             `json:"flrID"`
	Catalog         string             `json:"catalog"`
	Instruments     []donkiInstrument  `json:"instruments"`
	BeginTime       string             `json:"beginTime"`
	LegacyBeginTime string             `json:"begineTime"`
	PeakTime        string             `json:"peakTime"`
	EndTime         string             `json:"endTime"`
	ClassType       string             `json:"classType"`
	SourceLocation  string             `json:"sourceLocation"`
	ActiveRegionNum *int               `json:"activeRegionNum"`
	Note            string             `json:"note"`
	Link            string             `json:"link"`
	LinkedEvents    []donkiLinkedEvent `json:"linkedEvents"`
}

type rawSimpleEvent struct {
	ID           string             `json:"hssID"`
	SEPID        string             `json:"sepID"`
	ActivityID   string             `json:"activityID"`
	GSTID        string             `json:"gstID"`
	Catalog      string             `json:"catalog"`
	EventTime    string             `json:"eventTime"`
	StartTime    string             `json:"startTime"`
	Location     string             `json:"location"`
	Instruments  []donkiInstrument  `json:"instruments"`
	Link         string             `json:"link"`
	LinkedEvents []donkiLinkedEvent `json:"linkedEvents"`
	AllKp        []struct {
		ObservedTime string  `json:"observedTime"`
		KpIndex      float64 `json:"kpIndex"`
		Source       string  `json:"source"`
	} `json:"allKpIndex"`
}

type endpointResult struct {
	kind   domain.EventKind
	events []domain.EventDTO
	meta   FetchMeta
	err    error
}

func (c *DonkiClient) SearchEvents(
	ctx context.Context,
	query domain.EventQuery,
	nasaAPIKey string,
) ([]domain.EventDTO, []domain.ProviderIssue) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return nil, []domain.ProviderIssue{issue("DONKI", "invalid_range", err, false)}
	}
	kinds := normalizeKinds(query.Kinds)
	results := make(chan endpointResult, len(kinds))
	var wg sync.WaitGroup
	for _, kind := range kinds {
		kind := kind
		wg.Add(1)
		go func() {
			defer wg.Done()
			events, meta, err := c.fetchEventsForKind(ctx, kind, start, end, nasaAPIKey)
			results <- endpointResult{kind: kind, events: events, meta: meta, err: err}
		}()
	}
	wg.Wait()
	close(results)

	var events []domain.EventDTO
	var issues []domain.ProviderIssue
	for result := range results {
		if result.err != nil {
			issues = append(issues, issue("DONKI", string(result.kind), result.err, IsRetryable(result.err)))
			continue
		}
		events = append(events, result.events...)
		if result.meta.Warning != nil {
			issues = append(issues, issue("DONKI", "stale_cache", result.meta.Warning, true))
		}
	}
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].StartTime < events[j].StartTime
	})
	return events, issues
}

func normalizeKinds(input []domain.EventKind) []domain.EventKind {
	if len(input) == 0 {
		return []domain.EventKind{
			domain.EventCME,
			domain.EventFlare,
			domain.EventHSS,
			domain.EventSEP,
			domain.EventIPS,
			domain.EventStorm,
		}
	}
	seen := make(map[domain.EventKind]bool)
	result := make([]domain.EventKind, 0, len(input))
	for _, kind := range input {
		switch kind {
		case domain.EventCME, domain.EventFlare, domain.EventHSS,
			domain.EventSEP, domain.EventIPS, domain.EventStorm:
			if !seen[kind] {
				seen[kind] = true
				result = append(result, kind)
			}
		}
	}
	return result
}

func (c *DonkiClient) fetchEventsForKind(
	ctx context.Context,
	kind domain.EventKind,
	start time.Time,
	end time.Time,
	nasaAPIKey string,
) ([]domain.EventDTO, FetchMeta, error) {
	endpoint := map[domain.EventKind]string{
		domain.EventCME:   "CME",
		domain.EventFlare: "FLR",
		domain.EventHSS:   "HSS",
		domain.EventSEP:   "SEP",
		domain.EventIPS:   "IPS",
		domain.EventStorm: "GST",
	}[kind]
	if endpoint == "" {
		return nil, FetchMeta{}, fmt.Errorf("unsupported event kind %q", kind)
	}
	var raw json.RawMessage
	meta, providerName, err := c.fetchDONKI(ctx, endpoint, start, end, nasaAPIKey, &raw)
	if err != nil {
		return nil, FetchMeta{}, err
	}
	provenance := func(observedAt string) domain.Provenance {
		return domain.Provenance{
			Provider:        providerName,
			Dataset:         "DONKI/" + endpoint,
			SourceURL:       sourceBase(providerName, c),
			RetrievedAt:     domain.FormatTime(meta.RetrievedAt),
			ObservedAt:      observedAt,
			CoordinateFrame: eventCoordinateFrame(kind),
			Class:           domain.DataObserved,
			Cached:          meta.Cached,
			Stale:           meta.Stale,
		}
	}

	switch kind {
	case domain.EventCME:
		var records []rawCME
		if err := json.Unmarshal(raw, &records); err != nil {
			return nil, meta, err
		}
		events := make([]domain.EventDTO, 0, len(records))
		for _, record := range records {
			event := normalizeCME(record)
			event.Provenance = provenance(event.StartTime)
			events = append(events, event)
		}
		return events, meta, nil
	case domain.EventFlare:
		var records []rawFlare
		if err := json.Unmarshal(raw, &records); err != nil {
			return nil, meta, err
		}
		events := make([]domain.EventDTO, 0, len(records))
		for _, record := range records {
			event := normalizeFlare(record)
			event.Provenance = provenance(event.StartTime)
			events = append(events, event)
		}
		return events, meta, nil
	default:
		var records []rawSimpleEvent
		if err := json.Unmarshal(raw, &records); err != nil {
			return nil, meta, err
		}
		events := make([]domain.EventDTO, 0, len(records))
		for _, record := range records {
			event := normalizeSimple(kind, record)
			event.Provenance = provenance(event.StartTime)
			events = append(events, event)
		}
		return events, meta, nil
	}
}

func (c *DonkiClient) fetchDONKI(
	ctx context.Context,
	endpoint string,
	start time.Time,
	end time.Time,
	nasaAPIKey string,
	destination any,
) (FetchMeta, string, error) {
	ttl := 24 * time.Hour
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	if end.After(now.AddDate(0, 0, -31)) {
		ttl = 15 * time.Minute
	}
	values := url.Values{
		"startDate": {start.Format("2006-01-02")},
		"endDate":   {end.Format("2006-01-02")},
	}

	if nasaAPIKey != "" {
		values.Set("api_key", nasaAPIKey)
		meta, err := c.HTTP.GetJSON(
			ctx,
			strings.TrimRight(c.NASABase, "/")+"/"+endpoint+"?"+values.Encode(),
			fmt.Sprintf("donki:nasa:%s:%s:%s", endpoint, start.Format("2006-01-02"), end.Format("2006-01-02")),
			ttl,
			destination,
		)
		if err == nil {
			return meta, "NASA Open APIs", nil
		}
		meta, fallbackErr := c.fetchCCMC(ctx, endpoint, values, start, end, ttl, destination)
		if fallbackErr == nil {
			meta.Warning = fmt.Errorf("api.nasa.gov failed; used CCMC: %w", err)
			return meta, "NASA CCMC", nil
		}
		return FetchMeta{}, "", fmt.Errorf("api.nasa.gov: %v; CCMC: %w", err, fallbackErr)
	}

	meta, err := c.fetchCCMC(ctx, endpoint, values, start, end, ttl, destination)
	if err == nil {
		return meta, "NASA CCMC", nil
	}
	if end.Sub(start) > 31*24*time.Hour || !c.demo.Allow(now) {
		return FetchMeta{}, "", err
	}
	values.Set("api_key", "DEMO_KEY")
	meta, demoErr := c.HTTP.GetJSON(
		ctx,
		strings.TrimRight(c.NASABase, "/")+"/"+endpoint+"?"+values.Encode(),
		fmt.Sprintf("donki:demo:%s:%s:%s", endpoint, start.Format("2006-01-02"), end.Format("2006-01-02")),
		ttl,
		destination,
	)
	if demoErr != nil {
		return FetchMeta{}, "", fmt.Errorf("CCMC: %v; DEMO_KEY: %w", err, demoErr)
	}
	meta.Warning = fmt.Errorf("CCMC failed; used throttled DEMO_KEY: %w", err)
	return meta, "NASA Open APIs (DEMO_KEY)", nil
}

func (c *DonkiClient) fetchCCMC(
	ctx context.Context,
	endpoint string,
	values url.Values,
	start, end time.Time,
	ttl time.Duration,
	destination any,
) (FetchMeta, error) {
	// Remove api_key if this call follows a failed keyed NASA request.
	values = cloneValues(values)
	values.Del("api_key")
	return c.HTTP.GetJSON(
		ctx,
		strings.TrimRight(c.CCMCBase, "/")+"/"+endpoint+"?"+values.Encode(),
		fmt.Sprintf("donki:ccmc:%s:%s:%s", endpoint, start.Format("2006-01-02"), end.Format("2006-01-02")),
		ttl,
		destination,
	)
}

func cloneValues(input url.Values) url.Values {
	output := make(url.Values, len(input))
	for key, values := range input {
		output[key] = append([]string(nil), values...)
	}
	return output
}

func normalizeCME(record rawCME) domain.EventDTO {
	analysis := selectCMEAnalysis(record.Analyses)
	data := &domain.CMEData{}
	if analysis != nil {
		data.AnalysisTime = canonicalTime(analysis.Time215)
		data.LatitudeDeg = analysis.Latitude
		data.LongitudeDeg = analysis.Longitude
		data.HalfAngleDeg = analysis.HalfAngle
		data.MinorHalfWidthDeg = analysis.MinorHalfWidth
		data.TiltDeg = analysis.Tilt
		data.SpeedKMS = analysis.Speed
		data.SpeedClass = analysis.Type
		data.FeatureCode = analysis.FeatureCode
		data.DataLevel = analysis.LevelOfData
		data.Measurement = analysis.Measurement
		data.IsMostAccurate = analysis.IsMostAccurate
		data.DirectionKnown = analysis.Time215 != "" && analysis.Latitude != nil &&
			analysis.Longitude != nil && analysis.HalfAngle != nil && analysis.Speed != nil
	}
	return domain.EventDTO{
		ID:             record.ActivityID,
		Kind:           domain.EventCME,
		Catalog:        record.Catalog,
		Title:          titleForCME(data),
		StartTime:      canonicalTime(record.StartTime),
		SourceLocation: record.SourceLocation,
		Note:           record.Note,
		Link:           record.Link,
		Instruments:    instrumentNames(record.Instruments),
		LinkedEvents:   linkedEvents(record.LinkedEvents),
		CME:            data,
	}
}

func selectCMEAnalysis(analyses []rawCMEAnalysis) *rawCMEAnalysis {
	if len(analyses) == 0 {
		return nil
	}
	best := 0
	bestScore := -1
	for index, analysis := range analyses {
		score := 0
		complete := analysis.Time215 != "" && analysis.Speed != nil &&
			analysis.HalfAngle != nil && analysis.Latitude != nil &&
			analysis.Longitude != nil
		if complete {
			score += 1000
		}
		if analysis.IsMostAccurate {
			score += 100
		}
		if analysis.Time215 != "" {
			score += 10
		}
		for _, value := range []*float64{
			analysis.Speed,
			analysis.HalfAngle,
			analysis.Latitude,
			analysis.Longitude,
		} {
			if value != nil {
				score++
			}
		}
		if score > bestScore {
			best = index
			bestScore = score
		}
	}
	return &analyses[best]
}

func titleForCME(data *domain.CMEData) string {
	if data != nil && data.SpeedKMS != nil {
		return fmt.Sprintf("CME · %.0f km/s", *data.SpeedKMS)
	}
	return "Coronal mass ejection"
}

func normalizeFlare(record rawFlare) domain.EventDTO {
	begin := record.BeginTime
	if begin == "" {
		begin = record.LegacyBeginTime
	}
	latitude, longitude, parsed := parseStonyhurst(record.SourceLocation)
	return domain.EventDTO{
		ID:             record.ID,
		Kind:           domain.EventFlare,
		Catalog:        record.Catalog,
		Title:          flareTitle(record.ClassType),
		StartTime:      canonicalTime(begin),
		EndTime:        canonicalTime(record.EndTime),
		SourceLocation: record.SourceLocation,
		Note:           record.Note,
		Link:           record.Link,
		Instruments:    instrumentNames(record.Instruments),
		LinkedEvents:   linkedEvents(record.LinkedEvents),
		Flare: &domain.FlareData{
			PeakTime:        canonicalTime(record.PeakTime),
			EndTime:         canonicalTime(record.EndTime),
			ClassType:       record.ClassType,
			SourceLocation:  record.SourceLocation,
			ActiveRegion:    record.ActiveRegionNum,
			LongitudeDeg:    longitude,
			LatitudeDeg:     latitude,
			LocationParsed:  parsed,
			PeakFluxWattsM2: domain.FlareClassPeakFlux(record.ClassType),
		},
	}
}

func flareTitle(classType string) string {
	if classType == "" {
		return "Solar flare"
	}
	return classType + " solar flare"
}

func normalizeSimple(kind domain.EventKind, record rawSimpleEvent) domain.EventDTO {
	id := record.ID
	if kind == domain.EventSEP {
		id = record.SEPID
	}
	if kind == domain.EventIPS {
		id = record.ActivityID
	}
	if kind == domain.EventStorm {
		id = record.GSTID
	}
	start := record.EventTime
	if start == "" {
		start = record.StartTime
	}
	event := domain.EventDTO{
		ID:           id,
		Kind:         kind,
		Catalog:      record.Catalog,
		Title:        simpleTitle(kind, record.Location),
		StartTime:    canonicalTime(start),
		Link:         record.Link,
		Instruments:  instrumentNames(record.Instruments),
		LinkedEvents: linkedEvents(record.LinkedEvents),
	}
	switch kind {
	case domain.EventHSS:
		event.HSS = &domain.HSSData{EventTime: event.StartTime}
	case domain.EventSEP:
		event.SEP = &domain.SEPData{EventTime: event.StartTime}
	case domain.EventIPS:
		event.IPS = &domain.IPSData{EventTime: event.StartTime, Location: record.Location}
	case domain.EventStorm:
		var maximum *float64
		for _, item := range record.AllKp {
			value := item.KpIndex
			if maximum == nil || value > *maximum {
				maximum = &value
			}
		}
		event.Storm = &domain.StormData{KpMax: maximum}
	}
	return event
}

func simpleTitle(kind domain.EventKind, location string) string {
	switch kind {
	case domain.EventHSS:
		return "High-speed stream"
	case domain.EventSEP:
		return "Solar energetic particle event"
	case domain.EventIPS:
		if location != "" {
			return "Interplanetary shock · " + location
		}
		return "Interplanetary shock"
	case domain.EventStorm:
		return "Geomagnetic storm"
	default:
		return "Space weather event"
	}
}

func instrumentNames(input []donkiInstrument) []string {
	result := make([]string, 0, len(input))
	for _, item := range input {
		if item.DisplayName != "" {
			result = append(result, item.DisplayName)
		}
	}
	return result
}

func linkedEvents(input []donkiLinkedEvent) []domain.LinkedEvent {
	result := make([]domain.LinkedEvent, 0, len(input))
	for _, item := range input {
		if item.ActivityID == "" {
			continue
		}
		result = append(result, domain.LinkedEvent{
			ID:   item.ActivityID,
			Kind: kindFromActivityID(item.ActivityID),
		})
	}
	return result
}

func kindFromActivityID(id string) domain.EventKind {
	for marker, kind := range map[string]domain.EventKind{
		"-CME-": domain.EventCME,
		"-FLR-": domain.EventFlare,
		"-HSS-": domain.EventHSS,
		"-SEP-": domain.EventSEP,
		"-IPS-": domain.EventIPS,
		"-GST-": domain.EventStorm,
	} {
		if strings.Contains(id, marker) {
			return kind
		}
	}
	return ""
}

var stonyhurstPattern = regexp.MustCompile(`(?i)([NS])(\d{1,2})([EW])(\d{1,3})`)

func parseStonyhurst(value string) (*float64, *float64, bool) {
	match := stonyhurstPattern.FindStringSubmatch(strings.TrimSpace(value))
	if len(match) != 5 {
		return nil, nil, false
	}
	latitude, err := strconv.ParseFloat(match[2], 64)
	if err != nil {
		return nil, nil, false
	}
	longitude, err := strconv.ParseFloat(match[4], 64)
	if err != nil {
		return nil, nil, false
	}
	if strings.EqualFold(match[1], "S") {
		latitude *= -1
	}
	if strings.EqualFold(match[3], "E") {
		longitude *= -1
	}
	return &latitude, &longitude, true
}

func canonicalTime(value string) string {
	if value == "" {
		return ""
	}
	parsed, err := domain.ParseTime(value)
	if err != nil {
		return value
	}
	return domain.FormatTime(parsed)
}

func eventCoordinateFrame(kind domain.EventKind) string {
	switch kind {
	case domain.EventCME:
		return "HEEQ"
	case domain.EventFlare:
		return "Heliographic Stonyhurst"
	default:
		return ""
	}
}

func issue(provider, code string, err error, retryable bool) domain.ProviderIssue {
	message := ""
	if err != nil {
		message = err.Error()
	}
	return domain.ProviderIssue{
		Provider:  provider,
		Code:      code,
		Message:   message,
		Retryable: retryable,
	}
}

func sourceBase(providerName string, client *DonkiClient) string {
	if strings.Contains(providerName, "CCMC") {
		return client.CCMCBase
	}
	return client.NASABase
}
