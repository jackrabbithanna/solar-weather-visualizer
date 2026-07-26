package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"solar-weather-visualizer/internal/domain"
)

const horizonsVectorFixture = `
*******************************************************************************
Target body name: Earth (399)                     {source: DE441}
Reference frame : Ecliptic of J2000.0
*******************************************************************************
$$SOE
2461245.500000000, A.D. 2026-Jul-24 00:00:00.0000,  5.197950505732578E-01, -8.727550396189715E-01,  5.227851329283125E-05,  1.449692973544260E-02,  8.742311630387599E-03, -5.886472102371760E-07,
2461246.500000000, A.D. 2026-Jul-25 00:00:00.0000,  5.342175867725815E-01, -8.638906031480599E-01,  5.161487547797100E-05,  1.434750423178016E-02,  8.986135283636006E-03, -7.380355393487712E-07,
$$EOE
`

func TestDecodeHorizonsVectors(t *testing.T) {
	samples, source, err := decodeHorizonsVectors(horizonsVectorFixture)
	if err != nil {
		t.Fatal(err)
	}
	if source != "DE441" {
		t.Fatalf("unexpected source %q", source)
	}
	if len(samples) != 2 || samples[0].Time != "2026-07-24T00:00:00Z" {
		t.Fatalf("unexpected samples: %#v", samples)
	}
	if samples[0].XAU != 0.5197950505732578 ||
		samples[1].VYAUPerDay != 0.008986135283636006 {
		t.Fatalf("vector values changed: %#v", samples)
	}
}

func TestDecodeHorizonsVectorsRejectsMalformedTable(t *testing.T) {
	_, _, err := decodeHorizonsVectors("$$SOE\n1,bad\n$$EOE")
	if err == nil {
		t.Fatal("expected malformed vector row to fail")
	}
	_, _, err = decodeHorizonsVectors("no table")
	if err == nil {
		t.Fatal("expected missing table markers to fail")
	}
	_, _, err = decodeHorizonsVectors(`
Target body name: Earth (399) {source: DE441}
$$SOE
2461246.5, date, 1, 2, 3, 4, 5, 6,
2461245.5, date, 1, 2, 3, 4, 5, 6,
$$EOE`)
	if err == nil {
		t.Fatal("expected out-of-order vector timestamps to fail")
	}
}

func TestEphemerisCoverageIncludesFullOrbitAndInterpolationGuard(t *testing.T) {
	start := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	end := start.Add(3 * time.Hour)
	coverageStart, coverageEnd := ephemerisCoverage(innerEphemerisBodies[0], start, end)
	if !coverageStart.Before(start.Add(-44 * time.Hour * 24)) {
		t.Fatalf("Mercury coverage lacks half-orbit padding: %s", coverageStart)
	}
	if !coverageEnd.After(end.Add(44 * time.Hour * 24)) {
		t.Fatalf("Mercury coverage lacks end padding: %s", coverageEnd)
	}
	l1Start, l1End := ephemerisCoverage(innerEphemerisBodies[4], start, end)
	if start.Sub(l1Start) < 24*time.Hour || l1End.Sub(end) < 24*time.Hour {
		t.Fatalf("L1 coverage lacks interpolation guard: %s through %s", l1Start, l1End)
	}
}

func TestHorizonsClientReturnsPartialBodiesAndExactQuerySettings(t *testing.T) {
	var (
		mutex    sync.Mutex
		requests []*http.Request
	)
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		mutex.Lock()
		requests = append(requests, request)
		mutex.Unlock()
		command := request.URL.Query().Get("COMMAND")
		if command == "'31'" {
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Status:     "503 Service Unavailable",
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("temporarily unavailable")),
			}, nil
		}
		targetID := strings.Trim(command, "'")
		fixture := strings.Replace(
			horizonsVectorFixture,
			"Earth (399)",
			"Test body ("+targetID+")",
			1,
		)
		payload, err := json.Marshal(horizonsResponse{Result: fixture})
		if err != nil {
			return nil, err
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(string(payload))),
		}, nil
	})
	httpClient := NewCachedHTTP(nil)
	httpClient.Client = &http.Client{Transport: transport}
	client := NewHorizonsClient(httpClient)
	client.Base = "https://horizons.example/api"
	client.Now = func() time.Time {
		return time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	}

	result, err := client.Ephemeris(context.Background(), domain.TimeRange{
		Start: "2026-07-24T00:00:00Z",
		End:   "2026-07-25T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Bodies) != 4 || len(result.Issues) != 1 {
		t.Fatalf("expected four bodies and one partial issue, got %#v", result)
	}
	if len(requests) != 5 {
		t.Fatalf("expected one request per scene body, got %d", len(requests))
	}
	for _, request := range requests {
		values := request.URL.Query()
		if values.Get("CENTER") != "'500@10'" ||
			values.Get("EPHEM_TYPE") != "'VECTORS'" ||
			values.Get("REF_PLANE") != "'ECLIPTIC'" ||
			values.Get("OUT_UNITS") != "'AU-D'" ||
			values.Get("VEC_CORR") != "'NONE'" {
			t.Fatalf("unexpected Horizons request: %s", request.URL.RawQuery)
		}
	}
}
