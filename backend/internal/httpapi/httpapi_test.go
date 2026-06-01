package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"live-token-monitor/internal/config"
	"live-token-monitor/internal/domain"
	"live-token-monitor/internal/service"
	"live-token-monitor/internal/store"
)

func TestEventsEndpoint(t *testing.T) {
	handler := testHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v2/events?range=all", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"events"`) || !strings.Contains(rec.Body.String(), `"projectName":"demo"`) {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestInvalidRange(t *testing.T) {
	handler := testHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v2/events?range=bad", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", rec.Code)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	handler := testHandler(t)
	eventsReq := httptest.NewRequest(http.MethodGet, "/api/v2/events?range=all", nil)
	eventsRec := httptest.NewRecorder()
	handler.ServeHTTP(eventsRec, eventsReq)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		`live_token_monitor_up 1`,
		`live_token_monitor_events{source="all"} 1`,
		`live_token_monitor_events{source="codex"} 1`,
		`live_token_monitor_tokens{source="all",kind="total"} 3`,
		`live_token_monitor_http_requests_total{method="GET",route="/api/v2/events",status="200"} 1`,
		`live_token_monitor_http_request_duration_seconds_count{method="GET",route="/api/v2/events"} 1`,
		`live_token_monitor_http_requests_in_flight 0`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in body=%s", want, body)
		}
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
		t.Fatalf("content-type=%q", got)
	}
}

func TestCORSPreflight(t *testing.T) {
	handler := testHandler(t)
	req := httptest.NewRequest(http.MethodOptions, "/api/v2/events", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:5173" {
		t.Fatalf("cors=%q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func testHandler(t *testing.T) http.Handler {
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
	if err := st.UpsertEvents(context.Background(), []domain.Event{{
		ID:          "e1",
		Source:      domain.SourceCodex,
		Timestamp:   time.Now().UTC(),
		ProjectID:   "codex:/work/demo",
		ProjectName: "demo",
		ProjectPath: "/work/demo",
		SessionID:   "codex:/work/demo",
		SessionName: "demo",
		Session:     "s1",
		File:        "/tmp/s1.jsonl",
		Model:       "gpt",
		Input:       1,
		Output:      2,
		Total:       3,
	}}); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		DBPath:            ":memory:",
		MaxPoints:         260,
		HistoryMaxPoints:  1000,
		FileRefresh:       time.Hour,
		CORSOrigins:       []string{"http://127.0.0.1:5173"},
		MaxFilesPerSource: 1000,
	}
	svc := service.New(cfg, st)
	return New(svc, cfg.CORSOrigins)
}
