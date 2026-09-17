// Similarity search, run inside Postgres by `match_recipes`.
//
// Ranking in the app would mean shipping every row's embedding over the wire —
// ~30 MB per request at 2,000 recipes.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchedRecipe, Recipe } from "./recipes";

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
