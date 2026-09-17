// Presentation helpers shared by the chat and recipe components.
// Everything here reads the structured source metadata; none of it parses an answer
// for facts. The one thing it does read out of the answer is which recipe titles the
// model named, so the right cards are shown — the card contents still come from data.

import type { SourceRecipe, SourceRecipeData } from "@/lib/chat-types";
import { NO_MATCH_REPLY } from "@/lib/prompt";

// Some titles were ingested with HTML entities still in them.
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export const DIFFICULTY_EMOJI: Record<SourceRecipeData["difficulty"], string> = {
  Easy: "🟢",
  Medium: "🟡",
  Hard: "🔴",
};

// Colour is a second signal only; the word "Easy" is always shown next to it.
// These are the app's own meanings rather than palette shades, so they follow the
// theme without a `dark:` twin on every use.
export const DIFFICULTY_CLASS: Record<SourceRecipeData["difficulty"], string> = {
  Easy: "text-have",
  Medium: "text-need",
  Hard: "text-hard",
};

// A glanceable marker for the card header. Keyword driven, so it either recognises
// the dish or falls back to a neutral plate — it never guesses at content.
const EMOJI_KEYWORDS: [RegExp, string][] = [
  [/pasta|spaghetti|penne|linguine|noodle|lasagne|lasagna|macaroni/, "🍝"],
  [/omelette|frittata|scrambl|\begg/, "🍳"],
  [/pizza/, "🍕"],
  [/taco|burrito|quesadilla|enchilada/, "🌮"],
  [/burger/, "🍔"],
  [/sandwich|toast|bruschetta|panini/, "🥪"],
  [/salad|slaw/, "🥗"],
  [/soup|broth|chowder|stew|ramen|pho/, "🍲"],
  [/curry|masala|korma|tikka|dal|daal/, "🍛"],
  [/rice|risotto|biryani|pilaf|paella/, "🍚"],
  [/chicken|poultry|turkey/, "🍗"],
  [/beef|steak|lamb|pork|bacon|sausage/, "🥩"],
  [/fish|salmon|tuna|prawn|shrimp|seafood|cod/, "🐟"],
  [/cake|brownie|cookie|dessert|pudding|chocolate|pie|tart/, "🍰"],
  [/potato|fries|wedges/, "🥔"],
  [/bread|focaccia|bun|roll|scone|muffin/, "🍞"],
  [/smoothie|juice|latte|shake/, "🥤"],
];

export function recipeEmoji(title: string, recipe: SourceRecipeData): string {
  const haystack = `${title} ${recipe.ingredients
    .slice(0, 4)
    .map((i) => i.item)
    .join(" ")}`.toLowerCase();

  for (const [pattern, emoji] of EMOJI_KEYWORDS) {
    if (pattern.test(haystack)) return emoji;
  }
  return recipe.dietaryTags.includes("vegan") ? "🥬" : "🍽️";
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// Total time, or null when the source recorded neither prep nor cook.
export function totalMinutes(recipe: SourceRecipeData): number | null {
  const total = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  return total > 0 ? total : null;
}

function flatten(text: string): string {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Garlic & Chilli Spaghetti (Aglio e Olio)" is often written without its bracket.
function titleVariants(title: string): string[] {
  const full = flatten(title);
  const short = flatten(title.split(/[(—:]/)[0]);
  return [...new Set([full, short])].filter((v) => v.length >= 6);
}

// The retrieved recipes the answer actually recommends, in retrieval order.
export function mentionedSources(
  text: string,
  sources: SourceRecipe[],
): SourceRecipe[] {
  const haystack = flatten(text);
  if (!haystack) return [];
  return sources.filter((s) =>
    titleVariants(s.title).some((v) => haystack.includes(v)),
  );
}

// The grounded refusal, recognised while it is still streaming in.
export function isRefusal(text: string): boolean {
  const answer = text.trim();
  if (answer.length < 25) return false;
  const reply = NO_MATCH_REPLY;
  return reply.startsWith(answer) || answer.startsWith(reply);
}

// `label` carries the emoji for scanning; `prompt` is what is actually sent, so the
// retrieval query stays the plain question.
export type FollowUp = { id: string; label: string; prompt: string };

function followUp(id: string, emoji: string, prompt: string): FollowUp {
  return { id, label: `${emoji} ${prompt}`, prompt };
}

// Contextual next questions, built from the recipes on screen rather than guessed.
export function followUpsFor(shown: SourceRecipe[]): FollowUp[] {
  if (shown.length === 0) return [];

  const first = shown[0];
  const name = decodeEntities(first.title);

  if (shown.length === 1) {
    const missing = first.pantry.missing.find((i) => !i.optional);
    return [
      followUp("steps", "👨‍🍳", `Show me the steps for ${name}`),
      followUp("time", "⏱️", `How long does ${name} take?`),
      missing
        ? followUp("swap", "🥕", `What can I use instead of ${missing.item}?`)
        : followUp("serve", "🍽️", `What should I serve with ${name}?`),
    ];
  }

  return [
    followUp("easiest", "🏆", "Which one is easiest?"),
    followUp("fastest", "⚡", "Which one is fastest?"),
    followUp("pantry", "🥬", "Which one uses the most ingredients I already have?"),
    followUp("steps", "👨‍🍳", `Show me the steps for ${name}`),
  ];
}
