import { describe, expect, it } from "vitest";

import { buildContextBlock, SYSTEM_PROMPT } from "@/lib/prompt";
import type { MatchedRecipe } from "@/lib/recipes";

const MATCH: MatchedRecipe = {
  id: 1,
  slug: "spinach-feta-frittata",
  title: "Spinach Feta Frittata",
  // Not what toChunk would produce: proves the full tier uses stored content verbatim.
  content: "Recipe: Spinach Feta Frittata\nSteps: 1. Heat the oven to 180C.",
  metadata: {
    id: "1",
    title: "Spinach Feta Frittata",
    cuisine: "Mediterranean",
    country: "Greece",
    dietaryTags: ["vegetarian"],
    difficulty: "Easy",
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    servings: 4,
    ingredients: [
      { item: "eggs", quantity: "8 large" },
      { item: "feta cheese", quantity: "120 g" },
    ],
    instructions: ["Heat the oven to 180C.", "Wilt the spinach in a pan."],
  },
  similarity: 0.71,
};

describe("buildContextBlock", () => {
  it("defaults to the full tier, using the stored content verbatim", () => {
    const block = buildContextBlock([MATCH]);
    expect(block).toContain("Steps: 1. Heat the oven to 180C.");
    expect(buildContextBlock([MATCH], "full")).toBe(block);
  });

  it("renders the brief tier from metadata, with no step text", () => {
    const block = buildContextBlock([MATCH], "brief");
    expect(block).toContain("Steps: shown on the recipe card (2 steps) — not repeated here.");
    expect(block).not.toContain("Heat the oven");
    expect(block).not.toContain("Wilt the spinach");
  });

  it("keeps the delimiters and the relevance header in both tiers", () => {
    for (const tier of ["brief", "full"] as const) {
      const block = buildContextBlock([MATCH], tier);
      expect(block.startsWith("<RETRIEVED_RECIPES>")).toBe(true);
      expect(block.endsWith("</RETRIEVED_RECIPES>")).toBe(true);
      expect(block).toContain("--- RECIPE 1 (relevance 0.71) ---");
    }
  });

  it("says the block is empty in both tiers, so rule 2 still fires", () => {
    for (const tier of ["brief", "full"] as const) {
      expect(buildContextBlock([], tier)).toContain("(empty — no recipe cleared");
    }
  });
});

describe("SYSTEM_PROMPT", () => {
  it("tells the model what to do when the block points at the card", () => {
    expect(SYSTEM_PROMPT).toContain("shown on the recipe card");
  });

  it("still carries all four absolute rules", () => {
    expect(SYSTEM_PROMPT).toContain("ABSOLUTE RULES");
    for (const n of ["1.", "2.", "3.", "4."]) {
      expect(SYSTEM_PROMPT).toContain(n);
    }
  });
});
