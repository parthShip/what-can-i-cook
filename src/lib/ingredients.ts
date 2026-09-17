// "You have" vs "you still need", worked out from data rather than from the model.
//
// Both sides of the comparison are structured: the recipe's own ingredient rows as
// they were ingested, and the words the user actually typed. The model is never
// asked to do this — it cannot credit the user with an ingredient they never named.

import type { Ingredient } from "@/lib/recipes";

export type PantryIngredient = Ingredient & {
  // The user's wording, when it differs from the recipe's ("penne" ← "pasta").
  matchedWith?: string;
};

export type PantryComparison = {
  have: PantryIngredient[];
  missing: PantryIngredient[];
  // Optional extras do not stop anyone cooking, so they are counted apart.
  missingRequiredCount: number;
  hasEverything: boolean;
};

// Normalised term -> the user's original wording, so the UI can say "you said pasta".
export type Pantry = Map<string, string>;

// Words that are never an ingredient: questions, verbs, containers, units, filler.
const FILLER = new Set([
  "about", "actually", "all", "already", "also", "and", "any", "anything", "are",
  "ask", "back", "best", "breakfast", "but", "can", "could", "cook", "cooked",
  "cooking", "could", "cup", "cups", "did", "dinner", "dish", "does", "each",
  "easiest", "easy", "eat", "else", "fast", "fastest", "few", "find", "first",
  "for", "freezer", "fresh", "fridge", "from", "get", "give", "gluten", "got",
  "gram", "grams", "had", "has", "have", "healthy", "help", "here", "home", "how",
  "ingredient", "ingredients", "instead", "into", "just", "kilo", "kitchen",
  "kind", "last", "left", "leftover", "leftovers", "let", "like", "litre",
  "liter", "long", "look", "lunch", "make", "many", "meal", "might", "mine",
  "more", "most", "much", "must", "need", "not", "nothing", "now", "off", "one",
  "only", "option", "options", "other", "our", "out", "own", "pantry", "please",
  "quick", "really", "recipe", "recipes", "second", "see", "serve", "serves",
  "serving", "servings", "should", "show", "side", "simple", "some", "something",
  "step", "steps", "still", "substitute", "such", "supper", "take", "takes",
  "tasty", "tell", "than", "thanks", "that", "the", "their", "them", "then",
  "there", "these", "they", "thing", "third", "this", "those", "three", "time",
  "tbsp", "tsp", "today", "tonight", "two", "use", "using", "vegan",
  "vegetarian", "very", "want", "was", "way", "week", "were", "what", "when",
  "where", "which", "why", "will", "with", "without", "would", "you", "your",
]);

// Spelling and regional variants, plus pasta shapes, which a pantry treats as one
// thing. Category guesses do not belong here: "chicken" must never become "meat".
const SYNONYMS: Record<string, string> = {
  chile: "chilli",
  chili: "chilli",
  cilantro: "coriander",
  courgette: "zucchini",
  eggplant: "aubergine",
  garbanzo: "chickpea",
  shrimp: "prawn",
  yogurt: "yoghurt",
  farfalle: "pasta",
  fettuccine: "pasta",
  fusilli: "pasta",
  linguine: "pasta",
  macaroni: "pasta",
  penne: "pasta",
  rigatoni: "pasta",
  spaghetti: "pasta",
  tagliatelle: "pasta",
};

// Adjectives on a recipe row that do not change what the thing is.
const DESCRIPTORS = new Set([
  "baby", "boneless", "chopped", "cold", "cooked", "crushed", "cubed", "diced",
  "dried", "extra", "finely", "free", "freshly", "frozen", "grated", "ground",
  "large", "lean", "light", "low", "medium", "minced", "organic", "peeled",
  "plain", "range", "raw", "ripe", "roughly", "shredded", "skinless", "sliced",
  "small", "thinly", "toasted", "unsalted", "virgin", "warm", "whole",
]);

// Head nouns that describe a form, not an identity: "feta cheese" is still feta,
// while "chicken stock" is emphatically not chicken.
const FORM_WORDS = new Set([
  "breast", "bunch", "cheese", "chunk", "clove", "fillet", "flake", "floret", "half",
  "head", "leaf", "mince", "piece", "rib", "slice", "sprig", "stalk", "strip",
  "thigh", "wedge",
]);

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ves")) return `${word.slice(0, -3)}f`;
  if (/(ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function normalise(word: string): string {
  const base = singular(word.toLowerCase());
  return SYNONYMS[base] ?? base;
}

// The words of a phrase that carry meaning, normalised. "extra virgin olive oil"
// becomes ["olive", "oil"]; the last one is the head noun.
function significantWords(phrase: string, dropDescriptors: boolean): string[] {
  const words = phrase.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  const kept = words
    .filter((w) => w.length >= 3 && !FILLER.has(w))
    .filter((w) => !dropDescriptors || !DESCRIPTORS.has(w))
    .map(normalise);
  // Everything was a descriptor ("fresh chopped"): fall back rather than drop the row.
  if (kept.length === 0 && dropDescriptors) return significantWords(phrase, false);
  return kept;
}

// Everything the user has claimed across the conversation. A pantry accumulates:
// ingredients named three turns ago still count for the recipe shown now.
export function buildPantry(userTexts: string[]): Pantry {
  const pantry: Pantry = new Map();

  for (const text of userTexts) {
    // Connectors separate one ingredient from the next.
    const phrases = text.split(/[,;:/\n]|\band\b|\bor\b|\bplus\b|\bwith\b|\bbut\b/i);

    for (const phrase of phrases) {
      const words = significantWords(phrase, false);
      if (words.length === 0) continue;

      const original = phrase.trim().replace(/\s+/g, " ");
      for (const word of words) {
        if (!pantry.has(word)) pantry.set(word, word);
      }
      // The whole phrase too, so "olive oil" matches as a unit.
      if (words.length > 1 && !pantry.has(words.join(" "))) {
        pantry.set(words.join(" "), original.toLowerCase());
      }
    }
  }

  return pantry;
}

// The user's word for a recipe ingredient, or undefined when they never named it.
function findMatch(item: string, pantry: Pantry): string | undefined {
  const words = significantWords(item, true);
  if (words.length === 0) return undefined;

  const phrase = words.join(" ");
  if (pantry.has(phrase)) return pantry.get(phrase);

  const head = words[words.length - 1];
  if (pantry.has(head)) return pantry.get(head);

  // "feta cheese" ← "feta", but never "chicken stock" ← "chicken".
  if (FORM_WORDS.has(head)) {
    for (const word of words.slice(0, -1)) {
      if (pantry.has(word)) return pantry.get(word);
    }
  }

  return undefined;
}

// Split one recipe's ingredients into what the user has and what they still need.
export function comparePantry(
  ingredients: Ingredient[],
  pantry: Pantry,
): PantryComparison {
  const have: PantryIngredient[] = [];
  const missing: PantryIngredient[] = [];

  for (const ingredient of ingredients) {
    const matched = findMatch(ingredient.item, pantry);
    if (matched === undefined) {
      missing.push(ingredient);
      continue;
    }
    // Only worth showing when the two names read differently.
    const sameWording = ingredient.item.toLowerCase().includes(matched);
    have.push(sameWording ? ingredient : { ...ingredient, matchedWith: matched });
  }

  const missingRequiredCount = missing.filter((i) => !i.optional).length;

  return {
    have,
    missing,
    missingRequiredCount,
    hasEverything: have.length > 0 && missingRequiredCount === 0,
  };
}
