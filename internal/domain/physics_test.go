package domain

import (
	"math"
	"testing"
)

func TestDynamicPressureNPa(t *testing.T) {
	got := DynamicPressureNPa(5, 400)
	if math.Abs(got-1.33809754076) > 1e-9 {
		t.Fatalf("unexpected pressure: %v", got)
	}
}

func TestFlareClassPeakFlux(t *testing.T) {
	got := FlareClassPeakFlux("M5.4")
	if got == nil || math.Abs(*got-5.4e-5) > 1e-12 {
		t.Fatalf("unexpected flux: %v", got)
	}
	if got := FlareClassPeakFlux("Q2"); got != nil {
		t.Fatalf("unexpected unknown class: %v", *got)
	}
	if got := FlareClassPeakFlux(" m2.5 "); got == nil || math.Abs(*got-2.5e-5) > 1e-12 {
		t.Fatalf("unexpected normalized flux: %v", got)
	}
}

func TestCompressedRadiusEndpoints(t *testing.T) {
	if got := CompressedRadiusAU(0); got != 0 {
		t.Fatalf("zero mapped to %v", got)
	}
	if got := CompressedRadiusAU(2); math.Abs(got-2) > 1e-12 {
		t.Fatalf("2 AU mapped to %v", got)
	}
}
