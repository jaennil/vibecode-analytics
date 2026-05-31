package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Home              string
	Port              int
	DBPath            string
	HistoryFile       string
	MaxTailBytes      int64
	MaxPoints         int
	HistoryDays       int
	HistoryMaxPoints  int
	MaxFilesPerSource int
	FileRefresh       time.Duration
	CodexRoots        []string
	ClaudeRoots       []string
	CORSOrigins       []string
}

func Load() Config {
	home := firstNonEmpty(os.Getenv("HOME"), os.Getenv("USERPROFILE"))
	cfg := Config{
		Home:              home,
		Port:              intEnv("PORT", 8787),
		DBPath:            stringEnv("DB_PATH", filepath.Join("..", "data", "usage.db")),
		HistoryFile:       stringEnv("HISTORY_FILE", filepath.Join("..", "data", "usage-history.jsonl")),
		MaxTailBytes:      int64Env("MAX_TAIL_BYTES", 4*1024*1024),
		MaxPoints:         intEnv("MAX_POINTS", 260),
		HistoryDays:       intEnv("HISTORY_DAYS", 90),
		HistoryMaxPoints:  intEnv("HISTORY_MAX_POINTS", 100000),
		MaxFilesPerSource: intEnv("MAX_FILES_PER_SOURCE", 1000),
		FileRefresh:       time.Duration(intEnv("FILE_REFRESH_MS", 5000)) * time.Millisecond,
		CORSOrigins:       splitList(stringEnv("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")),
	}
	cfg.CodexRoots = codexRoots(home)
	cfg.ClaudeRoots = claudeRoots(home)
	return cfg
}

func codexRoots(home string) []string {
	raw := stringEnv("CODEX_HOME", filepath.Join(home, ".codex"))
	roots := make([]string, 0)
	for _, root := range splitList(raw) {
		expanded := expandHome(home, root)
		sessions := filepath.Join(expanded, "sessions")
		if stat, err := os.Stat(sessions); err == nil && stat.IsDir() {
			roots = append(roots, sessions)
			continue
		}
		roots = append(roots, expanded)
	}
	return roots
}

func claudeRoots(home string) []string {
	raw := os.Getenv("CLAUDE_CONFIG_DIR")
	if raw != "" {
		roots := make([]string, 0)
		for _, root := range splitList(raw) {
			expanded := expandHome(home, root)
			projects := filepath.Join(expanded, "projects")
			if stat, err := os.Stat(projects); err == nil && stat.IsDir() {
				roots = append(roots, projects)
				continue
			}
			roots = append(roots, expanded)
		}
		return roots
	}
	return []string{
		filepath.Join(home, ".config", "claude", "projects"),
		filepath.Join(home, ".claude", "projects"),
	}
}

func expandHome(home string, value string) string {
	if value == "~" {
		return home
	}
	if strings.HasPrefix(value, "~/") {
		return filepath.Join(home, value[2:])
	}
	return value
}

func splitList(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func intEnv(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func int64Env(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func stringEnv(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
