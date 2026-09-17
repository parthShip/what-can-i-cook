import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPERATURE,
  EXPLORATORY_TEMPERATURE,
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
