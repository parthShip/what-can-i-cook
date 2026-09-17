import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPERATURE,
  EXPLORATORY_TEMPERATURE,
  isExploratory,
  needsFullSteps,
  PRECISE_TEMPERATURE,
  temperatureFor,
} from "@/lib/chat-config";

describe("temperatureFor", () => {
  it("samples tight for method and amount questions", () => {
    expect(temperatureFor("how do i fold the batter")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("how long does it bake")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("what are the steps")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("what oven temperature")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("how many grams of flour")).toBe(PRECISE_TEMPERATURE);
    expect(temperatureFor("give me the recipe for it")).toBe(PRECISE_TEMPERATURE);
  });

  it("samples loose when the user wants ideas", () => {
    expect(temperatureFor("surprise me")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("what else could i make")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("something different please")).toBe(EXPLORATORY_TEMPERATURE);
    expect(temperatureFor("what do you recommend")).toBe(EXPLORATORY_TEMPERATURE);
  });

  it("falls back to the default for a plain ingredient list", () => {
    expect(temperatureFor("chicken, rice and peas")).toBe(DEFAULT_TEMPERATURE);
    expect(temperatureFor("")).toBe(DEFAULT_TEMPERATURE);
  });

  // Documented in chat-config.ts: a question that is both has a right answer.
  it("lets precise win a tie against exploratory", () => {
    expect(temperatureFor("what can i use instead of butter, and how much?")).toBe(
      PRECISE_TEMPERATURE,
    );
  });
});

describe("needsFullSteps", () => {
  it("is true for the questions that need the method verbatim", () => {
    expect(needsFullSteps("how do i fold the batter")).toBe(true);
    expect(needsFullSteps("what are the steps")).toBe(true);
    expect(needsFullSteps("how long does it bake")).toBe(true);
    expect(needsFullSteps("what oven temperature")).toBe(true);
    expect(needsFullSteps("how many grams of flour")).toBe(true);
    expect(needsFullSteps("give me the full recipe")).toBe(true);
  });

  it("is false for an ingredient list, which needs no method at all", () => {
    expect(needsFullSteps("chicken, rice and peas")).toBe(false);
    expect(needsFullSteps("i have eggs, spinach and feta")).toBe(false);
    expect(needsFullSteps("surprise me")).toBe(false);
    expect(needsFullSteps("")).toBe(false);
  });

  // The two must never disagree: that is the whole point of extracting the predicate.
  it("agrees with temperatureFor on every precise query", () => {
    for (const query of ["what are the steps", "how long does it bake", "exact amounts"]) {
      expect(needsFullSteps(query)).toBe(true);
      expect(temperatureFor(query)).toBe(PRECISE_TEMPERATURE);
    }
  });
});

describe("isExploratory", () => {
  it("is true when the user is asking for something other than what they were shown", () => {
    expect(isExploratory("what else could i make")).toBe(true);
    expect(isExploratory("any other options")).toBe(true);
    expect(isExploratory("surprise me")).toBe(true);
    expect(isExploratory("something different")).toBe(true);
    expect(isExploratory("what can i use instead of butter")).toBe(true);
  });

  it("is false for a follow-up about the recipe already on screen", () => {
    expect(isExploratory("how long do i bake it")).toBe(false);
    expect(isExploratory("can i make that tonight")).toBe(false);
    expect(isExploratory("")).toBe(false);
  });
});
