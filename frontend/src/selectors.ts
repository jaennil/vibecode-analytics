import type { Prompt, TokenEvent, TokenTotals } from "./types";

export interface BreakdownRow {
  key: "newTokens" | "input" | "cacheCreate" | "cacheRead" | "output" | "reasoning";
  label: string;
  value: number;
}

export function newTokens(event?: Pick<TokenEvent, "input" | "cacheCreate" | "output" | "reasoning"> | null): number {
  if (!event) return 0;
  return Number(event.input || 0) + Number(event.cacheCreate || 0) + Number(event.output || 0) + Number(event.reasoning || 0);
}

export function tokenSums(events: TokenEvent[]): TokenTotals {
  return events.reduce<TokenTotals>(
    (sum, event) => ({
      newTokens: sum.newTokens + newTokens(event),
      input: sum.input + Number(event.input || 0),
      cacheCreate: sum.cacheCreate + Number(event.cacheCreate || 0),
      cacheRead: sum.cacheRead + Number(event.cacheRead || 0),
      output: sum.output + Number(event.output || 0),
      reasoning: sum.reasoning + Number(event.reasoning || 0),
      total: sum.total + Number(event.total || 0),
    }),
    { newTokens: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, reasoning: 0, total: 0 },
  );
}

export function promptsInWindow(prompts: Prompt[], events: TokenEvent[]): Prompt[] {
  if (!events.length) return [];
  const sorted = sortEventsByTime(events);
  const first = new Date(sorted[0].timestamp).getTime();
  const last = new Date(sorted[sorted.length - 1].timestamp).getTime();
  return prompts.filter((prompt) => {
    const time = new Date(prompt.timestamp).getTime();
    return time >= first && time <= last;
  });
}

export function sortEventsByTime(events: TokenEvent[]): TokenEvent[] {
  return [...events].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

export function findSpikeEvent(events: TokenEvent[]): TokenEvent | null {
  return events.reduce<TokenEvent | null>((spike, event) => (!spike || newTokens(event) > newTokens(spike) ? event : spike), null);
}

export function eventBreakdown(event: TokenEvent): BreakdownRow[] {
  return [
    { key: "newTokens", label: "New tokens", value: newTokens(event) },
    { key: "input", label: "Fresh input", value: Number(event.input || 0) },
    { key: "cacheCreate", label: "Cache write", value: Number(event.cacheCreate || 0) },
    { key: "cacheRead", label: "Cache read", value: Number(event.cacheRead || 0) },
    { key: "output", label: "Output", value: Number(event.output || 0) },
    { key: "reasoning", label: "Reasoning", value: Number(event.reasoning || 0) },
  ];
}

export function visibleBreakdownRows(event: TokenEvent): BreakdownRow[] {
  return eventBreakdown(event)
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
}

export function promptsForTurn(prompts: Prompt[], events: TokenEvent[], eventId: string): Prompt[] {
  const sorted = sortEventsByTime(events);
  const index = sorted.findIndex((event) => event.id === eventId);
  if (index < 0) return [];
  const current = new Date(sorted[index].timestamp).getTime();
  const previous = index > 0 ? new Date(sorted[index - 1].timestamp).getTime() : Number.NEGATIVE_INFINITY;
  return prompts.filter((prompt) => {
    const timestamp = new Date(prompt.timestamp).getTime();
    return timestamp > previous && timestamp <= current;
  });
}

export function findNearestEventForPrompt(events: TokenEvent[], prompt: Prompt): TokenEvent | null {
  const promptTime = new Date(prompt.timestamp).getTime();
  return events.reduce<TokenEvent | null>((nearest, event) => {
    if (!nearest) return event;
    const nearestDistance = Math.abs(new Date(nearest.timestamp).getTime() - promptTime);
    const eventDistance = Math.abs(new Date(event.timestamp).getTime() - promptTime);
    return eventDistance < nearestDistance ? event : nearest;
  }, null);
}

export function compactPath(value: string, limit = 72): string {
  if (!value || value.length <= limit) return value;
  return `...${value.slice(-(limit - 3))}`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

export function formatAverage(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
