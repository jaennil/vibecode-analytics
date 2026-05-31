# Repository Guidelines

## Working Agreements

- Write all git commit messages in Conventional Commits format.
- Commit message should be 50 characters, no description.

## Project Structure & Module Organization

This is a local token-usage dashboard split into `backend/` and `frontend/`.
The Go backend lives under `backend/cmd/api` and `backend/internal/`: config
loading, JSONL log discovery, Codex/Claude parsing, SQLite storage, refresh
orchestration, and HTTP handlers. The frontend lives under `frontend/src/` and
is built with React, TypeScript, Vite, and ECharts. Runtime state is stored in
`data/usage.db`; legacy `data/usage-history.jsonl` is imported once when
present.

## Build, Test, and Development Commands

- `docker compose up`: run the API and Vite frontend together.
- `cd backend && go run ./cmd/api`: run the Go API on `http://127.0.0.1:8787`.
- `cd frontend && npm run dev`: run the Vite frontend on `http://127.0.0.1:5173`.
- `cd backend && go test ./...`: run backend tests.
- `cd frontend && npm test`: run frontend unit tests.
- `cd frontend && npm run build`: type-check and build the frontend.

Useful API environment variables include `PORT`, `DB_PATH`, `MAX_TAIL_BYTES`,
`HISTORY_DAYS`, `HISTORY_MAX_POINTS`, `MAX_FILES_PER_SOURCE`, `FILE_REFRESH_MS`,
`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `CORS_ORIGINS`.

## Coding Style & Naming Conventions

Use idiomatic Go with small packages, table-driven tests where useful, and
explicit error handling. Keep parser logic pure and filesystem-free. Use React
function components with TypeScript types for API DTOs. Prefer explicit state
and selectors over hidden global behavior. CSS class names should be lowercase
and hyphenated.

## Testing Guidelines

Backend changes should include focused `go test ./...` coverage for parser,
discovery, storage, service, or HTTP behavior. Frontend changes should include
Vitest coverage for selectors, API client behavior, or component logic where
practical. For visible changes, run the app with Docker Compose and manually
verify dashboard, project, session, detail, raw-data, filters, and polling.

## Security & Configuration Tips

The app reads local Codex and Claude JSONL logs and must not transmit them
externally. Avoid committing runtime DB files, private paths, prompts, tokens,
or generated data from `data/`. Keep dependencies minimal and explain new ones.
