package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const DefaultHAPIBase = "https://cdaweb.gsfc.nasa.gov/hapi"

type OMNIClient struct {
	HTTP *CachedHTTP
	Base string
	Now  func() time.Time
}

func NewOMNIClient(httpClient *CachedHTTP) *OMNIClient {
	return &OMNIClient{HTTP: httpClient, Base: DefaultHAPIBase, Now: time.Now}
}

type hapiParameter struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Unit string `json:"units"`
	Fill string `json:"fill"`
}

type hapiResponse struct {
	Parameters []hapiParameter     `json:"parameters"`
	Data       [][]json.RawMessage `json:"data"`
	Status     hapiStatus          `json:"status"`
}

type hapiStatus struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

var malformedHAPINoData = regexp.MustCompile(
	`"data"\s*:\s*\[\s*,\s*"status"\s*:`,
)

// DecodeMalformedJSON handles a CDAWeb HAPI defect observed for empty time
// ranges. The service returns HTTP 200/status 1201, but serializes the empty
// data array as `"data":[,` and therefore cannot be decoded as JSON.
func (response *hapiResponse) DecodeMalformedJSON(raw []byte) error {
	repaired := malformedHAPINoData.ReplaceAll(
		raw,
		[]byte(`"data":[],"status":`),
	)
	if bytes.Equal(repaired, raw) {
		return fmt.Errorf("not the CDAWeb empty-data response")
	}
	type plainHAPIResponse hapiResponse
	var decoded plainHAPIResponse
	if err := json.Unmarshal(repaired, &decoded); err != nil {
		return err
	}
	if decoded.Status.Code != 1201 || len(decoded.Data) != 0 {
		return fmt.Errorf("unexpected HAPI status %d after empty-data repair", decoded.Status.Code)
	}
	*response = hapiResponse(decoded)
	return nil
}

type omniLevel struct {
	Dataset string
	Cadence time.Duration
	Chunk   time.Duration
	Names   []string
}

func selectOMNILevel(start, end time.Time) omniLevel {
	span := end.Sub(start)
	if !start.Before(time.Date(1981, 1, 1, 0, 0, 0, 0, time.UTC)) && span <= 7*24*time.Hour {
		return omniLevel{
			Dataset: "OMNI_HRO_1MIN",
			Cadence: time.Minute,
			Chunk:   24 * time.Hour,
			Names: []string{
				"Time", "IMF", "PLS", "F", "BX_GSE", "BY_GSM", "BZ_GSM",
				"flow_speed", "proton_density", "T", "Pressure",
			},
		}
	}
	if !start.Before(time.Date(1981, 1, 1, 0, 0, 0, 0, time.UTC)) && span <= 90*24*time.Hour {
		return omniLevel{
			Dataset: "OMNI_HRO_5MIN",
			Cadence: 5 * time.Minute,
			Chunk:   30 * 24 * time.Hour,
			Names: []string{
				"Time", "IMF", "PLS", "F", "BX_GSE", "BY_GSM", "BZ_GSM",
				"flow_speed", "proton_density", "T", "Pressure",
			},
		}
	}
	return omniLevel{
		Dataset: "OMNI2_H0_MRG1HR",
		Cadence: time.Hour,
		Chunk:   365 * 24 * time.Hour,
		Names: []string{
			"Time", "IMF1800", "PLS1800", "F1800", "BX_GSE1800",
			"BY_GSM1800", "BZ_GSM1800", "V1800", "N1800", "T1800",
			"Pressure1800",
		},
	}
}

func ReplayCadence(start, end time.Time) time.Duration {
	return selectOMNILevel(start, end).Cadence
}

func (c *OMNIClient) Telemetry(ctx context.Context, query domain.TelemetryQuery) (domain.TelemetrySeriesDTO, error) {
	return c.telemetry(ctx, query, true)
}

// RawTelemetry retains all normalized provider samples so the replay router can
// merge OMNI with a recent-history source before applying the frontend budget.
func (c *OMNIClient) RawTelemetry(ctx context.Context, query domain.TelemetryQuery) (domain.TelemetrySeriesDTO, error) {
	return c.telemetry(ctx, query, false)
}

func (c *OMNIClient) telemetry(
	ctx context.Context,
	query domain.TelemetryQuery,
	applyPointLimit bool,
) (domain.TelemetrySeriesDTO, error) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return domain.TelemetrySeriesDTO{}, err
	}
	level := selectOMNILevel(start, end)
	maxPoints := query.MaxPoints
	if maxPoints <= 0 || maxPoints > 10_000 {
		maxPoints = 10_000
	}

	var points []domain.TelemetryPoint
	var issues []domain.ProviderIssue
	var metas []FetchMeta
	for chunkStart := start; chunkStart.Before(end); {
		chunkEnd := chunkStart.Add(level.Chunk)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		chunk, meta, err := c.fetchChunk(ctx, level, chunkStart, chunkEnd)
		if err != nil {
			issues = append(issues, issue("NASA CDAWeb", "omni_chunk", err, IsRetryable(err)))
		} else {
			points = append(points, chunk...)
			metas = append(metas, meta)
			if meta.Warning != nil {
				issues = append(issues, issue("NASA CDAWeb", "stale_cache", meta.Warning, true))
			}
		}
		chunkStart = chunkEnd
	}
	if len(points) == 0 && len(issues) > 0 {
		return domain.TelemetrySeriesDTO{}, fmt.Errorf("OMNI returned no usable chunks: %s", issues[0].Message)
	}
	points = deduplicatePoints(points)
	gaps := detectGaps(points, level.Cadence)
	if applyPointLimit {
		points = downsampleTelemetry(points, maxPoints)
	}

	retrievedAt := time.Now().UTC()
	if c.Now != nil {
		retrievedAt = c.Now().UTC()
	}
	cached := len(metas) > 0
	stale := false
	for _, meta := range metas {
		if meta.RetrievedAt.Before(retrievedAt) {
			retrievedAt = meta.RetrievedAt
		}
		cached = cached && meta.Cached
		stale = stale || meta.Stale
	}
	return domain.TelemetrySeriesDTO{
		Query:           query,
		Dataset:         level.Dataset,
		Location:        "Earth bow-shock nose",
		CoordinateFrame: "GSE/GSM",
		CadenceSeconds:  int(level.Cadence.Seconds()),
		Points:          points,
		Gaps:            gaps,
		Provenance: domain.Provenance{
			Provider:        "NASA CDAWeb",
			Dataset:         level.Dataset,
			SourceURL:       c.Base,
			RetrievedAt:     domain.FormatTime(retrievedAt),
			CoordinateFrame: "GSE/GSM",
			Class:           domain.DataObserved,
			Cached:          cached,
			Stale:           stale,
		},
		Issues: issues,
	}, nil
}

func (c *OMNIClient) fetchChunk(
	ctx context.Context,
	level omniLevel,
	start, end time.Time,
) ([]domain.TelemetryPoint, FetchMeta, error) {
	values := url.Values{
		"id":         {level.Dataset},
		"parameters": {strings.Join(level.Names, ",")},
		"time.min":   {start.UTC().Format(time.RFC3339)},
		"time.max":   {end.UTC().Format(time.RFC3339)},
		"format":     {"json"},
	}
	key := fmt.Sprintf(
		"omni:%s:%s:%s",
		level.Dataset,
		start.UTC().Format(time.RFC3339),
		end.UTC().Format(time.RFC3339),
	)
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	ttl := 30 * 24 * time.Hour
	if end.After(now.Add(-7 * 24 * time.Hour)) {
		ttl = time.Hour
	}
	var response hapiResponse
	meta, err := c.HTTP.GetJSON(ctx, strings.TrimRight(c.Base, "/")+"/data?"+values.Encode(), key, ttl, &response)
	if err != nil {
		return nil, FetchMeta{}, err
	}
	if response.Status.Code == 1201 {
		return nil, meta, nil
	}
	points, err := normalizeHAPI(response, level)
	return points, meta, err
}

func normalizeHAPI(response hapiResponse, level omniLevel) ([]domain.TelemetryPoint, error) {
	index := make(map[string]int, len(response.Parameters))
	fills := make(map[string]*float64)
	for position, parameter := range response.Parameters {
		index[parameter.Name] = position
		if parameter.Fill != "" {
			if parsed, err := strconv.ParseFloat(parameter.Fill, 64); err == nil {
				value := parsed
				fills[parameter.Name] = &value
			}
		}
	}
	for _, name := range level.Names {
		if _, ok := index[name]; !ok {
			return nil, fmt.Errorf("OMNI dataset %s omitted parameter %s", level.Dataset, name)
		}
	}
	hourly := level.Dataset == "OMNI2_H0_MRG1HR"
	name := func(highResolution, hourlyName string) string {
		if hourly {
			return hourlyName
		}
		return highResolution
	}
	points := make([]domain.TelemetryPoint, 0, len(response.Data))
	for _, row := range response.Data {
		timeValue, ok := rawString(row, index["Time"])
		if !ok {
			continue
		}
		parsed, err := domain.ParseTime(timeValue)
		if err != nil {
			continue
		}
		point := domain.TelemetryPoint{
			Time:             domain.FormatTime(parsed),
			IMFSource:        rawSource(row, index[name("IMF", "IMF1800")], fills[name("IMF", "IMF1800")]),
			PlasmaSource:     rawSource(row, index[name("PLS", "PLS1800")], fills[name("PLS", "PLS1800")]),
			FieldMagnitudeNT: rawFloat(row, index[name("F", "F1800")], fills[name("F", "F1800")]),
			BxGSENT:          rawFloat(row, index[name("BX_GSE", "BX_GSE1800")], fills[name("BX_GSE", "BX_GSE1800")]),
			ByGSMNT:          rawFloat(row, index[name("BY_GSM", "BY_GSM1800")], fills[name("BY_GSM", "BY_GSM1800")]),
			BzGSMNT:          rawFloat(row, index[name("BZ_GSM", "BZ_GSM1800")], fills[name("BZ_GSM", "BZ_GSM1800")]),
			SpeedKMS:         rawFloat(row, index[name("flow_speed", "V1800")], fills[name("flow_speed", "V1800")]),
			DensityPerCM3:    rawFloat(row, index[name("proton_density", "N1800")], fills[name("proton_density", "N1800")]),
			TemperatureK:     rawFloat(row, index[name("T", "T1800")], fills[name("T", "T1800")]),
			PressureNPa:      rawFloat(row, index[name("Pressure", "Pressure1800")], fills[name("Pressure", "Pressure1800")]),
		}
		if point.IMFSource != "" {
			point.Source = point.IMFSource
		} else {
			point.Source = point.PlasmaSource
		}
		if hasMagneticValues(point) {
			point.IMFAnchor = domain.SpatialAnchorEarth
		}
		if hasPlasmaValues(point) {
			point.PlasmaAnchor = domain.SpatialAnchorEarth
		}
		if hasTelemetryValues(point) {
			points = append(points, point)
		}
	}
	return points, nil
}

func rawString(row []json.RawMessage, index int) (string, bool) {
	if index < 0 || index >= len(row) {
		return "", false
	}
	var value string
	if err := json.Unmarshal(row[index], &value); err != nil {
		return "", false
	}
	return value, true
}

func rawFloat(row []json.RawMessage, index int, fill *float64) *float64 {
	if index < 0 || index >= len(row) || string(row[index]) == "null" {
		return nil
	}
	var value float64
	if err := json.Unmarshal(row[index], &value); err != nil ||
		math.IsNaN(value) || math.IsInf(value, 0) ||
		(fill != nil && value == *fill) {
		return nil
	}
	return &value
}

func rawSource(row []json.RawMessage, index int, fill *float64) string {
	value := rawFloat(row, index, fill)
	if value == nil {
		return ""
	}
	return "OMNI source " + strconv.Itoa(int(*value))
}

func deduplicatePoints(input []domain.TelemetryPoint) []domain.TelemetryPoint {
	byTime := make(map[string]domain.TelemetryPoint, len(input))
	for _, point := range input {
		byTime[point.Time] = point
	}
	result := make([]domain.TelemetryPoint, 0, len(byTime))
	for _, point := range byTime {
		result = append(result, point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Time < result[j].Time })
	return result
}

func detectGaps(points []domain.TelemetryPoint, cadence time.Duration) []domain.DataGap {
	if len(points) < 2 {
		return nil
	}
	threshold := cadence * 5 / 2
	var gaps []domain.DataGap
	for index := 1; index < len(points); index++ {
		previous, errPrevious := domain.ParseTime(points[index-1].Time)
		current, errCurrent := domain.ParseTime(points[index].Time)
		if errPrevious != nil || errCurrent != nil {
			continue
		}
		if current.Sub(previous) > threshold {
			gaps = append(gaps, domain.DataGap{
				Start:  points[index-1].Time,
				End:    points[index].Time,
				Reason: "No OMNI records at the selected cadence",
			})
		}
	}
	return gaps
}

func downsampleTelemetry(input []domain.TelemetryPoint, maximum int) []domain.TelemetryPoint {
	if maximum <= 0 || len(input) <= maximum {
		return input
	}
	if maximum == 1 {
		return input[len(input)-1:]
	}
	if maximum == 2 {
		return []domain.TelemetryPoint{input[0], input[len(input)-1]}
	}
	metrics := []func(domain.TelemetryPoint) *float64{
		func(point domain.TelemetryPoint) *float64 { return point.SpeedKMS },
		func(point domain.TelemetryPoint) *float64 { return point.DensityPerCM3 },
		func(point domain.TelemetryPoint) *float64 { return point.PressureNPa },
		func(point domain.TelemetryPoint) *float64 { return point.BzGSMNT },
		func(point domain.TelemetryPoint) *float64 { return point.FieldMagnitudeNT },
	}
	bucketCount := maximum/len(metrics) - 1
	if bucketCount < 1 {
		bucketCount = 1
	}
	bucketSize := float64(len(input)-2) / float64(bucketCount)
	selected := map[int]bool{0: true, len(input) - 1: true}
	for bucket := 0; bucket < bucketCount; bucket++ {
		start := 1 + int(math.Floor(float64(bucket)*bucketSize))
		end := 1 + int(math.Floor(float64(bucket+1)*bucketSize))
		if end > len(input)-1 {
			end = len(input) - 1
		}
		for _, metric := range metrics {
			minIndex, maxIndex := -1, -1
			var minValue, maxValue float64
			for index := start; index < end; index++ {
				value := metric(input[index])
				if value == nil {
					continue
				}
				if minIndex < 0 || *value < minValue {
					minIndex, minValue = index, *value
				}
				if maxIndex < 0 || *value > maxValue {
					maxIndex, maxValue = index, *value
				}
			}
			if minIndex >= 0 {
				selected[minIndex] = true
			}
			if maxIndex >= 0 {
				selected[maxIndex] = true
			}
		}
	}
	indices := make([]int, 0, len(selected))
	for index := range selected {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	if len(indices) > maximum {
		step := float64(len(indices)-1) / float64(maximum-1)
		reduced := make([]int, 0, maximum)
		for index := 0; index < maximum; index++ {
			reduced = append(reduced, indices[int(math.Round(float64(index)*step))])
		}
		indices = reduced
	}
	result := make([]domain.TelemetryPoint, 0, len(indices))
	for _, index := range indices {
		result = append(result, input[index])
	}
	return result
}
