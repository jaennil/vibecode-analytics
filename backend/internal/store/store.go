package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"live-token-monitor/internal/domain"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
		return nil, err
	}
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if err := store.Migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func OpenDB(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Migrate(ctx context.Context) error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS events (
			id TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			project_id TEXT NOT NULL,
			project_name TEXT NOT NULL,
			project_path TEXT NOT NULL,
			session_id TEXT NOT NULL,
			session_name TEXT NOT NULL,
			session TEXT NOT NULL,
			file TEXT NOT NULL,
			model TEXT NOT NULL,
			input INTEGER NOT NULL,
			cache_create INTEGER NOT NULL,
			cache_read INTEGER NOT NULL,
			output INTEGER NOT NULL,
			reasoning INTEGER NOT NULL,
			total INTEGER NOT NULL,
			cumulative_total INTEGER,
			context_window INTEGER,
			context_percent REAL,
			five_hour_percent REAL,
			weekly_percent REAL,
			indexed_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS prompts (
			id TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			project_id TEXT NOT NULL,
			project_name TEXT NOT NULL,
			project_path TEXT NOT NULL,
			session_id TEXT NOT NULL,
			session_name TEXT NOT NULL,
			session TEXT NOT NULL,
			file TEXT NOT NULL,
			text TEXT NOT NULL,
			image_count INTEGER NOT NULL,
			indexed_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS events_time_idx ON events(timestamp)`,
		`CREATE INDEX IF NOT EXISTS events_filter_idx ON events(source, project_id, session_id, timestamp)`,
		`CREATE INDEX IF NOT EXISTS prompts_time_idx ON prompts(timestamp)`,
		`CREATE INDEX IF NOT EXISTS prompts_filter_idx ON prompts(source, project_id, session_id, timestamp)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpsertEvents(ctx context.Context, events []domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO events (
		id, source, timestamp, project_id, project_name, project_path, session_id, session_name, session, file, model,
		input, cache_create, cache_read, output, reasoning, total, cumulative_total, context_window,
		context_percent, five_hour_percent, weekly_percent, indexed_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		source=excluded.source, timestamp=excluded.timestamp, project_id=excluded.project_id,
		project_name=excluded.project_name, project_path=excluded.project_path, session_id=excluded.session_id,
		session_name=excluded.session_name, session=excluded.session, file=excluded.file, model=excluded.model,
		input=excluded.input, cache_create=excluded.cache_create, cache_read=excluded.cache_read,
		output=excluded.output, reasoning=excluded.reasoning, total=excluded.total,
		cumulative_total=excluded.cumulative_total, context_window=excluded.context_window,
		context_percent=excluded.context_percent, five_hour_percent=excluded.five_hour_percent,
		weekly_percent=excluded.weekly_percent, indexed_at=excluded.indexed_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	indexedAt := time.Now().UTC().Format(time.RFC3339Nano)
	for _, event := range events {
		if _, err := stmt.ExecContext(ctx,
			event.ID, event.Source, formatTime(event.Timestamp), event.ProjectID, event.ProjectName, event.ProjectPath,
			event.SessionID, event.SessionName, event.Session, event.File, event.Model, event.Input, event.CacheCreate,
			event.CacheRead, event.Output, event.Reasoning, event.Total, nullableInt(event.CumulativeTotal),
			nullableInt(event.ContextWindow), nullableFloat(event.ContextPercent), nullableFloat(event.FiveHourPercent),
			nullableFloat(event.WeeklyPercent), indexedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) UpsertPrompts(ctx context.Context, prompts []domain.Prompt) error {
	if len(prompts) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO prompts (
		id, source, timestamp, project_id, project_name, project_path, session_id, session_name, session, file, text, image_count, indexed_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		source=excluded.source, timestamp=excluded.timestamp, project_id=excluded.project_id,
		project_name=excluded.project_name, project_path=excluded.project_path, session_id=excluded.session_id,
		session_name=excluded.session_name, session=excluded.session, file=excluded.file,
		text=excluded.text, image_count=excluded.image_count, indexed_at=excluded.indexed_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	indexedAt := time.Now().UTC().Format(time.RFC3339Nano)
	for _, prompt := range prompts {
		if _, err := stmt.ExecContext(ctx,
			prompt.ID, prompt.Source, formatTime(prompt.Timestamp), prompt.ProjectID, prompt.ProjectName,
			prompt.ProjectPath, prompt.SessionID, prompt.SessionName, prompt.Session, prompt.File,
			prompt.Text, prompt.ImageCount, indexedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) Events(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) ([]domain.Event, error) {
	where, args := filterSQL(query, "events", maxPoints, historyMaxPoints)
	rows, err := s.db.QueryContext(ctx, `SELECT id, source, timestamp, project_id, project_name, project_path,
		session_id, session_name, session, file, model, input, cache_create, cache_read, output, reasoning, total,
		cumulative_total, context_window, context_percent, five_hour_percent, weekly_percent, indexed_at
		FROM events `+where+` ORDER BY timestamp ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]domain.Event, 0)
	for rows.Next() {
		var event domain.Event
		var timestamp, indexedAt string
		var cumulativeTotal, contextWindow sql.NullInt64
		var contextPercent, fiveHourPercent, weeklyPercent sql.NullFloat64
		if err := rows.Scan(&event.ID, &event.Source, &timestamp, &event.ProjectID, &event.ProjectName, &event.ProjectPath,
			&event.SessionID, &event.SessionName, &event.Session, &event.File, &event.Model, &event.Input, &event.CacheCreate,
			&event.CacheRead, &event.Output, &event.Reasoning, &event.Total, &cumulativeTotal, &contextWindow,
			&contextPercent, &fiveHourPercent, &weeklyPercent, &indexedAt); err != nil {
			return nil, err
		}
		event.Timestamp = parseTime(timestamp)
		event.CumulativeTotal = ptrInt(cumulativeTotal)
		event.ContextWindow = ptrInt(contextWindow)
		event.ContextPercent = ptrFloat(contextPercent)
		event.FiveHourPercent = ptrFloat(fiveHourPercent)
		event.WeeklyPercent = ptrFloat(weeklyPercent)
		idx := parseTime(indexedAt)
		event.IndexedAt = &idx
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) Prompts(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) ([]domain.Prompt, error) {
	return s.prompts(ctx, query, maxPoints, historyMaxPoints, true)
}

func (s *Store) PromptMetas(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) ([]domain.Prompt, error) {
	return s.prompts(ctx, query, maxPoints, historyMaxPoints, false)
}

func (s *Store) Prompt(ctx context.Context, id string) (domain.Prompt, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, source, timestamp, project_id, project_name, project_path,
		session_id, session_name, session, file, text, image_count, indexed_at
		FROM prompts WHERE id = ?`, id)
	return scanPrompt(row)
}

func (s *Store) prompts(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int, includeText bool) ([]domain.Prompt, error) {
	where, args := filterSQL(query, "prompts", maxPoints, historyMaxPoints)
	textColumn := "''"
	if includeText {
		textColumn = "text"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, source, timestamp, project_id, project_name, project_path,
		session_id, session_name, session, file, `+textColumn+`, image_count, indexed_at
		FROM prompts `+where+` ORDER BY timestamp ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	prompts := make([]domain.Prompt, 0)
	for rows.Next() {
		prompt, err := scanPrompt(rows)
		if err != nil {
			return nil, err
		}
		prompts = append(prompts, prompt)
	}
	return prompts, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanPrompt(row rowScanner) (domain.Prompt, error) {
	var prompt domain.Prompt
	var timestamp, indexedAt string
	if err := row.Scan(&prompt.ID, &prompt.Source, &timestamp, &prompt.ProjectID, &prompt.ProjectName, &prompt.ProjectPath,
		&prompt.SessionID, &prompt.SessionName, &prompt.Session, &prompt.File, &prompt.Text, &prompt.ImageCount, &indexedAt); err != nil {
		return domain.Prompt{}, err
	}
	prompt.Timestamp = parseTime(timestamp)
	idx := parseTime(indexedAt)
	prompt.IndexedAt = &idx
	return prompt, nil
}

func (s *Store) Summary(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) (domain.Summary, error) {
	events, err := s.Events(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return domain.Summary{}, err
	}
	prompts, err := s.PromptMetas(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return domain.Summary{}, err
	}
	return summaryFrom(query, events, prompts), nil
}

func (s *Store) Dashboard(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) (domain.Dashboard, error) {
	events, err := s.Events(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return domain.Dashboard{}, err
	}
	prompts, err := s.PromptMetas(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return domain.Dashboard{}, err
	}
	return domain.Dashboard{
		Summary:  summaryFrom(query, events, prompts),
		Events:   events,
		Prompts:  prompts,
		Projects: projectsFrom(events, prompts),
		Sessions: sessionsFrom(events, prompts),
	}, nil
}

func summaryFrom(query domain.Query, events []domain.Event, prompts []domain.Prompt) domain.Summary {
	summary := domain.Summary{
		GeneratedAt: time.Now().UTC(),
		Range:       defaultRange(query.Range),
		Events:      len(events),
		Prompts:     len(prompts),
		Daily:       dailyTotals(events),
	}
	for i := range events {
		event := events[i]
		addTotals(&summary.Totals, event)
		if summary.Latest == nil || event.Timestamp.After(summary.Latest.Timestamp) {
			copy := event
			summary.Latest = &copy
		}
		if summary.Spike == nil || domain.NewTokens(event) > domain.NewTokens(*summary.Spike) {
			copy := event
			summary.Spike = &copy
		}
	}
	return summary
}

func (s *Store) Projects(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) ([]domain.ProjectSummary, error) {
	events, err := s.Events(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return nil, err
	}
	prompts, err := s.PromptMetas(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return nil, err
	}
	return projectsFrom(events, prompts), nil
}

func projectsFrom(events []domain.Event, prompts []domain.Prompt) []domain.ProjectSummary {
	byID := map[string]*domain.ProjectSummary{}
	for _, event := range events {
		row := byID[event.ProjectID]
		if row == nil {
			row = &domain.ProjectSummary{ID: event.ProjectID, Source: event.Source, Name: event.ProjectName, Path: event.ProjectPath, LatestTime: event.Timestamp}
			byID[event.ProjectID] = row
		}
		row.Events++
		addTotals(&row.Totals, event)
		if event.Timestamp.After(row.LatestTime) {
			row.LatestTime = event.Timestamp
		}
		if domain.NewTokens(event) > row.SpikeNewTokens {
			row.SpikeNewTokens = domain.NewTokens(event)
			row.SpikeEventID = event.ID
		}
	}
	for _, prompt := range prompts {
		row := byID[prompt.ProjectID]
		if row != nil {
			row.Prompts++
		}
	}
	out := make([]domain.ProjectSummary, 0, len(byID))
	for _, row := range byID {
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LatestTime.After(out[j].LatestTime) })
	return out
}

func (s *Store) Sessions(ctx context.Context, query domain.Query, maxPoints int, historyMaxPoints int) ([]domain.SessionSummary, error) {
	events, err := s.Events(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return nil, err
	}
	prompts, err := s.PromptMetas(ctx, query, maxPoints, historyMaxPoints)
	if err != nil {
		return nil, err
	}
	return sessionsFrom(events, prompts), nil
}

func sessionsFrom(events []domain.Event, prompts []domain.Prompt) []domain.SessionSummary {
	byID := map[string]*domain.SessionSummary{}
	for _, event := range events {
		row := byID[event.SessionID]
		if row == nil {
			row = &domain.SessionSummary{
				ID: event.SessionID, Source: event.Source, ProjectID: event.ProjectID, ProjectName: event.ProjectName,
				ProjectPath: event.ProjectPath, Name: event.SessionName, Session: event.Session, File: event.File,
				FirstTime: event.Timestamp, LatestTime: event.Timestamp,
			}
			byID[event.SessionID] = row
		}
		row.Events++
		addTotals(&row.Totals, event)
		if event.Timestamp.Before(row.FirstTime) {
			row.FirstTime = event.Timestamp
		}
		if event.Timestamp.After(row.LatestTime) {
			row.LatestTime = event.Timestamp
		}
		if domain.NewTokens(event) > row.SpikeNewTokens {
			row.SpikeNewTokens = domain.NewTokens(event)
			row.SpikeEventID = event.ID
		}
	}
	for _, prompt := range prompts {
		row := byID[prompt.SessionID]
		if row != nil {
			row.Prompts++
		}
	}
	out := make([]domain.SessionSummary, 0, len(byID))
	for _, row := range byID {
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LatestTime.After(out[j].LatestTime) })
	return out
}

func (s *Store) ImportHistoryJSONL(ctx context.Context, path string) (int, int, error) {
	if path == "" {
		return 0, 0, nil
	}
	if imported, _ := s.setting(ctx, "history_imported:"+path); imported == "1" {
		return 0, 0, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		_ = s.setSetting(ctx, "history_imported:"+path, "1")
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	events := make([]domain.Event, 0)
	prompts := make([]domain.Prompt, 0)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var record struct {
			Kind string          `json:"kind"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			continue
		}
		switch record.Kind {
		case "point":
			var event domain.Event
			if err := json.Unmarshal(record.Data, &event); err == nil {
				applyLegacyEventFields(record.Data, &event)
				normalizeLegacyEvent(&event)
				events = append(events, event)
			}
		case "prompt":
			var prompt domain.Prompt
			if err := json.Unmarshal(record.Data, &prompt); err == nil {
				applyLegacyPromptFields(record.Data, &prompt)
				normalizeLegacyPrompt(&prompt)
				prompts = append(prompts, prompt)
			}
		}
	}
	if err := s.UpsertEvents(ctx, events); err != nil {
		return 0, 0, err
	}
	if err := s.UpsertPrompts(ctx, prompts); err != nil {
		return 0, 0, err
	}
	if err := s.setSetting(ctx, "history_imported:"+path, "1"); err != nil {
		return 0, 0, err
	}
	return len(events), len(prompts), nil
}

func (s *Store) setting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s *Store) setSetting(ctx context.Context, key string, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func filterSQL(query domain.Query, table string, maxPoints int, historyMaxPoints int) (string, []any) {
	rangeName := defaultRange(query.Range)
	clauses := make([]string, 0)
	args := make([]any, 0)
	if since, ok := rangeStart(rangeName); ok {
		clauses = append(clauses, "timestamp >= ?")
		args = append(args, formatTime(since))
	}
	if query.Source != "" && query.Source != "all" {
		clauses = append(clauses, "source = ?")
		args = append(args, query.Source)
	}
	if query.ProjectID != "" {
		clauses = append(clauses, "project_id = ?")
		args = append(args, query.ProjectID)
	}
	if query.SessionID != "" {
		clauses = append(clauses, "session_id = ?")
		args = append(args, query.SessionID)
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	limit := historyMaxPoints
	if rangeName == "live" {
		limit = maxPoints
	}
	if limit > 0 && table != "prompts" {
		where = fmt.Sprintf("WHERE id IN (SELECT id FROM %s %s ORDER BY timestamp DESC LIMIT %d)", table, where, limit)
		args = append([]any{}, args...)
	}
	return where, args
}

func rangeStart(rangeName string) (time.Time, bool) {
	now := time.Now().UTC()
	switch rangeName {
	case "live", "all":
		return time.Time{}, false
	case "7d":
		return now.Add(-7 * 24 * time.Hour), true
	case "30d":
		return now.Add(-30 * 24 * time.Hour), true
	case "24h":
		return now.Add(-24 * time.Hour), true
	default:
		return now.Add(-24 * time.Hour), true
	}
}

func defaultRange(value string) string {
	switch value {
	case "live", "24h", "7d", "30d", "all":
		return value
	default:
		return "24h"
	}
}

func addTotals(total *domain.TokenTotals, event domain.Event) {
	total.NewTokens += domain.NewTokens(event)
	total.Input += event.Input
	total.CacheCreate += event.CacheCreate
	total.CacheRead += event.CacheRead
	total.Output += event.Output
	total.Reasoning += event.Reasoning
	total.Total += event.Total
}

func dailyTotals(events []domain.Event) []domain.DailyTotal {
	byDay := map[string]*domain.DailyTotal{}
	for _, event := range events {
		day := event.Timestamp.Format("2006-01-02")
		row := byDay[day]
		if row == nil {
			row = &domain.DailyTotal{Day: day}
			byDay[day] = row
		}
		value := domain.NewTokens(event)
		row.Total += value
		row.Events++
		if value > row.Spike {
			row.Spike = value
		}
		row.Average = float64(row.Total) / float64(row.Events)
	}
	out := make([]domain.DailyTotal, 0, len(byDay))
	for _, row := range byDay {
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out
}

func normalizeLegacyEvent(event *domain.Event) {
	if event.ProjectID == "" {
		event.ProjectID = event.Source + ":" + firstNonEmpty(event.ProjectPath, event.ProjectName, event.Session, "unknown")
	}
	if event.ProjectName == "" {
		event.ProjectName = basenameOrUnknown(firstNonEmpty(event.ProjectPath, event.ProjectID, "unknown"))
	}
	if event.SessionID == "" {
		event.SessionID = event.ProjectID
	}
	if event.SessionName == "" {
		event.SessionName = basenameOrUnknown(firstNonEmpty(event.ProjectPath, event.Session, event.ProjectName, "unknown"))
	}
}

func normalizeLegacyPrompt(prompt *domain.Prompt) {
	if prompt.ProjectID == "" {
		prompt.ProjectID = prompt.Source + ":" + firstNonEmpty(prompt.ProjectPath, prompt.ProjectName, prompt.Session, "unknown")
	}
	if prompt.ProjectName == "" {
		prompt.ProjectName = basenameOrUnknown(firstNonEmpty(prompt.ProjectPath, prompt.ProjectID, "unknown"))
	}
	if prompt.SessionID == "" {
		prompt.SessionID = prompt.ProjectID
	}
	if prompt.SessionName == "" {
		prompt.SessionName = basenameOrUnknown(firstNonEmpty(prompt.ProjectPath, prompt.Session, prompt.ProjectName, "unknown"))
	}
}

func applyLegacyEventFields(data json.RawMessage, event *domain.Event) {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if event.ProjectName == "" {
		event.ProjectName = legacyString(raw, "project")
	}
	if event.ProjectID == "" {
		event.ProjectID = legacyString(raw, "projectId")
	}
	if event.ProjectPath == "" {
		event.ProjectPath = legacyString(raw, "projectPath")
	}
	if event.SessionID == "" {
		event.SessionID = firstNonEmpty(legacyString(raw, "sessionId"), legacyString(raw, "sessionKey"))
	}
	if event.SessionName == "" {
		event.SessionName = legacyString(raw, "sessionLabel")
	}
	if event.Session == "" {
		event.Session = legacyString(raw, "session")
	}
}

func applyLegacyPromptFields(data json.RawMessage, prompt *domain.Prompt) {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if prompt.ProjectName == "" {
		prompt.ProjectName = legacyString(raw, "project")
	}
	if prompt.ProjectID == "" {
		prompt.ProjectID = legacyString(raw, "projectId")
	}
	if prompt.ProjectPath == "" {
		prompt.ProjectPath = legacyString(raw, "projectPath")
	}
	if prompt.SessionID == "" {
		prompt.SessionID = firstNonEmpty(legacyString(raw, "sessionId"), legacyString(raw, "sessionKey"))
	}
	if prompt.SessionName == "" {
		prompt.SessionName = legacyString(raw, "sessionLabel")
	}
	if prompt.Session == "" {
		prompt.Session = legacyString(raw, "session")
	}
}

func legacyString(raw map[string]any, key string) string {
	value, ok := raw[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func formatTime(ts time.Time) string {
	if ts.IsZero() {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	return ts.UTC().Format(time.RFC3339Nano)
}

func parseTime(raw string) time.Time {
	ts, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}
	}
	return ts.UTC()
}

func nullableInt(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func ptrInt(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func ptrFloat(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func basenameOrUnknown(value string) string {
	value = strings.TrimRight(value, `/\`)
	if value == "" {
		return "unknown"
	}
	base := filepath.Base(value)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return value
	}
	return base
}
