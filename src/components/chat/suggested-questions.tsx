"use client";

import type { FollowUp } from "@/lib/recipe-display";

// Chips that send an ordinary chat message. There is no second code path: clicking
// one is the same as typing it, so the next turn retrieves again like any other.
export function SuggestedQuestions({
  followUps,
  onSelect,
  disabled,
  label = "Ask next",
}: {
  followUps: FollowUp[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (followUps.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-xs text-muted-foreground">{label}</h4>
      <ul className="flex flex-wrap gap-1.5">
        {followUps.map((followUp, index) => (
          <li
            key={followUp.id}
            className="animate-in fade-in fill-mode-backwards max-w-full duration-300"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(followUp.prompt)}
              className="max-w-full rounded-full border border-border bg-card px-3 py-1 text-left text-xs break-words transition-colors duration-200 outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              {followUp.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
