import { describe, expect, it } from "vitest";

import {
  cachedTokensFrom,
  formatTurnMetrics,
  METRICS_PREFIX,
  type TurnMetrics,
} from "@/lib/metrics";

const ROW: TurnMetrics = {
  inputTokens: 1130,
  outputTokens: 210,
  cachedTokens: 0,
  totalTokens: 1340,
  modelId: "gemini-3.6-flash",
  modelIndex: 0,
  retrievalReused: false,
  reuseReason: "no-prior-sources",
  contextTier: "brief",
  candidateCount: 4,
  matchCount: 4,
  refused: false,
  embedMs: 180,
  retrieveMs: 42,
  firstTokenMs: 610,
  totalMs: 1450,
};

describe("cachedTokensFrom", () => {
  it("prefers the provider-agnostic usage detail", () => {
    expect(
      cachedTokensFrom(
        { inputTokenDetails: { cacheReadTokens: 1024 } },
        { google: { usageMetadata: { cachedContentTokenCount: 7 } } },
      ),
    ).toBe(1024);
  });

  it("reads zero as a real measurement, not a miss", () => {
    expect(cachedTokensFrom({ inputTokenDetails: { cacheReadTokens: 0 } }, undefined)).toBe(0);
  });

  it("falls back to the google provider metadata", () => {
    expect(
      cachedTokensFrom(undefined, {
        google: { usageMetadata: { cachedContentTokenCount: 2048 } },
      }),
    ).toBe(2048);
  });

  it("returns null when neither source reported anything", () => {
    expect(cachedTokensFrom(undefined, undefined)).toBeNull();
    expect(cachedTokensFrom({ inputTokenDetails: {} }, {})).toBeNull();
    expect(cachedTokensFrom({ inputTokenDetails: {} }, { google: {} })).toBeNull();
  });

  it("ignores a non-numeric value rather than logging a string", () => {
    expect(
      cachedTokensFrom(undefined, {
        google: { usageMetadata: { cachedContentTokenCount: "lots" } },
      }),
    ).toBeNull();
  });
});

describe("formatTurnMetrics", () => {
  it("emits one greppable line", () => {
    const line = formatTurnMetrics(ROW);
    expect(line.startsWith(`${METRICS_PREFIX} `)).toBe(true);
    expect(line).not.toContain("\n");
  });

  it("round-trips through JSON so a log drain can parse it", () => {
    const line = formatTurnMetrics(ROW);
    const json = line.slice(METRICS_PREFIX.length + 1);
    expect(JSON.parse(json)).toEqual(ROW);
  });
});
