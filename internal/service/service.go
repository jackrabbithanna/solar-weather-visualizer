package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"solar-weather-visualizer/internal/domain"
	"solar-weather-visualizer/internal/providers"
	"solar-weather-visualizer/internal/store"
)

const (
	ApplicationName    = "solar-weather-visualizer"
	ApplicationVersion = "0.1.0"
	replayBridgeWindow = 90 * 24 * time.Hour
)

type Service struct {
	Store    *store.Store
	HTTP     *providers.CachedHTTP
	DONKI    *providers.DonkiClient
	SWPC     *providers.SWPCClient
	OMNI     *providers.OMNIClient
	History  *providers.SWPCHistoryClient
	Horizons *providers.HorizonsClient
	Now      func() time.Time

	statusMu sync.Mutex
	status   map[string]domain.ProviderStatus
}

func New() (*Service, error) {
	persistence, err := store.New(ApplicationName)
	if err != nil {
		return nil, err
	}
	return NewWithStore(persistence), nil
}

func NewWithStore(persistence *store.Store) *Service {
	httpClient := providers.NewCachedHTTP(persistence)
	return &Service{
		Store:    persistence,
		HTTP:     httpClient,
		DONKI:    providers.NewDonkiClient(httpClient),
		SWPC:     providers.NewSWPCClient(httpClient),
		OMNI:     providers.NewOMNIClient(httpClient),
		History:  providers.NewSWPCHistoryClient(httpClient),
		Horizons: providers.NewHorizonsClient(httpClient),
		Now:      time.Now,
		status: map[string]domain.ProviderStatus{
			"NASA CCMC / DONKI": {Provider: "NASA CCMC / DONKI"},
			"NOAA SWPC":         {Provider: "NOAA SWPC"},
			"NASA CDAWeb":       {Provider: "NASA CDAWeb"},
			"NASA/JPL Horizons": {Provider: "NASA/JPL Horizons"},
		},
	}
}

func (s *Service) Bootstrap() (domain.BootstrapDTO, error) {
	settings, err := s.GetSettings()
	if err != nil {
		return domain.BootstrapDTO{}, err
	}
	cacheBytes, err := s.Store.CacheBytes()
	if err != nil {
		return domain.BootstrapDTO{}, err
	}
	return domain.BootstrapDTO{
		Version:      ApplicationVersion,
		GeneratedAt:  domain.FormatTime(s.now()),
		Settings:     settings,
		Providers:    s.providerStatuses(),
		CacheBytes:   cacheBytes,
		OfflineReady: s.Store.HasCache(),
	}, nil
}

func (s *Service) GetSettings() (domain.SettingsDTO, error) {
	config, err := s.Store.LoadConfig()
	if err != nil {
		return domain.SettingsDTO{}, err
	}
	return settingsDTO(config), nil
}

func (s *Service) SaveSettings(update domain.SettingsUpdate) (domain.SettingsDTO, error) {
	config, err := s.Store.LoadConfig()
	if err != nil {
		return domain.SettingsDTO{}, err
	}
	if update.ClearNASAAPIKey {
		config.NASAAPIKey = ""
	} else if update.NASAAPIKey != nil {
		config.NASAAPIKey = strings.TrimSpace(*update.NASAAPIKey)
	}
	if update.CacheLimitBytes != nil {
		if *update.CacheLimitBytes < 64<<20 {
			return domain.SettingsDTO{}, errors.New("cache limit must be at least 64 MiB")
		}
		config.CacheLimitBytes = *update.CacheLimitBytes
	}
	if update.LiveRefreshSeconds != nil {
		if *update.LiveRefreshSeconds < 30 {
			return domain.SettingsDTO{}, errors.New("live refresh must be at least 30 seconds")
		}
		config.LiveRefreshSeconds = *update.LiveRefreshSeconds
	}
	if update.FullRTSWRefreshSeconds != nil {
		if *update.FullRTSWRefreshSeconds < 300 {
			return domain.SettingsDTO{}, errors.New("full telemetry refresh must be at least 300 seconds")
		}
		config.FullRTSWRefreshSeconds = *update.FullRTSWRefreshSeconds
	}
	if update.EventRefreshSeconds != nil {
		if *update.EventRefreshSeconds < 300 {
			return domain.SettingsDTO{}, errors.New("event refresh must be at least 300 seconds")
		}
		config.EventRefreshSeconds = *update.EventRefreshSeconds
	}
	if update.PreferredScale != nil {
		if *update.PreferredScale != "linear" && *update.PreferredScale != "compressed" {
			return domain.SettingsDTO{}, errors.New("preferred scale must be linear or compressed")
		}
		config.PreferredScale = *update.PreferredScale
	}
	if update.ReducedMotion != nil {
		config.ReducedMotion = *update.ReducedMotion
	}
	if err := s.Store.SaveConfig(config); err != nil {
		return domain.SettingsDTO{}, err
	}
	return settingsDTO(config), nil
}

func settingsDTO(config store.Config) domain.SettingsDTO {
	return domain.SettingsDTO{
		NASAKeyConfigured:      config.NASAAPIKey != "",
		CacheLimitBytes:        config.CacheLimitBytes,
		LiveRefreshSeconds:     config.LiveRefreshSeconds,
		FullRTSWRefreshSeconds: config.FullRTSWRefreshSeconds,
		EventRefreshSeconds:    config.EventRefreshSeconds,
		PreferredScale:         config.PreferredScale,
		ReducedMotion:          config.ReducedMotion,
	}
}

func (s *Service) ClearCache() error {
	return s.Store.ClearCache()
}

func (s *Service) RefreshLive(ctx context.Context) (domain.LiveSnapshotDTO, error) {
	snapshot, err := s.SWPC.Live(ctx)
	s.recordStatus("NOAA SWPC", err)
	return snapshot, err
}

func (s *Service) LoadTelemetry(
	ctx context.Context,
	query domain.TelemetryQuery,
) (domain.TelemetrySeriesDTO, error) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return domain.TelemetrySeriesDTO{}, err
	}
	now := s.now()
	cadence := providers.ReplayCadence(start, end)
	type providerResult struct {
		series domain.TelemetrySeriesDTO
		err    error
	}
	omniResult := make(chan providerResult, 1)
	go func() {
		series, fetchErr := s.OMNI.RawTelemetry(ctx, query)
		omniResult <- providerResult{series: series, err: fetchErr}
	}()

	recentStart := start
	if cutoff := now.Add(-replayBridgeWindow); recentStart.Before(cutoff) {
		recentStart = cutoff
	}
	recentEnd := end
	if recentEnd.After(now) {
		recentEnd = now
	}
	noaaApplicable := recentStart.Before(recentEnd)
	var noaaResult chan providerResult
	if noaaApplicable {
		noaaResult = make(chan providerResult, 1)
		recentQuery := query
		recentQuery.Start = domain.FormatTime(recentStart)
		recentQuery.End = domain.FormatTime(recentEnd)
		go func() {
			series, fetchErr := s.History.Telemetry(ctx, recentQuery, cadence)
			noaaResult <- providerResult{series: series, err: fetchErr}
		}()
	}

	omni := <-omniResult
	s.recordStatus("NASA CDAWeb", omni.err)
	var noaa providerResult
	if noaaApplicable {
		noaa = <-noaaResult
		s.recordStatus("NOAA SWPC", noaa.err)
	}
	if omni.err != nil && (!noaaApplicable || noaa.err != nil) {
		if noaaApplicable {
			return domain.TelemetrySeriesDTO{}, fmt.Errorf(
				"replay telemetry providers failed: OMNI: %v; NOAA: %v",
				omni.err,
				noaa.err,
			)
		}
		return domain.TelemetrySeriesDTO{}, fmt.Errorf("OMNI telemetry failed: %w", omni.err)
	}

	var omniSeries *domain.TelemetrySeriesDTO
	var noaaSeries *domain.TelemetrySeriesDTO
	var issues []domain.ProviderIssue
	if omni.err == nil {
		omniSeries = &omni.series
	} else {
		issues = append(issues, domain.ProviderIssue{
			Provider:  "NASA CDAWeb",
			Code:      "omni_history",
			Message:   omni.err.Error(),
			Retryable: providers.IsRetryable(omni.err),
		})
	}
	if noaaApplicable {
		if noaa.err == nil {
			noaaSeries = &noaa.series
		} else {
			issues = append(issues, domain.ProviderIssue{
				Provider:  "NOAA SWPC",
				Code:      "replay_history",
				Message:   noaa.err.Error(),
				Retryable: providers.IsRetryable(noaa.err),
			})
		}
	}
	return providers.MergeReplayTelemetry(query, cadence, omniSeries, noaaSeries, issues), nil
}

func (s *Service) LoadEphemeris(
	ctx context.Context,
	timeRange domain.TimeRange,
) (domain.EphemerisResult, error) {
	result, err := s.Horizons.Ephemeris(ctx, timeRange)
	s.recordStatus("NASA/JPL Horizons", err)
	return result, err
}

func (s *Service) SearchEvents(
	ctx context.Context,
	query domain.EventQuery,
) (domain.EventSearchResult, error) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return domain.EventSearchResult{}, err
	}
	config, err := s.Store.LoadConfig()
	if err != nil {
		return domain.EventSearchResult{}, err
	}

	eventsByID := make(map[string]domain.EventDTO)
	var issues []domain.ProviderIssue
	cursor := dateFloor(start)
	lastDate := dateFloor(end)
	for !cursor.After(lastDate) {
		chunkEnd := cursor.AddDate(0, 0, 30)
		if chunkEnd.After(lastDate) {
			chunkEnd = lastDate
		}
		chunkQuery := query
		chunkQuery.Start = domain.FormatTime(cursor)
		chunkQuery.End = domain.FormatTime(chunkEnd.Add(23*time.Hour + 59*time.Minute + 59*time.Second))
		chunkEvents, chunkIssues := s.DONKI.SearchEvents(ctx, chunkQuery, config.NASAAPIKey)
		for _, event := range chunkEvents {
			eventTime, parseErr := domain.ParseTime(event.StartTime)
			if parseErr == nil && !eventTime.Before(start) && !eventTime.After(end) {
				eventsByID[eventKey(event)] = event
			}
		}
		issues = append(issues, chunkIssues...)
		if err := ctx.Err(); err != nil {
			return domain.EventSearchResult{}, err
		}
		cursor = chunkEnd.AddDate(0, 0, 1)
	}

	events := make([]domain.EventDTO, 0, len(eventsByID))
	fromCache := len(eventsByID) > 0
	for _, event := range eventsByID {
		events = append(events, event)
		fromCache = fromCache && event.Provenance.Cached
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].StartTime == events[j].StartTime {
			return events[i].ID < events[j].ID
		}
		return events[i].StartTime < events[j].StartTime
	})
	result := domain.EventSearchResult{
		Query:       query,
		Events:      events,
		Issues:      issues,
		FromCache:   fromCache,
		Complete:    len(issues) == 0,
		GeneratedAt: domain.FormatTime(s.now()),
	}
	if len(events) == 0 && len(issues) > 0 {
		err = fmt.Errorf("DONKI returned no usable event data: %s", issues[0].Message)
	}
	s.recordStatus("NASA CCMC / DONKI", err)
	return result, err
}

func (s *Service) LoadForecasts(
	ctx context.Context,
	timeRange domain.TimeRange,
) (domain.ForecastResult, error) {
	_, rangeEnd, validationErr := domain.ValidateRange(timeRange.Start, timeRange.End)
	if validationErr != nil {
		return domain.ForecastResult{}, validationErr
	}
	config, err := s.Store.LoadConfig()
	if err != nil {
		return domain.ForecastResult{}, err
	}

	type donkiResult struct {
		items  []domain.ForecastDTO
		issues []domain.ProviderIssue
	}
	type swpcResult struct {
		points     []domain.ForecastPoint
		provenance domain.Provenance
		attempted  bool
		err        error
	}
	donkiChannel := make(chan donkiResult, 1)
	swpcChannel := make(chan swpcResult, 1)
	go func() {
		items, issues := s.loadDONKIForecasts(ctx, timeRange, config.NASAAPIKey)
		donkiChannel <- donkiResult{items: items, issues: issues}
	}()
	go func() {
		// SWPC publishes only its current Earth time series. Never attach that
		// series to a historical DONKI run merely because both calls succeeded.
		if !shouldLoadCurrentSWPCForecast(rangeEnd, s.now()) {
			swpcChannel <- swpcResult{}
			return
		}
		points, provenance, fetchErr := s.SWPC.ENLILTimeSeries(ctx)
		swpcChannel <- swpcResult{
			points: points, provenance: provenance, attempted: true, err: fetchErr,
		}
	}()
	donki := <-donkiChannel
	swpc := <-swpcChannel
	issues := donki.issues
	if swpc.err != nil {
		issues = append(issues, domain.ProviderIssue{
			Provider: "NOAA SWPC", Code: "enlil_time_series",
			Message: swpc.err.Error(), Retryable: providers.IsRetryable(swpc.err),
		})
	}
	forecasts := providers.MergeForecastTimeSeries(donki.items, swpc.points, swpc.provenance)
	var resultErr error
	if len(forecasts) == 0 {
		resultErr = errors.New("no WSA-ENLIL forecast data is available")
	}
	s.recordStatus("NASA CCMC / DONKI", firstIssueError(donki.issues))
	if swpc.attempted {
		s.recordStatus("NOAA SWPC", swpc.err)
	}
	return domain.ForecastResult{
		Forecasts:   forecasts,
		Issues:      issues,
		GeneratedAt: domain.FormatTime(s.now()),
	}, resultErr
}

func shouldLoadCurrentSWPCForecast(rangeEnd, now time.Time) bool {
	return !rangeEnd.Before(now.Add(-7 * 24 * time.Hour))
}

func (s *Service) loadDONKIForecasts(
	ctx context.Context,
	timeRange domain.TimeRange,
	nasaAPIKey string,
) ([]domain.ForecastDTO, []domain.ProviderIssue) {
	start, end, err := domain.ValidateRange(timeRange.Start, timeRange.End)
	if err != nil {
		return nil, []domain.ProviderIssue{{
			Provider: "DONKI", Code: "invalid_range", Message: err.Error(),
		}}
	}
	byID := make(map[string]domain.ForecastDTO)
	var issues []domain.ProviderIssue
	cursor := dateFloor(start)
	lastDate := dateFloor(end)
	for !cursor.After(lastDate) {
		chunkEnd := cursor.AddDate(0, 0, 30)
		if chunkEnd.After(lastDate) {
			chunkEnd = lastDate
		}
		items, chunkIssues := s.DONKI.Forecasts(ctx, domain.TimeRange{
			Start: domain.FormatTime(cursor),
			End:   domain.FormatTime(chunkEnd.Add(23*time.Hour + 59*time.Minute + 59*time.Second)),
		}, nasaAPIKey)
		for _, item := range items {
			key := item.ID
			if key == "" {
				key = item.Model + ":" + item.CompletionTime
			}
			byID[key] = item
		}
		issues = append(issues, chunkIssues...)
		if ctx.Err() != nil {
			break
		}
		cursor = chunkEnd.AddDate(0, 0, 1)
	}
	result := make([]domain.ForecastDTO, 0, len(byID))
	for _, item := range byID {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CompletionTime < result[j].CompletionTime
	})
	return result, issues
}

func eventKey(event domain.EventDTO) string {
	if event.ID != "" {
		return string(event.Kind) + ":" + event.ID
	}
	return string(event.Kind) + ":" + event.StartTime + ":" + event.Title
}

func firstIssueError(issues []domain.ProviderIssue) error {
	if len(issues) == 0 {
		return nil
	}
	return errors.New(issues[0].Message)
}

func dateFloor(value time.Time) time.Time {
	year, month, day := value.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) recordStatus(provider string, err error) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	status := s.status[provider]
	status.Provider = provider
	if err != nil {
		status.Available = false
		status.LastError = err.Error()
	} else {
		status.Available = true
		status.LastError = ""
		status.LastSuccess = domain.FormatTime(s.now())
	}
	s.status[provider] = status
}

func (s *Service) providerStatuses() []domain.ProviderStatus {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	result := make([]domain.ProviderStatus, 0, len(s.status))
	for _, status := range s.status {
		result = append(result, status)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Provider < result[j].Provider
	})
	return result
}
