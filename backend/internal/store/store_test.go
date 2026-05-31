package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"live-token-monitor/internal/domain"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	store := OpenDB(db)
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestUpsertAndQueryEvents(t *testing.T) {
	store := testStore(t)
	event := fixtureEvent("e1", time.Now().UTC())
	if err := store.UpsertEvents(context.Background(), []domain.Event{event, event}); err != nil {
		t.Fatal(err)
	}
	events, err := store.Events(context.Background(), domain.Query{Range: "all"}, 260, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events=%d, want 1", len(events))
	}
	if events[0].ID != "e1" || events[0].Input != 10 {
		t.Fatalf("event=%+v", events[0])
	}
}

func TestImportHistoryJSONLDedupes(t *testing.T) {
	store := testStore(t)
	history := filepath.Join(t.TempDir(), "usage-history.jsonl")
	line := `{"kind":"point","data":{"id":"e1","source":"codex","timestamp":"2026-05-01T10:00:00Z","project":"demo","projectPath":"/work/demo","sessionKey":"codex:/work/demo","sessionLabel":"demo","session":"s1","file":"/tmp/s1.jsonl","model":"gpt","input":1,"output":2,"total":3}}`
	if err := os.WriteFile(history, []byte(line+"\n"+line+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	events, prompts, err := store.ImportHistoryJSONL(context.Background(), history)
	if err != nil {
		t.Fatal(err)
	}
	if events != 2 || prompts != 0 {
		t.Fatalf("import counts events=%d prompts=%d", events, prompts)
	}
	rows, err := store.Events(context.Background(), domain.Query{Range: "all"}, 260, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("stored rows=%d, want 1", len(rows))
	}
	if rows[0].ProjectName != "demo" || rows[0].SessionID != "codex:/work/demo" {
		t.Fatalf("legacy fields not imported: %+v", rows[0])
	}
	events, prompts, err = store.ImportHistoryJSONL(context.Background(), history)
	if err != nil {
		t.Fatal(err)
	}
	if events != 0 || prompts != 0 {
		t.Fatalf("second import counts events=%d prompts=%d", events, prompts)
	}
}

func TestSummaryComputesTotals(t *testing.T) {
	store := testStore(t)
	if err := store.UpsertEvents(context.Background(), []domain.Event{
		fixtureEvent("e1", time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)),
		fixtureEvent("e2", time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)),
	}); err != nil {
		t.Fatal(err)
	}
	summary, err := store.Summary(context.Background(), domain.Query{Range: "all"}, 260, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Events != 2 || summary.Totals.NewTokens != 24 || len(summary.Daily) != 1 {
		t.Fatalf("summary=%+v", summary)
	}
}

func fixtureEvent(id string, ts time.Time) domain.Event {
	return domain.Event{
		ID:          id,
		Source:      domain.SourceCodex,
		Timestamp:   ts,
		ProjectID:   "codex:/work/demo",
		ProjectName: "demo",
		ProjectPath: "/work/demo",
		SessionID:   "codex:/work/demo",
		SessionName: "demo",
		Session:     "s1",
		File:        "/tmp/s1.jsonl",
		Model:       "gpt",
		Input:       10,
		Output:      2,
		Total:       12,
	}
}
