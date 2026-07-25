package service

import (
	"math"
	"time"

	"solar-weather-visualizer/internal/domain"
)

// DemoScenario is deterministic and network-independent. It is inspired by a
// strong solar-wind interval, but it does not claim to reproduce a cataloged
// event.
func (s *Service) DemoScenario() domain.DemoScenarioDTO {
	start := time.Date(2024, 5, 10, 0, 0, 0, 0, time.UTC)
	end := start.Add(48 * time.Hour)
	cursor := start.Add(25 * time.Hour)
	latitude, longitude := 8.0, -12.0
	width, speed := 48.0, 1180.0
	flux := 3.4e-5
	events := []domain.EventDTO{
		{
			ID: "demo-cme", Kind: domain.EventCME, Title: "Fast Earth-directed CME",
			StartTime: domain.FormatTime(start.Add(90 * time.Minute)),
			CME: &domain.CMEData{
				AnalysisTime: domain.FormatTime(start.Add(3 * time.Hour)),
				LatitudeDeg:  &latitude, LongitudeDeg: &longitude,
				HalfAngleDeg: &width, SpeedKMS: &speed,
				IsMostAccurate: true, DirectionKnown: true,
			},
			Provenance: demoProvenance("DONKI-like scenario", domain.DataIllustrative, start),
		},
		{
			ID: "demo-flare", Kind: domain.EventFlare, Title: "M3.4 solar flare",
			StartTime: domain.FormatTime(start.Add(time.Hour)),
			EndTime:   domain.FormatTime(start.Add(2 * time.Hour)),
			Flare: &domain.FlareData{
				PeakTime:  domain.FormatTime(start.Add(80 * time.Minute)),
				EndTime:   domain.FormatTime(start.Add(2 * time.Hour)),
				ClassType: "M3.4", SourceLocation: "N08E12",
				LatitudeDeg: &latitude, LongitudeDeg: &longitude,
				LocationParsed: true, PeakFluxWattsM2: &flux,
			},
			Provenance: demoProvenance("GOES-like scenario", domain.DataIllustrative, start),
		},
		{
			ID: "demo-hss", Kind: domain.EventHSS, Title: "High-speed stream",
			StartTime:  domain.FormatTime(start.Add(32 * time.Hour)),
			HSS:        &domain.HSSData{EventTime: domain.FormatTime(start.Add(32 * time.Hour))},
			Provenance: demoProvenance("HSS scenario", domain.DataIllustrative, start),
		},
	}

	points := make([]domain.TelemetryPoint, 0, 193)
	for index := 0; index <= 192; index++ {
		at := start.Add(time.Duration(index) * 15 * time.Minute)
		hours := at.Sub(start).Hours()
		pulse := math.Exp(-math.Pow((hours-27)/5.5, 2))
		speedValue := 385 + 390*pulse + 24*math.Sin(hours/2.7)
		densityValue := 4.2 + 15*math.Exp(-math.Pow((hours-24.5)/1.5, 2))
		bzValue := 2.2*math.Sin(hours/3.2) - 15*math.Exp(-math.Pow((hours-28)/3.8, 2))
		fieldValue := 5 + 17*pulse
		pressureValue := domain.DynamicPressureNPa(densityValue, speedValue)
		points = append(points, domain.TelemetryPoint{
			Time: domain.FormatTime(at), Source: "DEMO", IMFSource: "DEMO", PlasmaSource: "DEMO",
			SpeedKMS: &speedValue, DensityPerCM3: &densityValue,
			PressureNPa: &pressureValue, FieldMagnitudeNT: &fieldValue, BzGSMNT: &bzValue,
		})
	}

	arrival := start.Add(25 * time.Hour)
	forecastSpeed := 720.0
	forecastPoints := make([]domain.ForecastPoint, 0, 97)
	for index := 0; index <= 96; index++ {
		at := start.Add(time.Duration(index) * 30 * time.Minute)
		hours := at.Sub(arrival).Hours()
		pulse := math.Exp(-math.Pow(hours/5, 2))
		value := 390 + (forecastSpeed-390)*pulse
		densityValue := 4.5 + 10*pulse
		forecastPoints = append(forecastPoints, domain.ForecastPoint{
			Time: domain.FormatTime(at), SpeedKMS: &value, DensityPerCM3: &densityValue,
		})
	}
	duration := 11.0
	domainAU := 2.0
	return domain.DemoScenarioDTO{
		Name:        "CME passage walkthrough",
		Description: "A deterministic, illustrative 48-hour replay for learning the controls without a network connection.",
		Start:       domain.FormatTime(start),
		End:         domain.FormatTime(end),
		Cursor:      domain.FormatTime(cursor),
		Events: domain.EventSearchResult{
			Query:  domain.EventQuery{Start: domain.FormatTime(start), End: domain.FormatTime(end)},
			Events: events, Complete: true, GeneratedAt: domain.FormatTime(s.now()),
		},
		Telemetry: domain.TelemetrySeriesDTO{
			Query:   domain.TelemetryQuery{Start: domain.FormatTime(start), End: domain.FormatTime(end)},
			Dataset: "DEMO_15MIN", Location: "Earth", CoordinateFrame: "GSM",
			CadenceSeconds: 900, Points: points,
			Provenance: demoProvenance("Synthetic telemetry", domain.DataIllustrative, start),
		},
		Forecasts: domain.ForecastResult{
			Forecasts: []domain.ForecastDTO{{
				ID: "demo-enlil", Model: "WSA-ENLIL-like walkthrough",
				CompletionTime: domain.FormatTime(start),
				DomainAU:       &domainAU, EarthArrivalTime: domain.FormatTime(arrival),
				EstimatedDurationHours: &duration, LinkedCMEIDs: []string{"demo-cme"},
				Points:     forecastPoints,
				Provenance: demoProvenance("Synthetic forecast", domain.DataIllustrative, start),
			}},
			GeneratedAt: domain.FormatTime(s.now()),
		},
	}
}

func demoProvenance(dataset string, class domain.DataClass, at time.Time) domain.Provenance {
	return domain.Provenance{
		Provider: "Built-in demo", Dataset: dataset,
		RetrievedAt: domain.FormatTime(at), Class: class,
	}
}
