package providers

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"solar-weather-visualizer/internal/domain"
)

type rawEnlilPoint struct {
	TimeTag     string   `json:"time_tag"`
	Density     *float64 `json:"earth_particles_per_cm3"`
	Temperature *float64 `json:"temperature"`
	VR          *float64 `json:"v_r"`
	BR          *float64 `json:"b_r"`
	BTheta      *float64 `json:"b_theta"`
	BPhi        *float64 `json:"b_phi"`
	Polarity    *float64 `json:"polarity"`
	Cloud       *float64 `json:"cloud"`
}

type rawSimulation struct {
	SimulationID          json.RawMessage `json:"simulationID"`
	ModelCompletionTime   string          `json:"modelCompletionTime"`
	AU                    *float64        `json:"au"`
	EstimatedShockArrival string          `json:"estimatedShockArrivalTime"`
	EstimatedDuration     *float64        `json:"estimatedDuration"`
	RMinRE                *float64        `json:"rmin_re"`
	KP18                  *int            `json:"kp_18"`
	KP90                  *int            `json:"kp_90"`
	KP135                 *int            `json:"kp_135"`
	KP180                 *int            `json:"kp_180"`
	IsEarthGB             bool            `json:"isEarthGB"`
	CMEInputs             []struct {
		CMEID string `json:"cmeid"`
	} `json:"cmeInputs"`
	ImpactList []struct {
		IsGlancingBlow bool   `json:"isGlancingBlow"`
		Location       string `json:"location"`
		ArrivalTime    string `json:"arrivalTime"`
	} `json:"impactList"`
}

func (c *DonkiClient) Forecasts(
	ctx context.Context,
	timeRange domain.TimeRange,
	nasaAPIKey string,
) ([]domain.ForecastDTO, []domain.ProviderIssue) {
	start, end, err := domain.ValidateRange(timeRange.Start, timeRange.End)
	if err != nil {
		return nil, []domain.ProviderIssue{issue("DONKI", "invalid_range", err, false)}
	}
	var simulations []rawSimulation
	meta, providerName, err := c.fetchDONKI(
		ctx,
		"WSAEnlilSimulations",
		start,
		end,
		nasaAPIKey,
		&simulations,
	)
	if err != nil {
		return nil, []domain.ProviderIssue{issue("DONKI", "enlil_simulations", err, IsRetryable(err))}
	}
	forecasts := make([]domain.ForecastDTO, 0, len(simulations))
	for _, simulation := range simulations {
		forecast := domain.ForecastDTO{
			ID:                     flexibleID(simulation.SimulationID),
			Model:                  "WSA-ENLIL+Cone",
			CompletionTime:         canonicalTime(simulation.ModelCompletionTime),
			DomainAU:               simulation.AU,
			EarthArrivalTime:       canonicalTime(simulation.EstimatedShockArrival),
			EstimatedDurationHours: simulation.EstimatedDuration,
			MinMagnetopauseRE:      simulation.RMinRE,
			Kp18:                   simulation.KP18,
			Kp90:                   simulation.KP90,
			Kp135:                  simulation.KP135,
			Kp180:                  simulation.KP180,
			EarthGlancingBlow:      simulation.IsEarthGB,
			Provenance: domain.Provenance{
				Provider:    providerName,
				Dataset:     "DONKI/WSAEnlilSimulations",
				SourceURL:   sourceBase(providerName, c),
				RetrievedAt: domain.FormatTime(meta.RetrievedAt),
				Class:       domain.DataForecast,
				Cached:      meta.Cached,
				Stale:       meta.Stale,
			},
		}
		for _, input := range simulation.CMEInputs {
			if input.CMEID != "" {
				forecast.LinkedCMEIDs = append(forecast.LinkedCMEIDs, input.CMEID)
			}
		}
		for _, impact := range simulation.ImpactList {
			forecast.Impacts = append(forecast.Impacts, domain.ImpactDTO{
				Location:     impact.Location,
				ArrivalTime:  canonicalTime(impact.ArrivalTime),
				GlancingBlow: impact.IsGlancingBlow,
			})
		}
		forecasts = append(forecasts, forecast)
	}
	var issues []domain.ProviderIssue
	if meta.Warning != nil {
		issues = append(issues, issue("DONKI", "stale_enlil", meta.Warning, true))
	}
	return forecasts, issues
}

func flexibleID(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return strings.Trim(string(raw), `"`)
}

func (c *SWPCClient) ENLILTimeSeries(ctx context.Context) ([]domain.ForecastPoint, domain.Provenance, error) {
	var raw []rawEnlilPoint
	meta, err := c.HTTP.GetJSON(
		ctx,
		c.Base+"/json/enlil_time_series.json",
		"swpc:enlil-time-series",
		15*time.Minute,
		&raw,
	)
	if err != nil {
		return nil, domain.Provenance{}, err
	}
	points := make([]domain.ForecastPoint, 0, len(raw))
	for _, item := range raw {
		points = append(points, domain.ForecastPoint{
			Time:          canonicalTime(item.TimeTag),
			DensityPerCM3: item.Density,
			TemperatureK:  item.Temperature,
			SpeedKMS:      item.VR,
			BRNT:          item.BR,
			BThetaNT:      item.BTheta,
			BPhiNT:        item.BPhi,
			Polarity:      item.Polarity,
			Cloud:         item.Cloud,
		})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].Time < points[j].Time })
	return points, domain.Provenance{
		Provider:        "NOAA SWPC",
		Dataset:         "enlil_time_series",
		SourceURL:       c.Base + "/json/enlil_time_series.json",
		RetrievedAt:     domain.FormatTime(meta.RetrievedAt),
		CoordinateFrame: "Earth forecast time series",
		Class:           domain.DataForecast,
		Cached:          meta.Cached,
		Stale:           meta.Stale,
	}, nil
}

func MergeForecastTimeSeries(
	forecasts []domain.ForecastDTO,
	points []domain.ForecastPoint,
	provenance domain.Provenance,
) []domain.ForecastDTO {
	if len(points) == 0 {
		return forecasts
	}
	if len(forecasts) == 0 {
		return []domain.ForecastDTO{{
			ID:         "noaa-current-enlil",
			Model:      "NOAA WSA-ENLIL",
			Points:     points,
			Provenance: provenance,
		}}
	}
	// The public SWPC time series has no simulation ID. Attach it only to the
	// newest DONKI run, while preserving that run's metadata provenance.
	newest := 0
	for index := range forecasts {
		if forecasts[index].CompletionTime > forecasts[newest].CompletionTime {
			newest = index
		}
	}
	forecasts[newest].Points = points
	return forecasts
}
