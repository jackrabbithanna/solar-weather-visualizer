package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConfigRoundTripUsesOwnerOnlyPermissions(t *testing.T) {
	root := t.TempDir()
	store, err := NewAt(filepath.Join(root, "config"), filepath.Join(root, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	config := DefaultConfig()
	config.NASAAPIKey = "secret"
	if err := store.SaveConfig(config); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "config", configFileName))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("settings mode = %o", got)
	}
	loaded, err := store.LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.NASAAPIKey != "secret" {
		t.Fatal("API key did not round trip")
	}
}

func TestCacheFreshAndStale(t *testing.T) {
	root := t.TempDir()
	store, err := NewAt(filepath.Join(root, "config"), filepath.Join(root, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]int{"value": 42}
	if err := store.PutJSON("key", input, time.Nanosecond, "etag"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	var output map[string]int
	if _, err := store.GetJSON("key", &output, false); !errors.Is(err, ErrCacheMiss) {
		t.Fatalf("expected cache miss, got %v", err)
	}
	meta, err := store.GetJSON("key", &output, true)
	if err != nil {
		t.Fatal(err)
	}
	if !meta.Stale || output["value"] != 42 {
		t.Fatalf("unexpected cached result: %#v %#v", meta, output)
	}
}
