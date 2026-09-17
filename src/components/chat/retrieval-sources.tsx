"use client";

import { memo, useId, useState } from "react";

import type { SourceRecipe } from "@/lib/chat-types";
import {
  decodeEntities,
  DIFFICULTY_EMOJI,
  formatMinutes,
  totalMinutes,
} from "@/lib/recipe-display";
import { cn } from "@/lib/utils";

// What the answer was built from. Each badge opens a short summary of that recipe,
// which is the useful half of the metadata — the embedding and row ids are not.
function RetrievalSourcesImpl({ sources }: { sources: SourceRecipe[] }) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const panelId = useId();

  if (sources.length === 0) return null;

  const open = sources.find((s) => s.slug === openSlug) ?? null;

  return (
    <section className="space-y-2">
      <h4 className="text-xs text-muted-foreground">
        Built from {sources.length} {sources.length === 1 ? "recipe" : "recipes"}{" "}
        in the cookbook
      </h4>

      <ul className="flex flex-wrap gap-1.5">
        {sources.map((source) => {
          const isOpen = source.slug === openSlug;
          return (
            <li key={source.slug} className="max-w-full">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenSlug(isOpen ? null : source.slug)}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-serif text-xs ring-1 transition-colors duration-200",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isOpen
                    ? "bg-accent text-accent-foreground ring-primary/35"
                    : "bg-card ring-border hover:bg-muted",
                )}
              >
                {/* The score belongs in the detail panel, not on the chip — it is
                    diagnostic, and reads as noise next to a recipe name. */}
                <span className="truncate">{decodeEntities(source.title)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div id={panelId} hidden={!open}>
        {open && (
          <dl
            // Keyed on the recipe so switching chips replays the fade, which is
            // the only cue that the panel below changed rather than stayed put.
            key={open.slug}
            className="animate-in fade-in slide-in-from-top-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/70 p-3 text-xs duration-200"
          >
            <dt className="text-muted-foreground">Recipe</dt>
            <dd className="font-serif font-semibold break-words">
              {decodeEntities(open.title)}
            </dd>

            <dt className="text-muted-foreground">Similarity</dt>
            <dd className="tabular-nums">{open.similarity.toFixed(2)}</dd>

            <dt className="text-muted-foreground">Cuisine</dt>
            <dd className="break-words">
              {open.recipe.cuisine}
              {open.recipe.country && open.recipe.country !== open.recipe.cuisine
                ? ` · ${open.recipe.country}`
                : ""}
            </dd>

            <dt className="text-muted-foreground">Effort</dt>
            <dd>
              <span aria-hidden>{DIFFICULTY_EMOJI[open.recipe.difficulty]} </span>
              {open.recipe.difficulty}
              {totalMinutes(open.recipe) !== null &&
                ` · ${formatMinutes(totalMinutes(open.recipe)!)}`}
            </dd>

            <dt className="text-muted-foreground">Ingredients</dt>
            <dd>
              {open.recipe.ingredients.length} listed · {open.pantry.have.length}{" "}
              you have
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}

export const RetrievalSources = memo(RetrievalSourcesImpl);
