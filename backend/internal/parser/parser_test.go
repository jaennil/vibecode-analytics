package parser

import (
	"testing"
	"time"

	"live-token-monitor/internal/domain"
)

func TestParseCodexEventAndPrompt(t *testing.T) {
	text := []byte(`{"type":"session_meta","timestamp":"2026-05-01T10:00:00Z","payload":{"cwd":"/work/demo"}}
{"type":"turn_context","timestamp":"2026-05-01T10:00:01Z","payload":{"cwd":"/work/demo","model":"gpt-5"}}
{"type":"event_msg","timestamp":"2026-05-01T10:01:00Z","payload":{"type":"user_message","message":"hello","images":["a"]}}
{"type":"event_msg","timestamp":"2026-05-01T10:01:05Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120},"total_token_usage":{"total_tokens":300},"model_context_window":1000},"rate_limits":{"primary":{"used_percent":12.5},"secondary":{"used_percent":50}}}}`)

	parsed := ParseSession(domain.SourceCodex, "/tmp/rollout-abc.jsonl", time.Unix(0, 0), int64(len(text)), text)
	if len(parsed.Events) != 1 {
		t.Fatalf("events=%d, want 1", len(parsed.Events))
	}
	if len(parsed.Prompts) != 1 {
		t.Fatalf("prompts=%d, want 1", len(parsed.Prompts))
	}
	event := parsed.Events[0]
	if event.ProjectName != "demo" || event.ProjectPath != "/work/demo" {
		t.Fatalf("project=%q path=%q", event.ProjectName, event.ProjectPath)
	}
	if event.Model != "gpt-5" {
		t.Fatalf("model=%q", event.Model)
	}
	if event.Input != 60 || event.CacheRead != 40 || event.Output != 20 || event.Reasoning != 5 || event.Total != 120 {
		t.Fatalf("bad event tokens: %+v", event)
	}
	if event.ContextPercent == nil || *event.ContextPercent != 10 {
		t.Fatalf("context percent=%v", event.ContextPercent)
	}
	if parsed.Prompts[0].Text != "hello" || parsed.Prompts[0].ImageCount != 1 {
		t.Fatalf("prompt=%+v", parsed.Prompts[0])
	}
}

func TestParseClaudeEventAndPrompt(t *testing.T) {
	text := []byte(`{"type":"user","timestamp":"2026-05-01T11:00:00Z","uuid":"u1","sessionId":"s1","cwd":"/repo/app","message":{"role":"user","content":[{"type":"text","text":"fix it"},{"type":"image","source":"x"}]}}
{"timestamp":"2026-05-01T11:00:05Z","requestId":"r1","sessionId":"s1","cwd":"/repo/app","message":{"id":"m1","model":"claude-opus","usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":7,"output_tokens":20}},"context_window":{"context_window_size":200000,"used_percentage":3.5}}`)

	parsed := ParseSession(domain.SourceClaude, "/tmp/projects/app/session.jsonl", time.Unix(0, 0), int64(len(text)), text)
	if len(parsed.Events) != 1 {
		t.Fatalf("events=%d, want 1", len(parsed.Events))
	}
	if len(parsed.Prompts) != 1 {
		t.Fatalf("prompts=%d, want 1", len(parsed.Prompts))
	}
	event := parsed.Events[0]
	if event.Input != 10 || event.CacheCreate != 5 || event.CacheRead != 7 || event.Output != 20 || event.Total != 42 {
		t.Fatalf("bad event tokens: %+v", event)
	}
	if event.Session != "s1" || event.ProjectName != "app" {
		t.Fatalf("bad ids: %+v", event)
	}
	if parsed.Prompts[0].Text != "fix it" || parsed.Prompts[0].ImageCount != 1 {
		t.Fatalf("prompt=%+v", parsed.Prompts[0])
	}
}

func TestParseJSONLinesIgnoresMalformedRows(t *testing.T) {
	rows := ParseJSONLines([]byte("{bad\n{\"ok\":true}\n"))
	if len(rows) != 1 {
		t.Fatalf("rows=%d, want 1", len(rows))
	}
}
