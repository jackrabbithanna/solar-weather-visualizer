package providers

import (
	"sort"
	"strings"
	"time"

	"solar-weather-visualizer/internal/domain"
)

func hasMagneticValues(point domain.TelemetryPoint) bool {
	return point.FieldMagnitudeNT != nil || point.BxGSENT != nil ||
		point.ByGSMNT != nil || point.BzGSMNT != nil
}

func hasPlasmaValues(point domain.TelemetryPoint) bool {
	return point.SpeedKMS != nil || point.DensityPerCM3 != nil ||
		point.TemperatureK != nil || point.PressureNPa != nil
}

func hasTelemetryValues(point domain.TelemetryPoint) bool {
	return hasMagneticValues(point) || hasPlasmaValues(point)
}

func mergePointsByTime(input []domain.TelemetryPoint) []domain.TelemetryPoint {
	byTime := make(map[string]domain.TelemetryPoint, len(input))
	for _, point := range input {
		if !hasTelemetryValues(point) {
			continue
		}
		existing := byTime[point.Time]
		mergeMagneticValues(&existing, point)
		mergePlasmaValues(&existing, point)
		mergePointMetadata(&existing, point)
		existing.Time = point.Time
		setCombinedSource(&existing)
		byTime[point.Time] = existing
	}
	result := make([]domain.TelemetryPoint, 0, len(byTime))
	for _, point := range byTime {
		result = append(result, point)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Time < result[j].Time })
	return result
}

func MergeReplayTelemetry(
	query domain.TelemetryQuery,
	cadence time.Duration,
	omni *domain.TelemetrySeriesDTO,
	noaa *domain.TelemetrySeriesDTO,
	additionalIssues []domain.ProviderIssue,
) domain.TelemetrySeriesDTO {
	start, end, _ := domain.ValidateRange(query.Start, query.End)
	var magneticCutoff time.Time
	var plasmaCutoff time.Time
	hasMagneticCutoff := false
	hasPlasmaCutoff := false
	if omni != nil {
		for _, point := range omni.Points {
			observedAt, err := domain.ParseTime(point.Time)
			if err != nil {
				continue
			}
			if hasMagneticValues(point) && (!hasMagneticCutoff || observedAt.After(magneticCutoff)) {
				magneticCutoff = observedAt
				hasMagneticCutoff = true
			}
			if hasPlasmaValues(point) && (!hasPlasmaCutoff || observedAt.After(plasmaCutoff)) {
				plasmaCutoff = observedAt
				hasPlasmaCutoff = true
			}
		}
	}

	var selected []domain.TelemetryPoint
	omniUsed := false
	if omni != nil {
		for _, point := range omni.Points {
			if !hasTelemetryValues(point) {
				continue
			}
			selected = append(selected, point)
			omniUsed = true
		}
	}
	noaaUsed := false
	if noaa != nil {
		for _, point := range noaa.Points {
			observedAt, err := domain.ParseTime(point.Time)
			if err != nil {
				continue
			}
			candidate := domain.TelemetryPoint{
				Time:    point.Time,
				Quality: point.Quality,
				Active:  point.Active,
			}
			if !hasMagneticCutoff || observedAt.After(magneticCutoff) {
				mergeMagneticValues(&candidate, point)
			}
			if !hasPlasmaCutoff || observedAt.After(plasmaCutoff) {
				mergePlasmaValues(&candidate, point)
			}
			if !hasTelemetryValues(candidate) {
				continue
			}
			setCombinedSource(&candidate)
			selected = append(selected, candidate)
			noaaUsed = true
		}
	}
	points := mergePointsByTime(selected)
	gaps := detectRangeGaps(points, start, end, cadence)

	maxPoints := query.MaxPoints
	if maxPoints <= 0 || maxPoints > 10_000 {
		maxPoints = 10_000
	}
	points = downsampleTelemetry(points, maxPoints)

	contributors := make([]domain.Provenance, 0, 2)
	var issues []domain.ProviderIssue
	if omni != nil {
		contributors = append(contributors, omni.Provenance)
		issues = append(issues, omni.Issues...)
	}
	if noaa != nil {
		contributors = append(contributors, noaa.Provenance)
		issues = append(issues, noaa.Issues...)
	}
	issues = append(issues, additionalIssues...)

	datasets := make([]string, 0, 2)
	if omniUsed && omni != nil {
		datasets = append(datasets, omni.Dataset)
	}
	if noaaUsed && noaa != nil {
		datasets = append(datasets, noaa.Dataset)
	}
	if len(datasets) == 0 {
		if omni != nil {
			datasets = append(datasets, omni.Dataset)
		}
		if noaa != nil {
			datasets = append(datasets, noaa.Dataset)
		}
	}
	dataset := strings.Join(uniqueStrings(datasets), " + ")
	location := "Near Earth"
	switch {
	case omniUsed && noaaUsed:
		location = "Near Earth (OMNI bow-shock shifted / NOAA L1)"
	case omniUsed:
		location = "Earth bow-shock nose"
	case noaaUsed:
		location = "L1"
	}
	return domain.TelemetrySeriesDTO{
		Query:           query,
		Dataset:         dataset,
		Location:        location,
		CoordinateFrame: "GSE/GSM",
		CadenceSeconds:  int(cadence.Seconds()),
		Points:          points,
		Gaps:            gaps,
		Provenance:      summarizeContributors(contributors, dataset),
		Contributors:    contributors,
		Issues:          issues,
	}
}

func mergeMagneticValues(destination *domain.TelemetryPoint, source domain.TelemetryPoint) {
	if !hasMagneticValues(source) {
		return
	}
	destination.FieldMagnitudeNT = source.FieldMagnitudeNT
	destination.BxGSENT = source.BxGSENT
	destination.ByGSMNT = source.ByGSMNT
	destination.BzGSMNT = source.BzGSMNT
	destination.IMFSource = source.IMFSource
}

func mergePlasmaValues(destination *domain.TelemetryPoint, source domain.TelemetryPoint) {
	if !hasPlasmaValues(source) {
		return
	}
	destination.SpeedKMS = source.SpeedKMS
	destination.DensityPerCM3 = source.DensityPerCM3
	destination.TemperatureK = source.TemperatureK
	destination.PressureNPa = source.PressureNPa
	destination.PlasmaSource = source.PlasmaSource
}

func mergePointMetadata(destination *domain.TelemetryPoint, source domain.TelemetryPoint) {
	if source.Quality != nil {
		destination.Quality = source.Quality
	}
	if source.Active != nil {
		destination.Active = source.Active
	}
}

func setCombinedSource(point *domain.TelemetryPoint) {
	switch {
	case point.IMFSource != "" && point.PlasmaSource != "" && point.IMFSource != point.PlasmaSource:
		point.Source = "IMF " + point.IMFSource + " / plasma " + point.PlasmaSource
	case point.IMFSource != "":
		point.Source = point.IMFSource
	default:
		point.Source = point.PlasmaSource
	}
}

func detectRangeGaps(
	points []domain.TelemetryPoint,
	start, end time.Time,
	cadence time.Duration,
) []domain.DataGap {
	if !start.Before(end) {
		return nil
	}
	reason := "No replay telemetry records at the selected cadence"
	if len(points) == 0 {
		return []domain.DataGap{{
			Start:  domain.FormatTime(start),
			End:    domain.FormatTime(end),
			Reason: reason,
		}}
	}
	threshold := cadence * 5 / 2
	var gaps []domain.DataGap
	first, firstErr := domain.ParseTime(points[0].Time)
	if firstErr == nil && first.Sub(start) > threshold {
		gaps = append(gaps, domain.DataGap{
			Start:  domain.FormatTime(start),
			End:    points[0].Time,
			Reason: reason,
		})
	}
	for index := 1; index < len(points); index++ {
		previous, previousErr := domain.ParseTime(points[index-1].Time)
		current, currentErr := domain.ParseTime(points[index].Time)
		if previousErr == nil && currentErr == nil && current.Sub(previous) > threshold {
			gaps = append(gaps, domain.DataGap{
				Start:  points[index-1].Time,
				End:    points[index].Time,
				Reason: reason,
			})
		}
	}
	last, lastErr := domain.ParseTime(points[len(points)-1].Time)
	if lastErr == nil && end.Sub(last) > threshold {
		gaps = append(gaps, domain.DataGap{
			Start:  points[len(points)-1].Time,
			End:    domain.FormatTime(end),
			Reason: reason,
		})
	}
	return gaps
}

func summarizeFetches(
	provider string,
	dataset string,
	sourceURL string,
	coordinateFrame string,
	metas []FetchMeta,
	fallbackTime time.Time,
) domain.Provenance {
	retrievedAt := fallbackTime.UTC()
	cached := len(metas) > 0
	stale := false
	for index, meta := range metas {
		if index == 0 || meta.RetrievedAt.Before(retrievedAt) {
			retrievedAt = meta.RetrievedAt
		}
		cached = cached && meta.Cached
		stale = stale || meta.Stale
	}
	return domain.Provenance{
		Provider:        provider,
		Dataset:         dataset,
		SourceURL:       sourceURL,
		RetrievedAt:     domain.FormatTime(retrievedAt),
		CoordinateFrame: coordinateFrame,
		Class:           domain.DataObserved,
		Cached:          cached,
		Stale:           stale,
	}
}

func summarizeContributors(
	contributors []domain.Provenance,
	dataset string,
) domain.Provenance {
	if len(contributors) == 1 {
		return contributors[0]
	}
	providers := make([]string, 0, len(contributors))
	retrievedAt := time.Time{}
	cached := len(contributors) > 0
	stale := false
	for _, contributor := range contributors {
		providers = append(providers, contributor.Provider)
		if observed, err := domain.ParseTime(contributor.RetrievedAt); err == nil &&
			(retrievedAt.IsZero() || observed.After(retrievedAt)) {
			retrievedAt = observed
		}
		cached = cached && contributor.Cached
		stale = stale || contributor.Stale
	}
	return domain.Provenance{
		Provider:        strings.Join(uniqueStrings(providers), " / "),
		Dataset:         dataset,
		RetrievedAt:     domain.FormatTime(retrievedAt),
		CoordinateFrame: "GSE/GSM",
		Class:           domain.DataObserved,
		Cached:          cached,
		Stale:           stale,
	}
}

func uniqueStrings(input []string) []string {
	seen := make(map[string]bool, len(input))
	result := make([]string, 0, len(input))
	for _, value := range input {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
