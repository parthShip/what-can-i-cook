// Recipe types and the chunking strategy, shared by the ingest script and the chat route.

import type { ContextTier } from "@/lib/metrics";

export type Ingredient = {
  item: string;
  quantity: string;
  optional?: boolean;
};

export type Recipe = {
  id: string;
  title: string;
  cuisine: string;
  // Country the cuisine belongs to, or the region when it names no single country.
  country: string;
  dietaryTags: string[];
  difficulty: "Easy" | "Medium" | "Hard";
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  // Absent when the source did not publish one.
  servings?: number;
  ingredients: Ingredient[];
  instructions: string[];
  tips?: string;
  source?: string;
  sourceUrl?: string;
};

// A row as returned by the `match_recipes` Postgres function.
export type MatchedRecipe = {
  id: number;
  slug: string;
  title: string;
  content: string;
  metadata: Recipe;
  similarity: number;
};

// 768 dims, not the model's native 3072: pgvector cannot index past 2000.
export const EMBEDDING_MODEL = "gemini-embedding-001" as const;
export const EMBEDDING_DIMENSIONS = 768 as const;

// One recipe = one chunk, ingredients first because the user's query is an ingredient list.
// Both tiers share every line but the method: `full` is what was embedded, `brief` drops
// the step text.
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
  // The sentence differs by tier: on `brief` there are no steps below to point at.
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

// The ingest format: what the `content` column holds, so it must stay byte-identical.
export function toChunk(r: Recipe): string {
  return chunkLines(r, "full").join("\n");
}

// The same recipe with the method replaced by a pointer at the card.
export function toBriefChunk(r: Recipe): string {
  return chunkLines(r, "brief").join("\n");
}
