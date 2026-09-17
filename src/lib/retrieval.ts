// Similarity search, run inside Postgres by `match_recipes`.
//
// Ranking in the app would mean shipping every row's embedding over the wire —
// ~30 MB per request at 2,000 recipes.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchedRecipe, Recipe } from "./recipes";
import type { PriorSource } from "./reuse";

export type SearchOptions = {
  threshold: number;
  limit: number;
};

// The best `limit` recipes above `threshold`, most similar first.
export async function searchRecipes(
  supabase: SupabaseClient,
  queryEmbedding: number[],
  { threshold, limit }: SearchOptions,
): Promise<MatchedRecipe[]> {
  const { data, error } = await supabase.rpc("match_recipes", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) throw error;

  // Already filtered, ordered and limited by SQL; this only types the rpc payload.
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as number,
    slug: row.slug as string,
    title: row.title as string,
    content: row.content as string,
    metadata: row.metadata as Recipe,
    similarity: row.similarity as number,
  }));
}

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
