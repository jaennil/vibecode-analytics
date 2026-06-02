import type { DashboardData, Range, Source } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface Query {
  range: Range;
  source: Source;
  projectId?: string;
  sessionId?: string;
}

export async function fetchDashboard(query: Query, signal?: AbortSignal): Promise<DashboardData> {
  return get<DashboardData>("/api/v2/dashboard", query, signal);
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
