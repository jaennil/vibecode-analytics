package domain

import "time"

const (
	SourceCodex  = "codex"
	SourceClaude = "claude"
)

type Event struct {
	ID              string     `json:"id"`
	Source          string     `json:"source"`
	Timestamp       time.Time  `json:"timestamp"`
	ProjectID       string     `json:"projectId"`
	ProjectName     string     `json:"projectName"`
	ProjectPath     string     `json:"projectPath"`
	SessionID       string     `json:"sessionId"`
	SessionName     string     `json:"sessionName"`
	Session         string     `json:"session"`
	File            string     `json:"file"`
	Model           string     `json:"model"`
	Input           int64      `json:"input"`
	CacheCreate     int64      `json:"cacheCreate"`
	CacheRead       int64      `json:"cacheRead"`
	Output          int64      `json:"output"`
	Reasoning       int64      `json:"reasoning"`
	Total           int64      `json:"total"`
	CumulativeTotal *int64     `json:"cumulativeTotal"`
	ContextWindow   *int64     `json:"contextWindow"`
	ContextPercent  *float64   `json:"contextPercent"`
	FiveHourPercent *float64   `json:"fiveHourPercent"`
	WeeklyPercent   *float64   `json:"weeklyPercent"`
	IndexedAt       *time.Time `json:"-"`
}

type Prompt struct {
	ID          string     `json:"id"`
	Source      string     `json:"source"`
	Timestamp   time.Time  `json:"timestamp"`
	ProjectID   string     `json:"projectId"`
	ProjectName string     `json:"projectName"`
	ProjectPath string     `json:"projectPath"`
	SessionID   string     `json:"sessionId"`
	SessionName string     `json:"sessionName"`
	Session     string     `json:"session"`
	File        string     `json:"file"`
	Text        string     `json:"text,omitempty"`
	ImageCount  int        `json:"imageCount"`
	IndexedAt   *time.Time `json:"-"`
}

type FileInfo struct {
	File        string    `json:"file"`
	Source      string    `json:"source"`
	ProjectName string    `json:"projectName"`
	ProjectPath string    `json:"projectPath"`
	Model       string    `json:"model,omitempty"`
	ModTime     time.Time `json:"modTime"`
	Size        int64     `json:"size"`
}

type ParsedSession struct {
	File    FileInfo `json:"file"`
	Events  []Event  `json:"events"`
	Prompts []Prompt `json:"prompts"`
}

type Query struct {
	Range     string
	Source    string
	ProjectID string
	SessionID string
}

type Summary struct {
	GeneratedAt time.Time    `json:"generatedAt"`
	Range       string       `json:"range"`
	Events      int          `json:"events"`
	Prompts     int          `json:"prompts"`
	Totals      TokenTotals  `json:"totals"`
	Latest      *Event       `json:"latest"`
	Spike       *Event       `json:"spike"`
	Daily       []DailyTotal `json:"daily"`
}

type Dashboard struct {
	Summary  Summary          `json:"summary"`
	Events   []Event          `json:"events"`
	Prompts  []Prompt         `json:"prompts"`
	Projects []ProjectSummary `json:"projects"`
	Sessions []SessionSummary `json:"sessions"`
}

type TokenTotals struct {
	NewTokens   int64 `json:"newTokens"`
	Input       int64 `json:"input"`
	CacheCreate int64 `json:"cacheCreate"`
	CacheRead   int64 `json:"cacheRead"`
	Output      int64 `json:"output"`
	Reasoning   int64 `json:"reasoning"`
	Total       int64 `json:"total"`
}

type DailyTotal struct {
	Day     string  `json:"day"`
	Total   int64   `json:"total"`
	Events  int     `json:"events"`
	Spike   int64   `json:"spike"`
	Average float64 `json:"average"`
}

type ProjectSummary struct {
	ID             string      `json:"id"`
	Source         string      `json:"source"`
	Name           string      `json:"name"`
	Path           string      `json:"path"`
	Events         int         `json:"events"`
	Prompts        int         `json:"prompts"`
	Totals         TokenTotals `json:"totals"`
	LatestTime     time.Time   `json:"latestTime"`
	SpikeEventID   string      `json:"spikeEventId"`
	SpikeNewTokens int64       `json:"spikeNewTokens"`
}

type SessionSummary struct {
	ID             string      `json:"id"`
	Source         string      `json:"source"`
	ProjectID      string      `json:"projectId"`
	ProjectName    string      `json:"projectName"`
	ProjectPath    string      `json:"projectPath"`
	Name           string      `json:"name"`
	Session        string      `json:"session"`
	File           string      `json:"file"`
	Events         int         `json:"events"`
	Prompts        int         `json:"prompts"`
	Totals         TokenTotals `json:"totals"`
	FirstTime      time.Time   `json:"firstTime"`
	LatestTime     time.Time   `json:"latestTime"`
	SpikeEventID   string      `json:"spikeEventId"`
	SpikeNewTokens int64       `json:"spikeNewTokens"`
}

func NewTokens(event Event) int64 {
	return event.Input + event.CacheCreate + event.Output + event.Reasoning
}
