# Live Token Monitor

Local dashboard for Codex CLI and Claude Code token usage. The app is split into
a Go API, a SQLite history database, and a React/Vite frontend.

## Run

```bash
docker compose up
```

Open:

```text
http://127.0.0.1:5173
```

The Go API listens on `http://127.0.0.1:8787`. In Compose, Vite proxies
`/api` requests to the `api` service.

## Layout

- `backend/`: Go API, JSONL parsing, SQLite storage, and API tests.
- `frontend/`: React, TypeScript, Vite, ECharts, and frontend tests.
- `data/`: local generated history and SQLite database files.

## Local Development Without Docker

Run the API:

```bash
cd backend
go run ./cmd/api
```

Run the frontend:

```bash
cd frontend
npm install
npm run dev
```

## What It Reads

- Codex: `${CODEX_HOME:-~/.codex}/sessions/**/*.jsonl`
- Claude Code: `~/.config/claude/projects/**/*.jsonl` and `~/.claude/projects/**/*.jsonl`
- Claude Code override: `${CLAUDE_CONFIG_DIR}/projects/**/*.jsonl`

The API reads only local log tails and stores parsed history locally. It does not
transmit prompts, paths, tokens, or logs externally.

## API

- `GET /api/v2/health`
- `POST /api/v2/refresh`
- `GET /api/v2/events?range=24h|7d|30d|all|live&source=all|codex|claude`
- `GET /api/v2/prompts?range=...`
- `GET /api/v2/projects?range=...`
- `GET /api/v2/sessions?range=...`
- `GET /api/v2/summary?range=...`

All list endpoints also accept `projectId` and `sessionId`.

## Storage

SQLite history is stored at `data/usage.db` by default. On first startup, the
API imports `data/usage-history.jsonl` if it exists, deduping by record id.

## Useful Env Vars

```bash
PORT=8790 go run ./cmd/api
DB_PATH=../data/usage.db go run ./cmd/api
MAX_TAIL_BYTES=67108864 go run ./cmd/api
HISTORY_DAYS=180 go run ./cmd/api
HISTORY_MAX_POINTS=200000 go run ./cmd/api
MAX_FILES_PER_SOURCE=50 go run ./cmd/api
CODEX_HOME="$HOME/.codex,$HOME/codex-exec-logs" go run ./cmd/api
CLAUDE_CONFIG_DIR="$HOME/.claude" go run ./cmd/api
```

## Checks

```bash
cd backend
go test ./...

cd ../frontend
npm test
npm run build
```
