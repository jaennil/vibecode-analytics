# Live Token Monitor

Local live dashboard for Codex CLI and Claude Code token spikes.

## Run

```bash
npm install
node server.js
```

Open:

```text
http://127.0.0.1:8787
```

## What It Reads

- Codex: `${CODEX_HOME:-~/.codex}/sessions/**/*.jsonl`
- Claude Code: `~/.config/claude/projects/**/*.jsonl` and `~/.claude/projects/**/*.jsonl`

The dashboard reads only local log tails. It does not send data anywhere.

## Useful Env Vars

```bash
PORT=8790 node server.js
MAX_TAIL_BYTES=67108864 node server.js
HISTORY_DAYS=180 node server.js
HISTORY_MAX_POINTS=200000 node server.js
MAX_FILES_PER_SOURCE=50 node server.js
CODEX_HOME="$HOME/.codex,$HOME/codex-exec-logs" node server.js
CLAUDE_CONFIG_DIR="$HOME/.claude" node server.js
```

By default the monitor scans up to 1000 recent JSONL sessions per source and
reads the last 4MB of each file. Lower `MAX_FILES_PER_SOURCE` if startup becomes
too slow, or raise `MAX_TAIL_BYTES` for a one-time deeper backfill.

## Reading the Charts

- Each mini chart shows new tokens per turn for one source and project.
- Hover a chart point to see the exact timestamp and token breakdown.
- Open a project to inspect separate lines for new tokens, fresh input, cache
  write, output, reasoning, and cache read.
- Prompt markers show user messages. One prompt can still cause many model calls
  after it.
- The daily trend chart compares total spend and average spend per model call
  across the selected range.
- Summary metrics and the daily trend use every indexed session in the selected
  range. Project charts are lazy: the first page renders the 3 most recent Codex
  projects and the 3 most recent Claude projects. Use pagination or chart search
  to open older projects without rendering every chart at once.
- Hover metric names to see their definitions.

New tokens include fresh input, cache writes, output, and reasoning. Cache reads
are shown in the hover tooltip but excluded from the line because they are reused
tokens. Red dots mark the largest new-token event on each chart.

History is stored locally in `data/usage-history.jsonl` for `HISTORY_DAYS`
days. The file is ignored by git and never leaves the machine.

Events are grouped by source (`codex` or `claude`) and by the project directory
recorded in the session metadata or transcript `cwd`.
