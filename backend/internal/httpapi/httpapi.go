package httpapi

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"live-token-monitor/internal/domain"
	"live-token-monitor/internal/service"
)

//go:embed static/openapi.json
var openAPISpec []byte

//go:embed static/swagger.html
var swaggerPage []byte

type API struct {
	service *service.Service
	origins map[string]bool
	metrics *httpMetrics
}

func New(svc *service.Service, corsOrigins []string) http.Handler {
	api := &API{service: svc, origins: map[string]bool{}, metrics: newHTTPMetrics()}
	for _, origin := range corsOrigins {
		api.origins[origin] = true
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/swagger", api.handleSwaggerRedirect)
	mux.HandleFunc("/swagger/", api.handleSwagger)
	mux.HandleFunc("/openapi.json", api.handleOpenAPI)
	mux.HandleFunc("/api/v2/health", api.handleHealth)
	mux.HandleFunc("/metrics", api.handleMetrics)
	mux.HandleFunc("/api/v2/refresh", api.handleRefresh)
	mux.HandleFunc("/api/v2/events", api.handleEvents)
	mux.HandleFunc("/api/v2/prompts", api.handlePrompts)
	mux.HandleFunc("/api/v2/projects", api.handleProjects)
	mux.HandleFunc("/api/v2/sessions", api.handleSessions)
	mux.HandleFunc("/api/v2/summary", api.handleSummary)
	mux.HandleFunc("/api/v2/dashboard", api.handleDashboard)
	return api.cors(api.observe(mux))
}

func (a *API) handleSwaggerRedirect(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	http.Redirect(w, r, "/swagger/", http.StatusMovedPermanently)
}

func (a *API) handleSwagger(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(swaggerPage)
}

func (a *API) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(openAPISpec)
}

func (a *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if a.origins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, a.service.Health())
}

func (a *API) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	metrics, err := a.service.Metrics(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, prometheusText(metrics))
	fmt.Fprint(w, a.metrics.prometheusText())
}

func (a *API) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodPost) {
		return
	}
	result, err := a.service.Refresh(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) handleEvents(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	events, err := a.service.Events(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (a *API) handlePrompts(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	prompts, err := a.service.Prompts(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"prompts": prompts})
}

func (a *API) handleProjects(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	projects, err := a.service.Projects(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (a *API) handleSessions(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	sessions, err := a.service.Sessions(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (a *API) handleSummary(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	summary, err := a.service.Summary(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (a *API) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, http.MethodGet) {
		return
	}
	query, ok := parseQuery(w, r)
	if !ok {
		return
	}
	dashboard, err := a.service.Dashboard(r.Context(), query)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dashboard)
}

func parseQuery(w http.ResponseWriter, r *http.Request) (domain.Query, bool) {
	values := r.URL.Query()
	query := domain.Query{
		Range:     firstNonEmpty(values.Get("range"), "24h"),
		Source:    firstNonEmpty(values.Get("source"), "all"),
		ProjectID: values.Get("projectId"),
		SessionID: values.Get("sessionId"),
	}
	if !validRange(query.Range) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid range"})
		return domain.Query{}, false
	}
	if !validSource(query.Source) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid source"})
		return domain.Query{}, false
	}
	return query, true
}

func validRange(value string) bool {
	switch value {
	case "live", "24h", "7d", "30d", "all":
		return true
	default:
		return false
	}
}

func validSource(value string) bool {
	switch strings.ToLower(value) {
	case "all", "", domain.SourceCodex, domain.SourceClaude:
		return true
	default:
		return false
	}
}

func method(w http.ResponseWriter, r *http.Request, want string) bool {
	if r.Method == want {
		return true
	}
	w.Header().Set("Allow", want)
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	return false
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

func prometheusText(metrics service.Metrics) string {
	var b strings.Builder
	writeMetricHeader(&b, "live_token_monitor_up", "API health status.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_up %d\n", boolValue(metrics.Health.Status == "ok"))
	writeMetricHeader(&b, "live_token_monitor_last_refresh_timestamp_seconds", "Unix timestamp of the latest successful file refresh.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_last_refresh_timestamp_seconds %.0f\n", unixSeconds(metrics.Health.LastRefresh))
	writeMetricHeader(&b, "live_token_monitor_last_refresh_files", "Files scanned in the latest refresh.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_last_refresh_files %d\n", metrics.Health.LastFiles)
	writeMetricHeader(&b, "live_token_monitor_last_refresh_events", "Events parsed in the latest refresh.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_last_refresh_events %d\n", metrics.Health.LastEvents)
	writeMetricHeader(&b, "live_token_monitor_last_refresh_prompts", "Prompts parsed in the latest refresh.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_last_refresh_prompts %d\n", metrics.Health.LastPrompts)
	writeMetricHeader(&b, "live_token_monitor_events", "Stored token usage events by source.", "gauge")
	for _, source := range metrics.Sources {
		fmt.Fprintf(&b, "live_token_monitor_events{source=%q} %d\n", source.Source, source.Summary.Events)
	}
	writeMetricHeader(&b, "live_token_monitor_prompts", "Stored prompts by source.", "gauge")
	for _, source := range metrics.Sources {
		fmt.Fprintf(&b, "live_token_monitor_prompts{source=%q} %d\n", source.Source, source.Summary.Prompts)
	}
	writeMetricHeader(&b, "live_token_monitor_tokens", "Stored token counts by source and token category.", "gauge")
	for _, source := range metrics.Sources {
		writeTokenMetric(&b, source.Source, "new", source.Summary.Totals.NewTokens)
		writeTokenMetric(&b, source.Source, "input", source.Summary.Totals.Input)
		writeTokenMetric(&b, source.Source, "cache_create", source.Summary.Totals.CacheCreate)
		writeTokenMetric(&b, source.Source, "cache_read", source.Summary.Totals.CacheRead)
		writeTokenMetric(&b, source.Source, "output", source.Summary.Totals.Output)
		writeTokenMetric(&b, source.Source, "reasoning", source.Summary.Totals.Reasoning)
		writeTokenMetric(&b, source.Source, "total", source.Summary.Totals.Total)
	}
	return b.String()
}

func writeMetricHeader(b *strings.Builder, name string, help string, typ string) {
	fmt.Fprintf(b, "# HELP %s %s\n", name, help)
	fmt.Fprintf(b, "# TYPE %s %s\n", name, typ)
}

func writeTokenMetric(b *strings.Builder, source string, kind string, value int64) {
	fmt.Fprintf(b, "live_token_monitor_tokens{source=%q,kind=%q} %d\n", source, kind, value)
}

func boolValue(value bool) int {
	if value {
		return 1
	}
	return 0
}

func unixSeconds(value time.Time) float64 {
	if value.IsZero() {
		return 0
	}
	return float64(value.UnixNano()) / float64(time.Second)
}

var latencyBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

type httpMetricKey struct {
	method string
	route  string
	status int
}

type httpLatencyKey struct {
	method string
	route  string
}

type httpLatency struct {
	count   uint64
	sum     float64
	buckets []uint64
}

type httpMetrics struct {
	mu       sync.Mutex
	inFlight int
	requests map[httpMetricKey]uint64
	latency  map[httpLatencyKey]*httpLatency
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func newHTTPMetrics() *httpMetrics {
	return &httpMetrics{
		requests: map[httpMetricKey]uint64{},
		latency:  map[httpLatencyKey]*httpLatency{},
	}
}

func (a *API) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		a.metrics.changeInFlight(1)
		defer a.metrics.changeInFlight(-1)
		writer := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(writer, r)
		a.metrics.observe(r.Method, routeLabel(r.URL.Path), writer.status, time.Since(start))
	})
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (m *httpMetrics) changeInFlight(delta int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inFlight += delta
}

func (m *httpMetrics) observe(method string, route string, status int, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests[httpMetricKey{method: method, route: route, status: status}]++
	key := httpLatencyKey{method: method, route: route}
	latency := m.latency[key]
	if latency == nil {
		latency = &httpLatency{buckets: make([]uint64, len(latencyBuckets))}
		m.latency[key] = latency
	}
	seconds := duration.Seconds()
	latency.count++
	latency.sum += seconds
	for i, bucket := range latencyBuckets {
		if seconds <= bucket {
			latency.buckets[i]++
		}
	}
}

func (m *httpMetrics) prometheusText() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var b strings.Builder
	writeMetricHeader(&b, "live_token_monitor_http_requests_total", "HTTP requests by method, route, and status.", "counter")
	for key, count := range m.requests {
		fmt.Fprintf(&b, "live_token_monitor_http_requests_total{method=%q,route=%q,status=%q} %d\n", key.method, key.route, strconv.Itoa(key.status), count)
	}
	writeMetricHeader(&b, "live_token_monitor_http_request_duration_seconds", "HTTP request latency by method and route.", "histogram")
	for key, latency := range m.latency {
		for i, count := range latency.buckets {
			fmt.Fprintf(&b, "live_token_monitor_http_request_duration_seconds_bucket{method=%q,route=%q,le=%q} %d\n", key.method, key.route, strconv.FormatFloat(latencyBuckets[i], 'f', -1, 64), count)
		}
		fmt.Fprintf(&b, "live_token_monitor_http_request_duration_seconds_bucket{method=%q,route=%q,le=\"+Inf\"} %d\n", key.method, key.route, latency.count)
		fmt.Fprintf(&b, "live_token_monitor_http_request_duration_seconds_sum{method=%q,route=%q} %g\n", key.method, key.route, latency.sum)
		fmt.Fprintf(&b, "live_token_monitor_http_request_duration_seconds_count{method=%q,route=%q} %d\n", key.method, key.route, latency.count)
	}
	writeMetricHeader(&b, "live_token_monitor_http_requests_in_flight", "HTTP requests currently being served.", "gauge")
	fmt.Fprintf(&b, "live_token_monitor_http_requests_in_flight %d\n", m.inFlight)
	return b.String()
}

func routeLabel(path string) string {
	switch path {
	case "/api/v2/health", "/api/v2/refresh", "/api/v2/events", "/api/v2/prompts", "/api/v2/projects", "/api/v2/sessions", "/api/v2/summary", "/api/v2/dashboard":
		return path
	default:
		return "unknown"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
