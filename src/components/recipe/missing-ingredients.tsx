import type { PantryComparison } from "@/lib/ingredients";

// What the recipe calls for and the user never mentioned. Optional extras are
// labelled rather than hidden, so "everything needed" stays an honest claim.
export function MissingIngredients({ pantry }: { pantry: PantryComparison }) {
  if (pantry.hasEverything) {
    return (
      <section className="rounded-lg bg-have-surface p-3 ring-1 ring-have/25">
        <p className="font-serif text-sm font-semibold text-have">
          <span aria-hidden>🎉</span> You have everything you need
        </p>
        {pantry.missing.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Optional extras: {pantry.missing.map((i) => i.item).join(", ")}
          </p>
        )}
      </section>
    );
  }

  if (pantry.missing.length === 0) return null;

  return (
    <section className="rounded-lg bg-need-surface p-3 ring-1 ring-need/20">
      <h4 className="mb-2 font-serif text-sm font-semibold text-need">
        You still need{" "}
        <span className="font-sans text-xs font-normal opacity-70">
          ({pantry.missingRequiredCount})
        </span>
      </h4>
      <ul className="space-y-1">
        {pantry.missing.map((ingredient, index) => (
          <li
            key={`${index}-${ingredient.item}`}
            className="flex items-start gap-1.5 text-sm break-words"
          >
            <span
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-need/70"
              aria-hidden
            />
            <span className="min-w-0">
              {ingredient.item}
              {ingredient.quantity && (
                <span className="text-muted-foreground">
                  {" "}
                  · {ingredient.quantity}
                </span>
              )}
              {ingredient.optional && (
                <span className="text-muted-foreground"> (optional)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
