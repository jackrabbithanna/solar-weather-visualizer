package domain

import (
	"math"
	"strings"
)

const (
	AstronomicalUnitMeters = 149_597_870_700.0
	SolarRadiusMeters      = 695_700_000.0
	ProtonMassKG           = 1.67262192595e-27
)

// DynamicPressureNPa derives solar-wind dynamic pressure from proton density
// and bulk speed. The result remains a proxy: alpha particles and composition
// corrections are intentionally not inferred when the source omits them.
func DynamicPressureNPa(densityPerCM3, speedKMS float64) float64 {
	densityPerM3 := densityPerCM3 * 1e6
	speedMS := speedKMS * 1e3
	return densityPerM3 * ProtonMassKG * speedMS * speedMS * 1e9
}

func FlareClassPeakFlux(classType string) *float64 {
	classType = strings.ToUpper(strings.TrimSpace(classType))
	if len(classType) < 2 {
		return nil
	}
	multipliers := map[byte]float64{
		'A': 1e-8,
		'B': 1e-7,
		'C': 1e-6,
		'M': 1e-5,
		'X': 1e-4,
	}
	base, ok := multipliers[classType[0]]
	if !ok {
		return nil
	}
	var coefficient float64
	if _, err := fmtSscanfFloat(classType[1:], &coefficient); err != nil {
		return nil
	}
	if coefficient <= 0 {
		return nil
	}
	value := base * coefficient
	return &value
}

// CompressedRadiusAU implements the documented radial display transform. It
// maps 0..2 AU onto 0..2 display units while expanding the inner heliosphere.
func CompressedRadiusAU(radiusAU float64) float64 {
	if radiusAU <= 0 {
		return 0
	}
	return 2 * math.Sqrt(radiusAU/2)
}

func LinearRadiusAU(radiusAU float64) float64 {
	return math.Max(0, radiusAU)
}

// fmtSscanfFloat is kept small so the physics package does not expose parsing
// policy. It accepts the decimal form used by GOES class strings.
func fmtSscanfFloat(value string, target *float64) (int, error) {
	var sign, integer, fraction, divisor float64 = 1, 0, 0, 1
	seenDigit := false
	seenDot := false
	for index, char := range value {
		switch {
		case index == 0 && char == '-':
			sign = -1
		case char == '.' && !seenDot:
			seenDot = true
		case char >= '0' && char <= '9':
			seenDigit = true
			digit := float64(char - '0')
			if seenDot {
				divisor *= 10
				fraction += digit / divisor
			} else {
				integer = integer*10 + digit
			}
		default:
			return 0, &parseFloatError{value: value}
		}
	}
	if !seenDigit {
		return 0, &parseFloatError{value: value}
	}
	*target = sign * (integer + fraction)
	return 1, nil
}

type parseFloatError struct {
	value string
}

func (e *parseFloatError) Error() string {
	return "invalid decimal " + e.value
}
