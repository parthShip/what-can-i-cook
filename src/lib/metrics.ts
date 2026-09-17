// One structured row per chat turn, so what a turn costs can be read off the logs.

// Which rendering of the retrieved recipes went into the prompt.
export type ContextTier = "brief" | "full";

// Stable prefix, so rows can be grepped out of a mixed log stream.
export const METRICS_PREFIX = "[metrics]";

export type TurnMetrics = {
  // Null when no model answered, or when usage was unavailable — modelId tells which.
  inputTokens: number | null;
  outputTokens: number | null;
  // Tokens billed at 10% because Gemini matched a cached prefix.
  cachedTokens: number | null;
  totalTokens: number | null;

  // Which model served the turn, and how far down CHAT_MODELS it sits.
  modelId: string | null;
  modelIndex: number | null;

  // Did this turn skip embedding and search entirely, and why not when not.
  retrievalReused: boolean;
  reuseReason: string;

  contextTier: ContextTier;
  // Rows fetched, and rows actually put in the prompt. Equal until a rerank lands.
  candidateCount: number;
  matchCount: number;
  // Did the turn end in the no-match reply?
  refused: boolean;

  // Null when the stage did not run.
  embedMs: number | null;
  retrieveMs: number | null;
  firstTokenMs: number | null;
  totalMs: number;
};

// Only the shape we read, so tests need no full LanguageModelUsage.
type UsageLike = {
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
};

// Prefers the SDK's provider-agnostic field, falling back to Google's own count.
export function cachedTokensFrom(
  usage: UsageLike | undefined,
  providerMetadata: unknown,
): number | null {
  const fromUsage = usage?.inputTokenDetails?.cacheReadTokens;
  if (typeof fromUsage === "number") return fromUsage;

  const google = (
    providerMetadata as
      | { google?: { usageMetadata?: { cachedContentTokenCount?: unknown } } }
      | undefined
  )?.google;
  const fromProvider = google?.usageMetadata?.cachedContentTokenCount;
  return typeof fromProvider === "number" ? fromProvider : null;
}

export function formatTurnMetrics(metrics: TurnMetrics): string {
  return `${METRICS_PREFIX} ${JSON.stringify(metrics)}`;
}

// console.log, not a table: the platform's log drain already collects it.
export function logTurnMetrics(metrics: TurnMetrics): void {
  console.log(formatTurnMetrics(metrics));
}
