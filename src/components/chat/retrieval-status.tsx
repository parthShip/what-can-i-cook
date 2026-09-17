"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Phase = "searching" | "found";

// What the wait actually feels like from the kitchen side. Two pools, because
// the two waits are different jobs: one is looking something up, the other is
// making it. Neither claims anything the app isn't doing.
const LOOKING = [
  "Rummaging through the pantry",
  "Checking what’s on the shelves",
  "Flipping through the cookbook",
  "Reading the index",
  "Sizing up your ingredients",
];

const COOKING = [
  "Cooking",
  "Simmering",
  "Chopping",
  "Seasoning",
  "Folding it together",
  "Tasting",
  "Plating up",
  "Warming the pan",
  "Reducing the sauce",
];

const ROTATE_MS = 2000;

/** Cycles a pool of labels while the step is running. */
function useRotating(pool: string[]) {
  // Started at a random word so two questions in a row don't read identically.
  // Safe here: this mounts long after hydration, on the user's own send.
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * pool.length),
  );

  useEffect(() => {
    const id = setInterval(
      () => setIndex((i) => (i + 1) % pool.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [pool.length]);

  return pool[index % pool.length];
}

/** Whole seconds since the turn started — the wait is unbounded, so show it. */
function useElapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// The three things a RAG turn actually does, with the real signal behind each:
// the question is in, the retrieval either has returned its matches or has not,
// and the answer starts as soon as the first token arrives (which unmounts this).
export function RetrievalStatus({
  phase,
  recipeCount,
}: {
  phase: Phase;
  recipeCount: number;
}) {
  const searching = phase === "searching";
  const verb = useRotating(searching ? LOOKING : COOKING);
  const elapsed = useElapsed();

  const steps = [
    { id: "question", label: "Read your ingredients", state: "done" as const },
    {
      id: "retrieve",
      label: searching
        ? null
        : recipeCount === 1
          ? "Found 1 recipe in the cookbook"
          : `Found ${recipeCount} recipes in the cookbook`,
      state: searching ? ("active" as const) : ("done" as const),
    },
    {
      id: "generate",
      label: searching ? "Then I’ll write it up" : null,
      state: searching ? ("pending" as const) : ("active" as const),
    },
  ];

  return (
    <div className="turn-in w-fit max-w-full rounded-2xl rounded-tl-sm bg-muted px-4 py-3 sm:ml-11">
      {/* The live region is deliberately not the panel: the verb rotates every
          two seconds and the clock ticks every one, and announcing either would
          make the wait unusable with a screen reader. Only the phase is spoken. */}
      <p className="sr-only" aria-live="polite">
        {searching
          ? "Searching your recipe collection"
          : `Found ${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}. Writing your answer.`}
      </p>

      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex items-center gap-2 text-sm",
              step.state === "pending" && "text-muted-foreground/60",
            )}
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {step.state === "done" && (
                <Check className="step-settle size-3.5 text-have" aria-hidden />
              )}
              {step.state === "active" && (
                <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
              )}
              {step.state === "pending" && (
                <span
                  className="size-1.5 rounded-full bg-current opacity-50"
                  aria-hidden
                />
              )}
            </span>

            {step.state === "active" ? (
              <span className="flex min-w-0 items-baseline gap-2">
                {/* Keyed on the word: React remounts the span, which replays the
                    fade, so the label reads as changing rather than glitching. */}
                <span
                  key={verb}
                  className="pantry-shimmer animate-in fade-in font-medium duration-500"
                >
                  {verb}…
                </span>
                <span
                  aria-hidden
                  className="shrink-0 text-xs tabular-nums text-muted-foreground/70"
                >
                  {elapsed}
                </span>
              </span>
            ) : (
              <span className="min-w-0 break-words">{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
