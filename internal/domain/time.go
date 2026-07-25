package domain

import (
	"fmt"
	"time"
)

const ISOTime = "2006-01-02T15:04:05Z"

func ParseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("time is required")
	}
	formats := []string{
		time.RFC3339Nano,
		"2006-01-02T15:04Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02T15:04",
		"2006-01-02",
	}
	for _, layout := range formats {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid UTC time %q", value)
}

func FormatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func ValidateRange(startValue, endValue string) (time.Time, time.Time, error) {
	start, err := ParseTime(startValue)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("start: %w", err)
	}
	end, err := ParseTime(endValue)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("end: %w", err)
	}
	if !end.After(start) {
		return time.Time{}, time.Time{}, fmt.Errorf("end must be after start")
	}
	return start, end, nil
}
