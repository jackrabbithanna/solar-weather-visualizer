package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"solar-weather-visualizer/internal/store"
)

const defaultUserAgent = "solar-weather-visualizer/0.1 (+Wails desktop application)"

type FetchMeta struct {
	RetrievedAt time.Time
	Cached      bool
	Stale       bool
	ETag        string
	Warning     error
}

type CachedHTTP struct {
	Client    *http.Client
	Store     *store.Store
	UserAgent string
	MaxBytes  int64
	Now       func() time.Time
}

func NewCachedHTTP(cache *store.Store) *CachedHTTP {
	return &CachedHTTP{
		Client:    &http.Client{Timeout: 25 * time.Second},
		Store:     cache,
		UserAgent: defaultUserAgent,
		MaxBytes:  64 << 20,
		Now:       time.Now,
	}
}

func (c *CachedHTTP) GetJSON(
	ctx context.Context,
	requestURL string,
	cacheKey string,
	ttl time.Duration,
	destination any,
) (FetchMeta, error) {
	if c.Store != nil {
		meta, err := c.Store.GetJSON(cacheKey, destination, false)
		if err == nil {
			return FetchMeta{
				RetrievedAt: meta.StoredAt,
				Cached:      true,
				ETag:        meta.ETag,
			}, nil
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return FetchMeta{}, err
	}
	userAgent := c.UserAgent
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	response, requestErr := client.Do(req)
	if requestErr == nil {
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			requestErr = &HTTPError{
				StatusCode: response.StatusCode,
				Status:     response.Status,
				Message:    strings.TrimSpace(string(body)),
			}
		} else {
			maxBytes := c.MaxBytes
			if maxBytes <= 0 {
				maxBytes = 64 << 20
			}
			decoder := json.NewDecoder(io.LimitReader(response.Body, maxBytes))
			if err := decoder.Decode(destination); err != nil {
				requestErr = fmt.Errorf("decode %s: %w", redactedURL(requestURL), err)
			} else {
				now := time.Now().UTC()
				if c.Now != nil {
					now = c.Now().UTC()
				}
				etag := response.Header.Get("ETag")
				if c.Store != nil {
					if err := c.Store.PutJSON(cacheKey, destination, ttl, etag); err != nil {
						return FetchMeta{
							RetrievedAt: now,
							ETag:        etag,
							Warning:     fmt.Errorf("cache response: %w", err),
						}, nil
					}
				}
				return FetchMeta{RetrievedAt: now, ETag: etag}, nil
			}
		}
	}

	if c.Store != nil {
		if meta, err := c.Store.GetJSON(cacheKey, destination, true); err == nil {
			return FetchMeta{
				RetrievedAt: meta.StoredAt,
				Cached:      true,
				Stale:       true,
				ETag:        meta.ETag,
				Warning:     requestErr,
			}, nil
		}
	}
	return FetchMeta{}, requestErr
}

type HTTPError struct {
	StatusCode int
	Status     string
	Message    string
}

func (e *HTTPError) Error() string {
	if e.Message == "" {
		return e.Status
	}
	return e.Status + ": " + e.Message
}

func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode == http.StatusTooManyRequests || httpErr.StatusCode >= 500
	}
	return true
}

func redactedURL(value string) string {
	for _, marker := range []string{"api_key=", "apiKey="} {
		index := strings.Index(value, marker)
		if index < 0 {
			continue
		}
		end := strings.IndexByte(value[index:], '&')
		if end < 0 {
			return value[:index] + marker + "REDACTED"
		}
		end += index
		value = value[:index] + marker + "REDACTED" + value[end:]
	}
	return value
}
