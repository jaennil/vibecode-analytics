package service

import (
	"context"
	"sync"
	"time"

	"live-token-monitor/internal/config"
	"live-token-monitor/internal/discovery"
	"live-token-monitor/internal/domain"
	"live-token-monitor/internal/parser"
	"live-token-monitor/internal/store"
)

type Service struct {
	cfg          config.Config
	store        *store.Store
	mu           sync.Mutex
	lastRefresh  time.Time
	lastFiles    int
	lastEvents   int
	lastPrompts  int
	importedOnce bool
}

type RefreshResult struct {
	GeneratedAt     time.Time `json:"generatedAt"`
	Files           int       `json:"files"`
	Events          int       `json:"events"`
	Prompts         int       `json:"prompts"`
	ImportedEvents  int       `json:"importedEvents"`
	ImportedPrompts int       `json:"importedPrompts"`
}

type Health struct {
	Status       string    `json:"status"`
	GeneratedAt  time.Time `json:"generatedAt"`
	LastRefresh  time.Time `json:"lastRefresh,omitempty"`
	LastFiles    int       `json:"lastFiles"`
	LastEvents   int       `json:"lastEvents"`
	LastPrompts  int       `json:"lastPrompts"`
	CodexRoots   []string  `json:"codexRoots"`
	ClaudeRoots  []string  `json:"claudeRoots"`
	DatabasePath string    `json:"databasePath"`
}

type Metrics struct {
	GeneratedAt time.Time
	Health      Health
	Sources     []SourceMetrics
}

type SourceMetrics struct {
	Source  string
	Summary domain.Summary
}

func New(cfg config.Config, st *store.Store) *Service {
	return &Service{cfg: cfg, store: st}
}

func (s *Service) Health() Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Health{
		Status:       "ok",
		GeneratedAt:  time.Now().UTC(),
		LastRefresh:  s.lastRefresh,
		LastFiles:    s.lastFiles,
		LastEvents:   s.lastEvents,
		LastPrompts:  s.lastPrompts,
		CodexRoots:   s.cfg.CodexRoots,
		ClaudeRoots:  s.cfg.ClaudeRoots,
		DatabasePath: s.cfg.DBPath,
	}
}

func (s *Service) Refresh(ctx context.Context) (RefreshResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.refreshLocked(ctx)
}

func (s *Service) refreshLocked(ctx context.Context) (RefreshResult, error) {
	result := RefreshResult{GeneratedAt: time.Now().UTC()}
	if !s.importedOnce {
		importedEvents, importedPrompts, err := s.store.ImportHistoryJSONL(ctx, s.cfg.HistoryFile)
		if err != nil {
			return result, err
		}
		result.ImportedEvents = importedEvents
		result.ImportedPrompts = importedPrompts
		s.importedOnce = true
	}

	filesBySource := map[string][]discovery.File{
		domain.SourceCodex:  discovery.LatestJSONL(s.cfg.CodexRoots, s.cfg.MaxFilesPerSource),
		domain.SourceClaude: discovery.LatestJSONL(s.cfg.ClaudeRoots, s.cfg.MaxFilesPerSource),
	}
	events := make([]domain.Event, 0)
	prompts := make([]domain.Prompt, 0)
	fileCount := 0
	for source, files := range filesBySource {
		for _, file := range files {
			fileCount++
			text, err := discovery.ReadTail(file.Path, s.cfg.MaxTailBytes)
			if err != nil {
				continue
			}
			parsed := parser.ParseSession(source, file.Path, file.ModTime, file.Size, text)
			events = append(events, parsed.Events...)
			prompts = append(prompts, parsed.Prompts...)
		}
	}
	if err := s.store.UpsertEvents(ctx, events); err != nil {
		return result, err
	}
	if err := s.store.UpsertPrompts(ctx, prompts); err != nil {
		return result, err
	}

	result.Files = fileCount
	result.Events = len(events)
	result.Prompts = len(prompts)
	s.lastRefresh = result.GeneratedAt
	s.lastFiles = result.Files
	s.lastEvents = result.Events
	s.lastPrompts = result.Prompts
	return result, nil
}

func (s *Service) Events(ctx context.Context, query domain.Query) ([]domain.Event, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return nil, err
	}
	return s.store.Events(ctx, query, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
}

func (s *Service) Prompts(ctx context.Context, query domain.Query) ([]domain.Prompt, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return nil, err
	}
	return s.store.Prompts(ctx, query, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
}

func (s *Service) Projects(ctx context.Context, query domain.Query) ([]domain.ProjectSummary, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return nil, err
	}
	return s.store.Projects(ctx, query, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
}

func (s *Service) Sessions(ctx context.Context, query domain.Query) ([]domain.SessionSummary, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return nil, err
	}
	return s.store.Sessions(ctx, query, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
}

func (s *Service) Summary(ctx context.Context, query domain.Query) (domain.Summary, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return domain.Summary{}, err
	}
	return s.store.Summary(ctx, query, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
}

func (s *Service) Metrics(ctx context.Context) (Metrics, error) {
	if err := s.refreshIfNeeded(ctx); err != nil {
		return Metrics{}, err
	}
	metrics := Metrics{
		GeneratedAt: time.Now().UTC(),
		Health:      s.Health(),
		Sources:     make([]SourceMetrics, 0, 3),
	}
	for _, source := range []string{"all", domain.SourceCodex, domain.SourceClaude} {
		summary, err := s.store.Summary(ctx, domain.Query{Range: "all", Source: source}, s.cfg.MaxPoints, s.cfg.HistoryMaxPoints)
		if err != nil {
			return Metrics{}, err
		}
		metrics.Sources = append(metrics.Sources, SourceMetrics{Source: source, Summary: summary})
	}
	return metrics, nil
}

func (s *Service) refreshIfNeeded(ctx context.Context) error {
	s.mu.Lock()
	shouldRefresh := time.Since(s.lastRefresh) >= s.cfg.FileRefresh || s.lastRefresh.IsZero()
	if !shouldRefresh {
		s.mu.Unlock()
		return nil
	}
	_, err := s.refreshLocked(ctx)
	s.mu.Unlock()
	return err
}
