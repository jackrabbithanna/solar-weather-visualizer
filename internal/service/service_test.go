package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"solar-weather-visualizer/internal/domain"
	"solar-weather-visualizer/internal/store"
)

type serviceRoundTrip func(*http.Request) (*http.Response, error)

func (function serviceRoundTrip) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func testService(t *testing.T) *Service {
	t.Helper()
	root := t.TempDir()
	persistence, err := store.NewAt(filepath.Join(root, "config"), filepath.Join(root, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	return NewWithStore(persistence)
}

func TestSettingsNeverExposeNASAKey(t *testing.T) {
	service := testService(t)
	key := "personal-secret"
	settings, err := service.SaveSettings(domain.SettingsUpdate{NASAAPIKey: &key})
	if err != nil {
		t.Fatal(err)
	}
	if !settings.NASAKeyConfigured {
		t.Fatal("expected configured marker")
	}
	config, err := service.Store.LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.NASAAPIKey != key {
		t.Fatal("key was not persisted")
	}
}

func TestSettingsRejectUnsafeRefreshIntervals(t *testing.T) {
	service := testService(t)
	seconds := 5
	if _, err := service.SaveSettings(domain.SettingsUpdate{LiveRefreshSeconds: &seconds}); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestDemoScenarioIsSelfContained(t *testing.T) {
	service := testService(t)
	demo := service.DemoScenario()
	if len(demo.Events.Events) < 3 || len(demo.Telemetry.Points) < 100 ||
		len(demo.Forecasts.Forecasts) == 0 {
		t.Fatalf("incomplete demo: %#v", demo)
	}
	if demo.Telemetry.Provenance.Class != domain.DataIllustrative {
		t.Fatalf("demo provenance is not illustrative: %#v", demo.Telemetry.Provenance)
	}
	if demo.Cursor != demo.Start {
		t.Fatalf("demo must start at the beginning: cursor %q, start %q", demo.Cursor, demo.Start)
	}
	cursor, err := domain.ParseTime(demo.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range demo.Events.Events {
		eventTime, err := domain.ParseTime(event.StartTime)
		if err != nil {
			t.Fatal(err)
		}
		if !eventTime.After(cursor) {
			t.Fatalf("demo event %q is already active at the initial cursor", event.ID)
		}
	}
}

func TestHistoricalReplayDoesNotMixInCurrentSWPCForecast(t *testing.T) {
	now := time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	if shouldLoadCurrentSWPCForecast(now.AddDate(-1, 0, 0), now) {
		t.Fatal("current SWPC time series must not be attached to a historical run")
	}
	if !shouldLoadCurrentSWPCForecast(now.Add(-24*time.Hour), now) {
		t.Fatal("a current range should load the SWPC time series")
	}
}

func TestLoadTelemetryRoutesRecentOMNIGapToNOAA(t *testing.T) {
	service := testService(t)
	now := time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	service.Now = func() time.Time { return now }
	service.OMNI.Now = service.Now
	service.History.Now = service.Now
	service.OMNI.Base = "https://omni.test/hapi"
	service.History.Base = "https://noaa.test/hapi"

	var mutex sync.Mutex
	requestCount := map[string]int{}
	service.HTTP.Client = &http.Client{Transport: serviceRoundTrip(
		func(request *http.Request) (*http.Response, error) {
			mutex.Lock()
			requestCount[request.URL.Host]++
			mutex.Unlock()
			var body string
			switch request.URL.Host {
			case "omni.test":
				body = `{"status":{"code":1201,"message":"no data"},"data":[]}`
			case "noaa.test":
				switch request.URL.Query().Get("id") {
				case "active-mag-pt1m":
					body = "time_tag,bt,bx_gse,by_gsm,bz_gsm,quality,source,active\n" +
						"2026-07-22T00:00:00Z,6.7,6.5,-0.2,-1.5,0,4,1\n"
				case "active-plasma-pt1m":
					body = "time_tag,speed,density,temperature,quality,source,active\n" +
						"2026-07-22T00:00:00Z,418.6,9.01,366449,0,4,1\n"
				default:
					return nil, fmt.Errorf(
						"unexpected NOAA dataset %q",
						request.URL.Query().Get("id"),
					)
				}
			default:
				return nil, fmt.Errorf("unexpected provider host %q", request.URL.Host)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		},
	)}

	result, err := service.LoadTelemetry(context.Background(), domain.TelemetryQuery{
		Start:     "2026-07-22T00:00:00Z",
		End:       "2026-07-23T00:00:00Z",
		MaxPoints: 4_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if requestCount["omni.test"] != 1 || requestCount["noaa.test"] != 2 {
		t.Fatalf("unexpected provider requests: %#v", requestCount)
	}
	if len(result.Points) != 1 || result.Points[0].SpeedKMS == nil ||
		result.Points[0].BzGSMNT == nil {
		t.Fatalf("NOAA did not fill the recent OMNI gap: %#v", result.Points)
	}
	if result.Location != "L1" || len(result.Contributors) != 2 ||
		!strings.Contains(result.Dataset, "active-mag-pt1m") {
		t.Fatalf("unexpected routed telemetry metadata: %#v", result)
	}
}
