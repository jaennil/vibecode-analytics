package service

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"live-token-monitor/internal/config"
	"live-token-monitor/internal/store"
)

func TestRefreshSkipsUnchangedFiles(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	session := filepath.Join(root, "session.jsonl")
	text := []byte(`{"type":"session_meta","timestamp":"2026-05-01T10:00:00Z","payload":{"cwd":"/work/demo"}}
{"type":"turn_context","timestamp":"2026-05-01T10:00:01Z","payload":{"cwd":"/work/demo","model":"gpt-5"}}
{"type":"event_msg","timestamp":"2026-05-01T10:01:00Z","payload":{"type":"user_message","message":"hello"}}
{"type":"event_msg","timestamp":"2026-05-01T10:01:05Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":120}}}}`)
	if err := os.WriteFile(session, text, 0o644); err != nil {
		t.Fatal(err)
	}

	svc := newTestService(t, root)
	first, err := svc.Refresh(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if first.Files != 1 || first.Events != 1 || first.Prompts != 1 {
		t.Fatalf("first refresh=%+v, want one parsed file", first)
	}

	second, err := svc.Refresh(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if second.Files != 1 || second.Events != 0 || second.Prompts != 0 {
		t.Fatalf("second refresh=%+v, want unchanged file skipped", second)
	}

	if err := os.WriteFile(session, append(text, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(session, time.Now().Add(time.Second), time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	third, err := svc.Refresh(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if third.Files != 1 || third.Events != 1 || third.Prompts != 1 {
		t.Fatalf("third refresh=%+v, want changed file parsed", third)
	}
}

func newTestService(t *testing.T, codexRoot string) *Service {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	st := store.OpenDB(db)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(config.Config{
		CodexRoots:        []string{codexRoot},
		MaxTailBytes:      1024 * 1024,
		MaxFilesPerSource: 100,
		FileRefresh:       time.Hour,
	}, st)
}
