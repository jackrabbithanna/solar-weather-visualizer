package store

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultCacheLimit = int64(1 << 30)
	configFileName    = "settings.json"
)

var ErrCacheMiss = errors.New("cache miss")

type Config struct {
	NASAAPIKey             string `json:"nasaApiKey,omitempty"`
	CacheLimitBytes        int64  `json:"cacheLimitBytes"`
	LiveRefreshSeconds     int    `json:"liveRefreshSeconds"`
	FullRTSWRefreshSeconds int    `json:"fullRtswRefreshSeconds"`
	EventRefreshSeconds    int    `json:"eventRefreshSeconds"`
	PreferredScale         string `json:"preferredScale"`
	ReducedMotion          bool   `json:"reducedMotion"`
}

func DefaultConfig() Config {
	return Config{
		CacheLimitBytes:        defaultCacheLimit,
		LiveRefreshSeconds:     60,
		FullRTSWRefreshSeconds: 900,
		EventRefreshSeconds:    900,
		PreferredScale:         "linear",
	}
}

type cacheEnvelope struct {
	StoredAt  time.Time       `json:"storedAt"`
	ExpiresAt time.Time       `json:"expiresAt"`
	ETag      string          `json:"etag,omitempty"`
	Data      json.RawMessage `json:"data"`
}

type CacheMeta struct {
	StoredAt time.Time
	ETag     string
	Stale    bool
}

type Store struct {
	configDir string
	cacheDir  string
	mu        sync.Mutex
}

func New(appName string) (*Store, error) {
	configBase, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve config directory: %w", err)
	}
	cacheBase, err := os.UserCacheDir()
	if err != nil {
		return nil, fmt.Errorf("resolve cache directory: %w", err)
	}
	return NewAt(filepath.Join(configBase, appName), filepath.Join(cacheBase, appName))
}

func NewAt(configDir, cacheDir string) (*Store, error) {
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return nil, fmt.Errorf("create cache directory: %w", err)
	}
	return &Store{configDir: configDir, cacheDir: cacheDir}, nil
}

func (s *Store) LoadConfig() (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := filepath.Join(s.configDir, configFileName)
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("open settings: %w", err)
	}
	defer file.Close()

	config := DefaultConfig()
	if err := json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&config); err != nil {
		return Config{}, fmt.Errorf("decode settings: %w", err)
	}
	normalizeConfig(&config)
	return config, nil
}

func (s *Store) SaveConfig(config Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	normalizeConfig(&config)
	return writeJSONAtomic(filepath.Join(s.configDir, configFileName), config, 0o600)
}

func normalizeConfig(config *Config) {
	if config.CacheLimitBytes < 64<<20 {
		config.CacheLimitBytes = defaultCacheLimit
	}
	if config.LiveRefreshSeconds < 30 {
		config.LiveRefreshSeconds = 60
	}
	if config.FullRTSWRefreshSeconds < 300 {
		config.FullRTSWRefreshSeconds = 900
	}
	if config.EventRefreshSeconds < 300 {
		config.EventRefreshSeconds = 900
	}
	if config.PreferredScale != "compressed" {
		config.PreferredScale = "linear"
	}
}

func (s *Store) GetJSON(key string, destination any, allowStale bool) (CacheMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := s.cachePath(key)
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return CacheMeta{}, ErrCacheMiss
	}
	if err != nil {
		return CacheMeta{}, fmt.Errorf("open cache: %w", err)
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		return CacheMeta{}, fmt.Errorf("open compressed cache: %w", err)
	}
	defer reader.Close()

	var envelope cacheEnvelope
	if err := json.NewDecoder(io.LimitReader(reader, 256<<20)).Decode(&envelope); err != nil {
		return CacheMeta{}, fmt.Errorf("decode cache: %w", err)
	}
	stale := !envelope.ExpiresAt.IsZero() && time.Now().UTC().After(envelope.ExpiresAt)
	if stale && !allowStale {
		return CacheMeta{}, ErrCacheMiss
	}
	if err := json.Unmarshal(envelope.Data, destination); err != nil {
		return CacheMeta{}, fmt.Errorf("decode cached payload: %w", err)
	}
	_ = os.Chtimes(path, time.Now(), time.Now())
	return CacheMeta{StoredAt: envelope.StoredAt, ETag: envelope.ETag, Stale: stale}, nil
}

func (s *Store) PutJSON(key string, value any, ttl time.Duration, etag string) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode cache payload: %w", err)
	}
	now := time.Now().UTC()
	envelope := cacheEnvelope{
		StoredAt: now,
		ETag:     etag,
		Data:     payload,
	}
	if ttl > 0 {
		envelope.ExpiresAt = now.Add(ttl)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeGzipJSONAtomic(s.cachePath(key), envelope); err != nil {
		return err
	}
	config, _ := s.loadConfigUnlocked()
	return s.pruneUnlocked(config.CacheLimitBytes)
}

func (s *Store) ClearCache() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.cacheDir)
	if err != nil {
		return fmt.Errorf("list cache: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json.gz") {
			continue
		}
		if err := os.Remove(filepath.Join(s.cacheDir, entry.Name())); err != nil {
			return fmt.Errorf("remove cache file: %w", err)
		}
	}
	return nil
}

func (s *Store) CacheBytes() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cacheBytes(s.cacheDir)
}

func (s *Store) HasCache() bool {
	size, err := s.CacheBytes()
	return err == nil && size > 0
}

func (s *Store) cachePath(key string) string {
	sum := sha256.Sum256([]byte(key))
	return filepath.Join(s.cacheDir, hex.EncodeToString(sum[:])+".json.gz")
}

func (s *Store) loadConfigUnlocked() (Config, error) {
	path := filepath.Join(s.configDir, configFileName)
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return Config{}, err
	}
	defer file.Close()
	config := DefaultConfig()
	err = json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&config)
	normalizeConfig(&config)
	return config, err
}

type cacheFile struct {
	path    string
	size    int64
	modTime time.Time
}

func (s *Store) pruneUnlocked(limit int64) error {
	if limit <= 0 {
		return nil
	}
	entries, err := os.ReadDir(s.cacheDir)
	if err != nil {
		return err
	}
	var files []cacheFile
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json.gz") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		total += info.Size()
		files = append(files, cacheFile{
			path:    filepath.Join(s.cacheDir, entry.Name()),
			size:    info.Size(),
			modTime: info.ModTime(),
		})
	}
	if total <= limit {
		return nil
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.Before(files[j].modTime)
	})
	for _, file := range files {
		if total <= limit {
			break
		}
		if err := os.Remove(file.path); err != nil {
			return err
		}
		total -= file.size
	}
	return nil
}

func cacheBytes(root string) (int64, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
		}
	}
	return total, nil
}

func writeJSONAtomic(path string, value any, mode fs.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".settings-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary file: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(mode); err != nil {
		temp.Close()
		return err
	}
	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("replace file: %w", err)
	}
	return nil
}

func writeGzipJSONAtomic(path string, value any) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".cache-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary cache: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	writer := gzip.NewWriter(temp)
	encoder := json.NewEncoder(writer)
	if err := encoder.Encode(value); err != nil {
		writer.Close()
		temp.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("replace cache: %w", err)
	}
	return nil
}
