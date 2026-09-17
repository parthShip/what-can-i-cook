import { describe, expect, it } from "vitest";

import { toBriefChunk, toChunk, type Recipe } from "@/lib/recipes";

const FULL: Recipe = {
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
    { item: "baby spinach", quantity: "150 g" },
    { item: "feta cheese", quantity: "120 g" },
    { item: "fresh dill", quantity: "2 tbsp", optional: true },
  ],
  instructions: [
    "Heat the oven to 180C.",
    "Wilt the spinach in a pan.",
    "Beat the eggs and fold in the feta.",
  ],
  tips: "Let it rest five minutes before slicing.",
};

// No servings, no tips, no quantities: the fields the corpus often lacks.
const SPARSE: Recipe = {
  id: "2",
  title: "Rice and Peas",
  cuisine: "Caribbean",
  country: "Jamaica",
  dietaryTags: [],
  difficulty: "Easy",
  prepTimeMinutes: 0,
  cookTimeMinutes: 25,
  ingredients: [
    { item: "rice", quantity: "" },
    { item: "kidney beans", quantity: "" },
  ],
  instructions: ["Simmer everything together for 25 minutes."],
};

// Steps of realistic length: the corpus averages eight instructions of ~90 characters.
const REALISTIC: Recipe = {
  ...FULL,
  instructions: [
    "Preheat the oven to 180C fan and line a 23cm springform tin with baking parchment.",
    "Rinse the baby spinach thoroughly, then wilt it in a dry pan over a medium heat for two minutes.",
    "Tip the wilted spinach into a sieve and press firmly with the back of a spoon to drive off the water.",
    "Crack the eggs into a large bowl, season well, and beat until the yolks and whites are fully combined.",
    "Crumble the feta into the eggs, add the drained spinach, and fold together with a spatula.",
    "Pour the mixture into the prepared tin and level the top so it cooks evenly.",
    "Bake for twenty minutes, until the centre is just set and no longer wobbles when you nudge the tin.",
    "Let it stand for five minutes before releasing the tin, then slice into wedges and scatter over the dill.",
  ],
};

// Written out in full, not derived: a change here decouples the corpus from its vectors.
describe("toChunk", () => {
  it("renders the frozen ingest format", () => {
    expect(toChunk(FULL)).toBe(
      [
        "Recipe: Spinach Feta Frittata",
        "Main ingredients: eggs, baby spinach, feta cheese, fresh dill",
        "Cuisine: Mediterranean (Greece). Tags: vegetarian.",
        "Difficulty: Easy. Prep 10 min, cook 20 min, total 30 min, Serves 4.",
        "Ingredients with quantities: 8 large eggs; 150 g baby spinach; 120 g feta cheese; 2 tbsp fresh dill (optional).",
        "Steps: 1. Heat the oven to 180C. 2. Wilt the spinach in a pan. 3. Beat the eggs and fold in the feta.",
        "Tip: Let it rest five minutes before slicing.",
      ].join("\n"),
    );
  });

  it("omits unknown fields rather than defaulting them", () => {
    const chunk = toChunk(SPARSE);
    expect(chunk).toContain("Quantities: not recorded for this recipe");
    expect(chunk).not.toContain("Serves");
    expect(chunk).not.toContain("Tip:");
    expect(chunk).not.toContain("Prep 0 min");
  });
});

describe("toBriefChunk", () => {
  it("keeps everything the model is allowed to use", () => {
    const brief = toBriefChunk(FULL);
    expect(brief).toContain("Recipe: Spinach Feta Frittata");
    expect(brief).toContain("Main ingredients: eggs, baby spinach, feta cheese, fresh dill");
    expect(brief).toContain("Cuisine: Mediterranean (Greece). Tags: vegetarian.");
    expect(brief).toContain("Difficulty: Easy. Prep 10 min, cook 20 min, total 30 min, Serves 4.");
    expect(brief).toContain("8 large eggs; 150 g baby spinach");
    expect(brief).toContain("Tip: Let it rest five minutes before slicing.");
  });

  it("replaces the method with a pointer to the card", () => {
    const brief = toBriefChunk(FULL);
    expect(brief).toContain("Steps: shown on the recipe card (3 steps) — not repeated here.");
    // The whole point: no step text reaches the model on a brief turn.
    expect(brief).not.toContain("Heat the oven");
    expect(brief).not.toContain("Wilt the spinach");
    expect(brief).not.toContain("Beat the eggs");
  });

  it("says so plainly when a recipe records no steps at all", () => {
    const brief = toBriefChunk({ ...SPARSE, instructions: [] });
    expect(brief).toContain("Steps: none recorded for this recipe.");
  });

  // Measured on realistic step text: the short fixture understates the saving.
  it("is substantially shorter than the full chunk", () => {
    expect(toBriefChunk(REALISTIC).length).toBeLessThan(toChunk(REALISTIC).length * 0.6);
    // Still smaller even on the unrepresentative short fixture.
    expect(toBriefChunk(FULL).length).toBeLessThan(toChunk(FULL).length);
  });

  it("omits unknown fields rather than defaulting them", () => {
    const brief = toBriefChunk(SPARSE);
    expect(brief).toContain("Quantities: not recorded for this recipe");
    expect(brief).not.toContain("Serves");
    expect(brief).not.toContain("Tip:");
  });

  // The brief tier ships no steps, so it must not point the model at them.
  it("does not point at steps below when there are none", () => {
    const brief = toBriefChunk(SPARSE);
    expect(brief).not.toContain("the steps below");
    expect(brief).toContain("which are on the recipe card");
    // The full tier does still have its steps further down the chunk.
    expect(toChunk(SPARSE)).toContain("the steps below are the only stated amounts");
  });
});
