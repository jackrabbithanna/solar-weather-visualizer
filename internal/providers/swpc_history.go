package providers

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const DefaultSWPCHistoryBase = "https://tlv-swpc.woc.noaa.gov/hapi"

type SWPCHistoryClient struct {
	HTTP *CachedHTTP
	Base string
	Now  func() time.Time
}

func NewSWPCHistoryClient(httpClient *CachedHTTP) *SWPCHistoryClient {
	return &SWPCHistoryClient{
		HTTP: httpClient,
		Base: DefaultSWPCHistoryBase,
		Now:  time.Now,
	}
}

type swpcHistoryLevel struct {
	Suffix  string
	Cadence time.Duration
	Chunk   time.Duration
}

func selectSWPCHistoryLevel(cadence time.Duration) swpcHistoryLevel {
	switch {
	case cadence <= time.Minute:
		return swpcHistoryLevel{Suffix: "pt1m", Cadence: time.Minute, Chunk: 24 * time.Hour}
	case cadence <= 5*time.Minute:
		return swpcHistoryLevel{Suffix: "pt5m", Cadence: 5 * time.Minute, Chunk: 7 * 24 * time.Hour}
	default:
		return swpcHistoryLevel{Suffix: "pt1h", Cadence: time.Hour, Chunk: 30 * 24 * time.Hour}
	}
}

type swpcHistoryStream struct {
	Kind       string
	Dataset    string
	Parameters []string
}

type swpcHistoryChunk struct {
	Points []domain.TelemetryPoint `json:"points"`
}

type swpcHistoryFetch struct {
	stream swpcHistoryStream
	points []domain.TelemetryPoint
	meta   FetchMeta
	err    error
}

func (c *SWPCHistoryClient) Telemetry(
	ctx context.Context,
	query domain.TelemetryQuery,
	cadence time.Duration,
) (domain.TelemetrySeriesDTO, error) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return domain.TelemetrySeriesDTO{}, err
	}
	level := selectSWPCHistoryLevel(cadence)
	streams := []swpcHistoryStream{
		{
			Kind:       "mag",
			Dataset:    "active-mag-" + level.Suffix,
			Parameters: []string{"bt", "bx_gse", "by_gsm", "bz_gsm", "quality", "source", "active"},
		},
		{
			Kind:       "plasma",
			Dataset:    "active-plasma-" + level.Suffix,
			Parameters: []string{"speed", "density", "temperature", "quality", "source", "active"},
		},
	}

	var points []domain.TelemetryPoint
	var issues []domain.ProviderIssue
	var metas []FetchMeta
	successfulChunks := 0
	for chunkStart := start; chunkStart.Before(end); {
		chunkEnd := chunkStart.Add(level.Chunk)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		results := make(chan swpcHistoryFetch, len(streams))
		for _, stream := range streams {
			stream := stream
			go func() {
				chunk, meta, fetchErr := c.fetchStream(ctx, stream, chunkStart, chunkEnd)
				results <- swpcHistoryFetch{
					stream: stream,
					points: chunk,
					meta:   meta,
					err:    fetchErr,
				}
			}()
		}
		for range streams {
			result := <-results
			if result.err != nil {
				issues = append(issues, issue(
					"NOAA SWPC",
					"history_"+result.stream.Kind,
					result.err,
					IsRetryable(result.err),
				))
				continue
			}
			successfulChunks++
			points = append(points, result.points...)
			metas = append(metas, result.meta)
			if result.meta.Warning != nil {
				issues = append(issues, issue(
					"NOAA SWPC",
					"stale_history_"+result.stream.Kind,
					result.meta.Warning,
					true,
				))
			}
		}
		chunkStart = chunkEnd
	}
	if successfulChunks == 0 && len(issues) > 0 {
		return domain.TelemetrySeriesDTO{}, fmt.Errorf(
			"NOAA replay history returned no usable chunks: %s",
			issues[0].Message,
		)
	}

	points = mergePointsByTime(points)
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	provenance := summarizeFetches(
		"NOAA SWPC",
		streams[0].Dataset+" + "+streams[1].Dataset,
		c.Base,
		"GSE/GSM",
		metas,
		now,
	)
	return domain.TelemetrySeriesDTO{
		Query:           query,
		Dataset:         provenance.Dataset,
		Location:        "L1",
		CoordinateFrame: "GSE/GSM",
		CadenceSeconds:  int(level.Cadence.Seconds()),
		Points:          points,
		Gaps:            detectGaps(points, level.Cadence),
		Provenance:      provenance,
		Issues:          issues,
	}, nil
}

func (c *SWPCHistoryClient) fetchStream(
	ctx context.Context,
	stream swpcHistoryStream,
	start, end time.Time,
) ([]domain.TelemetryPoint, FetchMeta, error) {
	values := url.Values{
		"id":         {stream.Dataset},
		"parameters": {strings.Join(stream.Parameters, ",")},
		"time.min":   {start.UTC().Format(time.RFC3339)},
		"time.max":   {end.UTC().Format(time.RFC3339)},
	}
	requestURL := strings.TrimRight(c.Base, "/") + "/data?" + values.Encode()
	cacheKey := fmt.Sprintf(
		"swpc-history:%s:%s:%s",
		stream.Dataset,
		start.UTC().Format(time.RFC3339),
		end.UTC().Format(time.RFC3339),
	)
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	ttl := 24 * time.Hour
	if end.After(now.Add(-7 * 24 * time.Hour)) {
		ttl = time.Hour
	}
	var decoded swpcHistoryChunk
	meta, err := c.HTTP.GetDecoded(
		ctx,
		requestURL,
		cacheKey,
		ttl,
		"*/*",
		&decoded,
		func(body []byte) error {
			points, decodeErr := decodeSWPCHistoryCSV(body, stream)
			if decodeErr != nil {
				return decodeErr
			}
			decoded.Points = points
			return nil
		},
	)
	return decoded.Points, meta, err
}

func decodeSWPCHistoryCSV(
	body []byte,
	stream swpcHistoryStream,
) ([]domain.TelemetryPoint, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, nil
	}
	if trimmed[0] == '{' {
		var response struct {
			Status hapiStatus `json:"status"`
		}
		if err := json.Unmarshal(trimmed, &response); err != nil {
			return nil, err
		}
		if response.Status.Code == 1201 {
			return nil, nil
		}
		return nil, fmt.Errorf(
			"NOAA HAPI status %d: %s",
			response.Status.Code,
			response.Status.Message,
		)
	}

	reader := csv.NewReader(bytes.NewReader(trimmed))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read NOAA CSV header: %w", err)
	}
	index := make(map[string]int, len(header))
	for position, name := range header {
		index[strings.TrimSpace(name)] = position
	}
	required := append([]string{"time_tag"}, stream.Parameters...)
	for _, name := range required {
		if _, ok := index[name]; !ok {
			return nil, fmt.Errorf("NOAA dataset %s omitted parameter %s", stream.Dataset, name)
		}
	}

	var points []domain.TelemetryPoint
	for {
		row, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			continue
		}
		timeValue, ok := csvValue(row, index["time_tag"])
		if !ok {
			continue
		}
		parsed, parseErr := domain.ParseTime(timeValue)
		if parseErr != nil {
			continue
		}
		point := domain.TelemetryPoint{Time: domain.FormatTime(parsed)}
		source := csvSource(row, index["source"])
		if source == "" {
			source = "NOAA SWPC active"
		} else {
			source = "NOAA SWPC source " + source
		}
		if stream.Kind == "mag" {
			point.FieldMagnitudeNT = csvFloat(row, index["bt"])
			point.BxGSENT = csvFloat(row, index["bx_gse"])
			point.ByGSMNT = csvFloat(row, index["by_gsm"])
			point.BzGSMNT = csvFloat(row, index["bz_gsm"])
			point.IMFSource = source
		} else {
			point.SpeedKMS = csvFloat(row, index["speed"])
			point.DensityPerCM3 = csvFloat(row, index["density"])
			point.TemperatureK = csvFloat(row, index["temperature"])
			point.PlasmaSource = source
			if point.SpeedKMS != nil && point.DensityPerCM3 != nil {
				pressure := domain.DynamicPressureNPa(*point.DensityPerCM3, *point.SpeedKMS)
				point.PressureNPa = &pressure
			}
		}
		point.Quality = csvInt(row, index["quality"])
		if active := csvInt(row, index["active"]); active != nil {
			value := *active != 0
			point.Active = &value
		}
		point.Source = source
		if hasTelemetryValues(point) {
			points = append(points, point)
		}
	}
	return points, nil
}

func csvValue(row []string, position int) (string, bool) {
	if position < 0 || position >= len(row) {
		return "", false
	}
	value := strings.TrimSpace(row[position])
	return value, value != ""
}

func csvFloat(row []string, position int) *float64 {
	text, ok := csvValue(row, position)
	if !ok {
		return nil
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) ||
		value <= -1e20 || value == -9999 {
		return nil
	}
	return &value
}

func csvInt(row []string, position int) *int {
	text, ok := csvValue(row, position)
	if !ok {
		return nil
	}
	value, err := strconv.Atoi(text)
	if err != nil || value == -1 {
		return nil
	}
	return &value
}

func csvSource(row []string, position int) string {
	value := csvInt(row, position)
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}
