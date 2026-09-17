"use client";

// Checked against the corpus so each example lands on a different kind of recipe.
// `have` is what the slip shows; `prompt` is the message it actually sends, so a
// click and a typed question take exactly the same path.
const EXAMPLES = [
  { emoji: "🥚", have: "eggs, spinach and feta" },
  { emoji: "🍝", have: "pasta, garlic and chilli" },
  { emoji: "🥔", have: "potatoes, onions and cheese" },
  { emoji: "🍗", have: "chicken thighs, yoghurt and garam masala" },
  { emoji: "🥗", have: "chickpeas, tomatoes and onion — vegan please" },
].map((example) => ({ ...example, prompt: `I have ${example.have}` }));

export function ChatEmptyState({
  onSelect,
  disabled,
}: {
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    // The one orchestrated moment in the app: the invitation arrives in order,
    // once, on first paint. Nothing else animates unless you touch it.
    // Left edge aligned with the transcript's own padding, so the invitation
    // sits on the same grid line as every message that will replace it.
    <div className="w-full py-6 sm:py-10">
      <h2 className="animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards font-serif text-3xl leading-[1.08] font-semibold tracking-tight text-balance duration-700 [font-variation-settings:'SOFT'_28] sm:text-[2.6rem]">
        Tell me what’s in the fridge.
      </h2>

      <p
        className="animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-muted-foreground duration-700"
        style={{ animationDelay: "90ms" }}
      >
        I’ll only suggest recipes that are really in the cookbook, and
        I’ll show you which ingredients you’re still missing. If
        nothing fits, I’ll say so rather than invent something.
      </p>

      <ul className="mt-7 grid max-w-2xl gap-2 sm:grid-cols-2">
        {EXAMPLES.map((example, index) => (
          <li
            key={example.prompt}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-500 sm:[&:last-child:nth-child(odd)]:col-span-2"
            style={{ animationDelay: `${200 + index * 60}ms` }}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(example.prompt)}
              className="group/slip flex h-full w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors duration-200 outline-none hover:border-primary/40 hover:bg-accent focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span
                aria-hidden
                className="text-lg leading-none transition-transform duration-200 group-hover/slip:scale-110"
              >
                {example.emoji}
              </span>
              <span className="min-w-0 text-sm break-words">
                <span className="sr-only">Ask: I have </span>
                {example.have}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
