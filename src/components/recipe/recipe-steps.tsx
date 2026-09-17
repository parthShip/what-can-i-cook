// The instructions as ingested: in order, unedited, never summarised. Numbered
// because a method genuinely is a sequence — step 3 after step 2 or the sauce
// splits — not because numbers make a list look considered.
export function RecipeSteps({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;

  return (
    <section>
      <h4 className="mb-2 font-serif text-sm font-semibold">Method</h4>
      <ol className="space-y-2.5">
        {steps.map((step, index) => (
          // Scraped rows repeat the odd line, so the index is the only safe key.
          <li key={`${index}-${step}`} className="flex gap-3 font-serif text-[0.9rem] leading-relaxed">
            <span
              className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent font-serif text-xs font-semibold text-accent-foreground tabular-nums"
              aria-hidden
            >
              {index + 1}
            </span>
            <span className="min-w-0 break-words">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
