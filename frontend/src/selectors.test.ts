import { describe, expect, it } from "vitest";
import { compactPath, newTokens, tokenSums } from "./selectors";
import type { TokenEvent } from "./types";

const event = (id: string, input: number, output: number): TokenEvent => ({
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
});
