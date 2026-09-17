import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  embed,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

import { CHAT_MODELS, needsFullSteps, temperatureFor } from "@/lib/chat-config";
import type { ChatMessage, SourceRecipe } from "@/lib/chat-types";
import { buildPantry, comparePantry } from "@/lib/ingredients";
import {
  buildContextBlock,
  buildFallbackAnswer,
  SEARCH_UNAVAILABLE_REPLY,
  SYSTEM_PROMPT,
} from "@/lib/prompt";
import {
  cachedTokensFrom,
  logTurnMetrics,
  type ContextTier,
  type TurnMetrics,
} from "@/lib/metrics";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type MatchedRecipe,
} from "@/lib/recipes";
import { fetchRecipesBySlug, searchRecipes } from "@/lib/retrieval";
import { decideReuse, priorSourcesFrom } from "@/lib/reuse";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 30;

const MATCH_THRESHOLD = 0.35;
const MATCH_COUNT = 4;

// Enough for a follow-up to keep its thread; older turns are cost without benefit,
// and the recipes themselves are re-retrieved every turn anyway.
const HISTORY_MESSAGES = 12;
const MAX_QUERY_CHARS = 1000;

// The client posts UI messages. Anything else is a bad request, not a 500 later on.
const bodySchema = z.object({
  messages: z
    .array(
      z.looseObject({
        role: z.enum(["system", "user", "assistant"]),
        parts: z.array(z.looseObject({ type: z.string() })),
      }),
    )
    .min(1)
    .max(200),
});

// The text parts of a message, joined.
function textOf(message: ChatMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

// Identical queries embed to identical vectors, and repeats are common here: the
// suggestion chips, the retry button, and two people typing "eggs and spinach".
// Each miss is a billed call against a small free quota.
const EMBEDDING_CACHE_LIMIT = 256;
const embeddingCache = new Map<string, number[]>();

async function embedQuery(query: string, abortSignal: AbortSignal) {
  const key = query.toLowerCase().replace(/\s+/g, " ").trim();

  const cached = embeddingCache.get(key);
  if (cached) {
    // Re-insert so the map stays ordered oldest-first for eviction.
    embeddingCache.delete(key);
    embeddingCache.set(key, cached);
    return cached;
  }

  const { embedding } = await embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    value: query,
    abortSignal,
    // Unlike the chat models, this call has no alternative: the corpus was ingested
    // with this exact model, so a different one's vectors would not be comparable.
    // A per-minute limit clears in seconds, so it is worth the SDK's backoff before
    // giving up — only a genuinely spent daily quota should reach the user.
    maxRetries: 2,
    providerOptions: {
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: "RETRIEVAL_QUERY",
      },
    },
  });

  embeddingCache.set(key, embedding);
  if (embeddingCache.size > EMBEDDING_CACHE_LIMIT) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest !== undefined) embeddingCache.delete(oldest);
  }
  return embedding;
}

// A spent quota or a busy provider: worth trying the next model. A malformed request
// or a bad key is not — that would just fail three times as slowly.
function isExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota|rate.?limit|RESOURCE_EXHAUSTED|UNAVAILABLE|overload|high demand|\b(429|503)\b/i.test(
    message,
  );
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function describeStreamError(error: unknown): string {
  console.error("[chat] stream failed:", error);
  if (isExhausted(error)) {
    return "Every chat model is rate-limited right now. The recipes below came from retrieval and are still accurate — try again in a minute for the written answer.";
  }
  return "The assistant could not finish that answer. Please try again.";
}

// A plain assistant message with no sources — used when the app cannot search at
// all, so the failure reads as an answer rather than as a broken page.
function streamNotice(text: string): Response {
  const stream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      const id = crypto.randomUUID();
      writer.write({ type: "start", messageMetadata: { sources: [] } });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

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

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: "Unexpected message format." }, { status: 400 });
  }

  const messages = parsed.data.messages as unknown as ChatMessage[];

  // 1. The latest user turn is the retrieval query.
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserMessage = userMessages[userMessages.length - 1];
  const query = lastUserMessage ? textOf(lastUserMessage).slice(0, MAX_QUERY_CHARS) : "";

  if (!query) {
    return Response.json({ error: "No user message to answer." }, { status: 400 });
  }

  const startedAt = Date.now();

  try {
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

    // 6. Temperature comes from the question: steps sample tighter than ideas.
    const temperature = temperatureFor(query);

    // Steps go in only when the question needs them. Everything else the model is
    // allowed to say is in the brief rendering, and the card shows the method either
    // way — so on a plain ingredient turn this is a saving, not a trade-off.
    const contextTier: ContextTier = needsFullSteps(query) ? "full" : "brief";

    const sources: SourceRecipe[] = matches.map((m) => {
      const r = m.metadata;
      return {
        slug: m.slug,
        title: m.title,
        similarity: Number(m.similarity.toFixed(2)),
        recipe: {
          cuisine: r.cuisine,
          country: r.country,
          dietaryTags: r.dietaryTags ?? [],
          difficulty: r.difficulty,
          prepTimeMinutes: r.prepTimeMinutes,
          cookTimeMinutes: r.cookTimeMinutes,
          servings: r.servings,
          ingredients: r.ingredients ?? [],
          instructions: r.instructions ?? [],
          tips: r.tips,
          source: r.source,
          sourceUrl: r.sourceUrl,
        },
        pantry: comparePantry(r.ingredients ?? [], pantry),
      };
    });

    // 7. Ground the model. An empty match set still goes through; rule 2 makes it refuse.
    const system = `${SYSTEM_PROMPT}\n\n${buildContextBlock(matches, contextTier)}`;
    const modelMessages = await convertToModelMessages(
      messages.slice(-HISTORY_MESSAGES),
    );

    // 8. Stream, with the retrieved recipes attached up front so the UI can show its
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

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    if (isAbort(error)) return new Response(null, { status: 499 });
    console.error("[chat] unexpected failure:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
