export type Source = "all" | "codex" | "claude";
export type Range = "live" | "24h" | "7d" | "30d" | "all";

export interface TokenEvent {
  id: string;
  source: "codex" | "claude";
  timestamp: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  sessionId: string;
  sessionName: string;
  session: string;
  file: string;
  model: string;
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  total: number;
  cumulativeTotal: number | null;
  contextWindow: number | null;
  contextPercent: number | null;
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
}

export interface Prompt {
  id: string;
  source: "codex" | "claude";
  timestamp: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  sessionId: string;
  sessionName: string;
  session: string;
  file: string;
  text?: string;
  imageCount: number;
}

export interface TokenTotals {
  newTokens: number;
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  total: number;
}

export interface DailyTotal {
  day: string;
  total: number;
  events: number;
  spike: number;
  average: number;
}

export interface Summary {
  generatedAt: string;
  range: Range;
  events: number;
  prompts: number;
  totals: TokenTotals;
  latest: TokenEvent | null;
  spike: TokenEvent | null;
  daily: DailyTotal[];
}

export interface ProjectSummary {
  id: string;
  source: "codex" | "claude";
  name: string;
  path: string;
  events: number;
  prompts: number;
  totals: TokenTotals;
  latestTime: string;
  spikeEventId: string;
  spikeNewTokens: number;
}

export interface SessionSummary {
  id: string;
  source: "codex" | "claude";
  projectId: string;
  projectName: string;
  projectPath: string;
  name: string;
  session: string;
  file: string;
  events: number;
  prompts: number;
  totals: TokenTotals;
  firstTime: string;
  latestTime: string;
  spikeEventId: string;
  spikeNewTokens: number;
}

export interface DashboardData {
  summary: Summary;
  events: TokenEvent[];
  prompts: Prompt[];
  projects: ProjectSummary[];
  sessions: SessionSummary[];
}
