import { Check } from "lucide-react";

import type { PantryIngredient } from "@/lib/ingredients";

// The recipe rows the user's own words covered. Matched on the server against the
// ingested ingredient list, so this is never the model's guess at what they have.
export function RecipeIngredients({
  ingredients,
}: {
  ingredients: PantryIngredient[];
}) {
  if (ingredients.length === 0) return null;

  return (
    <section className="rounded-lg bg-have-surface p-3 ring-1 ring-have/20">
      <h4 className="mb-2 font-serif text-sm font-semibold text-have">
        You have{" "}
        <span className="font-sans text-xs font-normal opacity-70">
          ({ingredients.length})
        </span>
      </h4>
      <ul className="space-y-1">
        {ingredients.map((ingredient, index) => (
          <li
            key={`${index}-${ingredient.item}`}
            className="flex items-start gap-1.5 text-sm break-words"
          >
            <Check className="mt-0.5 size-3.5 shrink-0 text-have" aria-hidden />
            <span className="min-w-0">
              {ingredient.item}
              {ingredient.matchedWith && (
                <span className="text-muted-foreground">
                  {" "}
                  — you said {ingredient.matchedWith}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
