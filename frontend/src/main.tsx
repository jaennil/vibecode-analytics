import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { fetchDashboard } from "./api";
import {
  compactPath,
  filterGlobalChartWindow,
  findNearestEventForPrompt,
  formatAverage,
  formatNumber,
  newTokens,
  promptsForTurn,
  promptsInWindow,
  sortEventsByTime,
  tokenSums,
  visibleBreakdownRows,
} from "./selectors";
import type { DashboardData, Prompt, ProjectSummary, Range, SessionSummary, Source, TokenEvent } from "./types";
import "./styles.css";

type Tab = "dashboard" | "projects" | "sessions" | "detail" | "raw";
type GlobalChartMode = "breakdown" | "new" | "total" | "cacheRead";
type GlobalScaleMode = "log" | "linear";

const ranges: Array<{ value: Range; label: string }> = [
  { value: "live", label: "Live tail" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "Stored history" },
];

function App() {
  const [range, setRange] = useState<Range>("24h");
  const [source, setSource] = useState<Source>("all");
  const [projectId, setProjectId] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [detailSession, setDetailSession] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let timer = 0;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const next = await fetchDashboard(
          { range, source, projectId: projectId === "all" ? undefined : projectId },
          controller.signal,
        );
        setData(next);
        setError("");
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        timer = window.setTimeout(load, 2000);
      }
    };
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [range, source, projectId]);

  const visibleProjects = useMemo(() => filterProjects(data?.projects ?? [], search), [data?.projects, search]);
  const visibleSessions = useMemo(() => filterSessions(data?.sessions ?? [], search), [data?.sessions, search]);
  const detailEvents = useMemo(
    () => (detailSession ? (data?.events ?? []).filter((event) => event.sessionId === detailSession) : []),
    [data?.events, detailSession],
  );
  const detailPrompts = useMemo(
    () => (detailSession ? (data?.prompts ?? []).filter((prompt) => prompt.sessionId === detailSession) : []),
    [data?.prompts, detailSession],
  );

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local telemetry only</p>
          <h1>Live Token Monitor</h1>
          <p>Go API, SQLite history, and React charts for Codex and Claude Code logs.</p>
        </div>
        <div className="status-card">
          <span className={error ? "status error" : "status ok"}>{error ? "error" : loading ? "refreshing" : "live"}</span>
          <strong>{data?.summary ? new Date(data.summary.generatedAt).toLocaleTimeString() : "waiting"}</strong>
          {error ? <small>{error}</small> : <small>{data?.summary.events ?? 0} events indexed</small>}
        </div>
      </header>

      <section className="filters" aria-label="filters">
        <label>
          <span>Range</span>
          <select value={range} onChange={(event) => setRange(event.target.value as Range)}>
            {ranges.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Source</span>
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value as Source);
              setProjectId("all");
            }}
          >
            <option value="all">All</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          <span>Project</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">All projects</option>
            {(data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.source} / {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="project, session, or path" />
        </label>
      </section>

      <nav className="tabs" aria-label="views">
        {(["dashboard", "projects", "sessions", "detail", "raw"] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} type="button" onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard data={data} />}
      {tab === "projects" && <Projects projects={visibleProjects} events={data?.events ?? []} prompts={data?.prompts ?? []} />}
      {tab === "sessions" && (
        <Sessions
          sessions={visibleSessions}
          events={data?.events ?? []}
          prompts={data?.prompts ?? []}
          onOpen={(id) => {
            setDetailSession(id);
            setTab("detail");
          }}
        />
      )}
      {tab === "detail" && <Detail sessionId={detailSession} events={detailEvents} prompts={detailPrompts} sessions={data?.sessions ?? []} />}
      {tab === "raw" && <RawTable events={data?.events ?? []} />}
    </main>
  );
}

function Dashboard({ data }: { data: DashboardData | null }) {
  const summary = data?.summary;
  return (
    <>
      <section className="metrics">
        <Metric label="Last Turn" value={formatNumber(summary?.latest?.total ?? 0)} note={summary?.latest ? `${summary.latest.source} / ${summary.latest.projectName}` : "no data"} />
        <Metric label="New Tokens" value={formatNumber(newTokens(summary?.latest))} note="fresh + cache write + output" />
        <Metric label="Output" value={formatNumber(summary?.latest?.output ?? 0)} note="assistant answer tokens" />
        <Metric label="Spike" value={formatNumber(newTokens(summary?.spike))} note={summary?.spike ? `${summary.spike.source} / ${summary.spike.projectName}` : "max turn"} warn />
      </section>
      <section className="panel">
        <PanelHead title="Daily trend" meta={`${summary?.daily.length ?? 0} days`} />
        <DailyChart data={summary?.daily ?? []} />
      </section>
      <section className="panel dashboard-global">
        <PanelHead title="All sessions" meta={`${data?.events.length ?? 0} events / ${data?.sessions.length ?? 0} sessions`} />
        <GlobalSessionChart events={data?.events ?? []} prompts={data?.prompts ?? []} />
      </section>
    </>
  );
}

function Projects({ projects, events, prompts }: { projects: ProjectSummary[]; events: TokenEvent[]; prompts: Prompt[] }) {
  if (!projects.length) return <Empty text="No projects match the current filters." />;
  return (
    <section className="grid-list">
      {projects.slice(0, 24).map((project) => {
        const projectEvents = events.filter((event) => event.projectId === project.id);
        const projectPrompts = prompts.filter((prompt) => prompt.projectId === project.id);
        return (
          <ChartCard key={project.id} title={`${project.source} / ${project.name}`} subtitle={compactPath(project.path)} events={projectEvents} prompts={projectPrompts}>
            <Stat label="events" value={project.events} />
            <Stat label="new" value={formatNumber(project.totals.newTokens)} />
            <Stat label="spike" value={formatNumber(project.spikeNewTokens)} />
          </ChartCard>
        );
      })}
    </section>
  );
}

function Sessions({
  sessions,
  events,
  prompts,
  onOpen,
}: {
  sessions: SessionSummary[];
  events: TokenEvent[];
  prompts: Prompt[];
  onOpen: (id: string) => void;
}) {
  if (!sessions.length) return <Empty text="No sessions match the current filters." />;
  return (
    <section className="grid-list">
      {sessions.slice(0, 24).map((session) => {
        const sessionEvents = events.filter((event) => event.sessionId === session.id);
        const sessionPrompts = prompts.filter((prompt) => prompt.sessionId === session.id);
        return (
          <ChartCard
            key={session.id}
            title={`${session.source} / ${session.projectName}`}
            subtitle={`${compactPath(session.projectPath || session.file)} · ${session.name}`}
            events={sessionEvents}
            prompts={sessionPrompts}
            action={<button onClick={() => onOpen(session.id)}>Open</button>}
          >
            <Stat label="events" value={session.events} />
            <Stat label="new" value={formatNumber(session.totals.newTokens)} />
            <Stat label="spike" value={formatNumber(session.spikeNewTokens)} />
          </ChartCard>
        );
      })}
    </section>
  );
}

function Detail({ sessionId, events, prompts, sessions }: { sessionId: string | null; events: TokenEvent[]; prompts: Prompt[]; sessions: SessionSummary[] }) {
  const orderedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const session = sessions.find((item) => item.id === sessionId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderedEvents.length) {
      setSelectedEventId(null);
      return;
    }
    setSelectedEventId((current) => {
      if (current && orderedEvents.some((event) => event.id === current)) return current;
      const spike = session?.spikeEventId ? orderedEvents.find((event) => event.id === session.spikeEventId) : undefined;
      return spike?.id ?? orderedEvents.at(-1)?.id ?? null;
    });
  }, [orderedEvents, session?.spikeEventId, sessionId]);

  if (!sessionId) return <Empty text="Select a session from the Sessions tab to inspect it." />;
  if (!orderedEvents.length) return <Empty text="No token events are available for this session in the loaded range." />;
  const selectedEvent = orderedEvents.find((event) => event.id === selectedEventId) ?? orderedEvents.at(-1)!;
  const eventPrompts = promptsForTurn(prompts, orderedEvents, selectedEvent.id);
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? eventPrompts.at(-1) ?? null;
  const selectedIndex = orderedEvents.findIndex((event) => event.id === selectedEvent.id);
  const sums = tokenSums(orderedEvents);
  const selectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSelectedPromptId(null);
  };
  const selectPrompt = (prompt: Prompt) => {
    setSelectedPromptId(prompt.id);
    const nearest = findNearestEventForPrompt(orderedEvents, prompt);
    if (nearest) setSelectedEventId(nearest.id);
  };
  return (
    <section className="panel detail">
      <PanelHead title={session ? `${session.source} / ${session.projectName} / ${session.name}` : "Session detail"} meta={session ? compactPath(session.projectPath || session.file) : ""} />
      <section className="metrics compact">
        <Metric label="Events" value={String(events.length)} note={`${prompts.length} prompts`} />
        <Metric label="New Tokens" value={formatNumber(sums.newTokens)} note="selected session" />
        <Metric label="Cache Read" value={formatNumber(sums.cacheRead)} note="reused context" />
        <Metric label="Output" value={formatNumber(sums.output)} note="answer tokens" />
      </section>
      <div className="detail-workspace">
        <SessionDetailChart
          events={orderedEvents}
          prompts={prompts}
          selectedEventId={selectedEvent.id}
          selectedPromptId={selectedPrompt?.id ?? null}
          onSelectEvent={selectEvent}
          onSelectPrompt={selectPrompt}
        />
        <TurnInspector
          event={selectedEvent}
          prompts={eventPrompts}
          selectedPrompt={selectedPrompt}
          onSelectPrompt={setSelectedPromptId}
          onPrevious={() => selectEvent(orderedEvents[selectedIndex - 1].id)}
          onNext={() => selectEvent(orderedEvents[selectedIndex + 1].id)}
          hasPrevious={selectedIndex > 0}
          hasNext={selectedIndex < orderedEvents.length - 1}
        />
      </div>
      <SessionEventTable events={orderedEvents} selectedEventId={selectedEvent.id} onSelectEvent={selectEvent} />
    </section>
  );
}

type DetailMode = "turn" | "cumulative";
type DetailSeriesKey = "input" | "cacheCreate" | "output" | "reasoning";

const detailSeries: Array<{ key: DetailSeriesKey; label: string; color: string }> = [
  { key: "input", label: "Fresh input", color: "#69b7ff" },
  { key: "cacheCreate", label: "Cache write", color: "#9b8cff" },
  { key: "output", label: "Output", color: "#ffcc66" },
  { key: "reasoning", label: "Reasoning", color: "#df88ff" },
];

function SessionDetailChart({
  events,
  prompts,
  selectedEventId,
  selectedPromptId,
  onSelectEvent,
  onSelectPrompt,
}: {
  events: TokenEvent[];
  prompts: Prompt[];
  selectedEventId: string;
  selectedPromptId: string | null;
  onSelectEvent: (eventId: string) => void;
  onSelectPrompt: (prompt: Prompt) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [mode, setMode] = useState<DetailMode>("turn");
  const [showTotal, setShowTotal] = useState(false);
  const [showCacheRead, setShowCacheRead] = useState(false);
  const [enabled, setEnabled] = useState<Record<DetailSeriesKey, boolean>>({
    input: true,
    cacheCreate: true,
    output: true,
    reasoning: true,
  });

  useEffect(() => {
    if (!ref.current) return;
    const chart = chartInstance(chartRef, ref.current);
    chart.setOption(sessionDetailOption(events, prompts, selectedEventId, selectedPromptId, enabled, mode, showTotal, showCacheRead), { notMerge: true });
    const click = (params: { seriesName?: string; data?: unknown }) => {
      const id = chartDataId(params.data);
      if (!id) return;
      if (params.seriesName === "Prompts") {
        const prompt = prompts.find((item) => item.id === id);
        if (prompt) onSelectPrompt(prompt);
        return;
      }
      if (events.some((event) => event.id === id)) onSelectEvent(id);
    };
    const resize = () => chart.resize();
    chart.on("click", click);
    window.addEventListener("resize", resize);
    return () => {
      chart.off("click", click);
      window.removeEventListener("resize", resize);
    };
  }, [enabled, events, mode, onSelectEvent, onSelectPrompt, prompts, selectedEventId, selectedPromptId, showCacheRead, showTotal]);

  useEffect(() => () => disposeChart(chartRef), []);

  const resetZoom = () => chartRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  return (
    <section className="detail-chart-region">
      <div className="detail-toolbar">
        <div className="series-toggles" aria-label="token series">
          {detailSeries.map((series) => (
            <label className="series-toggle" key={series.key}>
              <input
                type="checkbox"
                checked={enabled[series.key]}
                onChange={() => setEnabled((current) => ({ ...current, [series.key]: !current[series.key] }))}
              />
              <i style={{ background: series.color }} />
              <span>{series.label}</span>
            </label>
          ))}
          <label className="series-toggle">
            <input type="checkbox" checked={showTotal} onChange={() => setShowTotal((current) => !current)} />
            <i className="total-swatch" />
            <span>New tokens</span>
          </label>
          <label className="series-toggle">
            <input type="checkbox" checked={showCacheRead} onChange={() => setShowCacheRead((current) => !current)} />
            <i className="cache-swatch" />
            <span>Cache read</span>
          </label>
        </div>
        <div className="detail-chart-actions">
          <div className="segmented" aria-label="chart mode">
            <button type="button" className={mode === "turn" ? "active" : ""} aria-pressed={mode === "turn"} onClick={() => setMode("turn")}>
              Turns
            </button>
            <button type="button" className={mode === "cumulative" ? "active" : ""} aria-pressed={mode === "cumulative"} onClick={() => setMode("cumulative")}>
              Cumulative
            </button>
          </div>
          <button type="button" className="quiet-button" onClick={resetZoom}>
            Reset zoom
          </button>
        </div>
      </div>
      <div ref={ref} className="detail-chart" role="img" aria-label="Session token events and prompt markers" />
    </section>
  );
}

function TurnInspector({
  event,
  prompts,
  selectedPrompt,
  onSelectPrompt,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: {
  event: TokenEvent;
  prompts: Prompt[];
  selectedPrompt: Prompt | null;
  onSelectPrompt: (promptId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}) {
  return (
    <aside className="turn-inspector">
      <header className="inspector-head">
        <div>
          <p className="inspector-label">Selected turn</p>
          <h3>{new Date(event.timestamp).toLocaleString()}</h3>
          <small>{event.model || "unknown model"}</small>
        </div>
        <div className="turn-navigation">
          <button type="button" title="Previous turn" aria-label="Previous turn" disabled={!hasPrevious} onClick={onPrevious}>
            &lt;
          </button>
          <button type="button" title="Next turn" aria-label="Next turn" disabled={!hasNext} onClick={onNext}>
            &gt;
          </button>
        </div>
      </header>
      <dl className="turn-stats">
        {visibleBreakdownRows(event).map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>{formatNumber(row.value)}</dd>
          </div>
        ))}
        <div>
          <dt>Total</dt>
          <dd>{formatNumber(event.total)}</dd>
        </div>
      </dl>
      {(event.contextPercent != null || event.contextWindow != null || event.fiveHourPercent != null || event.weeklyPercent != null) && (
        <dl className="turn-stats quota-stats">
          {event.contextWindow != null && (
            <div>
              <dt>Context window</dt>
              <dd>{formatNumber(event.contextWindow)}</dd>
            </div>
          )}
          {event.contextPercent != null && (
            <div>
              <dt>Context used</dt>
              <dd>{formatPercent(event.contextPercent)}</dd>
            </div>
          )}
          {event.fiveHourPercent != null && (
            <div>
              <dt>Five hour</dt>
              <dd>{formatPercent(event.fiveHourPercent)}</dd>
            </div>
          )}
          {event.weeklyPercent != null && (
            <div>
              <dt>Weekly</dt>
              <dd>{formatPercent(event.weeklyPercent)}</dd>
            </div>
          )}
        </dl>
      )}
      <section className="prompt-inspector">
        <div className="inspector-section-head">
          <h4>Preceding prompts</h4>
          <small>{prompts.length}</small>
        </div>
        {prompts.length > 1 && (
          <div className="prompt-tabs">
            {prompts.map((prompt, index) => (
              <button type="button" className={prompt.id === selectedPrompt?.id ? "active" : ""} key={prompt.id} onClick={() => onSelectPrompt(prompt.id)}>
                {index + 1}
              </button>
            ))}
          </div>
        )}
        <div className="prompt-text">{selectedPrompt?.text || "No preceding prompt for this turn."}</div>
        {selectedPrompt && <small>{selectedPrompt.imageCount ? `${selectedPrompt.imageCount} images` : "Text prompt"}</small>}
      </section>
    </aside>
  );
}

function SessionEventTable({ events, selectedEventId, onSelectEvent }: { events: TokenEvent[]; selectedEventId: string; onSelectEvent: (eventId: string) => void }) {
  return (
    <section className="session-event-list">
      <div className="inspector-section-head">
        <h3>Session events</h3>
        <small>{events.length} turns</small>
      </div>
      <div className="table-wrap">
        <table className="session-event-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th>New</th>
              <th>Fresh</th>
              <th>Cache write</th>
              <th>Cache read</th>
              <th>Output</th>
              <th>Reasoning</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            {[...events].reverse().map((event) => (
              <tr
                key={event.id}
                className={event.id === selectedEventId ? "selected" : ""}
                tabIndex={0}
                onClick={() => onSelectEvent(event.id)}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                    keyEvent.preventDefault();
                    onSelectEvent(event.id);
                  }
                }}
              >
                <td>{new Date(event.timestamp).toLocaleString()}</td>
                <td>{event.model || "-"}</td>
                <td>{formatNumber(newTokens(event))}</td>
                <td>{formatNumber(event.input)}</td>
                <td>{formatNumber(event.cacheCreate)}</td>
                <td>{formatNumber(event.cacheRead)}</td>
                <td>{formatNumber(event.output)}</td>
                <td>{formatNumber(event.reasoning)}</td>
                <td>{event.contextPercent == null ? "-" : formatPercent(event.contextPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RawTable({ events }: { events: TokenEvent[] }) {
  return (
    <section className="panel">
      <PanelHead title="Raw events" meta={`${events.length} rows`} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Project</th>
              <th>Session</th>
              <th>New</th>
              <th>Fresh</th>
              <th>Cache write</th>
              <th>Cache read</th>
              <th>Output</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(-500).reverse().map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.timestamp).toLocaleString()}</td>
                <td>{event.source}</td>
                <td>{event.projectName}</td>
                <td>{event.sessionName}</td>
                <td>{formatNumber(newTokens(event))}</td>
                <td>{formatNumber(event.input)}</td>
                <td>{formatNumber(event.cacheCreate)}</td>
                <td>{formatNumber(event.cacheRead)}</td>
                <td>{formatNumber(event.output)}</td>
                <td>{formatNumber(event.reasoning)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChartCard({
  title,
  subtitle,
  events,
  prompts,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  events: TokenEvent[];
  prompts: Prompt[];
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="chart-card">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{subtitle || "unknown path"}</p>
        </div>
        <div className="card-actions">
          <div className="card-stats">{children}</div>
          {action}
        </div>
      </header>
      <TokenChart events={events} prompts={promptsInWindow(prompts, events)} />
    </article>
  );
}

function TokenChart({ events, prompts, large = false, breakdown = false }: { events: TokenEvent[]; prompts: Prompt[]; large?: boolean; breakdown?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = chartInstance(chartRef, ref.current);
    chart.setOption(tokenOption(events, prompts, large, breakdown), { notMerge: true });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [events, prompts, large, breakdown]);

  useEffect(() => () => disposeChart(chartRef), []);

  return <div ref={ref} className={large ? "chart large" : "chart"} />;
}

function DailyChart({ data }: { data: Array<{ day: string; total: number; average: number }> }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!data.length) {
      disposeChart(chartRef);
      return;
    }
    const chart = chartInstance(chartRef, ref.current);
    chart.setOption({
      animation: false,
      grid: { top: 20, right: 58, bottom: 36, left: 64 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#132024",
        borderColor: "#39525a",
        textStyle: { color: "#edf6f2" },
        valueFormatter: (value) => formatAverage(Number(value)),
      },
      xAxis: { type: "category", data: data.map((item) => item.day), axisLabel: { color: "#9bb2ad" } },
      yAxis: [
        { type: "value", axisLabel: { color: "#9bb2ad", formatter: formatNumber }, splitLine: { lineStyle: { color: "#26393d" } } },
        { type: "value", axisLabel: { color: "#9bb2ad", formatter: (value: number) => formatAverage(value) }, splitLine: { show: false } },
      ],
      series: [
        { type: "bar", name: "Daily total", data: data.map((item) => item.total), itemStyle: { color: "#73d99f", borderRadius: [6, 6, 0, 0] } },
        { type: "line", name: "Average", yAxisIndex: 1, data: data.map((item) => item.average), lineStyle: { color: "#ffcc66", width: 2 } },
      ],
    } satisfies EChartsOption);
  }, [data]);
  useEffect(() => () => disposeChart(chartRef), []);
  if (!data.length) return <div className="chart-empty">No daily totals in the selected range.</div>;
  return <div ref={ref} className="chart large" />;
}

function GlobalSessionChart({ events, prompts }: { events: TokenEvent[]; prompts: Prompt[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [promptLimit, setPromptLimit] = useState(0);
  const [mode, setMode] = useState<GlobalChartMode>("breakdown");
  const [scale, setScale] = useState<GlobalScaleMode>("log");
  const [hover, setHover] = useState<GlobalBarHover | null>(null);
  const visible = useMemo(() => filterGlobalChartWindow(events, prompts, minutes, promptLimit), [events, minutes, promptLimit, prompts]);
  const visibleTotals = useMemo(() => tokenSums(visible.events), [visible.events]);
  const largestEvent = useMemo(
    () => visible.events.reduce<TokenEvent | null>((largest, event) => (!largest || globalEventValue(event, mode) > globalEventValue(largest, mode) ? event : largest), null),
    [mode, visible.events],
  );

  useEffect(() => {
    if (!visible.events.length) {
      disposeChart(chartRef);
      setHover(null);
      return;
    }
    if (!ref.current) return;
    const chart = chartInstance(chartRef, ref.current);
    chart.setOption(globalSessionOption(visible.events, visible.prompts, mode, scale), { notMerge: true });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [mode, scale, visible.events, visible.prompts]);

  useEffect(() => () => disposeChart(chartRef), []);
  if (!events.length) return <div className="chart-empty">No session events in the selected range.</div>;
  return (
    <>
      <div className="global-chart-toolbar">
        <label>
          <span>Last prompts</span>
          <select value={promptLimit} onChange={(event) => setPromptLimit(Number(event.target.value))}>
            <option value={0}>All prompts</option>
            <option value={5}>Last 5 prompts</option>
            <option value={10}>Last 10 prompts</option>
            <option value={25}>Last 25 prompts</option>
            <option value={50}>Last 50 prompts</option>
          </select>
        </label>
        <label>
          <span>Last minutes</span>
          <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
            <option value={0}>All loaded time</option>
            <option value={15}>Last 15 minutes</option>
            <option value={30}>Last 30 minutes</option>
            <option value={60}>Last 60 minutes</option>
            <option value={180}>Last 180 minutes</option>
          </select>
        </label>
        <label>
          <span>Bars</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as GlobalChartMode)}>
            <option value="breakdown">New token breakdown</option>
            <option value="new">New tokens</option>
            <option value="total">Total incl. cache read</option>
            <option value="cacheRead">Cache read only</option>
          </select>
        </label>
        <label>
          <span>Scale</span>
          <select value={scale} onChange={(event) => setScale(event.target.value as GlobalScaleMode)}>
            <option value="log">Log scale</option>
            <option value="linear">Linear scale</option>
          </select>
        </label>
        <small>{visible.events.length} visible events / {visible.prompts.length} visible prompts</small>
      </div>
      <div className="global-chart-summary" aria-label="visible chart totals">
        <GlobalSummaryItem label="Bar unit" value={globalModeLabel(mode)} />
        <GlobalSummaryItem label="New tokens" value={formatNumber(visibleTotals.newTokens)} />
        <GlobalSummaryItem label="Cache read" value={formatNumber(visibleTotals.cacheRead)} />
        <GlobalSummaryItem label="Largest bar" value={largestEvent ? formatNumber(globalEventValue(largestEvent, mode)) : "0"} />
      </div>
      {visible.events.length ? (
        <div
          className="global-chart-stage"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(pointer) => {
            const bounds = pointer.currentTarget.getBoundingClientRect();
            setHover(globalBarHover(chartRef.current, visible.events, pointer.clientX - bounds.left, pointer.clientY - bounds.top));
          }}
        >
          <div ref={ref} className="global-session-chart" role="img" aria-label="Token events across all loaded sessions" />
          {hover && <GlobalBarTooltip hover={hover} />}
        </div>
      ) : (
        <div className="chart-empty">No session events match the chart filters.</div>
      )}
    </>
  );
}

function GlobalSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="global-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface GlobalBarHover {
  event: TokenEvent;
  left: number;
  top: number;
}

function GlobalBarTooltip({ hover }: { hover: GlobalBarHover }) {
  return (
    <div className="global-bar-tooltip" style={{ left: hover.left, top: hover.top }}>
      <strong>{new Date(hover.event.timestamp).toLocaleString()}</strong>
      <div className="chart-tooltip-meta">{hover.event.source} / {hover.event.projectName} / {hover.event.sessionName}</div>
      {visibleBreakdownRows(hover.event).map((row) => (
        <div className="chart-tooltip-row" key={row.key}>
          <span>{row.label}</span>
          <b>{formatNumber(row.value)}</b>
        </div>
      ))}
    </div>
  );
}

function chartInstance(ref: React.MutableRefObject<echarts.ECharts | null>, element: HTMLDivElement): echarts.ECharts {
  if (!ref.current || ref.current.isDisposed()) {
    ref.current = echarts.init(element, null, { renderer: "canvas" });
  }
  return ref.current;
}

function disposeChart(ref: React.MutableRefObject<echarts.ECharts | null>) {
  if (ref.current && !ref.current.isDisposed()) {
    ref.current.dispose();
  }
  ref.current = null;
}

function tokenOption(events: TokenEvent[], prompts: Prompt[], large: boolean, breakdown: boolean): EChartsOption {
  const visible = large ? events : events.slice(-80);
  const series: EChartsOption["series"] = breakdown
    ? [
        line("New tokens", visible.map((event) => [event.timestamp, newTokens(event)]), "#76d99f", 2.4),
        line("Fresh input", visible.map((event) => [event.timestamp, event.input]), "#69b7ff"),
        line("Cache write", visible.map((event) => [event.timestamp, event.cacheCreate]), "#8aa2ff"),
        line("Output", visible.map((event) => [event.timestamp, event.output]), "#ffcc66"),
        line("Reasoning", visible.map((event) => [event.timestamp, event.reasoning]), "#d987ff"),
      ]
    : [line("New tokens", visible.map((event) => [event.timestamp, newTokens(event)]), visible.at(-1)?.source === "claude" ? "#ffb86c" : "#7cc8ff", 2.3)];

  series.push({
    type: "scatter",
    name: "Prompts",
    data: prompts.map((prompt) => [prompt.timestamp, 0]),
    symbol: "diamond",
    symbolSize: large ? 10 : 7,
    itemStyle: { color: "#edf18a" },
  });

  return {
    animation: false,
    grid: large ? { top: breakdown ? 48 : 22, right: 28, bottom: 54, left: 62 } : { top: 10, right: 10, bottom: 18, left: 10 },
    legend: { show: breakdown, textStyle: { color: "#a9bbb7" } },
    tooltip: { trigger: "axis", backgroundColor: "#132024", borderColor: "#39525a", textStyle: { color: "#edf6f2" } },
    xAxis: { type: "time", axisLabel: { show: large, color: "#9bb2ad" }, axisLine: { lineStyle: { color: "#26393d" } } },
    yAxis: { type: "value", axisLabel: { show: large, color: "#9bb2ad", formatter: formatNumber }, splitLine: { lineStyle: { color: "#26393d" } } },
    dataZoom: large ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }] : [],
    series,
  };
}

const globalBreakdown = [
  { key: "input", name: "Fresh input", color: "#76d99f" },
  { key: "cacheCreate", name: "Cache write", color: "#8aa2ff" },
  { key: "output", name: "Output", color: "#ffcc66" },
  { key: "reasoning", name: "Reasoning", color: "#d987ff" },
] as const;

function globalModeLabel(mode: GlobalChartMode): string {
  if (mode === "total") return "Total tokens";
  if (mode === "cacheRead") return "Cache read";
  return "New tokens";
}

function globalEventValue(event: TokenEvent, mode: GlobalChartMode): number {
  if (mode === "cacheRead") return Number(event.cacheRead || 0);
  if (mode === "total") return Number(event.total || newTokens(event) + Number(event.cacheRead || 0));
  return newTokens(event);
}

function globalSessionOption(events: TokenEvent[], prompts: Prompt[], mode: GlobalChartMode, scale: GlobalScaleMode): EChartsOption {
  const visibleEvents = sortEventsByTime(events);
  const showSlider = visibleEvents.length > 120 || prompts.length > 60;
  const eventPoints = (source: "codex" | "claude") =>
    visibleEvents
      .filter((event) => event.source === source)
      .map((event) => [event.timestamp, globalEventValue(event, mode), event.id, event.projectName, event.sessionName]);
  const series: NonNullable<EChartsOption["series"]> =
    mode === "breakdown"
      ? globalBreakdown.map((definition) => ({
          type: "bar" as const,
          name: definition.name,
          data: visibleEvents.map((event) => [event.timestamp, Number(event[definition.key] || 0), event.id, event.projectName, event.sessionName]),
          stack: "new tokens",
          barMaxWidth: 18,
          itemStyle: { color: definition.color },
          emphasis: { focus: "series" },
        }))
      : [
          {
            type: "bar" as const,
            name: "Codex",
            data: eventPoints("codex"),
            barMaxWidth: 18,
            itemStyle: { color: "#69b7ff" },
          },
          {
            type: "bar" as const,
            name: "Claude",
            data: eventPoints("claude"),
            barMaxWidth: 18,
            itemStyle: { color: "#ffb86c" },
          },
        ];

  series.push({
    type: "scatter",
    name: "Prompts",
    xAxisIndex: 1,
    yAxisIndex: 1,
    data: prompts.map((prompt) => [prompt.timestamp, 0, prompt.id, prompt.projectName, prompt.sessionName]),
    symbol: "rect",
    symbolSize: [3, 14],
    itemStyle: { color: "#edf18a" },
  });

  const valueAxis =
    scale === "log"
      ? {
          type: "log" as const,
          min: 1,
          logBase: 10,
          name: globalModeLabel(mode),
          nameTextStyle: { color: "#9bb2ad" },
          axisLabel: { color: "#9bb2ad", formatter: formatNumber },
          splitLine: { lineStyle: { color: "#26393d" } },
        }
      : {
          type: "value" as const,
          name: globalModeLabel(mode),
          nameTextStyle: { color: "#9bb2ad" },
          axisLabel: { color: "#9bb2ad", formatter: formatNumber },
          splitLine: { lineStyle: { color: "#26393d" } },
        };

  return {
    animation: false,
    grid: [
      { left: 66, right: 24, top: 46, height: "66%" },
      { left: 66, right: 24, top: "80%", height: 18 },
    ],
    legend: { top: 0, textStyle: { color: "#a9bbb7" }, itemGap: 14 },
    tooltip: { show: false },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis: [detailTimeAxis(0, false), detailTimeAxis(1, true)],
    yAxis: [valueAxis, { type: "value", gridIndex: 1, min: -1, max: 1, show: false }],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1] },
      ...(showSlider ? [{ type: "slider" as const, xAxisIndex: [0, 1], height: 18, bottom: 8 }] : []),
    ],
    series,
  };
}

function globalBarHover(chart: echarts.ECharts | null, events: TokenEvent[], offsetX: number, offsetY: number): GlobalBarHover | null {
  if (!chart || !chart.containPixel({ gridIndex: 0 }, [offsetX, offsetY])) return null;
  const nearest = events.reduce<{ event: TokenEvent; distance: number } | null>((best, event) => {
    const x = Number(chart.convertToPixel({ xAxisIndex: 0 }, event.timestamp));
    const distance = Math.abs(x - offsetX);
    return !best || distance < best.distance ? { event, distance } : best;
  }, null);
  if (!nearest || nearest.distance > 28) return null;
  const tooltipWidth = 240;
  const tooltipHeight = 190;
  const gap = 18;
  const right = offsetX + gap + tooltipWidth;
  const bottom = offsetY + gap + tooltipHeight;
  return {
    event: nearest.event,
    left: right <= chart.getWidth() ? offsetX + gap : Math.max(gap, offsetX - tooltipWidth - gap),
    top: bottom <= chart.getHeight() ? offsetY + gap : Math.max(gap, offsetY - tooltipHeight - gap),
  };
}

function sessionDetailOption(
  events: TokenEvent[],
  prompts: Prompt[],
  selectedEventId: string,
  selectedPromptId: string | null,
  enabled: Record<DetailSeriesKey, boolean>,
  mode: DetailMode,
  showTotal: boolean,
  showCacheRead: boolean,
): EChartsOption {
  const cacheAxis = showCacheRead ? 1 : -1;
  const promptAxis = showCacheRead ? 2 : 1;
  const xAxis = [
    detailTimeAxis(0, false),
    ...(showCacheRead ? [detailTimeAxis(cacheAxis, false)] : []),
    detailTimeAxis(promptAxis, true),
  ];
  const yAxis = [
    {
      type: "value" as const,
      axisLabel: { color: "#9bb2ad", formatter: formatNumber },
      splitLine: { lineStyle: { color: "#26393d" } },
    },
    ...(showCacheRead
      ? [
          {
            type: "value" as const,
            gridIndex: cacheAxis,
            axisLabel: { color: "#9bb2ad", formatter: formatNumber },
            splitLine: { lineStyle: { color: "#26393d" } },
          },
        ]
      : []),
    {
      type: "value" as const,
      gridIndex: promptAxis,
      min: -1,
      max: 1,
      show: false,
    },
  ];
  const series: NonNullable<EChartsOption["series"]> = [];
  detailSeries.forEach((definition) => {
    if (!enabled[definition.key]) return;
    series.push({
      type: mode === "turn" ? "bar" : "line",
      name: definition.label,
      data: detailPoints(events, definition.key, mode),
      stack: mode === "turn" ? "turn tokens" : undefined,
      barMaxWidth: 22,
      symbol: "none",
      itemStyle: { color: definition.color },
      lineStyle: { color: definition.color, width: 1.8 },
      emphasis: { focus: "series" },
    });
  });
  if (showTotal) {
    series.push({
      type: "line",
      name: "New tokens",
      data: detailTotalPoints(events, mode),
      symbol: events.length < 80 ? "circle" : "none",
      symbolSize: 5,
      lineStyle: { color: "#76d99f", width: 2.2 },
      itemStyle: { color: "#76d99f" },
      emphasis: { focus: "series" },
    });
  }
  if (showCacheRead) {
    series.push({
      type: "line",
      name: "Cache read",
      xAxisIndex: cacheAxis,
      yAxisIndex: cacheAxis,
      data: detailPoints(events, "cacheRead", mode),
      symbol: "none",
      lineStyle: { color: "#43d4c3", width: 1.8 },
      areaStyle: { color: "#43d4c322" },
    });
  }
  series.push({
    type: "scatter",
    name: "Prompts",
    xAxisIndex: promptAxis,
    yAxisIndex: promptAxis,
    data: prompts.map((prompt) => ({
      value: [prompt.timestamp, 0, prompt.id],
      itemStyle: { color: prompt.id === selectedPromptId ? "#ffffff" : "#edf18a" },
    })),
    symbol: "diamond",
    symbolSize: (value: unknown) => (chartDataId(value) === selectedPromptId ? 15 : 10),
  });
  const selectedIndex = events.findIndex((event) => event.id === selectedEventId);
  if (selectedIndex >= 0) {
    series.push({
      type: "scatter",
      name: "Selected turn",
      data: [[events[selectedIndex].timestamp, detailTotalAt(events, selectedIndex, mode), selectedEventId]],
      symbol: "circle",
      symbolSize: 13,
      silent: true,
      tooltip: { show: false },
      itemStyle: { color: "#ffffff", borderColor: "#08110f", borderWidth: 3 },
      z: 8,
    });
  }
  const axisIndexes = xAxis.map((_, index) => index);
  return {
    animation: false,
    grid: showCacheRead
      ? [
          { left: 66, right: 24, top: 42, height: "43%" },
          { left: 66, right: 24, top: "58%", height: "14%" },
          { left: 66, right: 24, top: "77%", height: 28 },
        ]
      : [
          { left: 66, right: 24, top: 42, height: "62%" },
          { left: 66, right: 24, top: "75%", height: 28 },
        ],
    legend: { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      backgroundColor: "#132024",
      borderColor: "#39525a",
      textStyle: { color: "#edf6f2" },
      formatter: (params: unknown) => detailTooltip(params, events, prompts),
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis,
    yAxis,
    dataZoom: [
      { type: "inside", xAxisIndex: axisIndexes },
      { type: "slider", xAxisIndex: axisIndexes, height: 18, bottom: 8 },
    ],
    series,
  };
}

function detailTimeAxis(gridIndex: number, showLabels: boolean) {
  return {
    type: "time" as const,
    gridIndex,
    axisLabel: { show: showLabels, color: "#9bb2ad" },
    axisLine: { lineStyle: { color: "#26393d" } },
    axisTick: { show: showLabels },
  };
}

function detailPoints(events: TokenEvent[], key: DetailSeriesKey | "cacheRead", mode: DetailMode): Array<[string, number, string]> {
  let running = 0;
  return events.map((event) => {
    running += Number(event[key] || 0);
    return [event.timestamp, mode === "cumulative" ? running : Number(event[key] || 0), event.id];
  });
}

function detailTotalPoints(events: TokenEvent[], mode: DetailMode): Array<[string, number, string]> {
  let running = 0;
  return events.map((event) => {
    running += newTokens(event);
    return [event.timestamp, mode === "cumulative" ? running : newTokens(event), event.id];
  });
}

function detailTotalAt(events: TokenEvent[], index: number, mode: DetailMode): number {
  if (mode === "turn") return newTokens(events[index]);
  return events.slice(0, index + 1).reduce((sum, event) => sum + newTokens(event), 0);
}

function detailTooltip(params: unknown, events: TokenEvent[], prompts: Prompt[]): string {
  const items = Array.isArray(params) ? params : [];
  const id = items.map((item) => chartDataId((item as { data?: unknown }).data)).find((value) => events.some((event) => event.id === value));
  const event = events.find((candidate) => candidate.id === id);
  if (!event) return "";
  const rows = visibleBreakdownRows(event);
  const promptCount = promptsForTurn(prompts, events, event.id).length;
  return [
    `<strong>${new Date(event.timestamp).toLocaleString()}</strong>`,
    ...rows.map((row) => `<div class="chart-tooltip-row"><span>${row.label}</span><b>${formatNumber(row.value)}</b></div>`),
    ...(promptCount ? [`<div class="chart-tooltip-row"><span>Prompts</span><b>${promptCount}</b></div>`] : []),
  ].join("");
}

function chartDataId(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[2] === "string" ? value[2] : null;
  if (value && typeof value === "object" && "value" in value) return chartDataId((value as { value: unknown }).value);
  return null;
}

function formatPercent(value: number): string {
  return `${Number(value).toFixed(1)}%`;
}

function line(name: string, data: Array<[string, number]>, color: string, width = 1.8) {
  return {
    type: "line" as const,
    name,
    data,
    showSymbol: data.length === 1,
    smooth: false,
    lineStyle: { color, width },
    itemStyle: { color },
    areaStyle: name === "New tokens" ? { color: `${color}24` } : undefined,
  };
}

function Metric({ label, value, note, warn = false }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className={warn ? "metric warn" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <strong>{value}</strong> {label}
    </span>
  );
}

function PanelHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function filterProjects(projects: ProjectSummary[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter((project) => `${project.source} ${project.name} ${project.path}`.toLowerCase().includes(needle));
}

function filterSessions(sessions: SessionSummary[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => `${session.source} ${session.projectName} ${session.projectPath} ${session.name} ${session.file}`.toLowerCase().includes(needle));
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
