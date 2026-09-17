import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/chat-types";
import { buildPantry } from "@/lib/ingredients";
import {
  decideReuse,
  hasNewPantryTerms,
  MAX_REUSED_SLUGS,
  priorSourcesFrom,
  type PriorSource,
} from "@/lib/reuse";

// Only the fields the code reads. The cast mirrors reality: this data arrives as
// untrusted JSON, not as a well-formed ChatMessage.
function assistant(sources: unknown): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Try the frittata." }],
    metadata: { sources },
  } as unknown as ChatMessage;
}

function user(text: string): ChatMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

const GOOD = [
  { slug: "spinach-feta-frittata", similarity: 0.71, title: "x", recipe: {}, pantry: {} },
  { slug: "rice-and-peas", similarity: 0.52, title: "y", recipe: {}, pantry: {} },
];

describe("priorSourcesFrom", () => {
  it("reads slug and similarity off the last assistant turn", () => {
    expect(priorSourcesFrom([user("eggs"), assistant(GOOD), user("how long?")])).toEqual([
      { slug: "spinach-feta-frittata", similarity: 0.71 },
      { slug: "rice-and-peas", similarity: 0.52 },
    ]);
  });

  it("returns nothing when there is no assistant turn yet", () => {
    expect(priorSourcesFrom([user("eggs and spinach")])).toEqual([]);
    expect(priorSourcesFrom([])).toEqual([]);
  });

  it("does not reach past an assistant turn that retrieved nothing", () => {
    const messages = [user("a"), assistant(GOOD), user("b"), assistant([]), user("c")];
    expect(priorSourcesFrom(messages)).toEqual([]);
  });

  it("rejects slugs that are not slugs", () => {
    const junk = [
      { slug: "../../etc/passwd", similarity: 1 },
      { slug: "Spinach Feta", similarity: 1 },
      { slug: "a'; drop table recipes; --", similarity: 1 },
      { slug: "", similarity: 1 },
      { slug: "x".repeat(129), similarity: 1 },
      { slug: 42, similarity: 1 },
      { slug: null, similarity: 1 },
      "not-an-object",
      null,
    ];
    expect(priorSourcesFrom([assistant(junk)])).toEqual([]);
  });

  it("keeps a valid slug sitting next to junk", () => {
    const mixed = [{ slug: "BAD SLUG", similarity: 1 }, { slug: "rice-and-peas", similarity: 0.5 }];
    expect(priorSourcesFrom([assistant(mixed)])).toEqual([
      { slug: "rice-and-peas", similarity: 0.5 },
    ]);
  });

  it("caps the list, so a crafted body cannot widen the context", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ slug: `recipe-${i}`, similarity: 0.5 }));
    expect(priorSourcesFrom([assistant(many)])).toHaveLength(MAX_REUSED_SLUGS);
  });

  it("drops duplicates, so the same recipe cannot fill the block", () => {
    const dupes = Array.from({ length: 10 }, () => ({ slug: "rice-and-peas", similarity: 0.5 }));
    expect(priorSourcesFrom([assistant(dupes)])).toEqual([
      { slug: "rice-and-peas", similarity: 0.5 },
    ]);
  });

  it("clamps a similarity the client could have tampered with", () => {
    const odd = [
      { slug: "a-recipe", similarity: 99 },
      { slug: "b-recipe", similarity: -3 },
      { slug: "c-recipe", similarity: "high" },
      { slug: "d-recipe", similarity: Number.NaN },
    ];
    expect(priorSourcesFrom([assistant(odd)])).toEqual([
      { slug: "a-recipe", similarity: 1 },
      { slug: "b-recipe", similarity: 0 },
      { slug: "c-recipe", similarity: 0 },
      { slug: "d-recipe", similarity: 0 },
    ]);
  });

  it("survives metadata that is not an object at all", () => {
    expect(priorSourcesFrom([assistant("nope")])).toEqual([]);
    expect(priorSourcesFrom([assistant(undefined)])).toEqual([]);
    expect(priorSourcesFrom([{ id: "a", role: "assistant", parts: [] } as ChatMessage])).toEqual([]);
  });
});

describe("hasNewPantryTerms", () => {
  it("is false when the new turn named no ingredient", () => {
    const before = buildPantry(["i have eggs and spinach"]);
    const after = buildPantry(["i have eggs and spinach", "how long do i bake it"]);
    expect(hasNewPantryTerms(before, after)).toBe(false);
  });

  it("is true when the new turn added one", () => {
    const before = buildPantry(["i have eggs and spinach"]);
    const after = buildPantry(["i have eggs and spinach", "i also have feta"]);
    expect(hasNewPantryTerms(before, after)).toBe(true);
  });
});

describe("decideReuse", () => {
  const priorSources: PriorSource[] = [{ slug: "spinach-feta-frittata", similarity: 0.71 }];
  const pantry = buildPantry(["i have eggs and spinach"]);

  it("reuses a follow-up about the recipe on screen", () => {
    expect(
      decideReuse({
        priorSources,
        query: "how long do i bake it",
        pantryBefore: pantry,
        pantryAfter: pantry,
      }),
    ).toEqual({ reuse: true, sources: priorSources, reason: "reuse" });
  });

  it("retrieves afresh on the first turn", () => {
    const decision = decideReuse({
      priorSources: [],
      query: "eggs and spinach",
      pantryBefore: buildPantry([]),
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("no-prior-sources");
  });

  it("retrieves afresh when the user names a new ingredient", () => {
    const decision = decideReuse({
      priorSources,
      query: "i also have chorizo",
      pantryBefore: pantry,
      pantryAfter: buildPantry(["i have eggs and spinach", "i also have chorizo"]),
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("new-ingredients");
  });

  it("retrieves afresh when the user wants something else", () => {
    const decision = decideReuse({
      priorSources,
      query: "what else could i make",
      pantryBefore: pantry,
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("exploratory");
  });

  // A question that is both precise and exploratory: the user wants alternatives,
  // so exploratory has to win here even though the pantry is unchanged.
  it("prefers fresh retrieval for a substitution question", () => {
    const decision = decideReuse({
      priorSources,
      query: "what can i use instead of feta, and how much?",
      pantryBefore: pantry,
      pantryAfter: pantry,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toBe("exploratory");
  });

  it("never reuses an empty source list even if nothing else objects", () => {
    expect(
      decideReuse({
        priorSources: [],
        query: "how long do i bake it",
        pantryBefore: pantry,
        pantryAfter: pantry,
      }).reuse,
    ).toBe(false);
  });
});
