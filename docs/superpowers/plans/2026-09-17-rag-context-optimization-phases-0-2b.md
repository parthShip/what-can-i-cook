# RAG & Context Optimization — Phases 0–2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Gemini token and request cost of every chat turn — and fix the follow-up grounding bug — while adding the measurement needed to decide Phase 6.

**Architecture:** Three independent levers on the chat route, in shipping order. Phase 0 logs one structured row per turn so a baseline exists before anything changes. Phase 1 stops shipping recipe steps the system prompt forbids the model to use, choosing a `brief` or `full` context rendering from the existing `PRECISE_PATTERNS`. Phase 2 skips retrieval entirely on follow-up turns by re-fetching the previous turn's recipes by slug, which removes one Gemini request per turn and grounds follow-ups in the recipe actually under discussion. Phase 2b trims the client's upload to match what the server reads. Every new decision lives in a pure function with a unit test; the route only wires them together.

**Tech Stack:** Next.js 16.3.4 (App Router), TypeScript 5 strict, Vercel AI SDK v7 (`ai@7.0.94`, `@ai-sdk/google@4.0.65`, `@ai-sdk/react@4.0.97`), Supabase + pgvector, Zod v4, Vitest 5 (added by Task 1).

**Spec:** [docs/superpowers/specs/2026-09-17-rag-context-optimization-design.md](../specs/2026-09-17-rag-context-optimization-design.md)

## Global Constraints

- **No re-embedding.** `toChunk` in [src/lib/recipes.ts](../../../src/lib/recipes.ts) produced the stored `content` column that every embedding was computed from. Its output must stay **byte-identical**. Task 4 pins this with a golden test. New renderings are new functions.
- **No schema migration.** Everything in Phases 0–2b reads `metadata` JSON that `match_recipes` already returns, or plain columns. `supabase/schema.sql` is not touched in this plan.
- **No recipe card changes.** `src/components/recipe/*` is out of scope. The cards render from `sources` metadata and must keep rendering exactly what they render today.
- **The four ABSOLUTE RULES in `SYSTEM_PROMPT` may be extended but never weakened.** Rule 3 ("never state an ingredient, quantity, step, or cooking time that is not written in the block") is the guarantee this app exists to provide.
- **Never trust request-body recipe content.** Client-supplied `messageMetadata` is used for slug strings and similarity numbers only; all recipe text is re-fetched from Postgres.
- **Read the guide in `node_modules/next/dist/docs/` before touching route code** (per `AGENTS.md`). Already done for this plan — findings in "Version corrections" below.
- Package versions are pinned as installed; do not upgrade `ai`, `@ai-sdk/google` or `@ai-sdk/react` as part of this plan.

## Version corrections to the spec

The spec was written before the installed type definitions were read. Four of its API references are out of date; **the plan below is correct and the spec is not.** Each is verified against `node_modules`:

| Spec says | Actually required | Evidence |
| --- | --- | --- |
| add `onFinish` to `streamText` | `onFinish` is `@deprecated Use onEnd instead` — and better still, read the `PromiseLike` fields `result.usage` / `result.providerMetadata`, which work with this route's manual `for await (const part of result.stream)` loop | `ai/dist/index.d.ts:3644` (deprecation), `:96`/`:155` of the `StreamTextResult` interface (promise fields) |
| `promptTokens`, `completionTokens` | `usage.inputTokens`, `usage.outputTokens` | `LanguageModelUsage`, `ai/dist/index.d.ts:320-369` |
| cached tokens only via `providerMetadata.google.usageMetadata.cachedContentTokenCount` | prefer the provider-agnostic `usage.inputTokenDetails.cacheReadTokens`, falling back to the Google path | same `LanguageModelUsage` block; `@ai-sdk/google/dist/index.d.ts:179` |
| (not mentioned) | `export const runtime = "nodejs"` at [route.ts:25](../../../src/app/api/chat/route.ts#L25) should be **deleted** — `'nodejs'` is the default and the docs say to remove the export | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md` |

`export const maxDuration = 30` is current and stays.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `vitest.config.mts` | create | Test runner config; maps the `@/` path alias |
| `package.json` | modify | `vitest` devDependency, `test` / `test:watch` scripts |
| `src/lib/metrics.ts` | create | The `TurnMetrics` row, cached-token extraction, `[metrics]` line formatting. Pure except `logTurnMetrics`. |
| `src/lib/metrics.test.ts` | create | Tests for the above |
| `src/lib/chat-config.ts` | modify | Adds `needsFullSteps` and `isExploratory` as the single source of truth for the two regex lists |
| `src/lib/chat-config.test.ts` | create | Classification tests, including the documented precise-beats-exploratory tie |
| `src/lib/recipes.ts` | modify | Adds `toBriefChunk`; `toChunk` output frozen |
| `src/lib/recipes.test.ts` | create | Golden test on `toChunk`; brief-rendering tests |
| `src/lib/prompt.ts` | modify | `buildContextBlock` takes a tier; `SYSTEM_PROMPT` gains one rule |
| `src/lib/prompt.test.ts` | create | Brief block contains no step text; delimiters intact |
| `src/lib/reuse.ts` | create | Reads prior slugs out of untrusted metadata; decides reuse. Pure. |
| `src/lib/reuse.test.ts` | create | Slug validation, the three reuse conditions, reason codes |
| `src/lib/retrieval.ts` | modify | Adds `fetchRecipesBySlug` |
| `src/lib/chat-transport.ts` | create | `trimOutgoingMessages` — the Phase 2b wire projection. Pure. |
| `src/lib/chat-transport.test.ts` | create | Drops recipe bodies, keeps slugs, size assertion |
| `src/components/chat-panel.tsx` | modify | Wires `prepareSendMessagesRequest` |
| `src/app/api/chat/route.ts` | modify | Wiring only: reuse-or-retrieve, tier selection, metrics |
| `scripts/check.ts` | modify | Reports measured prompt sizes and captured quota errors |

Decisions locked here: **all classification and projection logic lives in `src/lib/`, never in the route or the component.** The route is already 325 lines and is the hardest file to test; every task below adds its logic to a testable module and adds only wiring to the route.

---

### Task 1: Test infrastructure, with the current temperature behaviour pinned

There is no test framework in this repo. Phase 1 refactors the regex list behind `temperatureFor` into a shared predicate, so the current behaviour must be pinned **before** that refactor, not after.

**Files:**
- Create: `vitest.config.mts`
- Create: `src/lib/chat-config.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest over `src/**/*.test.ts` with the `@/` alias resolving to `src/`. Every later task depends on this.

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest@^4.1.11
```

**Not vitest 5.** Vitest 5 declares `@types/node@^22.0.0 || >=24.0.0` as a peer, while
this repo pins `@types/node@^20`. Installing 5 needs `--force`, which leaves a tolerated
peer conflict in the lockfile and breaks a clean `npm install` for anyone else. Vitest
4.1.11 accepts `^20.0.0 || ^22.0.0 || >=24.0.0` and installs cleanly; the config and API
used below are identical across both majors.

The install must succeed with no `--force` and no `--legacy-peer-deps`. If it does not,
stop and report rather than forcing it.

- [ ] **Step 2: Create the runner config**

Create `vitest.config.mts`. The `.mts` extension is required, not cosmetic: this
`package.json` has no `"type": "module"`, so a `.ts` config is loaded as CommonJS and
Vite warns that the `import` / `import.meta.url` syntax below is unsupported by the
`configLoader: 'native'` mode that becomes the default in a future Vite major.
`tsconfig.json` already includes `**/*.mts`.

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node environment only: everything under test here is server-side or pure. There is
// no jsdom dependency, which keeps the install small and the run fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json so tests import the way the app does.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Add the scripts**

In `package.json`, add to `"scripts"` (after `"lint"`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Write the characterization test**

Create `src/lib/chat-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPERATURE,
  EXPLORATORY_TEMPERATURE,
  PRECISE_TEMPERATURE,
  temperatureFor,
} from "@/lib/chat-config";

describe("temperatureFor", () => {
  it("samples tight for method and amount questions", () => {
    expect(temperatureFor("how do i fold the batter")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("how long does it bake")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("what are the steps")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("what oven temperature")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("how many grams of flour")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("give me the recipe for it")).toBe(PRECISE_TEMPERATURE);
  });

  it("samples loose when the user wants ideas", () => {
    expect(temperatureFor("surprise me")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("what else could i make")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("something different please")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("what do you recommend")).toBe(EXPLORATORY_TEMPERATURE);
  });

  it("falls back to the default for a plain ingredient list", () => {
    expect(temperatureFor("chicken, rice and peas")).toBe(DEFAULT_TEMPERATURE);
    expect(temperatureFor("")).toBe(DEFAULT_TEMPERATURE);
  });

  // Documented in chat-config.ts: a question that is both has a right answer.
  it("lets precise win a tie against exploratory", () => {
    expect(temperatureFor("what can i use instead of butter, and how much?")).toBe(
      PRECISE_TEMPERATURE,
    );
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass against today's code**

Run: `npm test`
Expected: PASS, 4 tests, and **no Vite config warning anywhere in the output**. These tests describe existing behaviour, so they must pass immediately. A failure here means one of the assertions misreads the current regexes — fix the assertion, not `chat-config.ts`.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.mts package.json package-lock.json src/lib/chat-config.test.ts
git commit -m "test: add vitest and pin current temperature classification

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The metrics row

Phase 0's data structure, as a pure module. Wiring comes in Task 3.

**Files:**
- Create: `src/lib/metrics.ts`
- Create: `src/lib/metrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ContextTier = "brief" | "full"`
  - `type TurnMetrics` (field list in Step 3)
  - `const METRICS_PREFIX: string`
  - `cachedTokensFrom(usage: UsageLike | undefined, providerMetadata: unknown): number | null`
  - `formatTurnMetrics(metrics: TurnMetrics): string`
  - `logTurnMetrics(metrics: TurnMetrics): void`

  Task 3 imports all of these. Task 5 imports `ContextTier`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/metrics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/metrics"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/metrics.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/metrics.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics.ts src/lib/metrics.test.ts
git commit -m "feat: add per-turn metrics row for RAG cost measurement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire metrics into the chat route (Phase 0 ships)

This task's deliverable is a **baseline**: real numbers for the route as it behaves today, before Phases 1 and 2 change it. `contextTier` is therefore hardcoded to `"full"` and `retrievalReused` to `false` here; Tasks 6 and 9 make them dynamic.

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `logTurnMetrics`, `cachedTokensFrom`, `type TurnMetrics`, `type ContextTier` from Task 2.
- Produces: `streamAnswer` now resolves to an `AnswerOutcome` instead of `void`. Tasks 6 and 9 modify the same `POST` body and depend on the local variable names introduced here: `startedAt`, `embedMs`, `retrieveMs`, `contextTier`, `retrievalReused`, `reuseReason`.

  ```ts
  type AnswerOutcome = {
    modelId: string | null;
    modelIndex: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cachedTokens: number | null;
    firstTokenMs: number | null;
  };
  ```

- [ ] **Step 1: Delete the deprecated runtime export**

In `src/app/api/chat/route.ts`, delete line 25 entirely:

```ts
export const runtime = "nodejs";
```

`'nodejs'` is the default and the Next.js docs bundled with this version say to remove the export (see "Version corrections"). Keep `export const maxDuration = 30` on the following line.

- [ ] **Step 2: Add the imports**

After the existing `import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/recipes";` line, add:

```ts
import {
  cachedTokensFrom,
  logTurnMetrics,
  type ContextTier,
  type TurnMetrics,
} from "@/lib/metrics";
```

- [ ] **Step 3: Make `streamAnswer` report what it did**

Replace the `AnswerOptions` type and the whole `streamAnswer` function (currently lines 140–213) with:

```ts
type AnswerOptions = {
  writer: UIMessageStreamWriter<ChatMessage>;
  system: string;
  messages: Awaited<ReturnType<typeof convertToModelMessages>>;
  temperature: number;
  abortSignal: AbortSignal;
  sources: SourceRecipe[];
  // Wall clock at the start of the request, so first-token latency is measured
  // against the user's wait, not against this function's own start.
  startedAt: number;
};

// What actually happened, for the metrics row. All-null means no model answered.
type AnswerOutcome = {
  modelId: string | null;
  modelIndex: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  firstTokenMs: number | null;
};

const NO_ANSWER: AnswerOutcome = {
  modelId: null,
  modelIndex: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedTokens: null,
  firstTokenMs: null,
};

// Streams the answer, moving down the model list if one is out of quota, and falling
// back to the retrieved recipes themselves if all of them are. Deltas are forwarded
// as they arrive, so the failover is invisible unless every model is spent.
async function streamAnswer({
  writer,
  system,
  messages,
  temperature,
  abortSignal,
  sources,
  startedAt,
}: AnswerOptions): Promise<AnswerOutcome> {
  for (const [index, modelId] of CHAT_MODELS.entries()) {
    const result = streamText({
      model: google(modelId),
      system,
      messages,
      temperature,
      abortSignal,
      // Failing over to another model beats waiting out a backoff on a spent one.
      maxRetries: index === 0 ? 1 : 0,
    });

    let textId: string | null = null;
    let failure: unknown = null;
    let firstTokenMs: number | null = null;

    try {
      // `stream` surfaces errors as parts; `textStream` would swallow them.
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          if (!textId) {
            textId = crypto.randomUUID();
            firstTokenMs = Date.now() - startedAt;
            writer.write({ type: "text-start", id: textId });
          }
          writer.write({ type: "text-delta", id: textId, delta: part.text });
        } else if (part.type === "error") {
          failure = part.error;
          break;
        }
      }
    } catch (error) {
      failure = error;
    }

    if (textId) writer.write({ type: "text-end", id: textId });

    if (!failure) {
      // `usage` and `providerMetadata` are PromiseLike on the result and are already
      // settled once the stream is drained, so this adds no latency. Awaited only on
      // the success path — on a failed stream they reject with the same error.
      let usage: Awaited<typeof result.usage> | undefined;
      let providerMetadata: Awaited<typeof result.providerMetadata>;
      try {
        usage = await result.usage;
        providerMetadata = await result.providerMetadata;
      } catch (error) {
        // Usage is telemetry. Losing it must never lose the user their answer.
        console.warn("[chat] usage unavailable:", error);
      }

      return {
        modelId,
        modelIndex: index,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        cachedTokens: cachedTokensFrom(usage, providerMetadata),
        firstTokenMs,
      };
    }

    if (isAbort(failure)) return NO_ANSWER; // The reader hung up; nothing left to answer.
    // Tokens are already on screen: restarting would splice two different answers.
    if (textId) throw failure;
    if (!isExhausted(failure)) throw failure;

    console.warn(`[chat] ${modelId} unavailable, trying the next model`);
  }

  // Every model is spent. The retrieved rows are still here, and they are the part
  // that was ever grounded — so answer from them rather than showing an error.
  const textId = crypto.randomUUID();
  writer.write({ type: "text-start", id: textId });
  writer.write({
    type: "text-delta",
    id: textId,
    delta: buildFallbackAnswer(sources),
  });
  writer.write({ type: "text-end", id: textId });
  return NO_ANSWER;
}
```

- [ ] **Step 4: Time the stages in `POST`**

In `POST`, immediately after the `if (!query) { ... }` guard (currently lines 233–235), add:

```ts
  const startedAt = Date.now();
```

Then replace the embedding block (currently lines 238–250) with a timed version:

```ts
    // 2. Embed with the ingest-time model; only the task type differs.
    let embedding: number[];
    let embedMs: number | null = null;
    try {
      const embedStartedAt = Date.now();
      embedding = await embedQuery(query, req.signal);
      embedMs = Date.now() - embedStartedAt;
    } catch (error) {
      if (isAbort(error)) return new Response(null, { status: 499 });
      if (!isExhausted(error)) throw error;
      // Without an embedding there is no retrieval, and without retrieval there is
      // nothing to ground an answer in. Say so as an ordinary reply — inventing a
      // recipe here would be the one failure this app exists to prevent.
      console.error("[chat] embedding quota exhausted:", error);
      return streamNotice(SEARCH_UNAVAILABLE_REPLY);
    }
```

And the retrieval block (currently lines 252–262):

```ts
    // 3. Rank in Postgres and take the top matches.
    let matches;
    let retrieveMs: number | null = null;
    try {
      const retrieveStartedAt = Date.now();
      matches = await searchRecipes(getSupabaseAdmin(), embedding, {
        threshold: MATCH_THRESHOLD,
        limit: MATCH_COUNT,
      });
      retrieveMs = Date.now() - retrieveStartedAt;
    } catch (error) {
      console.error("[chat] retrieval failed:", error);
      return Response.json({ error: "Recipe search failed." }, { status: 500 });
    }
```

- [ ] **Step 5: Log the row when the stream finishes**

Replace the `createUIMessageStream` block (currently lines 303–317) with:

```ts
    // Hardcoded for now: Phase 1 (tiered context) makes the tier dynamic, Phase 2
    // (retrieval reuse) makes reuse dynamic. Logged from the start so this phase
    // produces a baseline for the route as it behaves today.
    const contextTier: ContextTier = "full";
    const retrievalReused = false;
    const reuseReason = "not-implemented";

    // 7. Stream, with the retrieved recipes attached up front so the UI can show its
    //    sources before the first token.
    const stream = createUIMessageStream<ChatMessage>({
      onError: describeStreamError,
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageMetadata: { sources } });
        const outcome = await streamAnswer({
          writer,
          system,
          messages: modelMessages,
          temperature,
          abortSignal: req.signal,
          sources,
          startedAt,
        });
        writer.write({ type: "finish" });

        const row: TurnMetrics = {
          ...outcome,
          retrievalReused,
          reuseReason,
          contextTier,
          candidateCount: matches.length,
          matchCount: matches.length,
          // The prompt's rule 2 is what actually refuses, so this is the best signal
          // available without parsing the model's prose: nothing was retrieved.
          refused: matches.length === 0,
          embedMs,
          retrieveMs,
          totalMs: Date.now() - startedAt,
        };
        logTurnMetrics(row);
      },
    });
```

- [ ] **Step 6: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. A `TurnMetrics` field mismatch surfaces here — the spread of `outcome` supplies exactly the seven billing/model/latency fields and the literal supplies the other nine.

- [ ] **Step 7: Verify a real turn logs a row**

Run: `npm run dev`, open the app, send "chicken, rice and peas", and watch the dev server output.
Expected: one line beginning `[metrics] {"inputTokens":` after the answer finishes. Record the `inputTokens` value — this is the **baseline** Phases 1 and 2 are measured against, and the number Phase 6 needs. Note it in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: log per-turn token, model and latency metrics

Establishes the pre-optimization baseline. Also removes the deprecated
runtime export: 'nodejs' is the default in Next 16.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `needsFullSteps` — one source of truth for the two regex lists

`PRECISE_PATTERNS` already detects exactly the questions that need verbatim steps. Phase 1 needs that same predicate for tier selection. Extract it rather than copying the list.

**Files:**
- Modify: `src/lib/chat-config.ts`
- Modify: `src/lib/chat-config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `needsFullSteps(query: string): boolean` and `isExploratory(query: string): boolean`. Task 6 imports `needsFullSteps`; Task 7 imports `isExploratory`. `temperatureFor` keeps its exact current signature and behaviour.

- [ ] **Step 1: Write the failing tests**

First extend the existing import at the top of `src/lib/chat-config.test.ts` —
merge the two new names into it rather than adding a second import statement:

```ts
import {
  DEFAULT_TEMPERATURE,
  EXPLORATORY_TEMPERATURE,
  isExploratory,
  needsFullSteps,
  PRECISE_TEMPERATURE,
  temperatureFor,
} from "@/lib/chat-config";
```

Then append:

```ts
describe("needsFullSteps", () => {
  it("is true for the questions that need the method verbatim", () => {
    expect(needsFullSteps("how do i fold the batter")).toBe(true);
    expect(needsFullSteps("what are the steps")).toBe(true);
    expect(needsFullSteps("how long does it bake")).toBe(true);
    expect(needsFullSteps("what oven temperature")).toBe(true);
    expect(needsFullSteps("how many grams of flour")).toBe(true);
    expect(needsFullSteps("give me the full recipe")).toBe(true);
  });

  it("is false for an ingredient list, which needs no method at all", () => {
    expect(needsFullSteps("chicken, rice and peas")).toBe(false);
    expect(needsFullSteps("i have eggs, spinach and feta")).toBe(false);
    expect(needsFullSteps("surprise me")).toBe(false);
    expect(needsFullSteps("")).toBe(false);
  });

  // The two must never disagree: that is the whole point of extracting the predicate.
  it("agrees with temperatureFor on every precise query", () => {
    for (const query of ["what are the steps", "how long does it bake", "exact amounts"]) {
      expect(needsFullSteps(query)).toBe(true);
      expect(temperatureFor(query)).toBe(PRECISE_TEMPERATURE);
    }
  });
});

describe("isExploratory", () => {
  it("is true when the user is asking for something other than what they were shown", () => {
    expect(isExploratory("what else could i make")).toBe(true);
    expect(isExploratory("any other options")).toBe(true);
    expect(isExploratory("surprise me")).toBe(true);
    expect(isExploratory("something different")).toBe(true);
    expect(isExploratory("what can i use instead of butter")).toBe(true);
  });

  it("is false for a follow-up about the recipe already on screen", () => {
    expect(isExploratory("how long do i bake it")).toBe(false);
    expect(isExploratory("can i make that tonight")).toBe(false);
    expect(isExploratory("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/chat-config.test.ts`
Expected: FAIL — `"needsFullSteps" is not exported by "src/lib/chat-config.ts"`.

- [ ] **Step 3: Export the two predicates**

In `src/lib/chat-config.ts`, replace the `temperatureFor` function (the last block in the file) with:

```ts
// Steps and amounts are quoted verbatim, so these are also exactly the questions
// that need the full step text in the retrieved context. Tier selection and
// temperature therefore read the same list — two copies would drift apart, and a
// drift would mean quoting steps the model was never given.
export function needsFullSteps(query: string): boolean {
  return PRECISE_PATTERNS.some((p) => p.test(query));
}

// The user wants recipes other than the ones on screen, which means retrieval must
// actually run even when their pantry has not changed.
export function isExploratory(query: string): boolean {
  return EXPLORATORY_PATTERNS.some((p) => p.test(query));
}

// Precise wins ties: "what can I use instead of butter, and how much?" has a right answer.
export function temperatureFor(query: string): number {
  if (needsFullSteps(query)) return PRECISE_TEMPERATURE;
  if (isExploratory(query)) return EXPLORATORY_TEMPERATURE;
  return DEFAULT_TEMPERATURE;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The Task 1 characterization tests must still pass unchanged — that is what proves the extraction changed no behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-config.ts src/lib/chat-config.test.ts
git commit -m "refactor: extract needsFullSteps and isExploratory predicates

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The brief recipe rendering

66.6% of the retrieved context is `Steps:` text the system prompt forbids the model to restate. This adds a rendering without it. The steps stay visible to the user on the recipe card, which renders from `sources` metadata and is untouched.

**Files:**
- Modify: `src/lib/recipes.ts`
- Create: `src/lib/recipes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toBriefChunk(r: Recipe): string`. Task 6 imports it. `toChunk(r: Recipe): string` keeps byte-identical output.

- [ ] **Step 1: Write the failing test**

Create `src/lib/recipes.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toBriefChunk, toChunk, type Recipe } from "@/lib/recipes";

const FULL: Recipe = {
  id: "1",
  title: "Spinach Feta Frittata",
  cuisine: "Mediterranean",
  country: "Greece",
  dietaryTags: ["vegetarian"],
  difficulty: "Easy",
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  servings: 4,
  ingredients: [
    { item: "eggs", quantity: "8 large" },
    { item: "baby spinach", quantity: "150 g" },
    { item: "feta cheese", quantity: "120 g" },
    { item: "fresh dill", quantity: "2 tbsp", optional: true },
  ],
  instructions: [
    "Heat the oven to 180C.",
    "Wilt the spinach in a pan.",
    "Beat the eggs and fold in the feta.",
  ],
  tips: "Let it rest five minutes before slicing.",
};

// No servings, no tips, no quantities: the fields the corpus often lacks.
const SPARSE: Recipe = {
  id: "2",
  title: "Rice and Peas",
  cuisine: "Caribbean",
  country: "Jamaica",
  dietaryTags: [],
  difficulty: "Easy",
  prepTimeMinutes: 0,
  cookTimeMinutes: 25,
  ingredients: [
    { item: "rice", quantity: "" },
    { item: "kidney beans", quantity: "" },
  ],
  instructions: ["Simmer everything together for 25 minutes."],
};

// Steps of realistic length: the corpus averages eight instructions of roughly
// ninety characters, and the whole point of the brief tier is what that costs.
const REALISTIC: Recipe = {
  ...FULL,
  instructions: [
    "Preheat the oven to 180C fan and line a 23cm springform tin with baking parchment.",
    "Rinse the baby spinach thoroughly, then wilt it in a dry pan over a medium heat for two minutes.",
    "Tip the wilted spinach into a sieve and press firmly with the back of a spoon to drive off the water.",
    "Crack the eggs into a large bowl, season well, and beat until the yolks and whites are fully combined.",
    "Crumble the feta into the eggs, add the drained spinach, and fold together with a spatula.",
    "Pour the mixture into the prepared tin and level the top so it cooks evenly.",
    "Bake for twenty minutes, until the centre is just set and no longer wobbles when you nudge the tin.",
    "Let it stand for five minutes before releasing the tin, then slice into wedges and scatter over the dill.",
  ],
};

// The stored `content` column and every embedding were produced by this function.
// Changing its output would silently decouple the corpus from its vectors, so the
// expected string is written out in full rather than derived.
describe("toChunk", () => {
  it("renders the frozen ingest format", () => {
    expect(toChunk(FULL)).toBe(
      [
        "Recipe: Spinach Feta Frittata",
        "Main ingredients: eggs, baby spinach, feta cheese, fresh dill",
        "Cuisine: Mediterranean (Greece). Tags: vegetarian.",
        "Difficulty: Easy. Prep 10 min, cook 20 min, total 30 min, Serves 4.",
        "Ingredients with quantities: 8 large eggs; 150 g baby spinach; 120 g feta cheese; 2 tbsp fresh dill (optional).",
        "Steps: 1. Heat the oven to 180C. 2. Wilt the spinach in a pan. 3. Beat the eggs and fold in the feta.",
        "Tip: Let it rest five minutes before slicing.",
      ].join("\n"),
    );
  });

  it("omits unknown fields rather than defaulting them", () => {
    const chunk = toChunk(SPARSE);
    expect(chunk).toContain("Quantities: not recorded for this recipe");
    expect(chunk).not.toContain("Serves");
    expect(chunk).not.toContain("Tip:");
    expect(chunk).not.toContain("Prep 0 min");
  });
});

describe("toBriefChunk", () => {
  it("keeps everything the model is allowed to use", () => {
    const brief = toBriefChunk(FULL);
    expect(brief).toContain("Recipe: Spinach Feta Frittata");
    expect(brief).toContain("Main ingredients: eggs, baby spinach, feta cheese, fresh dill");
    expect(brief).toContain("Cuisine: Mediterranean (Greece). Tags: vegetarian.");
    expect(brief).toContain("Difficulty: Easy. Prep 10 min, cook 20 min, total 30 min, Serves 4.");
    expect(brief).toContain("8 large eggs; 150 g baby spinach");
    expect(brief).toContain("Tip: Let it rest five minutes before slicing.");
  });

  it("replaces the method with a pointer to the card", () => {
    const brief = toBriefChunk(FULL);
    expect(brief).toContain("Steps: shown on the recipe card (3 steps) — not repeated here.");
    // The whole point: no step text reaches the model on a brief turn.
    expect(brief).not.toContain("Heat the oven");
    expect(brief).not.toContain("Wilt the spinach");
    expect(brief).not.toContain("Beat the eggs");
  });

  it("says so plainly when a recipe records no steps at all", () => {
    const brief = toBriefChunk({ ...SPARSE, instructions: [] });
    expect(brief).toContain("Steps: none recorded for this recipe.");
  });

  // FULL's three short steps are not representative: on that fixture the brief
  // rendering is only ~8% smaller. The corpus mean is 64% smaller, so the saving
  // is measured against a recipe with realistic step text.
  it("is substantially shorter than the full chunk", () => {
    expect(toBriefChunk(REALISTIC).length).toBeLessThan(toChunk(REALISTIC).length * 0.6);
    // Still smaller even on the unrepresentative short fixture.
    expect(toBriefChunk(FULL).length).toBeLessThan(toChunk(FULL).length);
  });

  it("omits unknown fields rather than defaulting them", () => {
    const brief = toBriefChunk(SPARSE);
    expect(brief).toContain("Quantities: not recorded for this recipe");
    expect(brief).not.toContain("Serves");
    expect(brief).not.toContain("Tip:");
  });

  // Rule 3: the brief tier ships no steps, so it must not tell the model to read
  // amounts out of steps it was never given.
  it("does not point at steps below when there are none", () => {
    const brief = toBriefChunk(SPARSE);
    expect(brief).not.toContain("the steps below");
    expect(brief).toContain("which are on the recipe card");
    // The full tier does still have its steps further down the chunk.
    expect(toChunk(SPARSE)).toContain("the steps below are the only stated amounts");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/recipes.test.ts`
Expected: FAIL — `"toBriefChunk" is not exported`. The two `toChunk` tests should pass; if the golden string does not match, **fix the test string to match the code**, never the reverse.

- [ ] **Step 3: Refactor `toChunk` and add `toBriefChunk`**

In `src/lib/recipes.ts`, add the tier type import at the top of the file:

```ts
import type { ContextTier } from "@/lib/metrics";
```

then replace the whole `toChunk` function with:

```ts
// One recipe = one chunk, ingredients first because the user's query is an ingredient list.
//
// Two renderings, sharing every line but the method. `full` is what the ingest script
// stored and embedded; `brief` drops the step text, which the system prompt forbids
// the model to restate anyway and which the recipe card renders from its own data.
//
// The tier union is imported rather than redeclared, so the rendering and the metrics
// row can never disagree about what tiers exist. It is a type-only import, erased at
// compile time, so the ingest script gains no runtime dependency.
function chunkLines(r: Recipe, tier: ContextTier): string[] {
  const ingredients = r.ingredients.map((i) => i.item).join(", ");
  const totalTime = r.prepTimeMinutes + r.cookTimeMinutes;

  // Unknown fields are omitted, never defaulted, so the model cannot read one back out.
  const timing = [
    r.prepTimeMinutes > 0 ? `Prep ${r.prepTimeMinutes} min` : "",
    r.cookTimeMinutes > 0 ? `cook ${r.cookTimeMinutes} min` : "",
    totalTime > 0 ? `total ${totalTime} min` : "",
    r.servings ? `Serves ${r.servings}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  // Some sources publish no measurements at all; say so rather than emitting blank amounts.
  //
  // The sentence has to differ by tier. On `full` the amounts really are further down
  // this chunk; on `brief` there are no steps below, so promising them would point the
  // model at text it was never given — exactly what ABSOLUTE RULE 3 forbids.
  const measured = r.ingredients.filter((i) => i.quantity.trim());
  const noAmounts =
    tier === "full"
      ? "Quantities: not recorded for this recipe — the steps below are the only stated amounts."
      : "Quantities: not recorded for this recipe — the only stated amounts are inside the steps, which are on the recipe card.";
  const amounts = measured.length
    ? `Ingredients with quantities: ${measured
        .map((i) => `${i.quantity} ${i.item}${i.optional ? " (optional)" : ""}`)
        .join("; ")}.`
    : noAmounts;

  const steps =
    tier === "full"
      ? `Steps: ${r.instructions.map((s, i) => `${i + 1}. ${s}`).join(" ")}`
      : r.instructions.length > 0
        ? `Steps: shown on the recipe card (${r.instructions.length} step${
            r.instructions.length === 1 ? "" : "s"
          }) — not repeated here.`
        : "Steps: none recorded for this recipe.";

  return [
    `Recipe: ${r.title}`,
    `Main ingredients: ${ingredients}`,
    `Cuisine: ${r.cuisine} (${r.country}). Tags: ${r.dietaryTags.join(", ") || "none"}.`,
    `Difficulty: ${r.difficulty}.${timing ? ` ${timing}.` : ""}`,
    amounts,
    steps,
    r.tips ? `Tip: ${r.tips}` : "",
  ].filter(Boolean);
}

// The ingest format. Its output is what the `content` column holds and what every
// stored embedding was computed from, so it must stay byte-identical — see the
// golden test in recipes.test.ts.
export function toChunk(r: Recipe): string {
  return chunkLines(r, "full").join("\n");
}

// The same recipe with the method replaced by a pointer at the card. Roughly a third
// of the tokens, and nothing the system prompt would have let the model say is lost.
export function toBriefChunk(r: Recipe): string {
  return chunkLines(r, "brief").join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/recipes.test.ts`
Expected: PASS, 7 tests. The golden `toChunk` test passing is the proof that no re-ingest is needed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipes.ts src/lib/recipes.test.ts
git commit -m "feat: add brief recipe chunk rendering without step text

toChunk output is unchanged and now pinned by a golden test, so the
stored embeddings stay valid.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Tier the context block and wire it into the route (Phase 1 ships)

**Files:**
- Modify: `src/lib/prompt.ts`
- Create: `src/lib/prompt.test.ts`
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `toBriefChunk` (Task 5), `needsFullSteps` (Task 4), `type ContextTier` (Task 2).
- Produces: `buildContextBlock(matches: MatchedRecipe[], tier?: ContextTier): string` — the second parameter defaults to `"full"`, so the existing call in `scripts/check.ts` and any other caller keeps working unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/lib/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildContextBlock, SYSTEM_PROMPT } from "@/lib/prompt";
import type { MatchedRecipe } from "@/lib/recipes";

const MATCH: MatchedRecipe = {
  id: 1,
  slug: "spinach-feta-frittata",
  title: "Spinach Feta Frittata",
  // Deliberately not what toChunk would produce: this proves the full tier uses the
  // stored content column verbatim rather than re-rendering it.
  content: "Recipe: Spinach Feta Frittata\nSteps: 1. Heat the oven to 180C.",
  metadata: {
    id: "1",
    title: "Spinach Feta Frittata",
    cuisine: "Mediterranean",
    country: "Greece",
    dietaryTags: ["vegetarian"],
    difficulty: "Easy",
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    servings: 4,
    ingredients: [
      { item: "eggs", quantity: "8 large" },
      { item: "feta cheese", quantity: "120 g" },
    ],
    instructions: ["Heat the oven to 180C.", "Wilt the spinach in a pan."],
  },
  similarity: 0.71,
};

describe("buildContextBlock", () => {
  it("defaults to the full tier, using the stored content verbatim", () => {
    const block = buildContextBlock([MATCH]);
    expect(block).toContain("Steps: 1. Heat the oven to 180C.");
    expect(buildContextBlock([MATCH], "full")).toBe(block);
  });

  it("renders the brief tier from metadata, with no step text", () => {
    const block = buildContextBlock([MATCH], "brief");
    expect(block).toContain("Steps: shown on the recipe card (2 steps) — not repeated here.");
    expect(block).not.toContain("Heat the oven");
    expect(block).not.toContain("Wilt the spinach");
  });

  it("keeps the delimiters and the relevance header in both tiers", () => {
    for (const tier of ["brief", "full"] as const) {
      const block = buildContextBlock([MATCH], tier);
      expect(block.startsWith("<RETRIEVED_RECIPES>")).toBe(true);
      expect(block.endsWith("</RETRIEVED_RECIPES>")).toBe(true);
      expect(block).toContain("--- RECIPE 1 (relevance 0.71) ---");
    }
  });

  it("says the block is empty in both tiers, so rule 2 still fires", () => {
    for (const tier of ["brief", "full"] as const) {
      expect(buildContextBlock([], tier)).toContain("(empty — no recipe cleared");
    }
  });
});

describe("SYSTEM_PROMPT", () => {
  it("tells the model what to do when the block points at the card", () => {
    expect(SYSTEM_PROMPT).toContain("shown on the recipe card");
  });

  it("still carries all four absolute rules", () => {
    expect(SYSTEM_PROMPT).toContain("ABSOLUTE RULES");
    for (const n of ["1.", "2.", "3.", "4."]) {
      expect(SYSTEM_PROMPT).toContain(n);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/prompt.test.ts`
Expected: FAIL — the brief-tier test fails because `buildContextBlock` ignores its second argument, and the `SYSTEM_PROMPT` test fails on the missing rule.

- [ ] **Step 3: Add the tier to `buildContextBlock`**

In `src/lib/prompt.ts`, add `toBriefChunk` to the recipes import and replace `buildContextBlock` with:

```ts
// Wraps retrieved recipes in delimiters, so it is unambiguous where trusted context ends.
//
// `full` uses the stored `content` column, which is what was embedded. `brief` renders
// from the same row's `metadata` and drops the step text: two-thirds of the block, and
// text the ABSOLUTE RULES never let the model restate. Defaults to `full` so a caller
// that has not thought about tiers gets the safe, complete rendering.
export function buildContextBlock(
  matches: MatchedRecipe[],
  tier: ContextTier = "full",
): string {
  if (matches.length === 0) {
    return "<RETRIEVED_RECIPES>\n(empty — no recipe cleared the similarity threshold)\n</RETRIEVED_RECIPES>";
  }

  const body = matches
    .map((m, i) => {
      const rendered = tier === "brief" ? toBriefChunk(m.metadata) : m.content;
      return `--- RECIPE ${i + 1} (relevance ${m.similarity.toFixed(2)}) ---\n${rendered}`;
    })
    .join("\n\n");

  return `<RETRIEVED_RECIPES>\n${body}\n</RETRIEVED_RECIPES>`;
}
```

Update the imports at the top of the file to:

```ts
import type { SourceRecipe } from "@/lib/chat-types";
import type { ContextTier } from "@/lib/metrics";
import { toBriefChunk, type MatchedRecipe } from "@/lib/recipes";
```

- [ ] **Step 4: Add the one new system-prompt rule**

In `SYSTEM_PROMPT`, under `## HOW TO ANSWER`, insert this bullet immediately after the existing `- Do not restate the ingredient list or the numbered steps unless the user asks for them. When they do ask, quote them verbatim from the block.` bullet:

```
- When a recipe in the block says its steps are "shown on the recipe card", you have
  not been given the method. Do not describe, summarise or reconstruct it — point the
  user at the card, and if they want the steps written out, tell them to ask and you
  will quote them next turn. This is rule 3 applied to steps: text you were not shown
  is text you cannot state.
```

This strengthens rule 3 rather than relaxing it, and it is truthful about the mechanism: `needsFullSteps` escalates the very next turn to the full tier, so "ask and I'll quote them" is a promise the code keeps.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Wire the tier into the route**

In `src/app/api/chat/route.ts`:

Add `needsFullSteps` to the `chat-config` import:

```ts
import { CHAT_MODELS, needsFullSteps, temperatureFor } from "@/lib/chat-config";
```

Replace the three hardcoded metrics lines added in Task 3:

```ts
    const contextTier: ContextTier = "full";
    const retrievalReused = false;
    const reuseReason = "not-implemented";
```

with:

```ts
    // Steps go in only when the question needs them. Everything else the model is
    // allowed to say is in the brief rendering, and the card shows the method either
    // way — so on a plain ingredient turn this is a saving, not a trade-off.
    const contextTier: ContextTier = needsFullSteps(query) ? "full" : "brief";
    const retrievalReused = false;
    const reuseReason = "not-implemented";
```

And pass the tier where the system prompt is assembled (currently line 296):

```ts
    // 6. Ground the model. An empty match set still goes through; rule 2 makes it refuse.
    const system = `${SYSTEM_PROMPT}\n\n${buildContextBlock(matches, contextTier)}`;
```

Note that `contextTier` must now be declared **before** the `const system = ...` line. Move the `contextTier` declaration up to just after the `const temperature = temperatureFor(query);` line (step 4 of the handler), leaving `retrievalReused` and `reuseReason` where they are.

- [ ] **Step 7: Verify it compiles and the saving is real**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors, all tests pass.

Then run `npm run dev` and send "chicken, rice and peas". Compare the `[metrics]` line's `inputTokens` against the Task 3 baseline.
Expected: a large drop. Measured across all 2,000 recipes, the 4-recipe context block goes from ~1,482 to ~530 tokens (a mean brief/full ratio of 0.358), so the whole prompt lands near ~1,330 against a ~2,240 baseline. The spec's "~495" was an estimate; ~530 is the measured figure. Then send "what are the steps for the first one?" and confirm `"contextTier":"full"` with `inputTokens` back near the baseline. Record both numbers in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts src/app/api/chat/route.ts
git commit -m "feat: tier retrieved context, dropping step text unless asked for

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The reuse decision

Pure logic, tested hard, because it reads client-controlled input and decides what goes into a grounded prompt.

**This task also fixes a measured blocker in `buildPantry`.** Steps 1–4 come first
and are a prerequisite, not a nicety: `buildPantry("how long do i bake it")` currently
yields `["egg", "spinach", "bake"]`, treating the cooking verb as an ingredient. That
makes `hasNewPantryTerms` return true and suppresses reuse for **exactly the query the
spec names as the bug Phase 2 exists to fix**. Without Steps 1–4, Task 9 ships a reuse
path that almost never fires.

**Files:**
- Modify: `src/lib/ingredients.ts`
- Create: `src/lib/ingredients.test.ts`
- Create: `src/lib/reuse.ts`
- Create: `src/lib/reuse.test.ts`

**Interfaces:**
- Consumes: `isExploratory` (Task 4), `type Pantry` from `@/lib/ingredients`, `type ChatMessage` from `@/lib/chat-types`.
- Produces:

  ```ts
  const SLUG_PATTERN: RegExp;                 // /^[a-z0-9-]{1,128}$/
  const MAX_REUSED_SLUGS: number;             // 8
  type PriorSource = { slug: string; similarity: number };
  type ReuseReason = "reuse" | "no-prior-sources" | "new-ingredients" | "exploratory";
  type ReuseDecision = { reuse: boolean; sources: PriorSource[]; reason: ReuseReason };
  function priorSourcesFrom(messages: readonly ChatMessage[]): PriorSource[];
  function hasNewPantryTerms(before: Pantry, after: Pantry): boolean;
  function decideReuse(input: {
    priorSources: PriorSource[];
    query: string;
    pantryBefore: Pantry;
    pantryAfter: Pantry;
  }): ReuseDecision;
  ```

  Tasks 8 and 9 import `PriorSource`, `priorSourcesFrom`, `decideReuse`.
- Also produces: `FILLER` in `src/lib/ingredients.ts` gains 18 method verbs. No signature changes, so nothing else needs updating.

- [ ] **Step 1: Write the failing pantry test**

Create `src/lib/ingredients.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPantry, comparePantry } from "@/lib/ingredients";

const terms = (texts: string[]) => [...buildPantry(texts).keys()];

describe("buildPantry", () => {
  it("reads ingredients out of ordinary sentences", () => {
    expect(terms(["i have eggs and spinach"])).toEqual(["egg", "spinach"]);
  });

  // The measured blocker: "bake" was being stored as though the user owned it, which
  // made every method question look like a new ingredient and suppressed reuse.
  it("does not treat a cooking verb as an ingredient", () => {
    expect(terms(["i have eggs and spinach", "how long do i bake it"])).toEqual([
      "egg",
      "spinach",
    ]);
    for (const verb of ["fry", "grill", "boil", "simmer", "steam", "stir", "whisk"]) {
      expect(terms([`should i ${verb} it`])).toEqual([]);
    }
  });

  // These verb forms are also real ingredient names in the corpus, so filtering them
  // would lose the user a genuine pantry item. Verified against all 2,000 recipes:
  // "Baked beans", "hard-boiled eggs", "chopped tomatoes", "cooked rice", "fried tofu",
  // "roast beef", "roasted peanuts", "seasoned rice vinegar", "sliced apples".
  it("keeps verb forms that name real ingredients", () => {
    expect(terms(["i have baked beans"])).toContain("baked beans");
    expect(terms(["i have chopped tomatoes"])).toContain("chopped tomato");
    expect(terms(["i have cooked rice"])).toContain("cooked rice");
    expect(terms(["i have roast beef"])).toContain("roast beef");
  });

  // The standing constraint in ingredients.ts: a category guess is never allowed.
  it("still never generalises an ingredient", () => {
    expect(terms(["i have chicken"])).toEqual(["chicken"]);
    expect(terms(["i have chicken"])).not.toContain("meat");
  });
});

describe("comparePantry", () => {
  // The regression that matters: filtering verbs must not stop a real ingredient
  // from being credited. Mirrors the fixture in scripts/check.ts step 5.
  it("still credits exactly the ingredients the user named", () => {
    const fixture = [
      { item: "eggs", quantity: "8 large" },
      { item: "baby spinach", quantity: "150 g" },
      { item: "feta cheese", quantity: "120 g" },
      { item: "chicken stock", quantity: "200 ml" },
    ];
    const result = comparePantry(fixture, buildPantry(["I have eggs, spinach and feta"]));
    expect(result.have.map((i) => i.item)).toEqual(["eggs", "baby spinach", "feta cheese"]);
    expect(result.missingRequiredCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/ingredients.test.ts`
Expected: FAIL on "does not treat a cooking verb as an ingredient" — the received
array is `["egg", "spinach", "bake"]`. The other four tests should already pass.

- [ ] **Step 3: Add the method verbs to `FILLER`**

In `src/lib/ingredients.ts`, add these 18 entries to the `FILLER` set, with this comment:

```ts
  // Method verbs. A question like "how long do I bake it?" is not a statement about
  // what is in someone's kitchen, but without these it added "bake" to their pantry —
  // which then read as a new ingredient and forced a fresh search on every follow-up.
  //
  // This list is deliberately narrower than it could be. Each of these appears in ZERO
  // of the 2,000 corpus recipes' ingredient names. The forms left OUT are left out on
  // purpose, because they do name real ingredients: "baked" (Baked beans), "boiled"
  // (hard-boiled eggs), "chopped" (chopped tomatoes), "cooked" (cooked rice), "fried"
  // (fried tofu), "roast" (roast beef), "roasted" (roasted peanuts), "season"
  // (Season-All salt), "seasoned" (seasoned rice vinegar), "slice" (lemon slice),
  // "sliced" (sliced apples), "steamed" (steamed rice).
  "bake",
  "boil",
  "chop",
  "cook",
  "fold",
  "fry",
  "garnish",
  "grill",
  "grilled",
  "knead",
  "marinate",
  "marinated",
  "reheat",
  "simmer",
  "simmered",
  "steam",
  "stir",
  "whisk",
```

Match the surrounding entries' formatting exactly — if the existing set is written as a
single `new Set([...])` literal with entries grouped by line, follow that layout.

- [ ] **Step 4: Run the pantry tests and the live preflight**

Run: `npm test -- src/lib/ingredients.test.ts`
Expected: PASS, 5 tests.

Then run: `npm run check`
Expected: step 5 ("Pantry comparison") still passes. That step asserts against both a
fixture and a live corpus row, and it is the guard that this change credits neither
more nor less than before.

- [ ] **Step 5: Write the failing reuse test**

Create `src/lib/reuse.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/chat-types";
import { buildPantry } from "@/lib/ingredients";
import {
  decideReuse,
  hasNewPantryTerms,
  MAX_REUSED_SLUGS,
  priorSourcesFrom,
  type PriorSource,
} from "@/lib/reuse";

// Only the fields the code reads. The cast mirrors reality: this data arrives as
// untrusted JSON, not as a well-formed ChatMessage.
function assistant(sources: unknown): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Try the frittata." }],
    metadata: { sources },
  } as unknown as ChatMessage;
}

function user(text: string): ChatMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

const GOOD = [
  { slug: "spinach-feta-frittata", similarity: 0.71, title: "x", recipe: {}, pantry: {} },
  { slug: "rice-and-peas", similarity: 0.52, title: "y", recipe: {}, pantry: {} },
];

describe("priorSourcesFrom", () => {
  it("reads slug and similarity off the last assistant turn", () => {
    expect(priorSourcesFrom([user("eggs"), assistant(GOOD), user("how long?")])).toEqual([
      { slug: "spinach-feta-frittata", similarity: 0.71 },
      { slug: "rice-and-peas", similarity: 0.52 },
    ]);
  });

  it("returns nothing when there is no assistant turn yet", () => {
    expect(priorSourcesFrom([user("eggs and spinach")])).toEqual([]);
    expect(priorSourcesFrom([])).toEqual([]);
  });

  it("does not reach past an assistant turn that retrieved nothing", () => {
    const messages = [user("a"), assistant(GOOD), user("b"), assistant([]), user("c")];
    expect(priorSourcesFrom(messages)).toEqual([]);
  });

  it("rejects slugs that are not slugs", () => {
    const junk = [
      { slug: "../../etc/passwd", similarity: 1 },
      { slug: "Spinach Feta", similarity: 1 },
      { slug: "a'; drop table recipes; --", similarity: 1 },
      { slug: "", similarity: 1 },
      { slug: "x".repeat(129), similarity: 1 },
      { slug: 42, similarity: 1 },
      { slug: null, similarity: 1 },
      "not-an-object",
      null,
    ];
    expect(priorSourcesFrom([assistant(junk)])).toEqual([]);
  });

  it("keeps a valid slug sitting next to junk", () => {
    const mixed = [{ slug: "BAD SLUG", similarity: 1 }, { slug: "rice-and-peas", similarity: 0.5 }];
    expect(priorSourcesFrom([assistant(mixed)])).toEqual([
      { slug: "rice-and-peas", similarity: 0.5 },
    ]);
  });

  it("caps the list, so a crafted body cannot widen the context", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ slug: `recipe-${i}`, similarity: 0.5 }));
    expect(priorSourcesFrom([assistant(many)])).toHaveLength(MAX_REUSED_SLUGS);
  });

  it("drops duplicates, so the same recipe cannot fill the block", () => {
    const dupes = Array.from({ length: 10 }, () => ({ slug: "rice-and-peas", similarity: 0.5 }));
    expect(priorSourcesFrom([assistant(dupes)])).toEqual([
      { slug: "rice-and-peas", similarity: 0.5 },
    ]);
  });

  it("clamps a similarity the client could have tampered with", () => {
    const odd = [
      { slug: "a-recipe", similarity: 99 },
      { slug: "b-recipe", similarity: -3 },
      { slug: "c-recipe", similarity: "high" },
      { slug: "d-recipe", similarity: Number.NaN },
    ];
    expect(priorSourcesFrom([assistant(odd)])).toEqual([
      { slug: "a-recipe", similarity: 1 },
      { slug: "b-recipe", similarity: 0 },
      { slug: "c-recipe", similarity: 0 },
      { slug: "d-recipe", similarity: 0 },
    ]);
  });

  it("survives metadata that is not an object at all", () => {
    expect(priorSourcesFrom([assistant("nope")])).toEqual([]);
    expect(priorSourcesFrom([assistant(undefined)])).toEqual([]);
    expect(priorSourcesFrom([{ id: "a", role: "assistant", parts: [] } as ChatMessage])).toEqual([]);
  });
});

describe("hasNewPantryTerms", () => {
  it("is false when the new turn named no ingredient", () => {
    const before = buildPantry(["i have eggs and spinach"]);
    const after = buildPantry(["i have eggs and spinach", "how long do i bake it"]);
    expect(hasNewPantryTerms(before, after)).toBe(false);
  });

  it("is true when the new turn added one", () => {
    const before = buildPantry(["i have eggs and spinach"]);
    const after = buildPantry(["i have eggs and spinach", "i also have feta"]);
    expect(hasNewPantryTerms(before, after)).toBe(true);
  });
});

describe("decideReuse", () => {
  const priorSources: PriorSource[] = [{ slug: "spinach-feta-frittata", similarity: 0.71 }];
  const pantry = buildPantry(["i have eggs and spinach"]);

  it("reuses a follow-up about the recipe on screen", () => {
    expect(
      decideReuse({
        priorSources,
        query: "how long do i bake it",
        pantryBefore: pantry,
        pantryAfter: pantry,
      }),
    ).toEqual({ reuse: true, sources: priorSources, reason: "reuse" });
  });

  it("retrieves afresh on the first turn", () => {
    const decision = decideReuse({
      priorSources: [],
      query: "eggs and spinach",
      pantryBefore: buildPantry([]),
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("no-prior-sources");
  });

  it("retrieves afresh when the user names a new ingredient", () => {
    const decision = decideReuse({
      priorSources,
      query: "i also have chorizo",
      pantryBefore: pantry,
      pantryAfter: buildPantry(["i have eggs and spinach", "i also have chorizo"]),
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("new-ingredients");
  });

  it("retrieves afresh when the user wants something else", () => {
    const decision = decideReuse({
      priorSources,
      query: "what else could i make",
      pantryBefore: pantry,
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("exploratory");
  });

  // A question that is both precise and exploratory: the user wants alternatives,
  // so exploratory has to win here even though the pantry is unchanged.
  it("prefers fresh retrieval for a substitution question", () => {
    const decision = decideReuse({
      priorSources,
      query: "what can i use instead of feta, and how much?",
      pantryBefore: pantry,
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("exploratory");
  });

  it("never reuses an empty source list even if nothing else objects", () => {
    expect(
      decideReuse({
        priorSources: [],
        query: "how long do i bake it",
        pantryBefore: pantry,
        pantryAfter: pantry,
      }).reuse,
    ).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `npm test -- src/lib/reuse.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/reuse"`.

- [ ] **Step 7: Write the implementation**

Create `src/lib/reuse.ts`:

```ts
// Deciding whether a turn needs retrieval at all.
//
// "How long do I bake it?" is not an ingredient search, but today it is embedded as
// one, which costs a Gemini request and retrieves recipes the user was never shown.
// Reusing the previous turn's recipes fixes the grounding and saves the request.
//
// SECURITY: the previous turn's sources arrive in the request body, which the client
// controls. Nothing here is trusted as recipe content. Only the slug — validated
// against a strict pattern — and a clamped similarity number leave this module, and
// the caller re-fetches every row from Postgres. A crafted body can at worst name a
// different real recipe; it cannot introduce one that does not exist.
import { isExploratory } from "@/lib/chat-config";
import type { ChatMessage } from "@/lib/chat-types";
import type { Pantry } from "@/lib/ingredients";

// Slugs are generated by the ingest script and are lowercase kebab-case. Anything
// else did not come from the corpus.
export const SLUG_PATTERN = /^[a-z0-9-]{1,128}$/;

// The route retrieves 4. The cap exists so a crafted body cannot widen the grounded
// context far beyond what retrieval would ever produce.
export const MAX_REUSED_SLUGS = 8;

// A recipe the previous turn was grounded in. The similarity is carried forward so
// the rendered context block is byte-identical across turns — which is what makes
// Gemini's implicit prefix cache able to fire at all.
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

// The slugs of the most recent assistant turn, or an empty list. Deliberately does
// not search further back: reuse is about the recipes currently on screen, and an
// assistant turn that retrieved nothing means there is nothing to follow up on.
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

// The pantry only ever accumulates — it is a Map keyed by normalised term, built over
// every user turn — so a new key is exactly "this turn named something new".
export function hasNewPantryTerms(before: Pantry, after: Pantry): boolean {
  for (const term of after.keys()) {
    if (!before.has(term)) return true;
  }
  return false;
}

// Reuse only when all three conditions hold. Each `false` carries its reason, so a
// reuse rate of zero in the metrics can be diagnosed instead of guessed at.
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
  // "What else", "other options", "instead of": the user is asking for recipes other
  // than the ones on screen, so reusing those would answer the wrong question.
  if (isExploratory(query)) {
    return { reuse: false, sources: [], reason: "exploratory" };
  }
  return { reuse: true, sources: priorSources, reason: "reuse" };
}
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS. `src/lib/reuse.test.ts` contributes 17 tests, and the pantry change
from Step 3 must not have broken any earlier suite.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ingredients.ts src/lib/ingredients.test.ts src/lib/reuse.ts src/lib/reuse.test.ts
git commit -m "feat: add retrieval-reuse decision over untrusted prior sources

Also stops buildPantry storing cooking verbs as ingredients: "how long do
I bake it?" was adding "bake" to the pantry, which read as a new ingredient
and suppressed reuse on exactly the follow-ups Phase 2 targets. The 18 verbs
added appear in none of the 2,000 corpus recipes' ingredient names.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Fetch recipes by slug

**Files:**
- Modify: `src/lib/retrieval.ts`

**Interfaces:**
- Consumes: `type PriorSource` (Task 7).
- Produces: `fetchRecipesBySlug(supabase: SupabaseClient, sources: PriorSource[]): Promise<MatchedRecipe[]>` — returns rows in the order the sources were given, carrying each source's similarity. Task 9 imports it.

- [ ] **Step 1: Add the function**

Append to `src/lib/retrieval.ts`:

```ts
// The rows behind a previous turn's slugs, for a follow-up that needs no new search.
//
// This is the trust boundary for Phase 2 of the RAG design: the slugs come from the
// request body, but every byte of recipe text returned here comes from Postgres. A
// client cannot put a fabricated recipe into the grounded context, only name a
// different real one.
//
// Returns rows in the order the sources were given — which was similarity order — and
// carries each source's similarity forward, so the rendered context block is
// byte-identical to the previous turn's and Gemini's prefix cache can fire.
export async function fetchRecipesBySlug(
  supabase: SupabaseClient,
  sources: PriorSource[],
): Promise<MatchedRecipe[]> {
  if (sources.length === 0) return [];

  const { data, error } = await supabase
    .from("recipes")
    .select("id, slug, title, content, metadata")
    .in(
      "slug",
      sources.map((s) => s.slug),
    );

  if (error) throw error;

  const rows = new Map<string, Record<string, unknown>>(
    (data ?? []).map((row: Record<string, unknown>) => [row.slug as string, row]),
  );

  return sources.flatMap((source) => {
    const row = rows.get(source.slug);
    // A slug with no row is a deleted recipe or a junk slug. Dropping it here lets the
    // caller notice the short result and fall back to a real search.
    if (!row) return [];
    return [
      {
        id: row.id as number,
        slug: row.slug as string,
        title: row.title as string,
        content: row.content as string,
        metadata: row.metadata as Recipe,
        similarity: source.similarity,
      },
    ];
  });
}
```

- [ ] **Step 2: Add the import**

Change the type import at the top of `src/lib/retrieval.ts` to add `PriorSource`:

```ts
import type { MatchedRecipe, Recipe } from "./recipes";
import type { PriorSource } from "./reuse";
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify it returns real rows against the real database**

Write a throwaway script **at the project root** and run it. It must live at the
root, not in a temp directory: `tsx` resolves `./src/...` against the script's own
location, so a script elsewhere fails with `MODULE_NOT_FOUND`.

```bash
cat > fetch-by-slug-check.ts <<'EOF'
import { createClient } from "@supabase/supabase-js";
import { fetchRecipesBySlug } from "./src/lib/retrieval";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const rows = await fetchRecipesBySlug(supabase, [
  { slug: "spinach-feta-frittata", similarity: 0.71 },
  { slug: "no-such-recipe-at-all", similarity: 0.4 },
]);

console.log("returned", rows.length, "of 2 requested");
for (const row of rows) console.log(" ", row.slug, row.similarity, row.title);
EOF
npx tsx --env-file-if-exists=.env.local --tsconfig tsconfig.json fetch-by-slug-check.ts
rm fetch-by-slug-check.ts
```

Delete the script before committing — `git status` must show only `src/lib/retrieval.ts`.

Expected: `returned 1 of 2 requested`, then the frittata row with similarity `0.71`. The missing slug being dropped rather than throwing is the behaviour Task 9's fallback depends on.

- [ ] **Step 5: Commit**

```bash
git add src/lib/retrieval.ts
git commit -m "feat: add fetchRecipesBySlug for reused retrieval

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire reuse into the route (Phase 2 ships)

The request-saving task. On a reused turn, `embedQuery` never runs, so the turn costs one Gemini call instead of two.

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `priorSourcesFrom`, `decideReuse` (Task 7), `fetchRecipesBySlug` (Task 8).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the imports**

```ts
import { fetchRecipesBySlug, searchRecipes } from "@/lib/retrieval";
import { decideReuse, priorSourcesFrom } from "@/lib/reuse";
```

and add `type MatchedRecipe` to the recipes import:

```ts
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type MatchedRecipe,
} from "@/lib/recipes";
```

- [ ] **Step 2: Move the pantry build above retrieval**

The reuse decision needs the pantry, and the pantry is currently built *after* retrieval (step 5 of the handler, line 269). Delete these lines from their current position:

```ts
    // 5. What the user has is read off every turn they typed, not off the answer:
    //    a pantry named three turns ago still counts for the recipe shown now.
    const pantry = buildPantry(userMessages.map(textOf));
```

- [ ] **Step 3: Replace the embed-and-search block with reuse-or-search**

Replace **both** the timed embedding block and the timed retrieval block from Task 3 (everything from `// 2. Embed with the ingest-time model` through the end of the `// 3. Rank in Postgres` block) with:

```ts
    // 2. What the user has is read off every turn they typed, not off the answer: a
    //    pantry named three turns ago still counts for the recipe shown now. Built
    //    before retrieval because the reuse decision turns on whether this turn
    //    added anything to it.
    const priorTexts = userMessages.slice(0, -1).map(textOf);
    const pantryBefore = buildPantry(priorTexts);
    const pantry = buildPantry(userMessages.map(textOf));

    // 3. A follow-up about the recipes already on screen needs no new search. Skipping
    //    it saves the embedding request outright, and grounds the answer in the recipe
    //    the user is actually asking about rather than in whatever "how long do I bake
    //    it?" happens to embed near.
    const decision = decideReuse({
      priorSources: priorSourcesFrom(messages),
      query,
      pantryBefore,
      pantryAfter: pantry,
    });

    let matches: MatchedRecipe[] = [];
    let retrievalReused = false;
    let reuseReason: string = decision.reason;
    let embedMs: number | null = null;
    let retrieveMs: number | null = null;

    if (decision.reuse) {
      try {
        const reuseStartedAt = Date.now();
        const rows = await fetchRecipesBySlug(getSupabaseAdmin(), decision.sources);
        // A short result means a slug no longer resolves — a deleted recipe, or a
        // crafted body. Fall through to a real search rather than answer from a
        // partial context.
        if (rows.length === decision.sources.length) {
          matches = rows;
          retrievalReused = true;
          retrieveMs = Date.now() - reuseStartedAt;
        } else {
          reuseReason = "slugs-unresolved";
        }
      } catch (error) {
        console.warn("[chat] slug re-fetch failed, searching instead:", error);
        reuseReason = "refetch-failed";
      }
    }

    if (!retrievalReused) {
      // 4. Embed with the ingest-time model; only the task type differs.
      let embedding: number[];
      try {
        const embedStartedAt = Date.now();
        embedding = await embedQuery(query, req.signal);
        embedMs = Date.now() - embedStartedAt;
      } catch (error) {
        if (isAbort(error)) return new Response(null, { status: 499 });
        if (!isExhausted(error)) throw error;
        // Without an embedding there is no retrieval, and without retrieval there is
        // nothing to ground an answer in. Say so as an ordinary reply — inventing a
        // recipe here would be the one failure this app exists to prevent.
        console.error("[chat] embedding quota exhausted:", error);
        return streamNotice(SEARCH_UNAVAILABLE_REPLY);
      }

      // 5. Rank in Postgres and take the top matches.
      try {
        const retrieveStartedAt = Date.now();
        matches = await searchRecipes(getSupabaseAdmin(), embedding, {
          threshold: MATCH_THRESHOLD,
          limit: MATCH_COUNT,
        });
        retrieveMs = Date.now() - retrieveStartedAt;
      } catch (error) {
        console.error("[chat] retrieval failed:", error);
        return Response.json({ error: "Recipe search failed." }, { status: 500 });
      }
    }
```

- [ ] **Step 4: Remove the now-dead metrics placeholders**

Delete these two lines, left over from Task 3 — both are now real variables declared above:

```ts
    const retrievalReused = false;
    const reuseReason = "not-implemented";
```

- [ ] **Step 5: Renumber the remaining comments**

The handler's numbered comments now run 1–5 for the new block, so update the three that follow: the temperature step becomes `// 6.`, the system-prompt assembly becomes `// 7.`, and the stream becomes `// 8.`.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors. If `tsc` reports that `matches` is possibly used before assignment, the `let matches: MatchedRecipe[] = []` initialiser is missing.

- [ ] **Step 7: Verify the request saving end to end**

Run `npm run dev`, then in one conversation:

1. Send "I have eggs, spinach and feta".
   Expected `[metrics]`: `"retrievalReused":false`, `"reuseReason":"no-prior-sources"`, `"embedMs"` a number.
2. Send "how long does it take?".
   Expected: `"retrievalReused":true`, `"reuseReason":"reuse"`, **`"embedMs":null`** — that null is the saved Gemini request. `"contextTier":"full"` too, since it is a timing question.
3. Send "what else could I make?".
   Expected: `"retrievalReused":false`, `"reuseReason":"exploratory"`, `"embedMs"` a number again.
4. Send "I also have chorizo".
   Expected: `"retrievalReused":false`, `"reuseReason":"new-ingredients"`.
5. Send "tell me about the first one" (no new ingredient, not exploratory, not precise).
   Expected: `"retrievalReused":true` with `"contextTier":"brief"`. Send it twice and check whether `"cachedTokens"` becomes non-zero on the second — a byte-identical brief prefix across two turns is the case Gemini's implicit cache can serve. It may still read 0 if the prefix is under the 1,024-token floor; record the number either way, because that is precisely the Phase 6 evidence.

Also confirm in the browser that the recipe cards on the reused turn still render ingredients and steps.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: reuse prior retrieval on follow-up turns

Saves the embedding request on a follow-up and fixes grounding: "how long
do I bake it?" no longer embeds as an ingredient search. Recipe content is
always re-fetched from Postgres, never read from the request body.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Trim the client's upload (Phase 2b)

The transport posts whole `UIMessage` objects, so each request re-uploads every prior turn's full recipe JSON — 6,298 bytes per assistant turn, ~37 KB across a six-turn transcript. The server reads only slugs.

**Files:**
- Create: `src/lib/chat-transport.ts`
- Create: `src/lib/chat-transport.test.ts`
- Modify: `src/components/chat-panel.tsx`

**Interfaces:**
- Consumes: `type ChatMessage` from `@/lib/chat-types`.
- Produces: `trimOutgoingMessages(messages: readonly ChatMessage[]): unknown[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/chat-transport.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { trimOutgoingMessages } from "@/lib/chat-transport";
import type { ChatMessage } from "@/lib/chat-types";

const ASSISTANT = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "Try the frittata." }],
  metadata: {
    sources: [
      {
        slug: "spinach-feta-frittata",
        title: "Spinach Feta Frittata",
        similarity: 0.71,
        recipe: {
          cuisine: "Mediterranean",
          ingredients: [{ item: "eggs", quantity: "8 large" }],
          instructions: ["Heat the oven to 180C.", "Wilt the spinach in a pan."],
        },
        pantry: { have: [], missing: [], missingRequiredCount: 0, hasEverything: false },
      },
    ],
  },
} as unknown as ChatMessage;

const USER = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "how long does it take?" }],
} as unknown as ChatMessage;

describe("trimOutgoingMessages", () => {
  it("keeps the parts the model needs", () => {
    expect(trimOutgoingMessages([USER])).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "how long does it take?" }] },
    ]);
  });

  it("keeps only slug and similarity from the sources", () => {
    expect(trimOutgoingMessages([ASSISTANT])).toEqual([
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Try the frittata." }],
        metadata: { sources: [{ slug: "spinach-feta-frittata", similarity: 0.71 }] },
      },
    ]);
  });

  it("does not upload the recipe body the server never reads", () => {
    const wire = JSON.stringify(trimOutgoingMessages([ASSISTANT]));
    expect(wire).not.toContain("Heat the oven");
    expect(wire).not.toContain("8 large");
    expect(wire).not.toContain("pantry");
  });

  it("omits metadata entirely when there are no sources", () => {
    const empty = { ...ASSISTANT, metadata: { sources: [] } } as unknown as ChatMessage;
    expect(trimOutgoingMessages([empty])[0]).not.toHaveProperty("metadata");
  });

  it("is dramatically smaller on the wire", () => {
    const before = Buffer.byteLength(JSON.stringify([ASSISTANT]));
    const after = Buffer.byteLength(JSON.stringify(trimOutgoingMessages([ASSISTANT])));
    expect(after).toBeLessThan(before / 2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- src/lib/chat-transport.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/chat-transport"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/chat-transport.ts`:

```ts
// What the client actually needs to upload.
//
// The AI SDK's default transport posts whole UIMessage objects, so every request
// re-uploads the full `sources` metadata of every prior assistant turn — each
// recipe's complete ingredient and instruction arrays, measured at ~6.3 KB per turn
// on this corpus. The route reads exactly two fields off those sources: the slug it
// re-fetches by, and the similarity it carries forward to keep the rendered context
// byte-identical (see src/lib/reuse.ts).
//
// This changes only the wire format. Client state keeps the full sources, so the
// recipe cards render from the same data they always did.
import type { ChatMessage } from "@/lib/chat-types";

export function trimOutgoingMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((message) => {
    const sources = message.metadata?.sources;
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      ...(sources?.length
        ? {
            metadata: {
              sources: sources.map((source) => ({
                slug: source.slug,
                similarity: source.similarity,
              })),
            },
          }
        : {}),
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/chat-transport.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the transport**

In `src/components/chat-panel.tsx`, replace the transport constant (line 22) with:

```ts
// One transport for the module: a fresh instance per render buys nothing and makes
// every child prop unstable.
//
// `prepareSendMessagesRequest` reproduces the SDK's own default body and swaps in the
// trimmed messages. The extra fields are not decoration — omitting them would drop
// `id`, `trigger` and `messageId` from the request.
const transport = new DefaultChatTransport<ChatMessageType>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ body, id, messages, trigger, messageId }) => ({
    body: {
      ...body,
      id,
      trigger,
      messageId,
      messages: trimOutgoingMessages(messages),
    },
  }),
});
```

and add the import alongside the existing `@/lib/chat-types` import:

```ts
import { trimOutgoingMessages } from "@/lib/chat-transport";
```

- [ ] **Step 6: Verify it compiles and the app still works**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no errors.

Then run `npm run dev` and, with the browser devtools Network tab open on `/api/chat`, repeat the five-turn conversation from Task 9 Step 7.
Expected: every turn still answers, the cards still render ingredients and steps, reuse still reports `"retrievalReused":true` on turn 2 — and the request payload size stays roughly flat across the transcript instead of growing by ~6 KB per assistant turn.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chat-transport.ts src/lib/chat-transport.test.ts src/components/chat-panel.tsx
git commit -m "perf: upload only slugs from prior turns, not full recipe JSON

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Report the quota evidence from `npm run check`

Phase 6 of the design is a decision waiting on evidence: is the binding ceiling requests or tokens? Gemini's 429 messages name the exact quota metric. `npm run check` already walks every model in `CHAT_MODELS`; this captures what it learns and prints the prompt sizes alongside.

**Files:**
- Modify: `scripts/check.ts`

**Interfaces:**
- Consumes: `buildContextBlock` and `SYSTEM_PROMPT` from `@/lib/prompt`.
- Produces: nothing importable. This is the last task in the plan.

- [ ] **Step 1: Add the imports**

In `scripts/check.ts`, add after the existing `../src/lib/ingredients` import:

```ts
import { buildContextBlock, SYSTEM_PROMPT } from "../src/lib/prompt";
```

- [ ] **Step 2: Capture the quota errors in step 6**

In the `"6. Chat models"` step, add a collector above the loop and record into it. Replace the `catch` block inside the `for (const modelId of CHAT_MODELS)` loop with:

```ts
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const spent = /quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(message);
        if (spent) quotaErrors.push({ modelId, message });
        console.log(
          `  ${spent ? "SKIP" : "FAIL"}  ${modelId}: ${spent ? "out of quota right now" : message.slice(0, 120)}`,
        );
      }
```

and declare the collector next to the other `main()` locals, beside `let topMatch: MatchedRecipe | null = null;`:

```ts
  // Gemini's 429 bodies name the exact quota that was hit, which is the evidence the
  // design's Phase 6 decision waits on. Collected in step 6, reported in step 7.
  const quotaErrors: { modelId: string; message: string }[] = [];
```

- [ ] **Step 3: Add step 7**

Insert immediately before the final `console.log(failures === 0 ? ...)` call:

```ts
  // Not a pass/fail check: the numbers behind the design's cost decisions. An estimate
  // of 4 characters per token is close enough to compare two renderings of the same
  // recipes, which is all this is for.
  await step("7. Prompt cost and quota evidence", async () => {
    const tokens = (text: string) => Math.round(text.length / 4);

    console.log(`          SYSTEM_PROMPT            ~${tokens(SYSTEM_PROMPT)} tok`);

    if (!topMatch) {
      ok("skipped the context measurement — step 4 found no matches");
    } else {
      const matches = [topMatch];
      for (const tier of ["brief", "full"] as const) {
        const block = buildContextBlock(matches, tier);
        console.log(
          `          context (${tier.padEnd(5)}, 1 recipe)  ~${tokens(block)} tok`,
        );
      }
      const full = tokens(buildContextBlock(matches, "full"));
      const brief = tokens(buildContextBlock(matches, "brief"));
      const saved = full > 0 ? Math.round(((full - brief) / full) * 100) : 0;
      ok(`the brief tier drops ${saved}% of the context block`);
      // Gemini bills a byte-identical prefix of >=1024 tokens (Flash) at 10%. Below
      // that floor the cache cannot fire at all, which decides Phase 6.
      const prefix = tokens(SYSTEM_PROMPT) + brief * 3;
      console.log(
        `          projected brief prefix, 3 recipes  ~${prefix} tok  (implicit cache floor: 1024)`,
      );
      if (prefix < 1024) {
        console.log(
          "          → under the floor: caching cannot fire, so do NOT trim further (design Phase 6)",
        );
      } else {
        ok("over the implicit-cache floor, so follow-up turns can be billed at 10%");
      }
    }

    if (quotaErrors.length === 0) {
      ok("no model reported a quota error on this run");
    } else {
      // Printed in full, untruncated: the metric name is usually near the end.
      console.log("\n          Quota errors, verbatim — these name the binding ceiling:");
      for (const { modelId, message } of quotaErrors) {
        console.log(`\n          ${modelId}:\n          ${message.replace(/\n/g, "\n          ")}`);
      }
      console.log(
        "\n          → a *PerDay metric means requests bind (favour design Phases 2 and 5);",
      );
      console.log(
        "            a *Tokens metric means tokens bind (favour trimming, design Phase 6).",
      );
    }
  });
```

- [ ] **Step 4: Run it**

Run: `npm run check`
Expected: steps 1–6 behave exactly as before, then a step 7 reporting the `SYSTEM_PROMPT` size, both tier sizes for the top match, the percentage the brief tier saves, and whether the projected prefix clears the 1,024-token cache floor. It must not add a failure — step 7 makes no assertions that can fail on a healthy install.

- [ ] **Step 5: Commit**

```bash
git add scripts/check.ts
git commit -m "feat: report prompt cost and quota evidence from npm run check

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `npm test` passes; `npx tsc --noEmit` and `npm run lint` are clean.
- `npm run check` reports step 7 with real numbers.
- A five-turn conversation logs one `[metrics]` row per turn, in which:
  - a plain ingredient turn shows `"contextTier":"brief"` with `inputTokens` well below the Task 3 baseline;
  - a "what are the steps" turn shows `"contextTier":"full"`;
  - a follow-up shows `"retrievalReused":true` and **`"embedMs":null`** — the saved Gemini request;
  - "what else could I make" shows `"reuseReason":"exploratory"` and searches again.
- The recipe cards render ingredients and steps on every turn, including reused ones.
- The `/api/chat` request body no longer grows by ~6 KB per assistant turn.

## Deliberately not in this plan

Phases 3–5 of the spec (hybrid `tsvector` + RRF ranking, pantry-coverage rerank with model routing, and the persistent embedding cache) all require `supabase/schema.sql` migrations and belong to plan two, together with the ~20-query retrieval eval harness that is the only honest way to prove or disprove Phase 3's precision claim. Phase 6 is a decision, and the data it needs starts accumulating the moment Task 3 ships.
