import type { UIMessage } from "ai";

import type { PantryComparison } from "@/lib/ingredients";
import type { Recipe } from "@/lib/recipes";

// The recipe fields the UI renders. Straight from the stored row — nothing here is
// derived, defaulted or written by the model, so a card can only show what was ingested.
export type SourceRecipeData = Pick<
  Recipe,
  | "cuisine"
  | "country"
  | "dietaryTags"
  | "difficulty"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "servings"
  | "ingredients"
  | "instructions"
  | "tips"
  | "source"
  | "sourceUrl"
>;

// One retrieved recipe an assistant answer was grounded in, sent as message metadata.
export type SourceRecipe = {
  slug: string;
  title: string;
  similarity: number;
  recipe: SourceRecipeData;
  // Computed on the server from this recipe's rows and the user's own words.
  pantry: PantryComparison;
};

export type ChatMessageMetadata = {
  sources?: SourceRecipe[];
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;
