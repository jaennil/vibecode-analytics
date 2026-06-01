import { describe, expect, it } from "vitest";
import {
  compactPath,
  findNearestEventForPrompt,
  findSpikeEvent,
  formatAverage,
  newTokens,
  promptsForTurn,
  sortEventsByTime,
  tokenSums,
  visibleBreakdownRows,
} from "./selectors";
import type { Prompt, TokenEvent } from "./types";

const event = (id: string, input: number, output: number, overrides: Partial<TokenEvent> = {}): TokenEvent => ({
  id,
  source: "codex",
  timestamp: "2026-05-01T10:00:00Z",
  projectId: "codex:/work/demo",
  projectName: "demo",
  projectPath: "/work/demo",
  sessionId: "codex:/work/demo",
  sessionName: "demo",
  session: "s1",
  file: "/tmp/s1.jsonl",
  model: "gpt",
  input,
  cacheCreate: 2,
  cacheRead: 3,
  output,
  reasoning: 5,
  total: input + output,
  cumulativeTotal: null,
  contextWindow: null,
  contextPercent: null,
  fiveHourPercent: null,
  weeklyPercent: null,
  ...overrides,
});

const prompt = (id: string, timestamp: string): Prompt => ({
  id,
  source: "codex",
  timestamp,
  projectId: "codex:/work/demo",
  projectName: "demo",
  projectPath: "/work/demo",
  sessionId: "codex:/work/demo",
  sessionName: "demo",
  session: "s1",
  file: "/tmp/s1.jsonl",
  text: id,
  imageCount: 0,
});

describe("selectors", () => {
  it("computes new tokens without cache reads", () => {
    expect(newTokens(event("e1", 10, 20))).toBe(37);
  });

  it("sums token fields", () => {
    expect(tokenSums([event("e1", 10, 20), event("e2", 1, 2)]).newTokens).toBe(47);
  });

  it("compacts long paths", () => {
    expect(compactPath("/a/very/long/project/path", 10)).toBe("...ct/path");
  });

  it("formats averages with two decimals", () => {
    expect(formatAverage(1234.5)).toBe("1,234.50");
    expect(formatAverage(12.345)).toBe("12.35");
  });

  it("sorts events chronologically and finds the spike", () => {
    const first = event("first", 10, 20, { timestamp: "2026-05-01T10:00:00Z" });
    const spike = event("spike", 100, 20, { timestamp: "2026-05-01T10:02:00Z" });
    const middle = event("middle", 30, 20, { timestamp: "2026-05-01T10:01:00Z" });
    expect(sortEventsByTime([spike, first, middle]).map((item) => item.id)).toEqual(["first", "middle", "spike"]);
    expect(findSpikeEvent([first, spike, middle])?.id).toBe("spike");
  });

  it("filters zero tooltip rows and sorts visible values", () => {
    const rows = visibleBreakdownRows(event("e1", 10, 0, { cacheCreate: 0, cacheRead: 200, reasoning: 0 }));
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Cache read", 200],
      ["New tokens", 10],
      ["Fresh input", 10],
    ]);
  });

  it("associates prompts with the following turn boundary", () => {
    const events = [
      event("e1", 1, 1, { timestamp: "2026-05-01T10:01:00Z" }),
      event("e2", 1, 1, { timestamp: "2026-05-01T10:03:00Z" }),
    ];
    const prompts = [
      prompt("before-first", "2026-05-01T10:00:00Z"),
      prompt("after-first", "2026-05-01T10:02:00Z"),
      prompt("at-second", "2026-05-01T10:03:00Z"),
    ];
    expect(promptsForTurn(prompts, events, "e1").map((item) => item.id)).toEqual(["before-first"]);
    expect(promptsForTurn(prompts, events, "e2").map((item) => item.id)).toEqual(["after-first", "at-second"]);
  });

  it("finds the event nearest to a prompt", () => {
    const events = [
      event("early", 1, 1, { timestamp: "2026-05-01T10:00:00Z" }),
      event("late", 1, 1, { timestamp: "2026-05-01T10:05:00Z" }),
    ];
    expect(findNearestEventForPrompt(events, prompt("p1", "2026-05-01T10:04:00Z"))?.id).toBe("late");
  });
});
