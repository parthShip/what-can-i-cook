// Model choice and sampling temperature, both derived on the server.

// Tried in order. The free tier counts its quota per model, so the second and third
// entries are not redundancy for an outage — they are the app still answering after
// the first model's daily allowance is spent. `npm run check` reports which of them
// your key can currently reach.
export const CHAT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

// Sampling temperature, from what the user asked. A keyword heuristic, not a model
// call: picking between three numbers is not worth a round trip.

// Ingredient lists and anything unmatched.
export const DEFAULT_TEMPERATURE = 0.4;

// Steps and amounts are quoted verbatim, so sampling variety is pure downside.
export const PRECISE_TEMPERATURE = 0.15;

// Substitutions and alternatives; rule 1 still pins the answer to the retrieved recipes.
export const EXPLORATORY_TEMPERATURE = 0.7;

const PRECISE_PATTERNS = [
  /\bhow (?:do|can|should) i\b/i,
  /\bhow (?:long|much|many)\b/i,
  /\b(?:step|steps|instructions?|method|directions?)\b/i,
  /\b(?:temperature|oven|degrees|celsius|fahrenheit)\b/i,
  /\b(?:quantit|amount|measurement|grams?|ml\b|cups?\b|tablespoons?|teaspoons?)/i,
  /\b(?:recipe for|full recipe|exact|precisely|verbatim)\b/i,
];

const EXPLORATORY_PATTERNS = [
  /\b(?:surprise|inspire|idea|ideas|suggestion|suggestions|anything else|something else)\b/i,
  /\b(?:what else|other options?|alternatives?|instead of|substitut|swap|replace)\b/i,
  /\b(?:different|variety|adventurous|unusual|creative)\b/i,
  /\b(?:recommend|feel like|in the mood)\b/i,
];

// Whether the question needs verbatim step text in context — the same list temperature uses.
export function needsFullSteps(query: string): boolean {
  return PRECISE_PATTERNS.some((p) => p.test(query));
}

// Whether the user is asking for recipes other than the ones on screen.
export function isExploratory(query: string): boolean {
  return EXPLORATORY_PATTERNS.some((p) => p.test(query));
}

// Precise wins ties: "what can I use instead of butter, and how much?" has a right answer.
export function temperatureFor(query: string): number {
  if (needsFullSteps(query)) return PRECISE_TEMPERATURE;
  if (isExploratory(query)) return EXPLORATORY_TEMPERATURE;
  return DEFAULT_TEMPERATURE;
}
