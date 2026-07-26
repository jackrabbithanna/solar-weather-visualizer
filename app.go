package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"solar-weather-visualizer/internal/domain"
	"solar-weather-visualizer/internal/service"
)

const maximumImportBytes = int64(512 << 20)

// App is the intentionally thin Wails facade. Provider and persistence logic
// belongs in internal packages so it can be tested without a WebView.
type App struct {
	ctx     context.Context
	service *service.Service
	initErr error
}

func NewApp() *App {
	applicationService, err := service.New()
	return &App{service: applicationService, initErr: err}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) Bootstrap() (domain.BootstrapDTO, error) {
	if err := a.ready(); err != nil {
		return domain.BootstrapDTO{}, err
	}
	return a.service.Bootstrap()
}

func (a *App) RefreshLive() (domain.LiveSnapshotDTO, error) {
	if err := a.ready(); err != nil {
		return domain.LiveSnapshotDTO{}, err
	}
	return a.service.RefreshLive(a.context())
}

func (a *App) SearchEvents(query domain.EventQuery) (domain.EventSearchResult, error) {
	if err := a.ready(); err != nil {
		return domain.EventSearchResult{}, err
	}
	return a.service.SearchEvents(a.context(), query)
}

func (a *App) LoadTelemetry(query domain.TelemetryQuery) (domain.TelemetrySeriesDTO, error) {
	if err := a.ready(); err != nil {
		return domain.TelemetrySeriesDTO{}, err
	}
	return a.service.LoadTelemetry(a.context(), query)
}

func (a *App) LoadForecasts(timeRange domain.TimeRange) (domain.ForecastResult, error) {
	if err := a.ready(); err != nil {
		return domain.ForecastResult{}, err
	}
	return a.service.LoadForecasts(a.context(), timeRange)
}

func (a *App) LoadEphemeris(timeRange domain.TimeRange) (domain.EphemerisResult, error) {
	if err := a.ready(); err != nil {
		return domain.EphemerisResult{}, err
	}
	return a.service.LoadEphemeris(a.context(), timeRange)
}

func (a *App) GetSettings() (domain.SettingsDTO, error) {
	if err := a.ready(); err != nil {
		return domain.SettingsDTO{}, err
	}
	return a.service.GetSettings()
}

func (a *App) SaveSettings(update domain.SettingsUpdate) (domain.SettingsDTO, error) {
	if err := a.ready(); err != nil {
		return domain.SettingsDTO{}, err
	}
	return a.service.SaveSettings(update)
}

func (a *App) ClearCache() error {
	if err := a.ready(); err != nil {
		return err
	}
	return a.service.ClearCache()
}

func (a *App) LoadDemoScenario() (domain.DemoScenarioDTO, error) {
	if err := a.ready(); err != nil {
		return domain.DemoScenarioDTO{}, err
	}
	return a.service.DemoScenario(), nil
}

func (a *App) ExportPNG(dataURL string) (string, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		return "", errors.New("screenshot is not a PNG data URL")
	}
	encoded := strings.TrimPrefix(dataURL, prefix)
	if len(encoded) > 80<<20 {
		return "", errors.New("screenshot exceeds the 60 MiB export limit")
	}
	payload, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode screenshot: %w", err)
	}
	path, err := runtime.SaveFileDialog(a.context(), runtime.SaveDialogOptions{
		Title:           "Export heliosphere image",
		DefaultFilename: "solar-weather.png",
		Filters: []runtime.FileFilter{{
			DisplayName: "PNG image (*.png)",
			Pattern:     "*.png",
		}},
	})
	if err != nil || path == "" {
		return path, err
	}
	return path, writePrivateFile(path, payload)
}

func (a *App) ExportText(bundle domain.ExportBundle) (string, error) {
	path, err := runtime.SaveFileDialog(a.context(), runtime.SaveDialogOptions{
		Title:           "Export readable data summary",
		DefaultFilename: "solar-weather-summary.txt",
		Filters: []runtime.FileFilter{{
			DisplayName: "Text document (*.txt)",
			Pattern:     "*.txt",
		}},
	})
	if err != nil || path == "" {
		return path, err
	}
	return path, writePrivateFile(path, []byte(formatBundleText(bundle)))
}

func (a *App) ExportBundle(bundle domain.ExportBundle) (string, error) {
	if bundle.SchemaVersion == 0 {
		bundle.SchemaVersion = 2
	}
	if bundle.CreatedAt == "" {
		bundle.CreatedAt = domain.FormatTime(time.Now())
	}
	path, err := runtime.SaveFileDialog(a.context(), runtime.SaveDialogOptions{
		Title:           "Export replay bundle",
		DefaultFilename: "solar-weather.swv.gz",
		Filters: []runtime.FileFilter{{
			DisplayName: "Solar Weather bundle (*.swv.gz)",
			Pattern:     "*.swv.gz",
		}},
	})
	if err != nil || path == "" {
		return path, err
	}
	var output bytes.Buffer
	writer := gzip.NewWriter(&output)
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(bundle); err != nil {
		writer.Close()
		return "", fmt.Errorf("encode bundle: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("compress bundle: %w", err)
	}
	return path, writePrivateFile(path, output.Bytes())
}

func (a *App) ImportBundle() (domain.ExportBundle, error) {
	path, err := runtime.OpenFileDialog(a.context(), runtime.OpenDialogOptions{
		Title: "Import replay bundle",
		Filters: []runtime.FileFilter{{
			DisplayName: "Solar Weather bundle (*.swv.gz;*.json)",
			Pattern:     "*.swv.gz;*.json",
		}},
	})
	if err != nil || path == "" {
		return domain.ExportBundle{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return domain.ExportBundle{}, err
	}
	defer file.Close()
	limited := io.LimitReader(file, maximumImportBytes+1)
	buffered := bufio.NewReader(limited)
	var reader io.Reader = buffered
	magic, _ := buffered.Peek(2)
	if len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		compressed, openErr := gzip.NewReader(buffered)
		if openErr != nil {
			return domain.ExportBundle{}, fmt.Errorf("open compressed bundle: %w", openErr)
		}
		defer compressed.Close()
		reader = io.LimitReader(compressed, maximumImportBytes+1)
	}
	var bundle domain.ExportBundle
	if err := json.NewDecoder(reader).Decode(&bundle); err != nil {
		return domain.ExportBundle{}, fmt.Errorf("decode bundle: %w", err)
	}
	if bundle.SchemaVersion != 1 && bundle.SchemaVersion != 2 {
		return domain.ExportBundle{}, fmt.Errorf("unsupported bundle schema %d", bundle.SchemaVersion)
	}
	return bundle, nil
}

func (a *App) PreviewNCEIArchive(query domain.NCEIArchiveQuery) (domain.NCEIArchivePreview, error) {
	start, end, err := domain.ValidateRange(query.Start, query.End)
	if err != nil {
		return domain.NCEIArchivePreview{}, err
	}
	days := int64(end.Sub(start).Hours()/24) + 1
	return domain.NCEIArchivePreview{
		Files: days * 2, Start: domain.FormatTime(start), End: domain.FormatTime(end),
		Available: false,
	}, nil
}

func (a *App) RequestNCEIArchive(request domain.NCEIArchiveRequest) (domain.NCEIOrderStatus, error) {
	if _, _, err := domain.ValidateRange(request.Start, request.End); err != nil {
		return domain.NCEIOrderStatus{}, err
	}
	if !strings.Contains(request.Email, "@") {
		return domain.NCEIOrderStatus{}, errors.New("a valid delivery email is required")
	}
	return domain.NCEIOrderStatus{
		Status: "feature-gated",
		Error:  "NCEI ordering is staged until the pure-Go NetCDF importer passes representative-file validation",
	}, nil
}

func (a *App) CheckNCEIOrder(id int64) (domain.NCEIOrderStatus, error) {
	if id <= 0 {
		return domain.NCEIOrderStatus{}, errors.New("order ID must be positive")
	}
	return domain.NCEIOrderStatus{
		ID: id, Status: "feature-gated",
		Error: "NCEI ordering is not enabled in this build",
	}, nil
}

func (a *App) ImportModel() (domain.ModelImportSummary, error) {
	path, err := runtime.OpenFileDialog(a.context(), runtime.OpenDialogOptions{
		Title: "Inspect WSA-ENLIL model file",
		Filters: []runtime.FileFilter{
			{DisplayName: "Model metadata (*.json)", Pattern: "*.json"},
			{DisplayName: "NetCDF model (*.nc;*.nc.gz)", Pattern: "*.nc;*.nc.gz"},
		},
	})
	if err != nil || path == "" {
		return domain.ModelImportSummary{}, err
	}
	extension := strings.ToLower(filepath.Ext(path))
	if extension != ".json" {
		return domain.ModelImportSummary{
			Name: filepath.Base(path), Format: "NetCDF",
			Ready:   false,
			Message: "Full 3D cube import is feature-gated pending pure-Go NetCDF validation; no CGO reader is bundled.",
		}, nil
	}
	file, err := os.Open(path)
	if err != nil {
		return domain.ModelImportSummary{}, err
	}
	defer file.Close()
	var summary domain.ModelImportSummary
	if err := json.NewDecoder(io.LimitReader(file, 8<<20)).Decode(&summary); err != nil {
		return domain.ModelImportSummary{}, fmt.Errorf("decode model metadata: %w", err)
	}
	summary.Name = filepath.Base(path)
	summary.Format = "WSA-ENLIL metadata JSON"
	summary.Ready = len(summary.GridShape) == 3 && summary.TimeSteps > 0
	if !summary.Ready && summary.Message == "" {
		summary.Message = "Metadata must declare a three-dimensional grid and at least one time step."
	}
	return summary, nil
}

func (a *App) ready() error {
	if a.initErr != nil {
		return a.initErr
	}
	if a.service == nil {
		return errors.New("application service is unavailable")
	}
	return nil
}

func (a *App) context() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func writePrivateFile(path string, payload []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(payload); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func formatBundleText(bundle domain.ExportBundle) string {
	var builder strings.Builder
	builder.WriteString("Solar Weather Visualizer export\n")
	builder.WriteString("Created: " + bundle.CreatedAt + "\n\n")
	builder.WriteString(fmt.Sprintf("Events: %d\n", len(bundle.Events)))
	for _, event := range bundle.Events {
		builder.WriteString(fmt.Sprintf("- %s  [%s]  %s\n", event.StartTime, event.Kind, event.Title))
		if event.CME != nil && event.CME.SpeedKMS != nil {
			builder.WriteString(fmt.Sprintf("  Speed: %.0f km/s\n", *event.CME.SpeedKMS))
		}
		if event.Flare != nil && event.Flare.ClassType != "" {
			builder.WriteString("  Class: " + event.Flare.ClassType + "\n")
		}
		builder.WriteString(fmt.Sprintf(
			"  Source: %s / %s (%s)\n",
			event.Provenance.Provider,
			event.Provenance.Dataset,
			event.Provenance.Class,
		))
	}
	if bundle.Telemetry != nil {
		builder.WriteString(fmt.Sprintf(
			"\nTelemetry: %d points, %s, %s\n",
			len(bundle.Telemetry.Points),
			bundle.Telemetry.Dataset,
			bundle.Telemetry.CoordinateFrame,
		))
	}
	if bundle.Ephemeris != nil {
		builder.WriteString(fmt.Sprintf(
			"\nEphemeris bodies: %d  frame %s  center %s\n",
			len(bundle.Ephemeris.Bodies),
			bundle.Ephemeris.CoordinateFrame,
			bundle.Ephemeris.Center,
		))
	}
	builder.WriteString(fmt.Sprintf("\nForecast runs: %d\n", len(bundle.Forecasts)))
	for _, forecast := range bundle.Forecasts {
		builder.WriteString(fmt.Sprintf(
			"- %s  completion %s  Earth arrival %s\n",
			forecast.Model,
			forecast.CompletionTime,
			forecast.EarthArrivalTime,
		))
	}
	builder.WriteString("\nEducational visualization; not an operational warning product.\n")
	return builder.String()
}
