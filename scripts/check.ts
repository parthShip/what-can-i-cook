// End-to-end preflight for the RAG pipeline: npm run check
// Tests env, embeddings, Supabase, vector search and the chat model in order, so a
// failure names the broken stage instead of leaving you with a silent chat box.
import { embed, generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { CHAT_MODELS } from "../src/lib/chat-config";
import { buildPantry, comparePantry } from "../src/lib/ingredients";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type MatchedRecipe,
} from "../src/lib/recipes";
import { searchRecipes } from "../src/lib/retrieval";

const TEST_QUERY = "I have eggs, spinach and feta";
// Asserting the identity of the top hit is what catches a degenerate index.
const EXPECTED_TOP_SLUG = "spinach-feta-frittata";

const ok = (msg: string) => console.log(`  PASS  ${msg}`);
const fail = (msg: string) => console.log(`  FAIL  ${msg}`);

let failures = 0;

async function step(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    failures++;
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log("Preflight check for 'What Can I Cook?'");

  let embedding: number[] = [];
  let rowCount = 0;
  let topMatch: MatchedRecipe | null = null;

  await step("1. Environment variables", async () => {
    const required = [
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(
        `Missing ${missing.join(", ")}. Copy .env.example to .env.local and fill it in.`,
      );
    }
    for (const key of required) ok(`${key} is set`);

    if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
      fail(
        "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is set — the service-role key must NEVER be public.",
      );
      failures++;
    }
  });

  await step(`2. Google embeddings (${EMBEDDING_MODEL})`, async () => {
    const result = await embed({
      model: google.textEmbeddingModel(EMBEDDING_MODEL),
      value: TEST_QUERY,
      providerOptions: {
        google: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "RETRIEVAL_QUERY",
        },
      },
    });
    embedding = result.embedding;

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}. The vector(${EMBEDDING_DIMENSIONS}) column will reject these.`,
      );
    }
    ok(`API key valid, returned ${embedding.length} dimensions`);
  });

  // Built lazily so a missing URL surfaces as a step failure, not a stack trace.
  let cached: SupabaseClient | null = null;
  const supabase = () => {
    if (cached) return cached;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Skipped — step 1 failed.");
    cached = createClient(url, key, { auth: { persistSession: false } });
    return cached;
  };

  await step("3. Supabase table", async () => {
    // A real (non-head) select, so "table not found" is an error, not a null count.
    const {
      data: rows,
      count,
      error,
    } = await supabase().from("recipes").select("slug", { count: "exact" }).limit(1);

    if (error) {
      throw new Error(
        `${error.message}\n        → Did you run supabase/schema.sql in the SQL Editor of THIS project?`,
      );
    }
    if (!rows?.length) {
      throw new Error("Table exists but is empty. Run: npm run ingest");
    }
    rowCount = count ?? 0;
    ok(`recipes table reachable, ${count} rows`);

    const { data: nulls } = await supabase()
      .from("recipes")
      .select("slug")
      .is("embedding", null);

    if (nulls?.length) {
      throw new Error(
        `${nulls.length} row(s) have no embedding: ${nulls.map((r) => r.slug).join(", ")}. Re-run: npm run ingest`,
      );
    }
    ok("every row has an embedding");
  });

  await step("4. Similarity search", async () => {
    if (!embedding.length) throw new Error("Skipped — step 2 failed.");

    const matches = await searchRecipes(supabase(), embedding, {
      threshold: 0.35,
      limit: 4,
    });

    if (!matches.length) {
      throw new Error(
        `No matches above threshold 0.35 for "${TEST_QUERY}". Retrieval is returning nothing — lower MATCH_THRESHOLD in the route, or check that ingest used the same embedding model.`,
      );
    }

    topMatch = matches[0];
    ok(`"${TEST_QUERY}" retrieved ${matches.length} recipe(s):`);
    for (const m of matches) {
      console.log(`          ${m.similarity.toFixed(3)}  ${m.title}`);
    }

    // Relevance, not liveness: exact scores over a junk candidate set still look like a pass.
    if (matches[0].slug !== EXPECTED_TOP_SLUG) {
      throw new Error(
        `Top match for "${TEST_QUERY}" was "${matches[0].slug}", expected "${EXPECTED_TOP_SLUG}".
        → Retrieval is returning the wrong recipe. Re-run supabase/schema.sql to rebuild the vector index.`,
      );
    }
    ok(`top match is "${EXPECTED_TOP_SLUG}" as expected`);

    // Depth, not total recall: HNSW may return fewer rows than a large LIMIT asks for,
    // but a realistic page must come back deduped and in order.
    const depth = Math.min(25, rowCount);
    const page = await searchRecipes(supabase(), embedding, { threshold: -1, limit: depth });

    if (page.length < depth) {
      throw new Error(
        `Asked for ${depth} matches, got ${page.length} — the index is not returning a full page.
        → Check that every row has a readable embedding: npm run ingest`,
      );
    }

    const slugs = new Set(page.map((m) => m.slug));
    if (slugs.size !== page.length) {
      throw new Error(`Search returned duplicate rows (${page.length} rows, ${slugs.size} unique).`);
    }

    const ordered = page.every((m, i) => i === 0 || page[i - 1].similarity >= m.similarity);
    if (!ordered) throw new Error("Matches came back out of similarity order.");

    ok(`${page.length} distinct matches, correctly ordered`);
  });

  // The "you have" / "you still need" split the cards render. Pure and offline, so a
  // wrong answer here is a code bug rather than a flaky model.
  await step("5. Pantry comparison", async () => {
    // A fixture, so this assertion holds whatever the ingested corpus currently is.
    const fixture = [
      { item: "eggs", quantity: "8 large" },
      { item: "baby spinach", quantity: "150 g" },
      { item: "feta cheese", quantity: "120 g" },
      { item: "chicken stock", quantity: "200 ml" },
      { item: "fresh dill", quantity: "2 tbsp", optional: true },
    ];
    const fixtureMatch = comparePantry(fixture, buildPantry([TEST_QUERY]));
    const credited = fixtureMatch.have.map((i) => i.item);

    const expected = ["eggs", "baby spinach", "feta cheese"];
    const wrong = credited.filter((item) => !expected.includes(item));
    const absent = expected.filter((item) => !credited.includes(item));

    if (absent.length) throw new Error(`Did not credit: ${absent.join(", ")}.`);
    // "chicken stock" must not be credited to someone who only said "chicken".
    if (wrong.length) throw new Error(`Credited ingredients never mentioned: ${wrong.join(", ")}.`);
    ok(`"${TEST_QUERY}" credits exactly ${credited.join(", ")}`);

    if (fixtureMatch.missingRequiredCount !== 1 || fixtureMatch.hasEverything) {
      throw new Error(
        `Expected 1 required ingredient still missing, got ${fixtureMatch.missingRequiredCount}.`,
      );
    }
    ok("optional extras are counted apart from what is really missing");

    // Against a live row: every ingredient lands on exactly one side, none is invented.
    if (!topMatch) throw new Error("Skipped — step 4 failed.");
    const live = comparePantry(topMatch.metadata.ingredients, buildPantry([TEST_QUERY]));
    const total = live.have.length + live.missing.length;
    if (total !== topMatch.metadata.ingredients.length) {
      throw new Error(
        `Split lost or invented rows: ${total} vs ${topMatch.metadata.ingredients.length} ingredients.`,
      );
    }
    ok(`"${topMatch.title}": ${live.have.length} you have, ${live.missing.length} needed, nothing invented`);

    // A question with no ingredients in it must credit the user with nothing.
    const empty = comparePantry(
      topMatch.metadata.ingredients,
      buildPantry(["how long does the second one take?"]),
    );
    if (empty.have.length) {
      throw new Error(
        `A question with no ingredients credited: ${empty.have.map((i) => i.item).join(", ")}.`,
      );
    }
    ok("a question with no ingredients credits nothing");
  });

  // The whole fallback chain, not just the first model: on the free tier the first
  // one is often spent while the others still answer, and that is exactly the case
  // the route is built to survive.
  await step("6. Chat models", async () => {
    let reachable = 0;

    for (const modelId of CHAT_MODELS) {
      try {
        const { text } = await generateText({
          model: google(modelId),
          prompt: "Reply with exactly the word: ready",
          maxRetries: 0,
        });
        reachable++;
        ok(`${modelId} responded: "${text.trim().slice(0, 20)}"`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const spent = /quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(message);
        console.log(
          `  ${spent ? "SKIP" : "FAIL"}  ${modelId}: ${spent ? "out of quota right now" : message.slice(0, 120)}`,
        );
      }
    }

    if (reachable === 0) {
      throw new Error(
        `No chat model is reachable. The app still answers from retrieved recipes, but without written answers.
        → Wait for the free-tier quota to reset, or add a model to CHAT_MODELS in src/lib/chat-config.ts.`,
      );
    }
    ok(`${reachable} of ${CHAT_MODELS.length} models reachable — the route fails over to these in order`);
  });

  console.log(
    failures === 0
      ? "\nAll checks passed. Run `npm run dev` and start cooking.\n"
      : `\n${failures} check(s) failed — fix the first FAIL above and re-run.\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
