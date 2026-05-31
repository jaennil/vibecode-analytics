package parser

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"live-token-monitor/internal/domain"
)

type SessionInfo struct {
	ProjectName string
	ProjectPath string
	Model       string
}

func ParseJSONLines(text []byte) []map[string]any {
	scanner := bufio.NewScanner(bytes.NewReader(text))
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	rows := make([]map[string]any, 0)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err == nil {
			rows = append(rows, row)
		}
	}
	return rows
}

func ParseSession(source string, file string, modTime time.Time, size int64, text []byte) domain.ParsedSession {
	rows := ParseJSONLines(text)
	info := ExtractSessionInfo(source, file, rows)
	out := domain.ParsedSession{
		File: domain.FileInfo{
			File:        file,
			Source:      source,
			ProjectName: info.ProjectName,
			ProjectPath: info.ProjectPath,
			Model:       info.Model,
			ModTime:     modTime,
			Size:        size,
		},
	}
	for _, row := range rows {
		if event, ok := ParseEvent(source, file, info, row); ok {
			out.Events = append(out.Events, event)
		}
		if prompt, ok := ParsePrompt(source, file, info, row); ok {
			out.Prompts = append(out.Prompts, prompt)
		}
	}
	return out
}

func ExtractSessionInfo(source string, file string, rows []map[string]any) SessionInfo {
	if source == domain.SourceClaude {
		for i := len(rows) - 1; i >= 0; i-- {
			if cwd := stringValue(rows[i], "cwd"); cwd != "" {
				return SessionInfo{ProjectName: basenameOrUnknown(cwd), ProjectPath: cwd}
			}
		}
		projectPath := claudeProjectFromFile(file)
		return SessionInfo{ProjectName: basenameOrUnknown(projectPath), ProjectPath: projectPath}
	}

	var cwd, model string
	for _, row := range rows {
		payload := objectValue(row, "payload")
		rowType := stringValue(row, "type")
		if cwd == "" && rowType == "session_meta" {
			cwd = stringValue(payload, "cwd")
		}
		if rowType == "turn_context" {
			if cwd == "" {
				cwd = stringValue(payload, "cwd")
			}
			if model == "" {
				model = stringValue(payload, "model")
			}
		}
		if cwd != "" && model != "" {
			break
		}
	}
	name := basenameOrUnknown(cwd)
	if name == "unknown" {
		name = shortSession(file)
	}
	return SessionInfo{ProjectName: name, ProjectPath: cwd, Model: model}
}

func ParseEvent(source string, file string, info SessionInfo, row map[string]any) (domain.Event, bool) {
	if source == domain.SourceClaude {
		return parseClaudeEvent(file, info, row)
	}
	return parseCodexEvent(file, info, row)
}

func ParsePrompt(source string, file string, info SessionInfo, row map[string]any) (domain.Prompt, bool) {
	if source == domain.SourceClaude {
		return parseClaudePrompt(file, info, row)
	}
	return parseCodexPrompt(file, info, row)
}

func parseCodexEvent(file string, info SessionInfo, row map[string]any) (domain.Event, bool) {
	payload := objectValue(row, "payload")
	if stringValue(row, "type") != "event_msg" || stringValue(payload, "type") != "token_count" {
		return domain.Event{}, false
	}
	tokenInfo := objectValue(payload, "info")
	last := objectValue(tokenInfo, "last_token_usage")
	totalUsage := objectValue(tokenInfo, "total_token_usage")
	rate := objectValue(payload, "rate_limits")
	primary := objectValue(rate, "primary")
	secondary := objectValue(rate, "secondary")

	totalInput := int64Value(last, "input_tokens")
	cacheRead := int64Value(last, "cached_input_tokens")
	freshInput := totalInput - cacheRead
	if freshInput < 0 {
		freshInput = 0
	}
	output := int64Value(last, "output_tokens")
	reasoning := int64Value(last, "reasoning_output_tokens")
	turnTotal := int64Value(last, "total_tokens")
	if turnTotal == 0 {
		turnTotal = totalInput + output
	}
	contextWindow := int64Value(tokenInfo, "model_context_window")
	var contextPercent *float64
	if contextWindow > 0 {
		v := (float64(totalInput) / float64(contextWindow)) * 100
		if v > 100 {
			v = 100
		}
		contextPercent = &v
	}

	ts := timestampValue(row)
	projectID := logicalKey(domain.SourceCodex, info.ProjectPath, info.ProjectName, shortSession(file))
	return domain.Event{
		ID:              fmt.Sprintf("%s:%s:codex:%d", file, ts.Format(time.RFC3339Nano), turnTotal),
		Source:          domain.SourceCodex,
		Timestamp:       ts,
		ProjectID:       projectID,
		ProjectName:     info.ProjectName,
		ProjectPath:     info.ProjectPath,
		SessionID:       projectID,
		SessionName:     logicalLabel(info.ProjectPath, info.ProjectName, shortSession(file)),
		Session:         shortSession(file),
		File:            file,
		Model:           firstNonEmpty(info.Model, stringValue(objectValue(payload, "turn_context"), "model"), "codex"),
		Input:           freshInput,
		CacheRead:       cacheRead,
		Output:          output,
		Reasoning:       reasoning,
		Total:           turnTotal,
		CumulativeTotal: int64Ptr(int64Value(totalUsage, "total_tokens")),
		ContextWindow:   int64Ptr(contextWindow),
		ContextPercent:  contextPercent,
		FiveHourPercent: floatPtr(floatValue(primary, "used_percent")),
		WeeklyPercent:   floatPtr(floatValue(secondary, "used_percent")),
	}, true
}

func parseCodexPrompt(file string, info SessionInfo, row map[string]any) (domain.Prompt, bool) {
	payload := objectValue(row, "payload")
	if stringValue(row, "type") == "event_msg" && stringValue(payload, "type") == "user_message" {
		imageCount := arrayLen(payload, "images") + arrayLen(payload, "local_images")
		text := strings.TrimSpace(stringValue(payload, "message"))
		if text == "" && imageCount > 0 {
			text = "[image-only prompt]"
		}
		if text == "" {
			return domain.Prompt{}, false
		}
		return codexPrompt(file, info, timestampValue(row), text, imageCount), true
	}
	if stringValue(row, "type") == "response_item" && stringValue(payload, "type") == "message" && stringValue(payload, "role") == "user" {
		content := payload["content"]
		imageCount := countContentImages(content)
		text := textFromContent(content)
		if text == "" && imageCount > 0 {
			text = "[image-only prompt]"
		}
		if text == "" {
			return domain.Prompt{}, false
		}
		return codexPrompt(file, info, timestampValue(row), text, imageCount), true
	}
	return domain.Prompt{}, false
}

func codexPrompt(file string, info SessionInfo, ts time.Time, text string, imageCount int) domain.Prompt {
	projectID := logicalKey(domain.SourceCodex, info.ProjectPath, info.ProjectName, shortSession(file))
	return domain.Prompt{
		ID:          fmt.Sprintf("%s:prompt:%s:%s", file, ts.Format(time.RFC3339Nano), stableHash(text)),
		Source:      domain.SourceCodex,
		Timestamp:   ts,
		ProjectID:   projectID,
		ProjectName: info.ProjectName,
		ProjectPath: info.ProjectPath,
		SessionID:   projectID,
		SessionName: logicalLabel(info.ProjectPath, info.ProjectName, shortSession(file)),
		Session:     shortSession(file),
		File:        file,
		Text:        text,
		ImageCount:  imageCount,
	}
}

func parseClaudeEvent(file string, info SessionInfo, row map[string]any) (domain.Event, bool) {
	message := objectValue(row, "message")
	usage := objectValue(message, "usage")
	if len(usage) == 0 {
		return domain.Event{}, false
	}
	input := int64Value(usage, "input_tokens")
	cacheCreate := int64Value(usage, "cache_creation_input_tokens")
	cacheRead := int64Value(usage, "cache_read_input_tokens")
	output := int64Value(usage, "output_tokens")
	total := input + cacheCreate + cacheRead + output
	if total <= 0 {
		return domain.Event{}, false
	}
	contextWindowObj := objectValue(row, "context_window")
	contextWindow := int64Value(contextWindowObj, "context_window_size")
	contextPercentValue, hasContextPercent := optionalFloat(contextWindowObj, "used_percentage")
	projectPath := firstNonEmpty(stringValue(row, "cwd"), info.ProjectPath)
	projectName := firstNonEmpty(basenameOrUnknown(projectPath), info.ProjectName)
	fallbackSession := firstNonEmpty(stringValue(row, "sessionId"), shortSession(file))
	ts := timestampValue(row)

	event := domain.Event{
		ID:            fmt.Sprintf("%s:claude:%s", file, firstNonEmpty(stringValue(row, "requestId"), stringValue(message, "id"), stringValue(row, "uuid"), ts.Format(time.RFC3339Nano), fmt.Sprint(total))),
		Source:        domain.SourceClaude,
		Timestamp:     ts,
		ProjectID:     logicalKey(domain.SourceClaude, projectPath, projectName, fallbackSession),
		ProjectName:   projectName,
		ProjectPath:   projectPath,
		SessionID:     logicalKey(domain.SourceClaude, projectPath, projectName, fallbackSession),
		SessionName:   logicalLabel(projectPath, projectName, fallbackSession),
		Session:       fallbackSession,
		File:          file,
		Model:         firstNonEmpty(stringValue(message, "model"), "claude"),
		Input:         input,
		CacheCreate:   cacheCreate,
		CacheRead:     cacheRead,
		Output:        output,
		Total:         total,
		ContextWindow: int64Ptr(contextWindow),
	}
	if hasContextPercent {
		event.ContextPercent = &contextPercentValue
	}
	return event, true
}

func parseClaudePrompt(file string, info SessionInfo, row map[string]any) (domain.Prompt, bool) {
	message := objectValue(row, "message")
	if stringValue(row, "type") != "user" || stringValue(message, "role") != "user" {
		return domain.Prompt{}, false
	}
	projectPath := firstNonEmpty(stringValue(row, "cwd"), info.ProjectPath)
	projectName := firstNonEmpty(basenameOrUnknown(projectPath), info.ProjectName)
	fallbackSession := firstNonEmpty(stringValue(row, "sessionId"), shortSession(file))
	content := message["content"]
	imageCount := countContentImages(content)
	text := textFromContent(content)
	if text == "" && imageCount > 0 {
		text = "[image-only prompt]"
	}
	if text == "" {
		return domain.Prompt{}, false
	}
	return domain.Prompt{
		ID:          fmt.Sprintf("%s:prompt:%s:%s", file, firstNonEmpty(stringValue(row, "uuid"), timestampValue(row).Format(time.RFC3339Nano)), stableHash(text)),
		Source:      domain.SourceClaude,
		Timestamp:   timestampValue(row),
		ProjectID:   logicalKey(domain.SourceClaude, projectPath, projectName, fallbackSession),
		ProjectName: projectName,
		ProjectPath: projectPath,
		SessionID:   logicalKey(domain.SourceClaude, projectPath, projectName, fallbackSession),
		SessionName: logicalLabel(projectPath, projectName, fallbackSession),
		Session:     fallbackSession,
		File:        file,
		Text:        text,
		ImageCount:  imageCount,
	}, true
}

func timestampValue(row map[string]any) time.Time {
	raw := stringValue(row, "timestamp")
	if raw == "" {
		return time.Now().UTC()
	}
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return ts.UTC()
	}
	return time.Now().UTC()
}

func textFromContent(content any) string {
	switch value := content.(type) {
	case string:
		return strings.TrimSpace(value)
	case []any:
		parts := make([]string, 0)
		for _, item := range value {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if stringValue(obj, "type") == "text" && stringValue(obj, "text") != "" {
				parts = append(parts, stringValue(obj, "text"))
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	default:
		return ""
	}
}

func countContentImages(content any) int {
	items, ok := content.([]any)
	if !ok {
		return 0
	}
	total := 0
	for _, item := range items {
		total += countContentItemImages(item)
	}
	return total
}

func countContentItemImages(item any) int {
	obj, ok := item.(map[string]any)
	if !ok {
		return 0
	}
	itemType := stringValue(obj, "type")
	if itemType == "image" || itemType == "input_image" {
		return 1
	}
	if obj["image_url"] != nil || obj["image"] != nil {
		return 1
	}
	if strings.HasPrefix(stringValue(obj, "url"), "data:image/") {
		return 1
	}
	if strings.HasPrefix(stringValue(obj, "media_type"), "image/") || strings.HasPrefix(stringValue(obj, "mimeType"), "image/") {
		return 1
	}
	if nested, ok := obj["content"].([]any); ok {
		return countContentImages(nested)
	}
	return 0
}

func objectValue(obj map[string]any, key string) map[string]any {
	if obj == nil {
		return map[string]any{}
	}
	value, ok := obj[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return value
}

func stringValue(obj map[string]any, key string) string {
	if obj == nil {
		return ""
	}
	value, ok := obj[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func int64Value(obj map[string]any, key string) int64 {
	if obj == nil {
		return 0
	}
	switch value := obj[key].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	case int:
		return int64(value)
	case json.Number:
		n, _ := value.Int64()
		return n
	default:
		return 0
	}
}

func floatValue(obj map[string]any, key string) float64 {
	value, _ := optionalFloat(obj, key)
	return value
}

func optionalFloat(obj map[string]any, key string) (float64, bool) {
	if obj == nil {
		return 0, false
	}
	switch value := obj[key].(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	default:
		return 0, false
	}
}

func arrayLen(obj map[string]any, key string) int {
	items, ok := obj[key].([]any)
	if !ok {
		return 0
	}
	return len(items)
}

func shortSession(file string) string {
	base := filepath.Base(file)
	base = strings.TrimPrefix(base, "rollout-")
	return strings.TrimSuffix(base, ".jsonl")
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

func claudeProjectFromFile(file string) string {
	parts := strings.Split(filepath.Clean(file), string(filepath.Separator))
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] == "projects" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return filepath.Base(filepath.Dir(file))
}

func logicalKey(source string, projectPath string, project string, fallbackSession string) string {
	value := firstNonEmpty(projectPath, project, fallbackSession, "unknown")
	return source + ":" + value
}

func logicalLabel(projectPath string, project string, fallbackSession string) string {
	return firstNonEmpty(basenameOrUnknown(projectPath), project, fallbackSession, "unknown")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func stableHash(value string) string {
	var hash uint32 = 5381
	for _, ch := range value {
		hash = ((hash << 5) + hash + uint32(ch))
	}
	return strings.ToLower(strconvFormatUint(uint64(hash), 36))
}

func strconvFormatUint(value uint64, base int) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	if value == 0 {
		return "0"
	}
	out := make([]byte, 0)
	for value > 0 {
		out = append([]byte{digits[value%uint64(base)]}, out...)
		value /= uint64(base)
	}
	return string(out)
}

func int64Ptr(value int64) *int64 {
	if value == 0 {
		return nil
	}
	return &value
}

func floatPtr(value float64) *float64 {
	if value == 0 {
		return nil
	}
	return &value
}
