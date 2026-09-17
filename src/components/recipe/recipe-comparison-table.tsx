import { memo } from "react";

import type { SourceRecipe } from "@/lib/chat-types";
import {
  decodeEntities,
  DIFFICULTY_CLASS,
  DIFFICULTY_EMOJI,
  formatMinutes,
  totalMinutes,
} from "@/lib/recipe-display";
import { cn } from "@/lib/utils";

// Side by side, for the one question a stack of cards answers badly: which of these?
// Every cell is a stored field or the server-side pantry count.
function RecipeComparisonTableImpl({ sources }: { sources: SourceRecipe[] }) {
  if (sources.length < 2) return null;

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-border">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">
          The recommended recipes compared by time, servings, difficulty and how many
          ingredients you are missing
        </caption>
        <thead>
          <tr className="bg-muted/70 text-left">
            <th scope="col" className="px-3 py-2 font-medium">
              Recipe
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Time
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Serves
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Difficulty
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Missing
            </th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const total = totalMinutes(source.recipe);
            return (
              <tr key={source.slug} className="border-t border-border align-top">
                {/* Serif here too: the name is the cookbook's, not the app's. */}
                <th
                  scope="row"
                  className="max-w-[14rem] px-3 py-2 text-left font-serif font-semibold break-words"
                >
                  {decodeEntities(source.title)}
                </th>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  {total !== null ? formatMinutes(total) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {source.recipe.servings ?? "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 whitespace-nowrap",
                    DIFFICULTY_CLASS[source.recipe.difficulty],
                  )}
                >
                  <span aria-hidden>{DIFFICULTY_EMOJI[source.recipe.difficulty]} </span>
                  {source.recipe.difficulty}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    source.pantry.missingRequiredCount === 0 && "text-have",
                  )}
                >
                  {source.pantry.missingRequiredCount === 0
                    ? "Nothing"
                    : source.pantry.missingRequiredCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const RecipeComparisonTable = memo(RecipeComparisonTableImpl);
