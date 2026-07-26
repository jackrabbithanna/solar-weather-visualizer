package service

import (
	"path/filepath"
	"testing"
	"time"

	"solar-weather-visualizer/internal/domain"
	"solar-weather-visualizer/internal/store"
)

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
