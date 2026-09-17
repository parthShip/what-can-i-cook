import type { ReactNode } from "react";
import { Clock, Globe2, Users } from "lucide-react";

import type { SourceRecipeData } from "@/lib/chat-types";
import {
  DIFFICULTY_CLASS,
  DIFFICULTY_EMOJI,
  formatMinutes,
  totalMinutes,
} from "@/lib/recipe-display";
import { cn } from "@/lib/utils";

function Pill({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Times, servings and difficulty exactly as they were ingested. A field the source
// never recorded is left out rather than filled in with a typical value.
export function RecipeMetadata({ recipe }: { recipe: SourceRecipeData }) {
  const total = totalMinutes(recipe);
  const timing = [
    recipe.prepTimeMinutes > 0 ? `${recipe.prepTimeMinutes} min prep` : null,
    recipe.cookTimeMinutes > 0 ? `${recipe.cookTimeMinutes} min cook` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {total !== null && (
        <li>
          <Pill title={timing || undefined}>
            <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {/* The breakdown is a tooltip for the eye and sr-only text for the ear. */}
            <span className="sr-only">
              Total time{timing ? ` (${timing})` : ""}:{" "}
            </span>
            <span className="tabular-nums">{formatMinutes(total)}</span>
          </Pill>
        </li>
      )}

      {recipe.servings ? (
        <li>
          <Pill>
            <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Serves</span>
            <span className="tabular-nums">{recipe.servings} servings</span>
          </Pill>
        </li>
      ) : null}

      <li>
        <Pill className={DIFFICULTY_CLASS[recipe.difficulty]}>
          <span aria-hidden>{DIFFICULTY_EMOJI[recipe.difficulty]}</span>
          <span className="sr-only">Difficulty</span>
          {recipe.difficulty}
        </Pill>
      </li>

      {recipe.cuisine ? (
        <li className="min-w-0">
          <Pill className="max-w-full">
            <Globe2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Cuisine</span>
            <span className="truncate">{recipe.cuisine}</span>
          </Pill>
        </li>
      ) : null}

      {recipe.dietaryTags.slice(0, 3).map((tag) => (
        <li key={tag}>
          <Pill className="bg-transparent font-normal text-muted-foreground ring-1 ring-border">
            {tag}
          </Pill>
        </li>
      ))}
    </ul>
  );
}
