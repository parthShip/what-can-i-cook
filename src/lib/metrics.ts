// One structured row per chat turn. Phase 6 of the design turns on which quota
// actually binds — requests or tokens — and that is not currently known, so the
// cheapest possible answer is to log it and read the logs.

// Which rendering of the retrieved recipes went into the prompt.
export type ContextTier = "brief" | "full";

// A stable prefix, so the rows can be grepped out of a mixed log stream:
//   vercel logs --since 1d | grep '^\[metrics\]'
export const METRICS_PREFIX = "[metrics]";

export type TurnMetrics = {
  // Billing. Null means the model never answered (every one was out of quota).
  inputTokens: number | null;
  outputTokens: number | null;
  // Tokens billed at 10% because Gemini matched a cached prefix. The number this
  // whole design is trying to move off zero.
  cachedTokens: number | null;
  totalTokens: number | null;

  // Which model served the turn, and how far down CHAT_MODELS we had to walk to
  // find it. A rising modelIndex is the free tier being spent, model by model.
  modelId: string | null;
  modelIndex: number | null;

  // Phase 2: did this turn skip embedding and search entirely?
  retrievalReused: boolean;
  // Why not, when not — so a reuse rate of zero can be explained rather than guessed.
  reuseReason: string;

  contextTier: ContextTier;
  // Rows fetched before ranking, and rows actually put in the prompt. Equal until
  // Phase 4 adds a local rerank; kept separate now so the field does not move later.
  candidateCount: number;
  matchCount: number;
  // Did the turn end in the no-match reply? A rising refusal rate is the signal
  // that retrieval quality, not cost, is the problem to work on next.
  refused: boolean;

  // Null when the stage did not run: embedMs on a reused turn, firstTokenMs when
  // no model produced a token.
  embedMs: number | null;
  retrieveMs: number | null;
  firstTokenMs: number | null;
  totalMs: number;
};

// Only the shape we read, so this stays testable without constructing a full
// LanguageModelUsage.
type UsageLike = {
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
};

// `usage.inputTokenDetails.cacheReadTokens` is the provider-agnostic field and is
// preferred. The Google-specific path is the fallback, for the case where the
// provider reports its own count but the SDK has not mapped it.
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

// Deliberately a console.log and not a table: this needs no migration, and Vercel's
// log drain already collects it. A Postgres table is a later option if aggregation
// is wanted.
export function logTurnMetrics(metrics: TurnMetrics): void {
  console.log(formatTurnMetrics(metrics));
}
