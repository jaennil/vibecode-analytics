import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { fetchDashboard } from "./api";
import { compactPath, formatNumber, newTokens, promptsInWindow, tokenSums } from "./selectors";
import type { DashboardData, Prompt, ProjectSummary, Range, SessionSummary, Source, TokenEvent } from "./types";
import "./styles.css";

type Tab = "dashboard" | "projects" | "sessions" | "detail" | "raw";

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
  if (!sessionId) return <Empty text="Select a session from the Sessions tab to inspect it." />;
  if (!events.length) return <Empty text="No token events are available for this session in the loaded range." />;
  const session = sessions.find((item) => item.id === sessionId);
  const sums = tokenSums(events);
  return (
    <section className="panel detail">
      <PanelHead title={session ? `${session.source} / ${session.projectName} / ${session.name}` : "Session detail"} meta={session ? compactPath(session.projectPath || session.file) : ""} />
      <section className="metrics compact">
        <Metric label="Events" value={String(events.length)} note={`${prompts.length} prompts`} />
        <Metric label="New Tokens" value={formatNumber(sums.newTokens)} note="selected session" />
        <Metric label="Cache Read" value={formatNumber(sums.cacheRead)} note="reused context" />
        <Metric label="Output" value={formatNumber(sums.output)} note="answer tokens" />
      </section>
      <TokenChart events={events} prompts={prompts} large breakdown />
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
    const chart = chartRef.current ?? echarts.init(ref.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    chart.setOption(tokenOption(events, prompts, large, breakdown), { notMerge: true });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [events, prompts, large, breakdown]);

  useEffect(() => () => chartRef.current?.dispose(), []);

  return <div ref={ref} className={large ? "chart large" : "chart"} />;
}

function DailyChart({ data }: { data: Array<{ day: string; total: number; average: number }> }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = chartRef.current ?? echarts.init(ref.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    chart.setOption({
      animation: false,
      grid: { top: 20, right: 58, bottom: 36, left: 64 },
      tooltip: { trigger: "axis", backgroundColor: "#132024", borderColor: "#39525a", textStyle: { color: "#edf6f2" } },
      xAxis: { type: "category", data: data.map((item) => item.day), axisLabel: { color: "#9bb2ad" } },
      yAxis: [
        { type: "value", axisLabel: { color: "#9bb2ad", formatter: formatNumber }, splitLine: { lineStyle: { color: "#26393d" } } },
        { type: "value", axisLabel: { color: "#9bb2ad", formatter: formatNumber }, splitLine: { show: false } },
      ],
      series: [
        { type: "bar", name: "Daily total", data: data.map((item) => item.total), itemStyle: { color: "#73d99f", borderRadius: [6, 6, 0, 0] } },
        { type: "line", name: "Average", yAxisIndex: 1, data: data.map((item) => item.average), lineStyle: { color: "#ffcc66", width: 2 } },
      ],
    } satisfies EChartsOption);
  }, [data]);
  useEffect(() => () => chartRef.current?.dispose(), []);
  return <div ref={ref} className="chart large" />;
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
