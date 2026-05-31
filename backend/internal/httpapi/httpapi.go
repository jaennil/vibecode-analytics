package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"live-token-monitor/internal/domain"
	"live-token-monitor/internal/service"
)

type API struct {
	service *service.Service
	origins map[string]bool
}

func New(svc *service.Service, corsOrigins []string) http.Handler {
	api := &API{service: svc, origins: map[string]bool{}}
	for _, origin := range corsOrigins {
		api.origins[origin] = true
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/health", api.handleHealth)
	mux.HandleFunc("/api/v2/refresh", api.handleRefresh)
	mux.HandleFunc("/api/v2/events", api.handleEvents)
	mux.HandleFunc("/api/v2/prompts", api.handlePrompts)
	mux.HandleFunc("/api/v2/projects", api.handleProjects)
	mux.HandleFunc("/api/v2/sessions", api.handleSessions)
	mux.HandleFunc("/api/v2/summary", api.handleSummary)
	return api.cors(mux)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
