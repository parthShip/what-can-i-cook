# RAG & context optimization

**Date:** 2026-09-17
**Status:** design, awaiting review

## Problem

The chat route exhausts its Gemini free-tier quota under light use ("the model
peaks out"), and retrieval quality caps what the answers can be. Three measured
facts drive the design:

| Measurement | Value |
| --- | --- |
| `SYSTEM_PROMPT` | ~759 tokens |
| Context block, 4 chunks | ~1,482 tokens average |
| Share of that block that is `Steps:` text | 66.6% (~990 tokens) |
| System + context, per turn | ~2,241 tokens |
| Gemini API requests per user turn | 2 (embed + chat) |

Measured with `toChunk` over all 2,000 rows of `data/recipes.json`, estimating
4 characters per token.

Three consequences:

1. **Two-thirds of the grounded context is text the prompt forbids the model to
   use.** `src/lib/prompt.ts` instructs it not to restate ingredients or
   numbered steps unless asked, yet every turn ships all of them.
2. **Implicit caching never fires.** Gemini bills a byte-identical prefix of
   ≥1,024 tokens (Flash) at 10%. The prefix here is
   `SYSTEM_PROMPT + buildContextBlock(...)`, and the context block changes every
   turn because `route.ts` re-retrieves unconditionally. The stable portion is
   759 tokens — below the floor.
3. **Dense-only retrieval is the quality ceiling.** Published pgvector
   comparisons put dense-only precision near 62% against ~84% for dense plus
   full-text fused with Reciprocal Rank Fusion. Dense-only specifically misses
   proper nouns, which here means ingredients like gochujang, harissa, paneer.

## Non-goals

- Re-embedding the corpus. Every change below preserves the existing 768-dim
  `gemini-embedding-001` vectors.
- Agentic / tool-calling RAG. Each tool call is another billed request and
  another second of latency, which is strictly worse for an app already out of
  quota, and it moves the "never invent a recipe" guarantee from code into model
  judgment.
- Any change to the recipe card components. They already render from data.
- Unrelated refactoring.

## Unknowns this design accommodates

Which quota ceiling binds first (requests/day, requests/minute, or tokens) is
currently unknown, and so is typical session length. The fixes for those cases
differ, and two of them pull against each other: trimming context reduces tokens
but can drop the prefix below the cache floor, while keeping context stable
maximises cache hits but not raw token count.

Therefore Phase 0 is instrumentation, and Phases 1–5 are ordered so that every
phase is a win under *all three* ceilings. The one genuinely
ceiling-dependent decision — how aggressively to trim — is deferred to Phase 6,
to be made against real data.

## Architecture

Six phases, each independently shippable and independently measurable.

This is more than one implementation plan's worth of work. Suggested split:
**plan one covers Phases 0–2** (measurement, tiering, reuse — the token and
request wins, no migration beyond none at all), **plan two covers Phases 3–5**
(hybrid ranking, rerank, persistent cache — the quality wins, all of which touch
`schema.sql`). Phase 6 is a decision, not an implementation, and needs Phase 0
data first.

### Phase 0 — Measurement

**Files:** `src/app/api/chat/route.ts`, `src/lib/metrics.ts` (new),
`scripts/check.ts`

Add `onFinish` to the `streamText` call and record one structured row per turn:

| Field | Source |
| --- | --- |
| `promptTokens`, `completionTokens` | `result.usage` |
| `cachedTokens` | `providerMetadata.google.usageMetadata.cachedContentTokenCount` |
| `modelId`, `modelIndex` | which entry of `CHAT_MODELS` served the turn |
| `retrievalReused` | boolean, from Phase 2 |
| `contextTier` | `"brief"` or `"full"`, from Phase 1 |
| `candidateCount`, `matchCount` | retrieval |
| `refused` | did the answer take the no-match path |
| `latencyMs` | wall clock for embed, retrieve, first token |

Destination: structured `console.log` with a stable `[metrics]` prefix, which
requires no migration and is readable in Vercel logs. A Postgres table is a
later option if aggregation is wanted.

`scripts/check.ts` gains a summary that reports which quota was hit, so the
Phase 6 decision has evidence.

**This phase must ship and collect data before Phase 6 is decided.** Phases 1–5
may proceed in parallel with collection.

### Phase 1 — Tiered context

**Files:** `src/lib/prompt.ts`, `src/lib/chat-config.ts`,
`src/app/api/chat/route.ts`

Two renderings of a retrieved recipe, both derived from the `metadata` JSON that
`match_recipes` already returns, so no schema change and no re-ingest:

- **brief** — title, ingredients with quantities, cuisine, country, tags,
  difficulty, timing, tips. Steps replaced by the marker
  `Steps: shown on the recipe card (N steps) — not repeated here.`
- **full** — the existing `content` chunk, steps verbatim.

Tier selection reuses `PRECISE_PATTERNS` from `chat-config.ts`, which already
detects the method-and-amount questions that need steps. Extract the predicate
as `needsFullSteps(query: string): boolean` so tier and temperature read from
one source of truth rather than two copies of the same regex list.

`SYSTEM_PROMPT` gains one rule: when the block says steps are on the card, point
the user at the card rather than describing a method. This *strengthens* rule 3
— the model cannot paraphrase a step it was never shown.

Safe because `src/components/recipe/recipe-steps.tsx` renders instructions from
`sources` metadata regardless of what the prompt contains. The user loses
nothing.

**Expected:** context block ~1,482 → ~495 tokens on non-method turns.

### Phase 2 — Retrieval reuse on follow-ups

**Files:** `src/app/api/chat/route.ts`, `src/lib/retrieval.ts`

Today the last user message is always the retrieval query, so "how long do I
bake it?" is embedded as an ingredient search and retrieves unrelated recipes.
The current comment in `route.ts` treats re-retrieval as harmless; it is not.

Recover the previous turn's slugs from the last assistant message's
`messageMetadata.sources`.

**Verified against the installed packages (2026-09-17), not assumed.** The
round-trip holds at every hop:

1. `writer.write({ type: "start", messageMetadata: { sources } })` emits a chunk
   whose `messageMetadata` is declared optional-unknown in `uiMessageChunkSchema`.
2. Client-side, `updateMessageMetadata` merges it into `state.message.metadata`
   (`ai@7.0.94`, `dist/index.js:7141`), so it survives on the stored message.
3. `@ai-sdk/react@4.0.97` preserves it across snapshots — `chat.react.ts:104`
   copies `metadata` when present.
4. `HttpChatTransport.sendMessages` builds its default body as
   `{ ...body, id, messages: options.messages, trigger, messageId }`
   (`dist/index.js:18906`) and `JSON.stringify`s it. `messages` are the whole
   `UIMessage` objects, `metadata` included. `chat-panel.tsx` uses a plain
   `DefaultChatTransport` with no `prepareSendMessagesRequest`, so this default
   path is the one in force.
5. Server-side `bodySchema` uses `z.looseObject`, which preserves unknown keys,
   so `metadata` reaches the handler rather than being stripped by validation.

The risk is therefore retired, not mitigated.

**Security:** that metadata is client-controlled. Trust **only the slug
strings**, then re-fetch rows from Postgres via a new
`fetchRecipesBySlug(supabase, slugs)`. Recipe content therefore always comes
from the database, never from the request body — a client cannot inject a
fabricated recipe into the grounded context. Cap at 8 slugs and validate each
against `/^[a-z0-9-]{1,128}$/`.

Reuse when **all** hold:

1. A previous assistant message carries at least one valid slug.
2. The current turn contributes no new pantry ingredient (`buildPantry` over
   prior turns vs. including this one).
3. The turn does not match `EXPLORATORY_PATTERNS` — "what else", "other
   options", "something different" mean the user wants *new* recipes even with
   an unchanged pantry.

Fall back to full retrieval whenever the slug re-fetch returns fewer rows than
requested (a recipe was deleted, or the slugs were junk).

**Three wins at once:** one fewer Gemini request per follow-up turn; a
byte-identical prefix across turns, making the block cache-eligible; and
follow-ups grounded in the recipe actually under discussion.

#### Phase 2b — Trim the upload (found while verifying the above)

Because the default transport posts whole `UIMessage` objects, every request
re-uploads the full `sources` metadata of *every* prior assistant turn —
including each recipe's complete `instructions` and `ingredients` arrays.
Measured on this corpus: **6,298 bytes per assistant turn**, so a six-turn
transcript uploads **~37 KB of recipe JSON the server does not read**. The
handler needs only the slugs: 13 bytes for the same four recipes.

Give `DefaultChatTransport` a `prepareSendMessagesRequest` that projects each
outgoing message to its `id`, `role`, `parts` and a metadata stub of
`{ sources: [{ slug }] }`. This changes only the wire format — client state
keeps the full sources, so the recipe cards render unchanged.

This costs no Gemini tokens either way, so it is a latency and bandwidth win
rather than a quota win. It also narrows the trust boundary Phase 2 has to
defend: after this, slugs are the only recipe data a client can send at all.

### Phase 3 — Hybrid ranking in Postgres

**Files:** `supabase/schema.sql`, `src/lib/retrieval.ts`

Add a generated column and a GIN index — instant on 2,000 rows, no re-embed:

```sql
alter table recipes add column if not exists fts tsvector
  generated always as (to_tsvector('english', title || ' ' || content)) stored;
create index if not exists recipes_fts_gin_idx on recipes using gin (fts);
```

New RPC `match_recipes_hybrid(query_embedding, query_terms text[],
match_threshold, match_count, rrf_k default 60)`:

- dense arm: top `match_count * 2` by `embedding <=> query_embedding`
- lexical arm: top `match_count * 2` by `ts_rank(fts, ...)`
- fuse: `FULL OUTER JOIN` on `id`, score `1/(k + dense_rank) + 1/(k + lex_rank)`,
  the standard RRF with k = 60
- return the best `match_count` fused rows

Callers set `match_count` to the number of *candidates* they want to rerank,
which Phase 4 fixes at 12; each arm therefore scans 24. Until Phase 4 lands,
`route.ts` keeps passing `MATCH_COUNT = 4` and no rerank runs.
- return `similarity` (the raw cosine value) as today, so the UI relevance badge
  and `SourceRecipe.similarity` are unchanged

**Lexical query text is the normalised pantry terms, not the raw message.**
`buildPantry` already strips filler and resolves synonyms, so the terms are
exactly the content words worth matching. Terms are sanitized in TypeScript with
`/[^a-z0-9]/g` and passed as `text[]`; the function joins them with `|` inside
`to_tsquery`, so no user text ever reaches tsquery syntax. Empty array ⇒ dense
arm only.

**Preserving the refusal path:** RRF has no natural similarity threshold, and
the no-match reply depends on one. A candidate qualifies only if it clears
`match_threshold` on the dense arm **or** has a non-zero `ts_rank`. An empty
result set still reaches rule 2 of the system prompt and still refuses.

**Rollout safety:** `searchRecipes` calls the hybrid RPC and falls back to the
existing `match_recipes` on a missing-function error (`PGRST202`), so deploying
code before running the migration degrades instead of breaking.

### Phase 4 — Local rerank and model routing

**Files:** `src/lib/retrieval.ts`, `src/lib/chat-config.ts`,
`src/app/api/chat/route.ts`

**Rerank.** Fetch 12 fused candidates, score in the app, pass the top 3:

```
score = 0.6 * normalisedRrf + 0.4 * pantryCoverage
pantryCoverage = have.length / max(1, requiredIngredientCount)
```

Ties break toward the lower `missingRequiredCount`. This costs nothing — the
pantry comparison in `src/lib/ingredients.ts` already runs for every candidate —
and it ranks by the question the app actually exists to answer: what can I cook
*right now*. A recipe you can make beats a semantically nearer one you cannot.

Top 3 rather than 4, since the system prompt already recommends at most three.

**Model routing.** Free-tier quota is counted per model, so spreading load across
the chain postpones exhaustion. Add
`modelChainFor(query): readonly string[]`, returning `CHAT_MODELS` reordered:
`flash-lite` first for a plain ingredient list, current order for substitution
and comparison questions that need the stronger model. Gated by an env flag
(`ROUTE_SIMPLE_TO_LITE`) so it can be switched off if Phase 0 shows the prose
suffers. Failover semantics in `streamAnswer` are unchanged; only the order is.

### Phase 5 — Persistent embedding cache

**Files:** `supabase/schema.sql`, `src/app/api/chat/route.ts`

The `Map` in `route.ts` is per-instance and dies on every cold start, so on
serverless it rarely hits. Add an L2:

```sql
create table if not exists query_embeddings (
  query_hash  text primary key,
  embedding   vector(768) not null,
  created_at  timestamptz not null default now()
);
```

Lookup order: in-process LRU → `query_embeddings` → Gemini. Key is
`sha256(normalised query)`, normalisation being lowercase and collapsed
whitespace, matching today's cache key. This is the strongest available lever if
requests-per-day turns out to be the binding ceiling, since suggestion chips and
retries repeat queries verbatim.

Exact-text keys only. Keying on sorted pantry terms would raise the hit rate but
conflates "chicken and rice" with "rice and chicken", which are not the same
vector; not worth the correctness risk.

### Phase 6 — Trim depth, decided on data

Deferred deliberately. Once Phase 0 has real numbers:

- **Tokens are the ceiling** ⇒ trim hard. Also shorten `SYSTEM_PROMPT`, which at
  759 tokens restates several rules, and cut `HISTORY_MESSAGES` from 12 by
  dropping assistant prose while keeping user turns.
- **Requests are the ceiling** ⇒ do not trim below the ~1,024-token cache floor.
  The trimmed prefix lands near ~1,130 tokens, over the line but not
  comfortably. Prioritise Phases 2 and 5 instead.

## Expected outcome

| | Before | After (phases 1–4) |
| --- | --- | --- |
| Grounded prompt, typical turn | ~2,241 tok | ~1,130 tok |
| Gemini requests, follow-up turn | 2 | 1 |
| Retrieval | dense only | hybrid RRF + pantry rerank |
| Cache eligibility | never | follow-up turns |

## Testing

No test framework is installed, and Phase 3's premise is unfalsifiable without
one. Add `vitest` as a dev dependency.

**Unit tests** over pure functions, which is most of this design:

- `needsFullSteps` / `temperatureFor` — tier and temperature classification,
  including the documented precise-beats-exploratory tie
- brief vs. full context rendering — brief must contain no step text; absent
  fields must stay absent, never defaulted
- the Phase 2 reuse predicate — each of the three conditions, plus slug
  validation rejecting junk and over-long lists
- rerank scoring — a fully-cookable lower-similarity recipe must outrank a
  higher-similarity one with missing staples
- tsquery term sanitization — no term may contain tsquery operators

**Retrieval eval harness**, extending `scripts/check.ts`: ~20 fixture queries
with expected slugs, covering ingredient lists, proper-noun ingredients
(gochujang, harissa, paneer — the dense-only blind spot), and queries that
*should* refuse. Reports recall@3 and refusal accuracy. Run against
`match_recipes` and `match_recipes_hybrid` to produce the before/after number
that justifies Phase 3, or to disprove it.

**Manual check** per `AGENTS.md`: read the relevant guide under
`node_modules/next/dist/docs/` before touching route or streaming code, since
this Next.js version's conventions may differ.

## Risks

| Risk | Mitigation |
| --- | --- |
| An SDK upgrade stops returning `messageMetadata`, silently killing Phase 2 | Round-trip verified against `ai@7.0.94` / `@ai-sdk/react@4.0.97` (see Phase 2); `retrievalReused` is logged, so a regression to 0% is visible rather than silent |
| Hybrid RPC deployed without the migration | `PGRST202` fallback to `match_recipes` |
| `flash-lite` degrades prose quality | Env-flag gated; Phase 0 metrics show which model served each turn |
| Reuse pins a stale recipe when the user has moved on | `EXPLORATORY_PATTERNS` escape hatch plus the new-ingredient check |
| Brief tier makes the model refuse a method it could have quoted | Steps stay visible on the card; `needsFullSteps` escalates before retrieval |

## Note

`git init` was run on 2026-09-17; this document is committed on `main` as the
first commit alongside the existing tree.
