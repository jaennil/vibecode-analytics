import type { DashboardData, Prompt, ProjectSummary, Range, SessionSummary, Source, Summary, TokenEvent } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface Query {
  range: Range;
  source: Source;
  projectId?: string;
  sessionId?: string;
}

export async function fetchDashboard(query: Query, signal?: AbortSignal): Promise<DashboardData> {
  const [summary, events, prompts, projects, sessions] = await Promise.all([
    get<Summary>("/api/v2/summary", query, signal),
    get<{ events: TokenEvent[] }>("/api/v2/events", query, signal),
    get<{ prompts: Prompt[] }>("/api/v2/prompts", query, signal),
    get<{ projects: ProjectSummary[] }>("/api/v2/projects", query, signal),
    get<{ sessions: SessionSummary[] }>("/api/v2/sessions", query, signal),
  ]);

  return {
    summary,
    events: events.events,
    prompts: prompts.prompts,
    projects: projects.projects,
    sessions: sessions.sessions,
  };
}

async function get<T>(path: string, query: Query, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  url.searchParams.set("range", query.range);
  url.searchParams.set("source", query.source);
  if (query.projectId) url.searchParams.set("projectId", query.projectId);
  if (query.sessionId) url.searchParams.set("sessionId", query.sessionId);

  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
