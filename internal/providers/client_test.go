package providers

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"solar-weather-visualizer/internal/store"
)

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("network unavailable")
}

func TestCachedHTTPUsesStalePayloadAfterNetworkFailure(t *testing.T) {
	root := t.TempDir()
	cache, err := store.NewAt(filepath.Join(root, "config"), filepath.Join(root, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	if err := cache.PutJSON("sample", map[string]int{"value": 7}, time.Nanosecond, "test-etag"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)

	client := NewCachedHTTP(cache)
	client.Client = &http.Client{Transport: failingTransport{}}
	var destination map[string]int
	meta, err := client.GetJSON(context.Background(), "https://unavailable.invalid", "sample", time.Minute, &destination)
	if err != nil {
		t.Fatal(err)
	}
	if !meta.Cached || !meta.Stale || meta.Warning == nil || destination["value"] != 7 {
		t.Fatalf("unexpected stale fallback: %#v %#v", meta, destination)
	}
}

func TestRedactedURLRemovesAPIKey(t *testing.T) {
	result := redactedURL("https://example.test/events?api_key=secret-value&start=2026-01-01")
	if result != "https://example.test/events?api_key=REDACTED&start=2026-01-01" {
		t.Fatalf("unexpected redaction: %s", result)
	}
}
