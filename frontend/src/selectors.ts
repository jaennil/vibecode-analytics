import type { Prompt, TokenEvent, TokenTotals } from "./types";

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
  const first = new Date(events[0].timestamp).getTime();
  const last = new Date(events[events.length - 1].timestamp).getTime();
  return prompts.filter((prompt) => {
    const time = new Date(prompt.timestamp).getTime();
    return time >= first && time <= last;
  });
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
