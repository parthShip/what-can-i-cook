import { describe, expect, it } from "vitest";

import { buildPantry, comparePantry } from "@/lib/ingredients";

const terms = (texts: string[]) => [...buildPantry(texts).keys()];

describe("buildPantry", () => {
  it("reads ingredients out of ordinary sentences", () => {
    expect(terms(["i have eggs and spinach"])).toEqual(["egg", "spinach"]);
  });

  // "bake" was stored as an owned ingredient, so method questions read as new ones.
  it("does not treat a cooking verb as an ingredient", () => {
    expect(terms(["i have eggs and spinach", "how long do i bake it"])).toEqual([
      "egg",
      "spinach",
    ]);
    for (const verb of ["fry", "grill", "boil", "simmer", "steam", "stir", "whisk"]) {
      expect(terms([`should i ${verb} it`])).toEqual([]);
    }
  });

  // These verb forms are also real ingredient names ("baked beans", "cooked rice").
  it("keeps verb forms that name real ingredients", () => {
    expect(terms(["i have baked beans"])).toContain("baked bean");
    expect(terms(["i have chopped tomatoes"])).toContain("chopped tomato");
    expect(terms(["i have cooked rice"])).toContain("cooked rice");
    expect(terms(["i have roast beef"])).toContain("roast beef");
  });

  // The standing constraint in ingredients.ts: a category guess is never allowed.
  it("still never generalises an ingredient", () => {
    expect(terms(["i have chicken"])).toEqual(["chicken"]);
    expect(terms(["i have chicken"])).not.toContain("meat");
  });
});

describe("comparePantry", () => {
  // Filtering verbs must not stop a real ingredient from being credited.
  it("still credits exactly the ingredients the user named", () => {
    const fixture = [
      { item: "eggs", quantity: "8 large" },
      { item: "baby spinach", quantity: "150 g" },
      { item: "feta cheese", quantity: "120 g" },
      { item: "chicken stock", quantity: "200 ml" },
    ];
    const result = comparePantry(fixture, buildPantry(["I have eggs, spinach and feta"]));
    expect(result.have.map((i) => i.item)).toEqual(["eggs", "baby spinach", "feta cheese"]);
    expect(result.missingRequiredCount).toBe(1);
  });
});
