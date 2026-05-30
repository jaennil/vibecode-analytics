const fs = require("fs");
const path = require("path");
const http = require("http");

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const PORT = Number(process.env.PORT || 8787);
const MAX_TAIL_BYTES = Number(process.env.MAX_TAIL_BYTES || 4 * 1024 * 1024);
const MAX_POINTS = Number(process.env.MAX_POINTS || 260);
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS || 90);
const HISTORY_MAX_POINTS = Number(process.env.HISTORY_MAX_POINTS || 100000);
const MAX_FILES_PER_SOURCE = Number(process.env.MAX_FILES_PER_SOURCE || 1000);
const FILE_REFRESH_MS = Number(process.env.FILE_REFRESH_MS || 5000);

const PUBLIC_DIR = path.join(__dirname, "public");
const ECHARTS_FILE = path.join(__dirname, "node_modules", "echarts", "dist", "echarts.min.js");
const HISTORY_FILE = path.join(__dirname, "data", "usage-history.jsonl");

let fileCache = {
  at: 0,
  codex: [],
  claude: [],
};
let rowCache = new Map();
let sessionCache = new Map();

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function walkJsonl(root, out, maxDepth = 8, depth = 0) {
  if (!root || depth > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, out, maxDepth, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const stat = safeStat(full);
      if (stat) out.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
}

function latestFiles(roots, limit) {
  const files = [];
  for (const root of roots) walkJsonl(root, files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, limit);
}

function getCodexRoots() {
  const raw = process.env.CODEX_HOME || path.join(HOME, ".codex");
  return raw
    .split(",")
    .map((part) => expandHome(part.trim()))
    .filter(Boolean)
    .map((root) => {
      const sessions = path.join(root, "sessions");
      return fs.existsSync(sessions) ? sessions : root;
    });
}

function getClaudeRoots() {
  const raw = process.env.CLAUDE_CONFIG_DIR;
  if (raw) {
    return raw
      .split(",")
      .map((part) => expandHome(part.trim()))
      .filter(Boolean)
      .map((root) => {
        const projects = path.join(root, "projects");
        return fs.existsSync(projects) ? projects : root;
      });
  }

  return [
    path.join(HOME, ".config", "claude", "projects"),
    path.join(HOME, ".claude", "projects"),
  ];
}

function refreshFileCache() {
  const now = Date.now();
  if (now - fileCache.at < FILE_REFRESH_MS) return fileCache;

  fileCache = {
    at: now,
    codex: latestFiles(getCodexRoots(), MAX_FILES_PER_SOURCE),
    claude: latestFiles(getClaudeRoots(), MAX_FILES_PER_SOURCE),
  };
  return fileCache;
}

function readTail(file, maxBytes = MAX_TAIL_BYTES) {
  const stat = safeStat(file);
  if (!stat || stat.size <= 0) return "";

  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function shortSession(file) {
  return path.basename(file).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
}

function basenameOrUnknown(value) {
  if (!value) return "unknown";
  return path.basename(value.replace(/\/+$/, "")) || value || "unknown";
}

function claudeProjectFromFile(file) {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf("projects");
  const encoded = idx >= 0 ? parts[idx + 1] : path.basename(path.dirname(file));
  if (!encoded) return { project: "unknown", projectPath: "" };
  return { project: encoded, projectPath: encoded };
}

function extractClaudeFileInfo(rows, file) {
  let cwd = "";
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.cwd) {
      cwd = rows[i].cwd;
      break;
    }
  }
  if (cwd) return { project: basenameOrUnknown(cwd), projectPath: cwd };
  const fallback = claudeProjectFromFile(file);
  return { project: basenameOrUnknown(fallback.projectPath) || fallback.project, projectPath: fallback.projectPath };
}

function extractCodexSessionInfo(rows, file) {
  let cwd = "";
  let model = "";
  for (const row of rows) {
    const payload = row.payload || {};
    if (!cwd && row.type === "session_meta") cwd = payload.cwd || "";
    if (!cwd && row.type === "turn_context") cwd = payload.cwd || "";
    if (!model && row.type === "turn_context") model = payload.model || "";
    if (cwd && model) break;
  }
  return {
    project: basenameOrUnknown(cwd) || shortSession(file),
    projectPath: cwd,
    model,
  };
}

function parseJsonLines(file) {
  const stat = safeStat(file);
  const cacheKey = stat ? `${file}:${stat.size}:${stat.mtimeMs}` : file;
  if (rowCache.has(cacheKey)) return rowCache.get(cacheKey);

  const text = readTail(file);
  const rows = [];
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Ignore partial lines and huge non-JSON fragments from in-progress writes.
    }
  }
  rowCache = new Map([[cacheKey, rows], ...[...rowCache.entries()].slice(0, 11)]);
  return rows;
}

function stableHash(value) {
  let hash = 5381;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function countContentImages(content) {
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, item) => total + countContentItemImages(item), 0);
}

function countContentItemImages(item) {
  if (!item || typeof item !== "object") return 0;
  if (item.type === "image" || item.type === "input_image") return 1;
  if (item.image_url || item.image) return 1;
  if (typeof item.url === "string" && item.url.startsWith("data:image/")) return 1;
  if (typeof item.media_type === "string" && item.media_type.startsWith("image/")) return 1;
  if (typeof item.mimeType === "string" && item.mimeType.startsWith("image/")) return 1;
  if (Array.isArray(item.content)) return countContentImages(item.content);
  return 0;
}

function countArrayImages(value) {
  return Array.isArray(value) ? value.length : 0;
}

function parseCodexPoint(row, file, sessionInfo) {
  if (row.type !== "event_msg" || row.payload?.type !== "token_count") return null;
  const info = row.payload.info || {};
  const last = info.last_token_usage || {};
  const total = info.total_token_usage || {};
  const rate = row.payload.rate_limits || {};

  const totalInput = number(last.input_tokens);
  const cacheRead = number(last.cached_input_tokens);
  const freshInput = Math.max(0, totalInput - cacheRead);
  const output = number(last.output_tokens);
  const reasoning = number(last.reasoning_output_tokens);
  const turnTotal = number(last.total_tokens) || totalInput + output;

  const contextWindow = number(info.model_context_window);

  return {
    id: `${file}:${row.timestamp}:codex:${turnTotal}`,
    source: "codex",
    timestamp: row.timestamp || new Date().toISOString(),
    project: sessionInfo.project,
    projectPath: sessionInfo.projectPath,
    session: shortSession(file),
    file,
    model: sessionInfo.model || row.payload.turn_context?.model || "codex",
    input: freshInput,
    cacheCreate: 0,
    cacheRead,
    output,
    reasoning,
    total: turnTotal,
    cumulativeTotal: number(total.total_tokens),
    contextWindow,
    contextPercent: contextWindow ? Math.min(100, (totalInput / contextWindow) * 100) : null,
    fiveHourPercent: rate.primary?.used_percent ?? null,
    weeklyPercent: rate.secondary?.used_percent ?? null,
  };
}

function parseCodexPrompt(row, file, sessionInfo) {
  if (row.type === "event_msg" && row.payload?.type === "user_message") {
    const imageCount = countArrayImages(row.payload.images) + countArrayImages(row.payload.local_images);
    const text = String(row.payload.message || "").trim() || (imageCount ? "[image-only prompt]" : "");
    if (!text) return null;
    return {
      id: `${file}:prompt:${row.timestamp}:${stableHash(text)}`,
      source: "codex",
      timestamp: row.timestamp || new Date().toISOString(),
      project: sessionInfo.project,
      projectPath: sessionInfo.projectPath,
      session: shortSession(file),
      file,
      text,
      imageCount,
    };
  }

  if (row.type === "response_item" && row.payload?.type === "message" && row.payload.role === "user") {
    const imageCount = countContentImages(row.payload.content);
    const text = textFromContent(row.payload.content) || (imageCount ? "[image-only prompt]" : "");
    if (!text) return null;
    return {
      id: `${file}:prompt:${row.timestamp}:${stableHash(text)}`,
      source: "codex",
      timestamp: row.timestamp || new Date().toISOString(),
      project: sessionInfo.project,
      projectPath: sessionInfo.projectPath,
      session: shortSession(file),
      file,
      text,
      imageCount,
    };
  }

  return null;
}

function parseClaudePoint(row, file, fileInfo) {
  const usage = row.message?.usage;
  if (!usage) return null;

  const input = number(usage.input_tokens);
  const cacheCreate = number(usage.cache_creation_input_tokens);
  const cacheRead = number(usage.cache_read_input_tokens);
  const output = number(usage.output_tokens);
  const total = input + cacheCreate + cacheRead + output;
  if (total <= 0) return null;

  const contextWindow = number(row.context_window?.context_window_size);
  const contextPercent = row.context_window?.used_percentage ?? null;
  const projectPath = row.cwd || fileInfo.projectPath;

  return {
    id: `${file}:claude:${row.requestId || row.message?.id || row.uuid || row.timestamp || total}`,
    source: "claude",
    timestamp: row.timestamp || new Date().toISOString(),
    project: basenameOrUnknown(projectPath) || fileInfo.project,
    projectPath,
    session: row.sessionId || shortSession(file),
    file,
    model: row.message?.model || "claude",
    input,
    cacheCreate,
    cacheRead,
    output,
    reasoning: 0,
    total,
    cumulativeTotal: null,
    contextWindow: contextWindow || null,
    contextPercent: contextPercent == null ? null : Number(contextPercent),
    fiveHourPercent: null,
    weeklyPercent: null,
  };
}

function parseClaudePrompt(row, file, fileInfo) {
  if (row.type !== "user" || row.message?.role !== "user") return null;
  const projectPath = row.cwd || fileInfo.projectPath;
  const imageCount = countContentImages(row.message.content);
  const text = textFromContent(row.message.content).trim() || (imageCount ? "[image-only prompt]" : "");
  if (!text) return null;

  return {
    id: `${file}:prompt:${row.uuid || row.timestamp}:${stableHash(text)}`,
    source: "claude",
    timestamp: row.timestamp || new Date().toISOString(),
    project: basenameOrUnknown(projectPath),
    projectPath,
    session: row.sessionId || shortSession(file),
    file,
    text,
    imageCount,
  };
}

function fileProject(source, file) {
  const rows = parseJsonLines(file);
  if (source === "claude") {
    return extractClaudeFileInfo(rows, file);
  }

  return extractCodexSessionInfo(rows, file);
}

function groupFilesBySource(files) {
  const groups = { codex: {}, claude: {} };
  for (const source of ["codex", "claude"]) {
    for (const item of files[source]) {
      const key = item.projectPath || item.project;
      if (!groups[source][key]) {
        groups[source][key] = {
          source,
          project: item.project,
          projectPath: item.projectPath,
          files: [],
        };
      }
      groups[source][key].files.push(item);
    }
  }
  return groups;
}

function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const point of points) {
    if (!point || seen.has(point.id)) continue;
    seen.add(point.id);
    out.push(point);
  }
  return out;
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function ensureHistoryDir() {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
}

function readHistory() {
  let text = "";
  try {
    text = fs.readFileSync(HISTORY_FILE, "utf8");
  } catch {
    return { points: [], prompts: [] };
  }

  const points = [];
  const prompts = [];
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.kind === "point") points.push(record.data);
      if (record.kind === "prompt") prompts.push(record.data);
    } catch {
      // Ignore corrupt or partially written history lines.
    }
  }
  return { points, prompts };
}

function writeHistory(history) {
  ensureHistoryDir();
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const points = dedupeById(history.points)
    .filter((point) => new Date(point.timestamp).getTime() >= cutoff)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-HISTORY_MAX_POINTS);
  const prompts = dedupeById(history.prompts)
    .filter((prompt) => new Date(prompt.timestamp).getTime() >= cutoff)
    .map((prompt) => ({ imageCount: 0, ...prompt }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const lines = [
    ...points.map((point) => JSON.stringify({ kind: "point", data: point })),
    ...prompts.map((prompt) => JSON.stringify({ kind: "prompt", data: prompt })),
  ];
  fs.writeFileSync(HISTORY_FILE, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
  return { points, prompts };
}

function mergeHistory(currentPoints, currentPrompts) {
  const history = readHistory();
  return writeHistory({
    points: [...currentPoints, ...history.points],
    prompts: [...currentPrompts, ...history.prompts],
  });
}

function rangeMs(range) {
  if (range === "live") return null;
  if (range === "24h") return 24 * 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return 30 * 24 * 60 * 60 * 1000;
  if (range === "all") return Infinity;
  return 24 * 60 * 60 * 1000;
}

function filterRange(items, range) {
  const ms = rangeMs(range);
  if (ms === null) return items.slice(-MAX_POINTS);
  if (ms === Infinity) return items.slice(-HISTORY_MAX_POINTS);
  const cutoff = Date.now() - ms;
  return items.filter((item) => new Date(item.timestamp).getTime() >= cutoff).slice(-HISTORY_MAX_POINTS);
}

function parseSessionFile(source, item) {
  const cacheKey = `${source}:${item.file}`;
  const signature = `${item.size}:${item.mtimeMs}`;
  const cached = sessionCache.get(cacheKey);
  if (cached?.signature === signature) return cached.data;

  const rows = parseJsonLines(item.file);
  const info = source === "codex" ? extractCodexSessionInfo(rows, item.file) : extractClaudeFileInfo(rows, item.file);
  const points = [];
  const prompts = [];
  for (const row of rows) {
    const point = source === "codex" ? parseCodexPoint(row, item.file, info) : parseClaudePoint(row, item.file, info);
    if (point) points.push(point);
    const prompt = source === "codex" ? parseCodexPrompt(row, item.file, info) : parseClaudePrompt(row, item.file, info);
    if (prompt) prompts.push(prompt);
  }
  const data = { file: { ...item, source, ...info }, points, prompts };
  sessionCache.set(cacheKey, { signature, data });
  return data;
}

function collectPoints(range = "24h") {
  const files = refreshFileCache();
  const enrichedFiles = { codex: [], claude: [] };
  const points = [];
  const prompts = [];

  for (const item of files.codex) {
    const session = parseSessionFile("codex", item);
    enrichedFiles.codex.push(session.file);
    points.push(...session.points);
    prompts.push(...session.prompts);
  }

  for (const item of files.claude) {
    const session = parseSessionFile("claude", item);
    enrichedFiles.claude.push(session.file);
    points.push(...session.points);
    prompts.push(...session.prompts);
  }

  const sorted = dedupePoints(points).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const sortedPrompts = dedupeById(prompts).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const history = mergeHistory(sorted, sortedPrompts);
  const historyPoints = history.points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const historyPrompts = history.prompts.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return {
    generatedAt: new Date().toISOString(),
    range,
    points: filterRange(historyPoints, range),
    prompts: filterRange(historyPrompts, range),
    files: enrichedFiles,
    fileGroups: groupFilesBySource(enrichedFiles),
    config: {
      port: PORT,
      maxTailBytes: MAX_TAIL_BYTES,
      maxPoints: MAX_POINTS,
      historyDays: HISTORY_DAYS,
      historyFile: HISTORY_FILE,
      historyMaxPoints: HISTORY_MAX_POINTS,
      maxFilesPerSource: MAX_FILES_PER_SOURCE,
      codexRoots: getCodexRoots(),
      claudeRoots: getClaudeRoots(),
    },
  };
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(resolved),
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (parsed.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "max-age=86400" });
    res.end();
    return;
  }

  if (parsed.pathname === "/api/usage") {
    try {
      const data = collectPoints(parsed.searchParams.get("range") || "24h");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String(error?.stack || error) }));
    }
    return;
  }

  if (parsed.pathname === "/vendor/echarts.min.js") {
    fs.readFile(ECHARTS_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("ECharts is not installed");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(data);
    });
    return;
  }

  serveStatic(req, res, parsed.pathname || "/");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Live token monitor: http://127.0.0.1:${PORT}`);
});
