// Recipe types and the chunking strategy, shared by the ingest script and the chat route.

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
export function toChunk(r: Recipe): string {
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
  const measured = r.ingredients.filter((i) => i.quantity.trim());
  const amounts = measured.length
    ? `Ingredients with quantities: ${measured
        .map((i) => `${i.quantity} ${i.item}${i.optional ? " (optional)" : ""}`)
        .join("; ")}.`
    : "Quantities: not recorded for this recipe — the steps below are the only stated amounts.";

  return [
    `Recipe: ${r.title}`,
    `Main ingredients: ${ingredients}`,
    `Cuisine: ${r.cuisine} (${r.country}). Tags: ${r.dietaryTags.join(", ") || "none"}.`,
    `Difficulty: ${r.difficulty}.${timing ? ` ${timing}.` : ""}`,
    amounts,
    `Steps: ${r.instructions.map((s, i) => `${i + 1}. ${s}`).join(" ")}`,
    r.tips ? `Tip: ${r.tips}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
