// Deciding whether a turn needs retrieval at all.
//
// SECURITY: prior sources arrive in the client-controlled request body. Only a
// pattern-checked slug and a clamped similarity leave this module, and the caller
// re-fetches every row from Postgres.
import { isExploratory } from "@/lib/chat-config";
import type { ChatMessage } from "@/lib/chat-types";
import type { Pantry } from "@/lib/ingredients";

// Ingest generates lowercase kebab-case slugs; anything else is not from the corpus.
export const SLUG_PATTERN = /^[a-z0-9-]{1,128}$/;

// Cap, so a crafted body cannot widen the context beyond what retrieval produces.
export const MAX_REUSED_SLUGS = 8;

// A recipe the previous turn was grounded in; its similarity is carried forward unchanged.
export type PriorSource = {
  slug: string;
  similarity: number;
};

export type ReuseReason =
  | "reuse"
  | "no-prior-sources"
  | "new-ingredients"
  | "exploratory";

export type ReuseDecision = {
  reuse: boolean;
  sources: PriorSource[];
  reason: ReuseReason;
};

function clampSimilarity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// The slugs of the most recent assistant turn — the recipes currently on screen.
export function priorSourcesFrom(messages: readonly ChatMessage[]): PriorSource[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const raw: unknown = (message.metadata as { sources?: unknown } | undefined)?.sources;
    if (!Array.isArray(raw)) return [];

    const sources: PriorSource[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      if (sources.length >= MAX_REUSED_SLUGS) break;
      const slug = (entry as { slug?: unknown } | null | undefined)?.slug;
      if (typeof slug !== "string" || !SLUG_PATTERN.test(slug) || seen.has(slug)) continue;
      seen.add(slug);
      sources.push({
        slug,
        similarity: clampSimilarity((entry as { similarity?: unknown }).similarity),
      });
    }

    return sources;
  }

  return [];
}

// The pantry only accumulates, so a new key means this turn named something new.
export function hasNewPantryTerms(before: Pantry, after: Pantry): boolean {
  for (const term of after.keys()) {
    if (!before.has(term)) return true;
  }
  return false;
}

// Reuse only when all three conditions hold; each refusal carries its reason.
export function decideReuse({
  priorSources,
  query,
  pantryBefore,
  pantryAfter,
}: {
  priorSources: PriorSource[];
  query: string;
  pantryBefore: Pantry;
  pantryAfter: Pantry;
}): ReuseDecision {
  if (priorSources.length === 0) {
    return { reuse: false, sources: [], reason: "no-prior-sources" };
  }
  // A new ingredient changes the question, so it has to change the answer.
  if (hasNewPantryTerms(pantryBefore, pantryAfter)) {
    return { reuse: false, sources: [], reason: "new-ingredients" };
  }
  // The user is asking for recipes other than the ones on screen.
  if (isExploratory(query)) {
    return { reuse: false, sources: [], reason: "exploratory" };
  }
  return { reuse: true, sources: priorSources, reason: "reuse" };
}
