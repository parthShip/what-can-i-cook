// Builds data/recipes.json from the seed file plus two public datasets: npm run build-corpus
// Archana's Kitchen supplies real labels and units; Food.com supplies the global country spread.
// Recipes are drawn round-robin by country so no one cuisine dominates retrieval.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";

import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from "hyparquet";

import type { Ingredient, Recipe } from "../src/lib/recipes";

// Total recipes written, seed recipes included.
const TARGET_RECIPES = 2000;

// Breadth caps; India alone arrives under ~45 regional labels.
const MAX_PER_COUNTRY = 110;
const MAX_PER_CUISINE = 55;

// Minimum structure for a recipe to be worth embedding.
const MIN_INGREDIENTS = 3;
const MIN_STEPS = 2;

const CACHE = resolve(process.cwd(), ".cache");
const ARCHANA_ROWS = 7101;

type RawArchana = {
  name: string;
  description: string;
  cuisine: string;
  course: string;
  diet: string;
  ingredients_name: string;
  ingredients_quantity: string;
  "prep_time (in mins)": number | null;
  "cook_time (in mins)": number | null;
  instructions: string;
};

// ---------------------------------------------------------------------------
// Download + cache
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pulls all Archana rows via the HF REST API, checkpointing each page against rate limits.
async function fetchArchana(): Promise<RawArchana[]> {
  const out = resolve(CACHE, "archana.json");
  if (existsSync(out)) return JSON.parse(readFileSync(out, "utf8"));

  const partial = resolve(CACHE, "archana.partial.json");
  const rows: RawArchana[] = existsSync(partial)
    ? JSON.parse(readFileSync(partial, "utf8"))
    : [];

  const base =
    "https://datasets-server.huggingface.co/rows?dataset=BhavaishKumar112%2FFood_Recipe&config=default&split=train";

  for (let offset = rows.length; offset < ARCHANA_ROWS; offset += 100) {
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(`${base}&offset=${offset}&length=100`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { rows: { row: RawArchana }[] };
        rows.push(...json.rows.map((r) => r.row));
        break;
      } catch (error) {
        if (++attempt > 8) throw error;
        writeFileSync(partial, JSON.stringify(rows));
        // Backoff, capped: the limiter clears in well under a minute.
        await sleep(Math.min(60_000, 4000 * 2 ** (attempt - 1)));
      }
    }
    if (offset % 1000 === 0) {
      writeFileSync(partial, JSON.stringify(rows));
      console.log(`  archana ${rows.length}/${ARCHANA_ROWS}`);
    }
    await sleep(400);
  }

  writeFileSync(out, JSON.stringify(rows));
  return rows;
}

// Food.com is only published as parquet, so the shards come down whole (~320 MB).
async function fetchFoodComShards(): Promise<string[]> {
  const paths: string[] = [];
  for (const shard of [0, 1]) {
    const path = resolve(CACHE, `foodcom-${shard}.parquet`);
    if (!existsSync(path)) {
      console.log(`  downloading food.com shard ${shard} …`);
      const url = `https://huggingface.co/api/datasets/untitledwebsite123/food-recipes/parquet/default/train/${shard}.parquet`;
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`shard ${shard}: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
    }
    paths.push(path);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

// Collapses whitespace and strips the BOM/zero-width junk in the cuisine labels.
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[\uFEFF\u200B-\u200D]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function slugify(title: string): string {
  return clean(title)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Parses Food.com's serialised R vectors, `c("4", "1/4", NA)`; NA holes stay as nulls
// because the vectors are index-aligned.
function parseRVector(raw: unknown): (string | null)[] {
  const s = clean(raw);
  if (!s || s === "NA" || s === "character(0)") return [];

  const out: (string | null)[] = [];
  const token = /"((?:[^"\\]|\\.)*)"|\bNA\b/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(s))) {
    if (match[0] === "NA") out.push(null);
    else
      out.push(
        match[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, " ")
          .replace(/\\\\/g, "\\")
          .trim(),
      );
  }

  // Neither a c(...) vector nor quoted means a plain scalar.
  if (out.length === 0 && !s.startsWith("c(")) return [s];
  return out;
}

// ISO-8601 duration ("PT1H30M") to whole minutes.
function isoToMinutes(raw: unknown): number | undefined {
  const s = clean(raw);
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s);
  if (!m) return undefined;
  const [, d, h, min, sec] = m;
  const total =
    Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Math.round(Number(sec ?? 0) / 60);
  return total > 0 ? total : undefined;
}

// Splits Archana's instruction blob on its original step boundaries: a period with NO
// following space ("ready.Cook the wheat"), since sentences within a step still use ". ".
function splitInstructions(blob: unknown): { steps: string[]; tips?: string } {
  let text = clean(blob);
  if (!text) return { steps: [] };

  // Trailing "Tips…" sections are commentary, not steps.
  let tips: string | undefined;
  const tail = /(?:^|\.)\s*(?:Tips?|Did you know\??)(?=[A-Z])/.exec(text);
  if (tail && tail.index > text.length * 0.3) {
    tips = clean(text.slice(tail.index + tail[0].length)) || undefined;
    text = text.slice(0, tail.index + 1);
  }

  const glued = /(?<=[a-z0-9)\]])\.(?=[A-Z])/;
  let steps = text.split(glued);
  // Rows with no glued periods leave the sentence boundary as the only signal.
  if (steps.length < 2) steps = text.split(/(?<=[.!?])\s+/);

  return {
    steps: steps
      .map((s) => clean(s).replace(/^[.,;:\s]+/, ""))
      .filter((s) => s.length > 8)
      .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)),
    tips,
  };
}

// Pairs Archana ingredient names with the quantity blob, matching by name.
// Quantity is the LAST numeric run before the name, which skips glued section headers.
function parseArchanaIngredients(namesRaw: string, quantitiesRaw: string): Ingredient[] {
  const names = clean(namesRaw)
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const blob = clean(quantitiesRaw);

  const seen = new Set<string>();
  const ingredients: Ingredient[] = [];
  let cursor = 0;

  for (const item of names) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let quantity = "";
    const at = blob.indexOf(item, cursor);
    if (at !== -1) {
      const before = blob.slice(cursor, at);
      // Last numeric run before the name starts the quantity.
      const numbers = [...before.matchAll(/\d+(?:[-–\/.]\d+)*/g)];
      const last = numbers.at(-1);
      if (last?.index !== undefined) quantity = clean(before.slice(last.index));
      cursor = at + item.length;

      // "Salt , to taste" — matched exactly, since an open-ended capture swallows the next entries.
      if (!quantity) {
        const note = /^\s*,\s*(to taste|as required|as needed|as per taste)\b/i.exec(
          blob.slice(cursor),
        );
        if (note) quantity = note[1].toLowerCase();
      }
    }

    // An unnamed ingredient keeps an empty amount rather than a guessed one.
    ingredients.push({ item, quantity });
  }

  return ingredients;
}

// Food.com ingredient names WITHOUT amounts: this mirror strips units, storing "4 cups
// blueberries" as "4". Carrying that over would state a wrong measurement, not a missing one.
function foodComIngredients(parts: (string | null)[]): Ingredient[] {
  const seen = new Set<string>();
  const out: Ingredient[] = [];

  for (const part of parts) {
    const name = clean(part);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ item: name, quantity: "" });
  }

  return out;
}

// Derived, since neither source publishes it — but only from stated fields.
function deriveDifficulty(steps: number, ingredients: number, totalMinutes: number): Recipe["difficulty"] {
  // Thresholds sit high: Food.com writes one sentence per step, so counts inflate.
  const score =
    (steps >= 18 ? 2 : steps >= 11 ? 1 : 0) +
    (ingredients >= 16 ? 2 : ingredients >= 11 ? 1 : 0) +
    (totalMinutes >= 180 ? 2 : totalMinutes >= 75 ? 1 : 0);
  return score >= 4 ? "Hard" : score >= 2 ? "Medium" : "Easy";
}

// ---------------------------------------------------------------------------
// Cuisine + diet vocabulary
// ---------------------------------------------------------------------------

// Raw label -> [cuisine, country]. Folding ~45 Indian regional names onto one country is
// what stops the balancer handing India 45 separate allowances.
const INDIAN_REGIONS = [
  "indian", "north indian", "south indian", "maharashtrian", "bengali", "kerala",
  "tamil nadu", "karnataka", "gujarati", "rajasthani", "andhra", "goan",
  "chettinad", "punjabi", "kashmiri", "mangalorean", "parsi", "awadhi",
  "hyderabadi", "konkan", "mughlai", "oriya", "sindhi", "north east india",
  "assamese", "bihari", "himachal", "north karnataka", "south karnataka",
  "coastal karnataka", "karnataka coastal", "udupi", "coorg", "uttar pradesh",
  "malabar", "malvani", "lucknowi", "nagaland", "haryana", "jharkhand",
  "kongunadu", "uttarakhand-north kumaon", "uttarakhand - north kumaon",
  "indo chinese", "sichuan style indian",
];

const COUNTRY_BY_LABEL: Record<string, string> = {
  // --- Europe
  italian: "Italy", french: "France", greek: "Greece", spanish: "Spain",
  portuguese: "Portugal", german: "Germany", austrian: "Austria", swiss: "Switzerland",
  dutch: "Netherlands", belgian: "Belgium", british: "United Kingdom", english: "United Kingdom",
  scottish: "United Kingdom", welsh: "United Kingdom", irish: "Ireland",
  hungarian: "Hungary", polish: "Poland", russian: "Russia", czech: "Czechia",
  swedish: "Sweden", norwegian: "Norway", danish: "Denmark", finnish: "Finland",
  icelandic: "Iceland", turkish: "Turkey", georgian: "Georgia", ukrainian: "Ukraine",
  // --- Americas
  american: "United States", "southwestern u.s.": "United States", cajun: "United States",
  creole: "United States", hawaiian: "United States", "native american": "United States",
  "pennsylvania dutch": "United States", "tex mex": "United States",
  canadian: "Canada", mexican: "Mexico", brazilian: "Brazil", peruvian: "Peru",
  colombian: "Colombia", chilean: "Chile", argentine: "Argentina", venezuelan: "Venezuela",
  cuban: "Cuba", "puerto rican": "Puerto Rico", "costa rican": "Costa Rica",
  // --- Asia
  chinese: "China", cantonese: "China", hunan: "China", shandong: "China", sichuan: "China",
  japanese: "Japan", korean: "South Korea", thai: "Thailand", vietnamese: "Vietnam",
  cambodian: "Cambodia", indonesian: "Indonesia", malaysian: "Malaysia",
  singapore: "Singapore", singaporean: "Singapore", filipino: "Philippines",
  burmese: "Myanmar", nepalese: "Nepal", "sri lankan": "Sri Lanka", "sri lanka": "Sri Lanka",
  pakistani: "Pakistan", bangladeshi: "Bangladesh", afghan: "Afghanistan", mongolian: "Mongolia",
  // --- Middle East + Africa
  lebanese: "Lebanon", israeli: "Israel", jewish: "Israel", palestinian: "Palestine",
  egyptian: "Egypt", moroccan: "Morocco", ethiopian: "Ethiopia", nigerian: "Nigeria",
  "south african": "South Africa", somalian: "Somalia", sudanese: "Sudan",
  algerian: "Algeria", tunisian: "Tunisia", iranian: "Iran", persian: "Iran", iraqi: "Iraq",
  // --- Oceania
  australian: "Australia", "new zealand": "New Zealand", polynesian: "Polynesia",
};

// Regional labels with no single country; they bucket under themselves.
const REGIONS = new Set([
  "asian", "european", "african", "continental", "mediterranean", "middle eastern",
  "caribbean", "scandinavian", "south american", "central american", "latin american",
  "southwest asia (middle east)", "fusion", "arab",
]);

function resolveCuisine(raw: string): { cuisine: string; country: string } | null {
  const label = clean(raw).replace(/\s*Recipes?\s*$/i, "").trim();
  if (!label) return null;
  const key = label.toLowerCase();

  if (INDIAN_REGIONS.includes(key)) return { cuisine: label, country: "India" };

  const country = COUNTRY_BY_LABEL[key];
  if (country) return { cuisine: label, country };

  if (REGIONS.has(key)) {
    const cuisine = key === "southwest asia (middle east)" ? "Middle Eastern" : label;
    return { cuisine, country: cuisine };
  }

  return null;
}

// Source diet labels -> the controlled vocabulary the seed recipes use.
const DIET_TAGS: [RegExp, string][] = [
  [/^vegan$/i, "vegan"],
  [/vegetarian/i, "vegetarian"],
  [/eggetarian/i, "vegetarian"],
  [/non ?veg/i, "non-vegetarian"],
  [/high protein/i, "high-protein"],
  [/gluten ?free/i, "gluten-free"],
  [/lactose ?free|dairy ?free/i, "dairy-free"],
  [/egg ?free/i, "egg-free"],
  [/diabetic/i, "diabetic-friendly"],
  [/sugar ?free/i, "sugar-free"],
  [/no onion no garlic|sattvic/i, "no-onion-no-garlic"],
  [/very low carb|low carb/i, "low-carb"],
  [/low ?fat/i, "low-fat"],
  [/low cholesterol/i, "low-cholesterol"],
  [/high fiber/i, "high-fibre"],
  [/kosher/i, "kosher"],
];

function toDietaryTags(labels: string[]): string[] {
  const tags = new Set<string>();
  for (const label of labels) {
    for (const [pattern, tag] of DIET_TAGS) {
      if (pattern.test(label)) tags.add(tag);
    }
  }
  // "Vegan" already implies the weaker claim.
  if (tags.has("vegan")) tags.delete("vegetarian");
  if (tags.has("non-vegetarian")) tags.delete("vegetarian");
  return [...tags];
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

// Carries the fields the balancer ranks on, then is unwrapped.
type Candidate = { recipe: Recipe; country: string; score: number };

// Completeness score: picks which recipes fill a country's allowance.
function scoreRecipe(r: Recipe, popularity = 0): number {
  // Only a quantity with a unit counts, which tips allowances towards Archana rows.
  const realQuantities = r.ingredients.filter((i) => /\d/.test(i.quantity) && /[a-z]/i.test(i.quantity)).length;
  return (
    Math.min(r.instructions.length, 10) * 2 +
    Math.min(realQuantities, 12) * 3 +
    (r.prepTimeMinutes > 0 ? 6 : 0) +
    (r.cookTimeMinutes > 0 ? 6 : 0) +
    (r.servings ? 6 : 0) +
    (r.tips ? 3 : 0) +
    Math.min(popularity, 10)
  );
}

function fromArchana(row: RawArchana): Candidate | null {
  const title = clean(row.name).replace(/\s*Recipe\b.*$/i, "").trim();
  const resolved = resolveCuisine(row.cuisine);
  if (!title || !resolved) return null;

  const { steps, tips } = splitInstructions(row.instructions);
  const ingredients = parseArchanaIngredients(row.ingredients_name, row.ingredients_quantity);
  if (ingredients.length < MIN_INGREDIENTS || steps.length < MIN_STEPS) return null;

  const prep = Math.max(0, Math.round(row["prep_time (in mins)"] ?? 0));
  const cook = Math.max(0, Math.round(row["cook_time (in mins)"] ?? 0));

  const recipe: Recipe = {
    id: slugify(title),
    title,
    cuisine: resolved.cuisine,
    country: resolved.country,
    // Archana publishes no serving count; left undefined rather than defaulted.
    dietaryTags: toDietaryTags([row.diet]),
    difficulty: deriveDifficulty(steps.length, ingredients.length, prep + cook),
    prepTimeMinutes: prep,
    cookTimeMinutes: cook,
    ingredients,
    instructions: steps,
    tips,
    source: "Archana's Kitchen",
  };

  return { recipe, country: resolved.country, score: scoreRecipe(recipe) };
}

type RawFoodCom = {
  RecipeId: bigint | number;
  Name: string;
  CookTime: string | null;
  PrepTime: string | null;
  RecipeCategory: string | null;
  Keywords: string | null;
  RecipeIngredientQuantities: string | null;
  RecipeIngredientParts: string | null;
  RecipeServings: number | null;
  RecipeInstructions: string | null;
  AggregatedRating: number | null;
  ReviewCount: number | null;
};

function fromFoodCom(row: RawFoodCom): Candidate | null {
  const title = clean(row.Name);
  if (!title) return null;

  const keywords = parseRVector(row.Keywords).filter(Boolean).map(String);

  // Category is the stronger signal, but many rows only reveal cuisine via keywords.
  const resolved =
    resolveCuisine(clean(row.RecipeCategory)) ??
    keywords.map(resolveCuisine).find((r): r is NonNullable<typeof r> => r !== null) ??
    null;
  if (!resolved) return null;

  const ingredients = foodComIngredients(parseRVector(row.RecipeIngredientParts));
  const instructions = parseRVector(row.RecipeInstructions)
    .filter(Boolean)
    .map((s) => clean(s))
    .filter((s) => s.length > 8);
  if (ingredients.length < MIN_INGREDIENTS || instructions.length < MIN_STEPS) return null;

  const prep = isoToMinutes(row.PrepTime) ?? 0;
  const cook = isoToMinutes(row.CookTime) ?? 0;
  const servings = row.RecipeServings && row.RecipeServings > 0
    ? Math.round(row.RecipeServings)
    : undefined;

  const recipe: Recipe = {
    id: slugify(title),
    title,
    cuisine: resolved.cuisine,
    country: resolved.country,
    dietaryTags: toDietaryTags(keywords),
    difficulty: deriveDifficulty(instructions.length, ingredients.length, prep + cook),
    prepTimeMinutes: prep,
    cookTimeMinutes: cook,
    servings,
    ingredients,
    instructions,
    tips: undefined,
    source: "Food.com",
    sourceUrl: `https://www.food.com/recipe/${row.RecipeId}`,
  };

  // Ratings only count once a few people have voted.
  const popularity = (row.ReviewCount ?? 0) >= 3 ? (row.AggregatedRating ?? 0) * 2 : 0;
  return { recipe, country: resolved.country, score: scoreRecipe(recipe, popularity) };
}

// Streams the Food.com shards in slices; 522k rows will not fit in memory.
async function readFoodCom(paths: string[]): Promise<Candidate[]> {
  const columns = [
    "RecipeId", "Name", "CookTime", "PrepTime", "RecipeCategory", "Keywords",
    "RecipeIngredientParts", "RecipeServings",
    "RecipeInstructions", "AggregatedRating", "ReviewCount",
  ];

  const candidates: Candidate[] = [];
  for (const path of paths) {
    const file = await asyncBufferFromFile(path);
    const metadata = await parquetMetadataAsync(file);
    const total = Number(metadata.num_rows);

    for (let start = 0; start < total; start += 50_000) {
      const rows = (await parquetReadObjects({
        file,
        metadata,
        columns,
        rowStart: start,
        rowEnd: Math.min(start + 50_000, total),
      })) as unknown as RawFoodCom[];

      for (const row of rows) {
        const candidate = fromFoodCom(row);
        if (candidate) candidates.push(candidate);
      }
    }
    console.log(`  food.com ${path.split(/[\\/]/).pop()}: ${candidates.length} usable so far`);
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Balancing + entry point
// ---------------------------------------------------------------------------

// Fills round-robin across countries: a global top-N would give every slot to the two
// best-documented countries, and "lamb and couscous" needs Morocco present at all.
function balance(candidates: Candidate[], seeded: Recipe[]): Recipe[] {
  const taken = new Map<string, Recipe>();
  const perCountry = new Map<string, number>();
  const perCuisine = new Map<string, number>();

  const admit = (recipe: Recipe, country: string) => {
    taken.set(recipe.id, recipe);
    perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    perCuisine.set(recipe.cuisine, (perCuisine.get(recipe.cuisine) ?? 0) + 1);
  };

  // The hand-written recipes are always in; the chips and check.ts assert against them.
  for (const recipe of seeded) admit(recipe, recipe.country);

  const byCountry = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (taken.has(candidate.recipe.id)) continue;
    const bucket = byCountry.get(candidate.country);
    if (bucket) bucket.push(candidate);
    else byCountry.set(candidate.country, [candidate]);
  }
  for (const bucket of byCountry.values()) bucket.sort((a, b) => b.score - a.score);

  // Rarest countries first, so a country with 7 recipes is not crowded out by one with 30,000.
  const order = [...byCountry.keys()].sort(
    (a, b) => byCountry.get(a)!.length - byCountry.get(b)!.length,
  );
  const cursors = new Map(order.map((c) => [c, 0]));

  let progressed = true;
  while (taken.size < TARGET_RECIPES && progressed) {
    progressed = false;

    for (const country of order) {
      if (taken.size >= TARGET_RECIPES) break;
      if ((perCountry.get(country) ?? 0) >= MAX_PER_COUNTRY) continue;

      const bucket = byCountry.get(country)!;
      let i = cursors.get(country)!;

      while (i < bucket.length) {
        const { recipe } = bucket[i++];
        if (taken.has(recipe.id)) continue;
        if ((perCuisine.get(recipe.cuisine) ?? 0) >= MAX_PER_CUISINE) continue;
        admit(recipe, country);
        progressed = true;
        break;
      }

      cursors.set(country, i);
    }
  }

  return [...taken.values()];
}

async function main() {
  mkdirSync(CACHE, { recursive: true });

  const seedPath = resolve(process.cwd(), "data/recipes.seed.json");
  const seedRaw: Recipe[] = JSON.parse(readFileSync(seedPath, "utf8"));
  // The seed file predates the country field; fill it from the same registry.
  const seeded = seedRaw.map((r) => ({
    ...r,
    country: r.country ?? resolveCuisine(r.cuisine)?.country ?? r.cuisine,
    source: r.source ?? "hand-written",
  }));
  console.log(`Seed: ${seeded.length} curated recipes`);

  console.log("Fetching Archana's Kitchen …");
  const archana = await fetchArchana();
  const archanaCandidates = archana
    .map(fromArchana)
    .filter((c): c is Candidate => c !== null);
  console.log(`  ${archanaCandidates.length} usable of ${archana.length}`);

  console.log("Reading Food.com …");
  const foodComCandidates = await readFoodCom(await fetchFoodComShards());
  console.log(`  ${foodComCandidates.length} usable`);

  const recipes = balance([...archanaCandidates, ...foodComCandidates], seeded);

  const countries = new Set(recipes.map((r) => r.country));
  const cuisines = new Set(recipes.map((r) => r.cuisine));
  console.log(
    `\nCorpus: ${recipes.length} recipes across ${countries.size} countries / ${cuisines.size} cuisines`,
  );

  const top = [...recipes.reduce((m, r) => m.set(r.country, (m.get(r.country) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);
  console.log(top.map(([c, n]) => `${c}:${n}`).join("  "));

  const out = resolve(process.cwd(), "data/recipes.json");
  writeFileSync(out, `${JSON.stringify(recipes, null, 2)}\n`);
  console.log(`\nWrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
