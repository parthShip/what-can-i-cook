"use client";

import { memo } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import { MissingIngredients } from "@/components/recipe/missing-ingredients";
import { RecipeIngredients } from "@/components/recipe/recipe-ingredients";
import { RecipeMetadata } from "@/components/recipe/recipe-metadata";
import { RecipeSteps } from "@/components/recipe/recipe-steps";
import { TechniqueTip } from "@/components/recipe/technique-tip";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { SourceRecipe } from "@/lib/chat-types";
import { decodeEntities, recipeEmoji } from "@/lib/recipe-display";

// One retrieved recipe, rendered from its stored fields. Set in the serif
// throughout: everything on this card is quoted out of the cookbook, and the
// typeface is how the app says so without a label claiming it.
function RecipeCardImpl({ source }: { source: SourceRecipe }) {
  const { recipe, pantry } = source;
  const title = decodeEntities(source.title);
  const measured = recipe.ingredients.some((i) => i.quantity.trim());
  // Prep and cook separately, for the cook who wants to know where the time goes.
  const timing = [
    recipe.prepTimeMinutes > 0 ? `${recipe.prepTimeMinutes} min prep` : null,
    recipe.cookTimeMinutes > 0 ? `${recipe.cookTimeMinutes} min cook` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <article className="overflow-hidden rounded-xl bg-card ring-1 ring-border transition-shadow duration-300 hover:shadow-md hover:shadow-foreground/5">
      <header className="flex items-start gap-3 px-4 pt-4">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-lg leading-none"
        >
          {recipeEmoji(title, recipe)}
        </span>
        <h3 className="min-w-0 flex-1 pt-1 font-serif text-lg leading-snug font-semibold break-words [font-variation-settings:'SOFT'_20]">
          {title}
        </h3>
      </header>

      <div className="space-y-3 p-4">
        <RecipeMetadata recipe={recipe} />

        {/* items-start: a short "you have" list should not stretch to match a long
            shopping list beside it. */}
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <RecipeIngredients ingredients={pantry.have} />
          <MissingIngredients pantry={pantry} />
        </div>

        {/* Base UI animates to the panel's measured height, so opening shows the
            recipe unrolling rather than the card jumping to its new size. */}
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="group/disclose w-full justify-center sm:w-auto"
              />
            }
          >
            <span className="group-data-[panel-open]/disclose:hidden">
              View the full recipe
            </span>
            <span className="hidden group-data-[panel-open]/disclose:inline">
              Hide the recipe
            </span>
            <ChevronDown
              className="transition-transform duration-300 group-data-[panel-open]/disclose:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>

          <CollapsiblePanel>
            <div className="mt-4 space-y-5 border-t border-border pt-4">
              {timing && (
                <p className="text-xs text-muted-foreground">{timing}</p>
              )}

              <section>
                <h4 className="mb-2 font-serif text-sm font-semibold">
                  Ingredients
                </h4>
                {!measured && (
                  <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden>⚠️</span>
                    Amounts were not recorded for this recipe — only what the
                    steps state.
                  </p>
                )}
                {/* Set the way a cookbook sets it: the ingredient on the left,
                    the amount ranged right against it. Scanning "do I have this"
                    and "how much" are two different reads, so they get two
                    columns rather than one run-on line. */}
                <ul className="max-w-md space-y-1.5">
                  {recipe.ingredients.map((ingredient, index) => (
                    <li
                      key={`${index}-${ingredient.item}`}
                      className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 font-serif text-[0.9rem] leading-snug"
                    >
                      <span className="break-words">
                        {ingredient.item}
                        {ingredient.optional && (
                          <span className="font-sans text-xs text-muted-foreground">
                            {" "}
                            optional
                          </span>
                        )}
                      </span>
                      {measured && ingredient.quantity && (
                        <span className="text-right font-sans text-xs tabular-nums text-muted-foreground">
                          {ingredient.quantity}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <RecipeSteps steps={recipe.instructions} />
              <TechniqueTip tip={recipe.tips} />

              <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Retrieved from the cookbook</span>
                {recipe.source && (
                  <>
                    <span aria-hidden>·</span>
                    {recipe.sourceUrl ? (
                      <a
                        href={recipe.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
                      >
                        {recipe.source}
                        <ExternalLink className="size-3" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>{recipe.source}</span>
                    )}
                  </>
                )}
              </footer>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
    </article>
  );
}

// Sources arrive once, before the first token; without this every card re-renders
// on every token of the answer above it.
export const RecipeCard = memo(RecipeCardImpl);
