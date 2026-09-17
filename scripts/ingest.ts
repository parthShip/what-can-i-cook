// Embeds data/recipes.json into Supabase pgvector: npm run ingest
// Idempotent and resumable — upserts on slug, skips unchanged rows, prunes deleted ones.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toChunk,
  type Recipe,
} from "../src/lib/recipes";

// Measured ceilings, not documented ones: the API 429s on too many inputs OR too many
// tokens and calls both a "quota" error. 50 inputs pass / 100 fail; ~17k tokens pass / ~26k fail.
const MAX_BATCH_ITEMS = 32;
const MAX_BATCH_TOKENS = 12_000;

// Rough, and only used to decide where to split a batch.
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// Slugs per delete request, to keep the query string short.
const DELETE_BATCH = 200;

// Spacing between calls, to stay inside the per-minute request limit.
const THROTTLE_MS = 700;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey || !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error(
    "Missing env vars. Copy .env.example to .env.local and fill in GOOGLE_GENERATIVE_AI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Embeds one batch, treating a rate limit as backpressure rather than failure.
async function embedBatch(values: string[], batchLabel: string): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel(EMBEDDING_MODEL),
        values,
        providerOptions: {
          google: {
            outputDimensionality: EMBEDDING_DIMENSIONS,
            // Documents and queries are embedded with different task types so the
            // model places a stored recipe and a "what can I cook" question in
            // comparable regions of the space.
            taskType: "RETRIEVAL_DOCUMENT",
          },
        },
      });
      return embeddings;
    } catch (error) {
      if (attempt > 5) throw error;
      const wait = Math.min(60_000, 2000 * 2 ** (attempt - 1));
      console.warn(`  ${batchLabel} failed (attempt ${attempt}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

type StoredRow = { slug: string; content: string | null };

// Paged: PostgREST silently caps a response at 1,000 rows, which would re-embed half the corpus.
async function fetchStored(options: { unembeddedOnly?: boolean } = {}): Promise<StoredRow[]> {
  const PAGE = 1000;
  const out: StoredRow[] = [];

  for (let from = 0; ; from += PAGE) {
    const base = supabase
      .from("recipes")
      .select(options.unembeddedOnly ? "slug" : "slug, content");

    const { data, error } = await (options.unembeddedOnly
      ? base.is("embedding", null)
      : base
    ).range(from, from + PAGE - 1);

    if (error) throw error;

    const rows = (data ?? []) as unknown as StoredRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function main() {
  const recipes: Recipe[] = JSON.parse(
    readFileSync(resolve(process.cwd(), "data/recipes.json"), "utf-8"),
  );
  console.log(`Loaded ${recipes.length} recipes from data/recipes.json`);

  const chunks = recipes.map(toChunk);

  // The table is the checkpoint: already-embedded rows are skipped, so a run can resume.
  // `embedding` is not selected — reading 2,000 x 768 floats back is a 30 MB round trip.
  const done = new Map((await fetchStored()).map((r) => [r.slug, r.content]));
  for (const { slug } of await fetchStored({ unembeddedOnly: true })) done.delete(slug);

  const pending = recipes
    .map((recipe, i) => ({ recipe, chunk: chunks[i] }))
    // Unchanged chunk text would embed to the same vector.
    .filter(({ recipe, chunk }) => done.get(recipe.id) !== chunk);

  const skipped = recipes.length - pending.length;
  if (skipped) console.log(`${skipped} already embedded and unchanged — skipping those.`);
  if (pending.length === 0) {
    console.log("Nothing to embed; the table is already up to date.");
  }

  // Split on whichever ceiling comes first: 32 average recipes fit, 32 of the largest do not.
  const batches: (typeof pending)[] = [];
  let current: typeof pending = [];
  let currentTokens = 0;

  for (const entry of pending) {
    const tokens = estimateTokens(entry.chunk);
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_ITEMS || currentTokens + tokens > MAX_BATCH_TOKENS)
    ) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += tokens;
  }
  if (current.length) batches.push(current);

  let embedded = 0;
  for (const [batchIndex, slice] of batches.entries()) {
    const label = `batch ${batchIndex + 1}/${batches.length}`;

    let vectors: number[][];
    try {
      vectors = await embedBatch(slice.map((p) => p.chunk), label);
    } catch (error) {
      // Work so far is persisted, so this is a pause, not a loss.
      console.error(
        `\nEmbedding stopped at ${embedded + skipped}/${recipes.length}.\n` +
          `Cause: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n` +
          `If this is a quota error, re-run 'npm run ingest' once the quota resets — ` +
          `finished recipes are saved and will be skipped.`,
      );
      process.exit(1);
    }

    const width = vectors[0]?.length;
    if (width !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS}-dim embeddings, got ${width}. The vector(${EMBEDDING_DIMENSIONS}) column will reject these.`,
      );
    }

    // Upserted per batch: a batch that is paid for survives the next failure.
    const { error } = await supabase.from("recipes").upsert(
      slice.map(({ recipe, chunk }, j) => ({
        slug: recipe.id,
        title: recipe.title,
        content: chunk,
        metadata: recipe,
        embedding: vectors[j],
      })),
      { onConflict: "slug" },
    );
    if (error) throw error;

    embedded += slice.length;
    console.log(`  ${label} — ${embedded}/${pending.length} embedded and saved`);
    if (batchIndex + 1 < batches.length) await sleep(THROTTLE_MS);
  }

  // Rows no longer in the corpus would still be retrieved and quoted, so drop them.
  // Diffed here because 2,000 slugs in a `not.in(...)` filter is a ~60 KB URL.
  const wanted = new Set(recipes.map((r) => r.id));
  const stale = [...done.keys()].filter((slug) => !wanted.has(slug));

  for (let i = 0; i < stale.length; i += DELETE_BATCH) {
    const { error } = await supabase
      .from("recipes")
      .delete()
      .in("slug", stale.slice(i, i + DELETE_BATCH));
    if (error) throw error;
  }
  if (stale.length) console.log(`Pruned ${stale.length} recipes no longer in the corpus.`);

  const { count } = await supabase
    .from("recipes")
    .select("*", { count: "exact", head: true });
  console.log(`Done. ${count ?? "?"}/${recipes.length} recipes are in Supabase.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
