package providers

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const (
	DefaultHorizonsBase = "https://ssd.jpl.nasa.gov/api/horizons.api"
	horizonsCacheTTL    = 30 * 24 * time.Hour
	horizonsChunkDays   = 9_000
	julianUnixEpoch     = 2_440_587.5
)

type HorizonsClient struct {
	HTTP *CachedHTTP
	Base string
	Now  func() time.Time
}

type horizonsResponse struct {
	Signature struct {
		Version string `json:"version"`
		Source  string `json:"source"`
	} `json:"signature"`
	Result string `json:"result"`
	Error  string `json:"error"`
}

type ephemerisBodyDefinition struct {
	ID         string
	Name       string
	Kind       string
	PeriodDays float64
}

var innerEphemerisBodies = []ephemerisBodyDefinition{
	{ID: "199", Name: "Mercury", Kind: "planet", PeriodDays: 87.969},
	{ID: "299", Name: "Venus", Kind: "planet", PeriodDays: 224.701},
	{ID: "399", Name: "Earth", Kind: "planet", PeriodDays: 365.256},
	{ID: "499", Name: "Mars", Kind: "planet", PeriodDays: 686.98},
	{ID: "31", Name: "Sun–EMB L1", Kind: "lagrange-point"},
}

func NewHorizonsClient(httpClient *CachedHTTP) *HorizonsClient {
	return &HorizonsClient{HTTP: httpClient, Base: DefaultHorizonsBase, Now: time.Now}
}

// Ephemeris loads Sun-centered geometric vectors for every object in the
// inner-heliosphere scene. Planet requests include enough padding for a full
// trajectory revolution centered on any cursor in the requested range.
func (c *HorizonsClient) Ephemeris(
	ctx context.Context,
	timeRange domain.TimeRange,
) (domain.EphemerisResult, error) {
	start, end, err := domain.ValidateRange(timeRange.Start, timeRange.End)
	if err != nil {
		return domain.EphemerisResult{}, err
	}

	type bodyResult struct {
		body   *domain.BodyEphemerisDTO
		issues []domain.ProviderIssue
		err    error
	}
	results := make([]bodyResult, len(innerEphemerisBodies))
	semaphore := make(chan struct{}, 3)
	var waitGroup sync.WaitGroup
	for index, definition := range innerEphemerisBodies {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[index].err = ctx.Err()
				return
			}
			body, issues, loadErr := c.loadBody(ctx, definition, start, end)
			results[index] = bodyResult{body: body, issues: issues, err: loadErr}
		}()
	}
	waitGroup.Wait()

	output := domain.EphemerisResult{
		Query:           timeRange,
		Center:          "Sun body center (10)",
		CoordinateFrame: "J2000 ecliptic",
		GeneratedAt:     domain.FormatTime(c.now()),
	}
	for index, result := range results {
		output.Issues = append(output.Issues, result.issues...)
		if result.err != nil {
			definition := innerEphemerisBodies[index]
			output.Issues = append(output.Issues, issue(
				"NASA/JPL Horizons",
				"horizons_"+definition.ID,
				fmt.Errorf("%s: %w", definition.Name, result.err),
				IsRetryable(result.err),
			))
			continue
		}
		if result.body != nil {
			output.Bodies = append(output.Bodies, *result.body)
		}
	}
	if len(output.Bodies) == 0 {
		if len(output.Issues) > 0 {
			return output, errors.New(output.Issues[0].Message)
		}
		return output, errors.New("Horizons returned no usable ephemeris bodies")
	}
	return output, nil
}

func (c *HorizonsClient) loadBody(
	ctx context.Context,
	definition ephemerisBodyDefinition,
	start time.Time,
	end time.Time,
) (*domain.BodyEphemerisDTO, []domain.ProviderIssue, error) {
	coverageStart, coverageEnd := ephemerisCoverage(definition, start, end)
	var (
		samples []domain.EphemerisSample
		metas   []FetchMeta
		issues  []domain.ProviderIssue
		source  string
	)
	for chunkStart := coverageStart; chunkStart.Before(coverageEnd); {
		chunkEnd := chunkStart.Add(horizonsChunkDays * 24 * time.Hour)
		if chunkEnd.After(coverageEnd) {
			chunkEnd = coverageEnd
		}
		chunk, chunkSource, meta, err := c.fetchChunk(
			ctx,
			definition,
			chunkStart,
			chunkEnd,
		)
		if err != nil {
			return nil, issues, err
		}
		samples = append(samples, chunk...)
		metas = append(metas, meta)
		if source == "" {
			source = chunkSource
		}
		if meta.Warning != nil {
			issues = append(issues, issue(
				"NASA/JPL Horizons",
				"stale_cache",
				meta.Warning,
				true,
			))
		}
		chunkStart = chunkEnd
	}
	samples = deduplicateEphemerisSamples(samples)
	if len(samples) < 2 {
		return nil, issues, fmt.Errorf("only %d usable state vectors", len(samples))
	}

	retrievedAt := c.now()
	cached := len(metas) > 0
	stale := false
	for _, meta := range metas {
		if meta.RetrievedAt.Before(retrievedAt) {
			retrievedAt = meta.RetrievedAt
		}
		cached = cached && meta.Cached
		stale = stale || meta.Stale
	}
	dataset := "Horizons"
	if source != "" {
		dataset += " " + source
	}
	return &domain.BodyEphemerisDTO{
		ID:              definition.ID,
		Name:            definition.Name,
		Kind:            definition.Kind,
		OrbitPeriodDays: definition.PeriodDays,
		CoverageStart:   samples[0].Time,
		CoverageEnd:     samples[len(samples)-1].Time,
		Samples:         samples,
		Provenance: domain.Provenance{
			Provider:        "NASA/JPL Horizons",
			Dataset:         dataset,
			SourceURL:       c.Base,
			RetrievedAt:     domain.FormatTime(retrievedAt),
			CoordinateFrame: "J2000 ecliptic",
			Class:           domain.DataDerived,
			Cached:          cached,
			Stale:           stale,
		},
	}, issues, nil
}

func (c *HorizonsClient) fetchChunk(
	ctx context.Context,
	definition ephemerisBodyDefinition,
	start time.Time,
	end time.Time,
) ([]domain.EphemerisSample, string, FetchMeta, error) {
	values := url.Values{
		"format":      {"json"},
		"COMMAND":     {quotedHorizons(definition.ID)},
		"OBJ_DATA":    {quotedHorizons("NO")},
		"MAKE_EPHEM":  {quotedHorizons("YES")},
		"EPHEM_TYPE":  {quotedHorizons("VECTORS")},
		"CENTER":      {quotedHorizons("500@10")},
		"START_TIME":  {quotedHorizons(start.UTC().Format("2006-01-02 15:04:05"))},
		"STOP_TIME":   {quotedHorizons(end.UTC().Format("2006-01-02 15:04:05"))},
		"STEP_SIZE":   {quotedHorizons("1 d")},
		"TIME_TYPE":   {quotedHorizons("UT")},
		"TIME_DIGITS": {quotedHorizons("SECONDS")},
		"CAL_TYPE":    {quotedHorizons("GREGORIAN")},
		"REF_PLANE":   {quotedHorizons("ECLIPTIC")},
		"REF_SYSTEM":  {quotedHorizons("ICRF")},
		"OUT_UNITS":   {quotedHorizons("AU-D")},
		"VEC_TABLE":   {quotedHorizons("2")},
		"VEC_CORR":    {quotedHorizons("NONE")},
		"CSV_FORMAT":  {quotedHorizons("YES")},
		"VEC_LABELS":  {quotedHorizons("NO")},
		"VEC_DELTA_T": {quotedHorizons("NO")},
	}
	requestURL := c.Base + "?" + values.Encode()
	cacheKey := fmt.Sprintf(
		"horizons:v1:%s:%s:%s",
		definition.ID,
		start.UTC().Format(time.RFC3339),
		end.UTC().Format(time.RFC3339),
	)
	var response horizonsResponse
	meta, err := c.HTTP.GetJSON(
		ctx,
		requestURL,
		cacheKey,
		horizonsCacheTTL,
		&response,
	)
	if err != nil {
		return nil, "", meta, err
	}
	if response.Error != "" {
		return nil, "", meta, errors.New(strings.TrimSpace(response.Error))
	}
	if err := validateHorizonsTarget(response.Result, definition.ID); err != nil {
		return nil, "", meta, err
	}
	samples, source, err := decodeHorizonsVectors(response.Result)
	if err != nil {
		return nil, "", meta, err
	}
	return samples, source, meta, nil
}

func validateHorizonsTarget(result string, expectedID string) error {
	for _, line := range strings.Split(result, "\n") {
		if !strings.Contains(line, "Target body name:") {
			continue
		}
		if strings.Contains(line, "("+expectedID+")") {
			return nil
		}
		return fmt.Errorf(
			"Horizons returned an unexpected target for ID %s: %s",
			expectedID,
			strings.TrimSpace(line),
		)
	}
	return errors.New("Horizons response omitted the target body")
}

func ephemerisCoverage(
	definition ephemerisBodyDefinition,
	start time.Time,
	end time.Time,
) (time.Time, time.Time) {
	padding := 24 * time.Hour
	if definition.PeriodDays > 0 {
		padding += time.Duration(definition.PeriodDays / 2 * float64(24*time.Hour))
	}
	return utcDayFloor(start.Add(-padding)), utcDayCeil(end.Add(padding))
}

func utcDayFloor(value time.Time) time.Time {
	year, month, day := value.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func utcDayCeil(value time.Time) time.Time {
	floor := utcDayFloor(value)
	if value.Equal(floor) {
		return floor
	}
	return floor.Add(24 * time.Hour)
}

func quotedHorizons(value string) string {
	return "'" + value + "'"
}

func decodeHorizonsVectors(
	result string,
) ([]domain.EphemerisSample, string, error) {
	startMarker := strings.Index(result, "$$SOE")
	endMarker := strings.Index(result, "$$EOE")
	if startMarker < 0 || endMarker < 0 || endMarker <= startMarker {
		return nil, "", errors.New("Horizons response has no ephemeris table")
	}
	source := horizonsSource(result[:startMarker])
	table := result[startMarker+len("$$SOE") : endMarker]
	reader := csv.NewReader(strings.NewReader(table))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, "", fmt.Errorf("parse Horizons CSV: %w", err)
	}
	samples := make([]domain.EphemerisSample, 0, len(records))
	previousJulianDate := math.Inf(-1)
	for _, record := range records {
		if len(record) == 1 && strings.TrimSpace(record[0]) == "" {
			continue
		}
		if len(record) < 8 {
			return nil, "", fmt.Errorf("Horizons vector row has %d columns", len(record))
		}
		values := make([]float64, 7)
		indices := []int{0, 2, 3, 4, 5, 6, 7}
		for index, column := range indices {
			value, parseErr := strconv.ParseFloat(strings.TrimSpace(record[column]), 64)
			if parseErr != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				if parseErr == nil {
					parseErr = errors.New("value is not finite")
				}
				return nil, "", fmt.Errorf(
					"parse Horizons column %d value %q: %w",
					column,
					record[column],
					parseErr,
				)
			}
			values[index] = value
		}
		if values[0] <= previousJulianDate {
			return nil, "", fmt.Errorf(
				"Horizons timestamps are not strictly increasing: %.9f after %.9f",
				values[0],
				previousJulianDate,
			)
		}
		previousJulianDate = values[0]
		samples = append(samples, domain.EphemerisSample{
			Time:       domain.FormatTime(timeFromJulianDate(values[0])),
			XAU:        values[1],
			YAU:        values[2],
			ZAU:        values[3],
			VXAUPerDay: values[4],
			VYAUPerDay: values[5],
			VZAUPerDay: values[6],
		})
	}
	if len(samples) == 0 {
		return nil, "", errors.New("Horizons ephemeris table is empty")
	}
	return samples, source, nil
}

func horizonsSource(header string) string {
	for _, line := range strings.Split(header, "\n") {
		if !strings.Contains(line, "Target body name:") {
			continue
		}
		start := strings.Index(line, "{source:")
		if start < 0 {
			return ""
		}
		value := line[start+len("{source:"):]
		if end := strings.IndexByte(value, '}'); end >= 0 {
			value = value[:end]
		}
		return strings.TrimSpace(value)
	}
	return ""
}

func timeFromJulianDate(julianDate float64) time.Time {
	totalSeconds := (julianDate - julianUnixEpoch) * 86_400
	whole, fractional := math.Modf(totalSeconds)
	nanoseconds := int64(math.Round(fractional * float64(time.Second)))
	seconds := int64(whole)
	if nanoseconds >= int64(time.Second) {
		seconds++
		nanoseconds -= int64(time.Second)
	}
	return time.Unix(seconds, nanoseconds).UTC()
}

func deduplicateEphemerisSamples(
	input []domain.EphemerisSample,
) []domain.EphemerisSample {
	byTime := make(map[string]domain.EphemerisSample, len(input))
	for _, sample := range input {
		byTime[sample.Time] = sample
	}
	output := make([]domain.EphemerisSample, 0, len(byTime))
	for _, sample := range byTime {
		output = append(output, sample)
	}
	sort.Slice(output, func(i, j int) bool {
		return output[i].Time < output[j].Time
	})
	return output
}

func (c *HorizonsClient) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}
