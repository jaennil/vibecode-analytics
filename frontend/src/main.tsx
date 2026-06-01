import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { fetchDashboard } from "./api";
import {
  compactPath,
  filterDetailChartWindow,
  filterGlobalChartWindow,
  findNearestEventForPrompt,
  formatAverage,
  formatNumber,
  newTokens,
  promptCountForEventWindow,
  promptsForEventWindow,
  promptsInWindow,
  sortEventsByTime,
  tokenSums,
  visibleBreakdownRows,
} from "./selectors";
import type { DailyTotal, DashboardData, Prompt, ProjectSummary, Range, SessionSummary, Source, Summary, TokenEvent, TokenTotals } from "./types";
import "./styles.css";

type Tab = "dashboard" | "projects" | "sessions" | "detail" | "raw";
type DetailTarget = { type: "project" | "session"; id: string };
type GlobalChartMode = "line" | "breakdown" | "new" | "total" | "cacheRead";
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
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const projectOptionsData = useMemo(() => filterDashboardData(data, source, "all"), [data, source]);
  const viewData = useMemo(() => filterDashboardData(data, source, projectId), [data, projectId, source]);

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

  const visibleProjects = useMemo(() => filterProjects(viewData?.projects ?? [], search), [search, viewData?.projects]);
  const visibleSessions = useMemo(() => filterSessions(viewData?.sessions ?? [], search), [search, viewData?.sessions]);
  const detailEvents = useMemo(
    () =>
      detailTarget
        ? (viewData?.events ?? []).filter((event) => (detailTarget.type === "session" ? event.sessionId === detailTarget.id : event.projectId === detailTarget.id))
        : [],
    [detailTarget, viewData?.events],
  );
  const detailPrompts = useMemo(
    () =>
      detailTarget
        ? (viewData?.prompts ?? []).filter((prompt) => (detailTarget.type === "session" ? prompt.sessionId === detailTarget.id : prompt.projectId === detailTarget.id))
        : [],
    [detailTarget, viewData?.prompts],
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
          <strong>{viewData?.summary ? new Date(viewData.summary.generatedAt).toLocaleTimeString() : "waiting"}</strong>
          {error ? <small>{error}</small> : <small>{viewData?.summary.events ?? 0} events indexed</small>}
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
              setDetailTarget(null);
            }}
          >
            <option value="all">All</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          <span>Project</span>
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setDetailTarget(null);
            }}
          >
            <option value="all">All projects</option>
            {(projectOptionsData?.projects ?? []).map((project) => (
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

      {tab === "dashboard" && <Dashboard data={viewData} />}
      {tab === "projects" && (
        <Projects
          projects={visibleProjects}
          events={viewData?.events ?? []}
          prompts={viewData?.prompts ?? []}
          onOpen={(id) => {
            setDetailTarget({ type: "project", id });
            setTab("detail");
          }}
        />
      )}
      {tab === "sessions" && (
        <Sessions
          sessions={visibleSessions}
          events={viewData?.events ?? []}
          prompts={viewData?.prompts ?? []}
          onOpen={(id) => {
            setDetailTarget({ type: "session", id });
            setTab("detail");
          }}
        />
      )}
      {tab === "detail" && <Detail target={detailTarget} events={detailEvents} prompts={detailPrompts} projects={viewData?.projects ?? []} sessions={viewData?.sessions ?? []} />}
      {tab === "raw" && <RawTable events={viewData?.events ?? []} />}
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

function Projects({ projects, events, prompts, onOpen }: { projects: ProjectSummary[]; events: TokenEvent[]; prompts: Prompt[]; onOpen: (id: string) => void }) {
  if (!projects.length) return <Empty text="No projects match the current filters." />;
  return (
    <section className="grid-list">
      {projects.slice(0, 24).map((project) => {
        const projectEvents = events.filter((event) => event.projectId === project.id);
        const projectPrompts = prompts.filter((prompt) => prompt.projectId === project.id);
        return (
          <ChartCard
            key={project.id}
            title={`${project.source} / ${project.name}`}
            subtitle={compactPath(project.path)}
            events={projectEvents}
            prompts={projectPrompts}
            action={<button onClick={() => onOpen(project.id)}>Open</button>}
          >
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

function Detail({
  target,
  events,
  prompts,
  projects,
  sessions,
}: {
  target: DetailTarget | null;
  events: TokenEvent[];
  prompts: Prompt[];
  projects: ProjectSummary[];
  sessions: SessionSummary[];
}) {
  const orderedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const session = target?.type === "session" ? sessions.find((item) => item.id === target.id) : null;
  const project = target?.type === "project" ? projects.find((item) => item.id === target.id) : null;
  const [minutes, setMinutes] = useState(0);
  const [promptLimit, setPromptLimit] = useState(0);
  const [showSum, setShowSum] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const visible = useMemo(() => filterDetailChartWindow(orderedEvents, prompts, minutes, promptLimit), [minutes, orderedEvents, promptLimit, prompts]);

  useEffect(() => {
    if (!visible.events.length) {
      setSelectedEventId(null);
      return;
    }
    setSelectedEventId((current) => {
      if (current && visible.events.some((event) => event.id === current)) return current;
      const spike = session?.spikeEventId ? visible.events.find((event) => event.id === session.spikeEventId) : undefined;
      return spike?.id ?? visible.events.at(-1)?.id ?? null;
    });
  }, [session?.spikeEventId, target?.id, target?.type, visible.events]);

  if (!target) return <Empty text="Open a project or session to inspect it." />;
  if (!orderedEvents.length) return <Empty text="No token events are available for this detail target in the loaded range." />;
  if (!visible.events.length) return <Empty text="No token events match the detail filters." />;
  const selectedEvent = visible.events.find((event) => event.id === selectedEventId) ?? visible.events.at(-1)!;
  const eventPrompts = promptsForEventWindow(visible.prompts, selectedEvent);
  const selectedPrompt = visible.prompts.find((prompt) => prompt.id === selectedPromptId) ?? eventPrompts.at(-1) ?? null;
  const selectedIndex = visible.events.findIndex((event) => event.id === selectedEvent.id);
  const sums = tokenSums(visible.events);
  const selectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSelectedPromptId(null);
  };
  const selectPrompt = (prompt: Prompt) => {
    setSelectedPromptId(prompt.id);
    const nearest = findNearestEventForPrompt(visible.events, prompt);
    if (nearest) setSelectedEventId(nearest.id);
  };
  return (
    <section className="panel detail">
      <PanelHead title={detailTitle(target, project, session)} meta={detailMeta(target, project, session)} />
      <section className="metrics compact">
        <Metric label="Events" value={String(visible.events.length)} note={`${visible.prompts.length} prompts`} />
        <Metric label="New Tokens" value={formatNumber(sums.newTokens)} note="visible window" />
        <Metric label="Cache Read" value={formatNumber(sums.cacheRead)} note="reused context" />
        <Metric label="Output" value={formatNumber(sums.output)} note="answer tokens" />
      </section>
      <div className="detail-workspace">
        <SessionDetailChart
          events={visible.events}
          prompts={visible.prompts}
          selectedEventId={selectedEvent.id}
          selectedPromptId={selectedPrompt?.id ?? null}
          minutes={minutes}
          promptLimit={promptLimit}
          showSum={showSum}
          sums={sums}
          onMinutesChange={(value) => {
            setMinutes(value);
            if (value > 0) setPromptLimit(0);
          }}
          onPromptLimitChange={(value) => {
            setPromptLimit(value);
            if (value > 0) setMinutes(0);
          }}
          onToggleSum={() => setShowSum((current) => !current)}
          onSelectEvent={selectEvent}
          onSelectPrompt={selectPrompt}
        />
        <TurnInspector
          event={selectedEvent}
          prompts={eventPrompts}
          selectedPrompt={selectedPrompt}
          onSelectPrompt={setSelectedPromptId}
          onPrevious={() => selectEvent(visible.events[selectedIndex - 1].id)}
          onNext={() => selectEvent(visible.events[selectedIndex + 1].id)}
          hasPrevious={selectedIndex > 0}
          hasNext={selectedIndex < visible.events.length - 1}
        />
      </div>
      <SessionEventTable events={visible.events} selectedEventId={selectedEvent.id} onSelectEvent={selectEvent} />
    </section>
  );
}

type DetailMode = "line" | "breakdown" | "cumulative";
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
  minutes,
  promptLimit,
  showSum,
  sums,
  onMinutesChange,
  onPromptLimitChange,
  onToggleSum,
  onSelectEvent,
  onSelectPrompt,
}: {
  events: TokenEvent[];
  prompts: Prompt[];
  selectedEventId: string;
  selectedPromptId: string | null;
  minutes: number;
  promptLimit: number;
  showSum: boolean;
  sums: TokenTotals;
  onMinutesChange: (minutes: number) => void;
  onPromptLimitChange: (promptLimit: number) => void;
  onToggleSum: () => void;
  onSelectEvent: (eventId: string) => void;
  onSelectPrompt: (prompt: Prompt) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [mode, setMode] = useState<DetailMode>("line");
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
    chart.setOption(sessionDetailOption(events, prompts, selectedEventId, selectedPromptId, enabled, mode, showCacheRead), { notMerge: true });
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
  }, [enabled, events, mode, onSelectEvent, onSelectPrompt, prompts, selectedEventId, selectedPromptId, showCacheRead]);

  useEffect(() => () => disposeChart(chartRef), []);

  const resetZoom = () => chartRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  return (
    <section className="detail-chart-region">
      <div className="detail-toolbar">
        <div className="detail-range-controls" aria-label="detail range">
          <label>
            <span>Time</span>
            <select value={minutes} onChange={(event) => onMinutesChange(Number(event.target.value))}>
              <option value={0}>All</option>
              <option value={5}>Last 5m</option>
              <option value={10}>Last 10m</option>
              <option value={60}>Last 1h</option>
              <option value={360}>Last 6h</option>
              <option value={1440}>Last 24h</option>
            </select>
          </label>
          <label>
            <span>Prompts</span>
            <select value={promptLimit} onChange={(event) => onPromptLimitChange(Number(event.target.value))}>
              <option value={0}>None</option>
              <option value={1}>Last prompt</option>
              <option value={2}>Last 2 prompts</option>
              <option value={3}>Last 3 prompts</option>
              <option value={5}>Last 5 prompts</option>
              <option value={10}>Last 10 prompts</option>
            </select>
          </label>
          <button type="button" className={showSum ? "quiet-button active" : "quiet-button"} aria-pressed={showSum} onClick={onToggleSum}>
            SUM
          </button>
        </div>
        {showSum && (
          <div className="detail-sum-grid" aria-label="detail visible totals">
            <GlobalSummaryItem label="New tokens" value={formatNumber(sums.newTokens)} />
            <GlobalSummaryItem label="Fresh input" value={formatNumber(sums.input)} />
            <GlobalSummaryItem label="Cache write" value={formatNumber(sums.cacheCreate)} />
            <GlobalSummaryItem label="Cache read" value={formatNumber(sums.cacheRead)} />
            <GlobalSummaryItem label="Output" value={formatNumber(sums.output)} />
            <GlobalSummaryItem label="Reasoning" value={formatNumber(sums.reasoning)} />
          </div>
        )}
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
            <input type="checkbox" checked={showCacheRead} onChange={() => setShowCacheRead((current) => !current)} />
            <i className="cache-swatch" />
            <span>Cache read</span>
          </label>
        </div>
        <div className="detail-chart-actions">
          <div className="segmented" aria-label="chart mode">
            <button type="button" className={mode === "line" ? "active" : ""} aria-pressed={mode === "line"} onClick={() => setMode("line")}>
              Line
            </button>
            <button type="button" className={mode === "breakdown" ? "active" : ""} aria-pressed={mode === "breakdown"} onClick={() => setMode("breakdown")}>
              Breakdown
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
  const [mode, setMode] = useState<GlobalChartMode>("line");
  const [scale, setScale] = useState<GlobalScaleMode>("linear");
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
            <option value={1}>Last prompt</option>
            <option value={2}>Last 2 prompts</option>
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
          <span>View</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as GlobalChartMode)}>
            <option value="line">New tokens line</option>
            <option value="new">New token bars</option>
            <option value="breakdown">Token breakdown bars</option>
            <option value="total">Total incl. cache read</option>
            <option value="cacheRead">Cache read only</option>
          </select>
        </label>
        <label>
          <span>Scale</span>
          <select value={scale} onChange={(event) => setScale(event.target.value as GlobalScaleMode)}>
            <option value="linear">Linear scale</option>
            <option value="log">Log scale</option>
          </select>
        </label>
        <small>{visible.events.length} visible events / {visible.prompts.length} visible prompts</small>
      </div>
      <div className="global-chart-summary" aria-label="visible chart totals">
        <GlobalSummaryItem label="Chart unit" value={globalModeLabel(mode)} />
        <GlobalSummaryItem label="New tokens" value={formatNumber(visibleTotals.newTokens)} />
        <GlobalSummaryItem label="Cache read" value={formatNumber(visibleTotals.cacheRead)} />
        <GlobalSummaryItem label="Largest event" value={largestEvent ? formatNumber(globalEventValue(largestEvent, mode)) : "0"} />
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
  const series: NonNullable<EChartsOption["series"]> = (() => {
    if (mode === "line") {
      return [
        {
          type: "line" as const,
          name: "New tokens",
          data: visibleEvents.map((event) => [event.timestamp, newTokens(event), event.id, event.projectName, event.sessionName]),
          showSymbol: visibleEvents.length < 80,
          symbol: "circle",
          symbolSize: 6,
          smooth: false,
          lineStyle: { color: "#76d99f", width: 2.5 },
          itemStyle: { color: "#76d99f" },
          areaStyle: { color: "#76d99f1f" },
        },
      ];
    }
    return mode === "breakdown"
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
  })();

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
  const magnetRange = Math.min(52, Math.max(28, chart.getWidth() / Math.max(events.length * 2, 12)));
  if (!nearest || nearest.distance > magnetRange) return null;
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
  const values = events.map((event) => newTokens(event));
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  if (mode === "line") {
    series.push({
      type: "line",
      name: "New tokens",
      data: detailTotalPoints(events, "line"),
      showSymbol: events.length < 80,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { color: "#76d99f", width: 2.5 },
      itemStyle: { color: "#76d99f" },
      areaStyle: { color: "#76d99f22" },
      emphasis: { focus: "series" },
      markPoint: {
        symbol: "circle",
        symbolSize: 10,
        label: { show: false },
        itemStyle: { color: "#ff766f", borderColor: "#08110f", borderWidth: 2 },
        data: [{ type: "max", name: "Spike" }],
      },
      markLine: {
        silent: true,
        symbol: "none",
        label: { color: "#9bb2ad", formatter: `avg ${formatNumber(average)}`, position: "insideEndTop" },
        lineStyle: { color: "#80919a", type: "dashed", width: 1 },
        data: [{ yAxis: average }],
      },
    });
  } else {
    detailSeries.forEach((definition) => {
      if (!enabled[definition.key]) return;
      series.push({
        type: "line",
        name: definition.label,
        data: detailPoints(events, definition.key, mode),
        symbol: events.length < 80 ? "circle" : "none",
        symbolSize: 5,
        itemStyle: { color: definition.color },
        lineStyle: { color: definition.color, width: 1.8 },
        emphasis: { focus: "series" },
      });
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
    id: "detail-prompt-lines",
    type: "line",
    name: "Prompt lines",
    data: [],
    symbol: "none",
    lineStyle: { opacity: 0 },
    tooltip: { show: false },
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      lineStyle: { color: "#edf18a", type: "dotted", width: 1 },
      data: prompts.map((prompt) => ({ xAxis: prompt.timestamp })),
    },
  });
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
    tooltip: { formatter: (params: unknown) => detailPromptTooltip(params, prompts) },
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
      confine: true,
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
  if (mode !== "cumulative") return newTokens(events[index]);
  return events.slice(0, index + 1).reduce((sum, event) => sum + newTokens(event), 0);
}

function detailTooltip(params: unknown, events: TokenEvent[], prompts: Prompt[]): string {
  const items = Array.isArray(params) ? params : [];
  const id = items.map((item) => chartDataId((item as { data?: unknown }).data)).find((value) => events.some((event) => event.id === value));
  const event = events.find((candidate) => candidate.id === id);
  if (!event) {
    const promptId = items.map((item) => chartDataId((item as { data?: unknown }).data)).find((value) => prompts.some((prompt) => prompt.id === value));
    const prompt = prompts.find((candidate) => candidate.id === promptId);
    return prompt ? promptTooltip(prompt) : "";
  }
  const rows = visibleBreakdownRows(event);
  const promptCount = promptCountForEventWindow(prompts, event);
  return [
    `<strong>${new Date(event.timestamp).toLocaleString()}</strong>`,
    ...rows.map((row) => `<div class="chart-tooltip-row"><span>${row.label}</span><b>${formatNumber(row.value)}</b></div>`),
    ...(promptCount ? [`<div class="chart-tooltip-row"><span>Prompts</span><b>${promptCount}</b></div>`] : []),
  ].join("");
}

function detailPromptTooltip(params: unknown, prompts: Prompt[]): string {
  const id = chartDataId((params as { data?: unknown })?.data);
  const prompt = prompts.find((candidate) => candidate.id === id);
  return prompt ? promptTooltip(prompt) : "";
}

function promptTooltip(prompt: Prompt): string {
  return [
    `<strong>${escapeHtml(new Date(prompt.timestamp).toLocaleString())}</strong>`,
    `<div class="chart-tooltip-meta">User prompt</div>`,
    `<div class="chart-tooltip-row"><span>Images</span><b>${formatNumber(prompt.imageCount || 0)}</b></div>`,
    `<div class="chart-tooltip-text">${escapeHtml(shortText(prompt.text, 240))}</div>`,
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortText(value: string, limit: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
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

function detailTitle(target: DetailTarget, project: ProjectSummary | null | undefined, session: SessionSummary | null | undefined): string {
  if (target.type === "project") return project ? `${project.source} / ${project.name}` : "Project detail";
  return session ? `${session.source} / ${session.projectName} / ${session.name}` : "Session detail";
}

function detailMeta(target: DetailTarget, project: ProjectSummary | null | undefined, session: SessionSummary | null | undefined): string {
  if (target.type === "project") return project ? compactPath(project.path) : "";
  return session ? compactPath(session.projectPath || session.file) : "";
}

function filterDashboardData(data: DashboardData | null, source: Source, projectId: string): DashboardData | null {
  if (!data) return null;
  const matches = (item: { source: "codex" | "claude"; projectId: string }) =>
    (source === "all" || item.source === source) && (projectId === "all" || item.projectId === projectId);
  const events = data.events.filter(matches);
  const prompts = data.prompts.filter(matches);
  const projects = data.projects.filter((project) => (source === "all" || project.source === source) && (projectId === "all" || project.id === projectId));
  const sessions = data.sessions.filter(matches);
  return {
    summary: buildSummary(data.summary, events, prompts),
    events,
    prompts,
    projects,
    sessions,
  };
}

function buildSummary(base: Summary, events: TokenEvent[], prompts: Prompt[]): Summary {
  const ordered = sortEventsByTime(events);
  const latest = ordered.at(-1) ?? null;
  const spike = ordered.reduce<TokenEvent | null>((best, event) => (!best || newTokens(event) > newTokens(best) ? event : best), null);
  return {
    ...base,
    events: events.length,
    prompts: prompts.length,
    totals: tokenSums(events),
    latest,
    spike,
    daily: dailyTotals(events),
  };
}

function dailyTotals(events: TokenEvent[]): DailyTotal[] {
  const byDay = new Map<string, DailyTotal>();
  for (const event of events) {
    const day = event.timestamp.slice(0, 10);
    const current = byDay.get(day) ?? { day, total: 0, events: 0, spike: 0, average: 0 };
    const value = newTokens(event);
    current.total += value;
    current.events += 1;
    current.spike = Math.max(current.spike, value);
    current.average = current.total / current.events;
    byDay.set(day, current);
  }
  return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day));
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
