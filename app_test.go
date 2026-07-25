package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"solar-weather-visualizer/internal/domain"
)

func TestWritePrivateFileTightensExistingPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "export.txt")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writePrivateFile(path, []byte("new")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("export mode is %o", info.Mode().Perm())
	}
}

func TestFormatBundleTextIncludesClassificationAndSafetyBoundary(t *testing.T) {
	text := formatBundleText(domain.ExportBundle{
		CreatedAt: "2026-01-02T03:04:05Z",
		Events: []domain.EventDTO{{
			Kind: domain.EventCME, Title: "Example CME",
			StartTime: "2026-01-01T00:00:00Z",
			Provenance: domain.Provenance{
				Provider: "NASA CCMC", Dataset: "DONKI/CME", Class: domain.DataObserved,
			},
		}},
	})
	for _, expected := range []string{"Example CME", "NASA CCMC", "observed", "not an operational warning"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("text export omitted %q:\n%s", expected, text)
		}
	}
}
