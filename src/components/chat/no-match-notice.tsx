"use client";

// Staples that genuinely appear across the corpus, so a retry has a real chance.
const STAPLES = ["eggs", "pasta", "rice", "tomatoes", "garlic", "chicken", "beans"];

// The grounded refusal, dressed up. The behaviour behind it is untouched: nothing
// cleared the similarity threshold, so no recipe is invented to fill the gap.
export function NoMatchNotice({
  onSelect,
  disabled,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl rounded-tl-sm bg-muted p-4">
      <h3 className="font-serif text-base font-semibold">
        Nothing in the cookbook matches that
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        No recipe came close enough to those ingredients, and I won’t write
        one that isn’t in the book. Adding a staple usually finds something.
      </p>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {STAPLES.map((staple, index) => (
          <li
            key={staple}
            className="animate-in fade-in fill-mode-backwards duration-300"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(`I have ${staple}`)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs transition-colors duration-200 outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="sr-only">Search again with </span>
              {staple}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
