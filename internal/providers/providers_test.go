package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"solar-weather-visualizer/internal/domain"
)

func pointer[T any](value T) *T {
	return &value
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestNormalizeCMEKeepsUnknownDirection(t *testing.T) {
	event := normalizeCME(rawCME{
		ActivityID: "2026-01-02T03:04:00-CME-001",
		StartTime:  "2026-01-02T03:04Z",
		Analyses: []rawCMEAnalysis{
			{Speed: pointer(450.0), Longitude: pointer(12.0)},
			{
				IsMostAccurate: true,
				Time215:        "2026-01-02T04:00Z",
				Latitude:       pointer(-8.0),
				HalfAngle:      pointer(34.0),
				Speed:          pointer(925.0),
			},
		},
	})

	if event.CME == nil || event.CME.SpeedKMS == nil || *event.CME.SpeedKMS != 925 {
		t.Fatalf("expected most-accurate analysis, got %#v", event.CME)
	}
	if event.CME.DirectionKnown {
		t.Fatal("a CME without longitude must not be assigned a 3D direction")
	}
	if event.StartTime != "2026-01-02T03:04:00Z" {
		t.Fatalf("unexpected normalized time %q", event.StartTime)
	}
}

func TestNormalizeCMEPrefersCompleteAnalysis(t *testing.T) {
	event := normalizeCME(rawCME{Analyses: []rawCMEAnalysis{
		{
			IsMostAccurate: true, Time215: "2026-01-02T04:00Z",
			Latitude: pointer(2.0), HalfAngle: pointer(40.0), Speed: pointer(900.0),
		},
		{
			Time215: "2026-01-02T04:10Z", Latitude: pointer(3.0), Longitude: pointer(4.0),
			HalfAngle: pointer(35.0), Speed: pointer(850.0),
		},
	}})
	if event.CME == nil || !event.CME.DirectionKnown || event.CME.SpeedKMS == nil ||
		*event.CME.SpeedKMS != 850 {
		t.Fatalf("expected complete analysis, got %#v", event.CME)
	}
}

func TestNormalizeFlareParsesStonyhurstAndFlux(t *testing.T) {
	event := normalizeFlare(rawFlare{
		ID:             "flare-1",
		BeginTime:      "2026-01-02T03:04Z",
		PeakTime:       "2026-01-02T03:10Z",
		EndTime:        "2026-01-02T03:20Z",
		ClassType:      "M2.5",
		SourceLocation: "N14W32",
	})

	if event.Flare == nil || !event.Flare.LocationParsed {
		t.Fatalf("expected parsed flare, got %#v", event.Flare)
	}
	if *event.Flare.LatitudeDeg != 14 || *event.Flare.LongitudeDeg != 32 {
		t.Fatalf("unexpected position: %#v", event.Flare)
	}
	if event.Flare.PeakFluxWattsM2 == nil ||
		math.Abs(*event.Flare.PeakFluxWattsM2-2.5e-5) > 1e-12 {
		t.Fatalf("unexpected peak flux: %#v", event.Flare.PeakFluxWattsM2)
	}
}

func TestMergeRecentRTSWUsesActiveLatestSources(t *testing.T) {
	now := time.Date(2026, 1, 2, 6, 0, 0, 0, time.UTC)
	winds := []rawWind{
		{TimeTag: "2026-01-02T05:58Z", Active: false, Source: "ACE", Speed: pointer(999.0)},
		{
			TimeTag: "2026-01-02T05:59Z", Active: true, Source: "SOLAR1",
			Speed: pointer(500.0), Density: pointer(4.0),
		},
	}
	mags := []rawMag{{
		TimeTag: "2026-01-02T05:59Z", Active: true, Source: "DSCOVR",
		Magnitude: pointer(7.0), BzGSM: pointer(-4.0),
	}}

	points, plasmaSource, imfSource := mergeRecentRTSW(winds, mags, now)
	if len(points) != 1 || plasmaSource != "SOLAR1" || imfSource != "DSCOVR" {
		t.Fatalf("unexpected source merge: %d %q %q", len(points), plasmaSource, imfSource)
	}
	if points[0].PressureNPa == nil || *points[0].PressureNPa <= 0 {
		t.Fatalf("expected derived pressure, got %#v", points[0].PressureNPa)
	}
}

func TestFillLiveSnapshotUsesNewestValueFromStaggeredStreams(t *testing.T) {
	summarySpeed := 510.0
	summaryField := 8.0
	density := 3.5
	pressure := 1.5
	bz := -4.0
	snapshot := domain.LiveSnapshotDTO{
		SpeedKMS:         &summarySpeed,
		FieldMagnitudeNT: &summaryField,
		Recent: []domain.TelemetryPoint{
			{
				Time:          "2026-01-02T05:59:00Z",
				SpeedKMS:      pointer(500.0),
				DensityPerCM3: &density,
				PressureNPa:   &pressure,
			},
			{
				Time:    "2026-01-02T06:00:00Z",
				BzGSMNT: &bz,
			},
		},
	}

	fillLiveSnapshotFromRecent(&snapshot)

	if snapshot.DensityPerCM3 == nil || *snapshot.DensityPerCM3 != density {
		t.Fatalf("expected latest plasma density, got %#v", snapshot.DensityPerCM3)
	}
	if snapshot.PressureNPa == nil || *snapshot.PressureNPa != pressure {
		t.Fatalf("expected latest plasma pressure, got %#v", snapshot.PressureNPa)
	}
	if snapshot.BzGSMNT == nil || *snapshot.BzGSMNT != bz {
		t.Fatalf("expected latest magnetic Bz, got %#v", snapshot.BzGSMNT)
	}
	if *snapshot.SpeedKMS != summarySpeed || *snapshot.FieldMagnitudeNT != summaryField {
		t.Fatal("recent values must not replace newer compact-summary values")
	}
}

func TestSWPCSummaryAcceptsOperationalObjectWithStringNumbers(t *testing.T) {
	var speeds speedSummaryFeed
	if err := json.Unmarshal(
		[]byte(`{"WindSpeed":"731","TimeStamp":"2026-01-02T05:59:00Z"}`),
		&speeds,
	); err != nil {
		t.Fatal(err)
	}
	var fields fieldSummaryFeed
	if err := json.Unmarshal(
		[]byte(`{"Bt":"19.9","Bz":"-5.8","TimeStamp":"2026-01-02T05:59:00Z"}`),
		&fields,
	); err != nil {
		t.Fatal(err)
	}
	if len(speeds) != 1 || speeds[0].speed() == nil || *speeds[0].speed() != 731 {
		t.Fatalf("unexpected speed summary: %#v", speeds)
	}
	if len(fields) != 1 || fields[0].magnitude() == nil || *fields[0].bz() != -5.8 {
		t.Fatalf("unexpected field summary: %#v", fields)
	}
	roundTrip, err := json.Marshal(speeds)
	if err != nil {
		t.Fatal(err)
	}
	var cached speedSummaryFeed
	if err := json.Unmarshal(roundTrip, &cached); err != nil {
		t.Fatal(err)
	}
	if cached[0].speed() == nil || *cached[0].speed() != 731 {
		t.Fatalf("cached summary lost its numeric value: %s", roundTrip)
	}
}

func TestOMNILevelOfDetail(t *testing.T) {
	recent := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if got := selectOMNILevel(recent, recent.Add(6*24*time.Hour)); got.Dataset != "OMNI_HRO_1MIN" {
		t.Fatalf("six-day range selected %s", got.Dataset)
	}
	if got := selectOMNILevel(recent, recent.Add(30*24*time.Hour)); got.Dataset != "OMNI_HRO_5MIN" {
		t.Fatalf("thirty-day range selected %s", got.Dataset)
	}
	if got := selectOMNILevel(recent, recent.Add(180*24*time.Hour)); got.Dataset != "OMNI2_H0_MRG1HR" {
		t.Fatalf("long range selected %s", got.Dataset)
	}
}

func TestSWPCHistorySelectsCadence(t *testing.T) {
	if level := selectSWPCHistoryLevel(time.Minute); level.Suffix != "pt1m" ||
		level.Chunk != 24*time.Hour {
		t.Fatalf("unexpected one-minute level: %#v", level)
	}
	if level := selectSWPCHistoryLevel(5 * time.Minute); level.Suffix != "pt5m" ||
		level.Chunk != 7*24*time.Hour {
		t.Fatalf("unexpected five-minute level: %#v", level)
	}
	if level := selectSWPCHistoryLevel(time.Hour); level.Suffix != "pt1h" ||
		level.Chunk != 30*24*time.Hour {
		t.Fatalf("unexpected hourly level: %#v", level)
	}
}

func TestSWPCHistoryRequestsUTCAndMergesCSVStreams(t *testing.T) {
	var mutex sync.Mutex
	var requests []*http.Request
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		mutex.Lock()
		requests = append(requests, request)
		mutex.Unlock()
		var body string
		switch request.URL.Query().Get("id") {
		case "active-mag-pt1m":
			body = "time_tag,bt,bx_gse,by_gsm,bz_gsm,quality,source,active\n" +
				"2026-07-22T00:00:00Z,6.7,6.5,-0.2,-1.5,0,4,1\n"
		case "active-plasma-pt1m":
			body = "time_tag,speed,density,temperature,quality,source,active\n" +
				"2026-07-22T00:00:00Z,418.6,9.01,366449,0,4,1\n"
		default:
			return nil, fmt.Errorf("unexpected dataset %q", request.URL.Query().Get("id"))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	})
	httpClient := NewCachedHTTP(nil)
	httpClient.Client = &http.Client{Transport: transport}
	client := NewSWPCHistoryClient(httpClient)
	client.Base = "https://history.example/hapi"
	client.Now = func() time.Time {
		return time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	}
	result, err := client.Telemetry(context.Background(), domain.TelemetryQuery{
		Start: "2026-07-22T00:00:00Z",
		End:   "2026-07-22T01:00:00Z",
	}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 {
		t.Fatalf("expected two stream requests, got %d", len(requests))
	}
	for _, request := range requests {
		values := request.URL.Query()
		if values.Get("time.min") != "2026-07-22T00:00:00Z" ||
			values.Get("time.max") != "2026-07-22T01:00:00Z" {
			t.Fatalf("unexpected UTC range: %s", request.URL.RawQuery)
		}
		if strings.Contains(values.Get("parameters"), "time_tag") || values.Has("format") {
			t.Fatalf("unexpected NOAA parameters: %s", request.URL.RawQuery)
		}
		if request.Header.Get("Accept") != "*/*" {
			t.Fatalf("unexpected Accept header %q", request.Header.Get("Accept"))
		}
	}
	if len(result.Points) != 1 {
		t.Fatalf("expected merged point, got %#v", result.Points)
	}
	point := result.Points[0]
	if point.SpeedKMS == nil || *point.SpeedKMS != 418.6 ||
		point.BzGSMNT == nil || *point.BzGSMNT != -1.5 ||
		point.PressureNPa == nil {
		t.Fatalf("unexpected normalized point: %#v", point)
	}
	if point.IMFSource != "NOAA SWPC source 4" ||
		point.PlasmaSource != "NOAA SWPC source 4" {
		t.Fatalf("unexpected source labels: %#v", point)
	}
	if point.IMFAnchor != domain.SpatialAnchorSEMBL1 ||
		point.PlasmaAnchor != domain.SpatialAnchorSEMBL1 {
		t.Fatalf("NOAA observations must remain anchored at L1: %#v", point)
	}
}

func TestSWPCHistoryCSVRejectsFillValues(t *testing.T) {
	stream := swpcHistoryStream{
		Kind:       "plasma",
		Dataset:    "active-plasma-pt1m",
		Parameters: []string{"speed", "density", "temperature", "quality", "source", "active"},
	}
	points, err := decodeSWPCHistoryCSV([]byte(
		"time_tag,speed,density,temperature,quality,source,active\n"+
			"2026-07-22T00:00:00Z,-9999,8,-1e30,0,4,1\n"+
			"not-a-time,420,9,300000,0,4,1\n",
	), stream)
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 1 || points[0].SpeedKMS != nil ||
		points[0].TemperatureK != nil || points[0].DensityPerCM3 == nil ||
		points[0].PressureNPa != nil {
		t.Fatalf("fill normalization failed: %#v", points)
	}
}

func TestReplayTelemetryMergeUsesIndependentOMNICutoffs(t *testing.T) {
	query := domain.TelemetryQuery{
		Start:     "2026-07-22T00:00:00Z",
		End:       "2026-07-22T03:00:00Z",
		MaxPoints: 100,
	}
	omniProvenance := domain.Provenance{
		Provider: "NASA CDAWeb", Dataset: "OMNI_HRO_1MIN",
		RetrievedAt: "2026-07-25T00:00:00Z", Class: domain.DataObserved,
	}
	noaaProvenance := domain.Provenance{
		Provider: "NOAA SWPC", Dataset: "active",
		RetrievedAt: "2026-07-25T00:01:00Z", Class: domain.DataObserved,
	}
	omni := domain.TelemetrySeriesDTO{
		Dataset: "OMNI_HRO_1MIN", Provenance: omniProvenance,
		Points: []domain.TelemetryPoint{
			{
				Time: "2026-07-22T00:00:00Z", FieldMagnitudeNT: pointer(5.0),
				SpeedKMS: pointer(400.0), IMFSource: "OMNI source 55",
				PlasmaSource: "OMNI source 55",
			},
			{
				Time: "2026-07-22T01:00:00Z", FieldMagnitudeNT: pointer(6.0),
				IMFSource: "OMNI source 55",
			},
		},
	}
	noaa := domain.TelemetrySeriesDTO{
		Dataset: "active", Provenance: noaaProvenance,
		Points: []domain.TelemetryPoint{
			{
				Time: "2026-07-22T01:00:00Z", FieldMagnitudeNT: pointer(60.0),
				SpeedKMS: pointer(410.0), IMFSource: "NOAA SWPC source 4",
				PlasmaSource: "NOAA SWPC source 4",
			},
			{
				Time: "2026-07-22T02:00:00Z", FieldMagnitudeNT: pointer(7.0),
				SpeedKMS: pointer(420.0), IMFSource: "NOAA SWPC source 4",
				PlasmaSource: "NOAA SWPC source 4",
			},
		},
	}
	result := MergeReplayTelemetry(query, time.Hour, &omni, &noaa, nil)
	if len(result.Points) != 3 {
		t.Fatalf("unexpected merged points: %#v", result.Points)
	}
	boundary := result.Points[1]
	if boundary.FieldMagnitudeNT == nil || *boundary.FieldMagnitudeNT != 6 ||
		boundary.SpeedKMS == nil || *boundary.SpeedKMS != 410 {
		t.Fatalf("provider cutoffs were not applied by metric group: %#v", boundary)
	}
	if len(result.Contributors) != 2 ||
		result.Provenance.Provider != "NASA CDAWeb / NOAA SWPC" {
		t.Fatalf("unexpected merged provenance: %#v", result)
	}
}

func TestOMNITreatsMalformedHAPINoDataAsEmptyResult(t *testing.T) {
	response := `{
		"HAPI": "2.0",
		"status": {"code": 1200, "message": "OK"},
		"format": "json",
		"data": [
		,
		"status": {"code": 1201, "message": "OK - no data for time range"}
	}`
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(response))
	}))
	defer server.Close()

	client := NewOMNIClient(NewCachedHTTP(nil))
	client.Base = server.URL
	client.Now = func() time.Time {
		return time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	}
	result, err := client.Telemetry(context.Background(), domain.TelemetryQuery{
		Start:     "2026-07-22T21:55:00Z",
		End:       "2026-07-22T22:55:00Z",
		MaxPoints: 10_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Points == nil || len(result.Points) != 0 {
		t.Fatalf("expected a completed empty result, got %#v", result.Points)
	}
	if result.Dataset != "OMNI_HRO_1MIN" {
		t.Fatalf("unexpected dataset %q", result.Dataset)
	}
}

func TestHAPIMalformedFallbackRejectsNonEmptyStatus(t *testing.T) {
	var response hapiResponse
	err := response.DecodeMalformedJSON([]byte(
		`{"data":[,"status":{"code":1200,"message":"OK"}}`,
	))
	if err == nil {
		t.Fatal("malformed success response must not be accepted as an empty result")
	}
}

func TestNormalizeHAPIConvertsFillToNull(t *testing.T) {
	level := selectOMNILevel(
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC),
	)
	parameters := make([]hapiParameter, 0, len(level.Names))
	row := make([]json.RawMessage, 0, len(level.Names))
	for index, name := range level.Names {
		parameters = append(parameters, hapiParameter{Name: name, Fill: "99999"})
		if index == 0 {
			row = append(row, json.RawMessage(`"2026-01-01T00:00:00Z"`))
			continue
		}
		row = append(row, json.RawMessage(fmt.Sprintf("%d", index)))
	}
	row[7] = json.RawMessage("99999") // flow_speed
	parameters[6].Fill = ""           // a true zero Bz must remain valid without a declared fill
	row[6] = json.RawMessage("0")

	points, err := normalizeHAPI(hapiResponse{Parameters: parameters, Data: [][]json.RawMessage{row}}, level)
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 1 || points[0].SpeedKMS != nil || points[0].DensityPerCM3 == nil ||
		points[0].BzGSMNT == nil || *points[0].BzGSMNT != 0 {
		t.Fatalf("fill normalization failed: %#v", points)
	}
	if points[0].IMFAnchor != domain.SpatialAnchorEarth ||
		points[0].PlasmaAnchor != domain.SpatialAnchorEarth {
		t.Fatalf("OMNI observations must remain anchored at Earth: %#v", points[0])
	}
}

func TestTelemetryDownsampleHonorsLimitAndEndpoints(t *testing.T) {
	points := make([]domain.TelemetryPoint, 1000)
	for index := range points {
		speed := 350.0 + 150*math.Sin(float64(index)/31)
		points[index] = domain.TelemetryPoint{
			Time:     domain.FormatTime(time.Unix(int64(index*60), 0)),
			SpeedKMS: &speed,
		}
	}
	output := downsampleTelemetry(points, 75)
	if len(output) > 75 {
		t.Fatalf("downsampled to %d points", len(output))
	}
	if output[0].Time != points[0].Time || output[len(output)-1].Time != points[len(points)-1].Time {
		t.Fatal("downsampling must preserve range endpoints")
	}
	one := downsampleTelemetry(points, 1)
	if len(one) != 1 || one[0].Time != points[len(points)-1].Time {
		t.Fatalf("one-point budget should keep the latest point: %#v", one)
	}
}
