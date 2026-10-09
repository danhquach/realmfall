import { advance } from './loop.ts';
import {
  armedSoldiers,
  armyPower,
  assign,
  attack,
  conquests,
  createRealm,
  housingCap,
  order,
  PEOPLE,
  population,
  pickOffer,
  queued,
  rates,
  RESOURCES,
  slotTrait,
  storeCaps,
  train,
  TRAITS,
  unassign,
  winChance,
  YEAR_SECONDS,
  type Construction,
  type Realm,
  type Resource,
} from './realm.ts';
import { createRng, type Rng } from './rng.ts';

/**
 * Headless balance runner (RF-060): plays a run with a fixed, simple strategy
 * and records the realm at the end of each year, so changes to the numbers in
 * docs/design.md can be compared run against run. Pure, like the rest of core;
 * scripts/sim.mjs prints the table.
 */

/** The scripted player's thresholds. Deliberately plain: a baseline, not an optimal player. */
export const STRATEGY = {
  /** Food per second kept in hand before any idle peasant goes anywhere but the farms. */
  foodMargin: 1,
  /** Gold per second kept in hand after a new soldier's upkeep before training one. */
  goldMargin: 0.5,
  /** Below that margin, years of shortfall the gold stockpile must still cover. */
  reserveYears: 10,
  /** Most soldiers trained in one year. */
  trainPerYear: 2,
  /** Lowest win chance worth an attack. */
  attackOdds: 0.6,
  /** A store this full (share of its cap) asks for the next Storehouse level. */
  storeFull: 0.9,
  /** Soldiers needed before a Forge or a Wall level is worth building. */
  forgeAfter: 10,
  /** Soldiers each Forge arms: one more Forge per this many soldiers. */
  soldiersPerForge: 10,
  /** Huts or Markets owned before their next level is worth buying. */
  upgradeAfter: 10,
  /** People per builder kept on the job (at least one). */
  peoplePerBuilder: 7,
} as const;

export interface YearRow {
  year: number;
  stores: Record<Resource, number>;
  population: number;
  soldiers: number;
  power: number;
  conquests: number;
}

export const SIM_LIMITS = { defaultYears: 100, maxYears: 10_000, defaultSeed: 1 } as const;

function row(realm: Realm, year: number): YearRow {
  return {
    year,
    stores: { ...realm.stores },
    population: population(realm),
    soldiers: realm.soldiers,
    power: armyPower(realm),
    conquests: conquests(realm),
  };
}

/**
 * Takes the first choice of every pending trait offer, then fills every empty
 * slot with an owned trait (free, §9).
 */
function slotTraits(realm: Realm): Realm {
  for (let n = realm.offers.length; n > 0; n--) realm = pickOffer(realm, 0, 0);
  for (const trait of TRAITS) {
    const slot = realm.slots.indexOf(null);
    if (slot === -1) break;
    if (realm.traits[trait]) realm = slotTrait(realm, slot, trait);
  }
  return realm;
}

/**
 * Orders, one of each at a time: a Hut when housing is one Hut from full, a Storehouse
 * level when a store is nearly capped, the Barracks once unlocked, then a
 * Market, then a Forge per STRATEGY.soldiersPerForge soldiers and a Wall level
 * once the army is big enough. The next Huts or Markets level comes once
 * STRATEGY.upgradeAfter of them stand, and the next Forges level once every
 * soldier is armed. Each is ordered only while none of its kind is queued, so
 * the queue never clogs.
 */
function buildUp(realm: Realm): Realm {
  const once = (c: Construction) => (queued(realm, c) === 0 ? order(realm, c) : realm);
  realm = once('barracks');
  if (population(realm) + PEOPLE.hutHousing >= housingCap(realm)) realm = once('hut');
  const { soldiers, buildings } = realm;
  if (soldiers >= STRATEGY.forgeAfter && buildings.forge * STRATEGY.soldiersPerForge < soldiers)
    realm = once('forge');
  if (buildings.forge > 0 && soldiers > 0 && armedSoldiers(realm) === soldiers)
    realm = once('forgeLevel');
  if (buildings.hut >= STRATEGY.upgradeAfter) realm = once('hutLevel');
  if (buildings.market >= STRATEGY.upgradeAfter) realm = once('marketLevel');
  const caps = storeCaps(realm);
  if (RESOURCES.some((k) => realm.stores[k] >= caps[k] * STRATEGY.storeFull))
    realm = once('storehouse');
  realm = once('market');
  if (realm.soldiers >= STRATEGY.forgeAfter) realm = once('wall');
  return realm;
}

/**
 * Keeps one builder per STRATEGY.peoplePerBuilder people (at least one) while
 * anything is queued, and one otherwise; any surplus goes back to idle.
 */
function staffBuilders(realm: Realm): Realm {
  const busy = realm.queue.length > 0;
  const want = busy ? Math.max(1, Math.floor(population(realm) / STRATEGY.peoplePerBuilder)) : 1;
  const have = realm.jobs.builder;
  return want > have
    ? assign(realm, 'builder', want - have)
    : unassign(realm, 'builder', have - want);
}

/**
 * Trains up to STRATEGY.trainPerYear soldiers, each only if food still balances
 * with them and gold either keeps STRATEGY.goldMargin of income or the stockpile
 * covers the shortfall for STRATEGY.reserveYears. Rates come from the realm as
 * it would be, so trait modifiers to upkeep count.
 */
function trainArmy(realm: Realm): Realm {
  for (let i = 0; i < STRATEGY.trainPerYear; i++) {
    const next = train(realm);
    if (next === realm) break;
    const r = rates(next);
    const reserve = next.stores.gold + r.gold * YEAR_SECONDS * STRATEGY.reserveYears;
    if (r.food < 0 || (r.gold < STRATEGY.goldMargin && reserve < 0)) break;
    realm = next;
  }
  return realm;
}

/** Attacks the rival with the best odds, if they clear STRATEGY.attackOdds. */
function fight(realm: Realm, rng: Rng): Realm {
  if (realm.soldiers === 0) return realm;
  const power = armyPower(realm);
  let best = -1;
  let bestOdds = 0;
  realm.rivals.forEach((rival, i) => {
    const odds = winChance(power, rival.power);
    if (odds > bestOdds) [best, bestOdds] = [i, odds];
  });
  return best >= 0 && bestOdds >= STRATEGY.attackOdds ? attack(realm, best, rng) : realm;
}

/** Puts every idle peasant to work: farms until food clears the margin, then wood and iron 2:1. */
function employ(realm: Realm): Realm {
  while (realm.idle > 0) {
    const job =
      rates(realm).food < STRATEGY.foodMargin
        ? 'farmer'
        : realm.jobs.woodcutter <= realm.jobs.miner * 2
          ? 'woodcutter'
          : 'miner';
    realm = assign(realm, job);
  }
  return realm;
}

/** One year of decisions, made at the start of the year. Soldiers are trained before builders are staffed. */
export function decide(realm: Realm, rng: Rng): Realm {
  realm = slotTraits(realm);
  realm = buildUp(realm);
  realm = trainArmy(realm);
  realm = staffBuilders(realm);
  realm = fight(realm, rng);
  return employ(slotTraits(realm));
}

/**
 * Plays `years` years from a fresh realm on `seed` and returns one row per
 * year, taken at the end of that year. Battles roll on their own stream, so
 * they don't shift the raid and event rolls tied to the seed.
 */
export function simulate(years: number, seed: number): YearRow[] {
  let realm = createRealm(seed);
  const battles = createRng(seed ^ 0x5eed_ba77);
  const rows: YearRow[] = [];
  for (let y = 0; y < years; y++) {
    realm = advance(decide(realm, battles), YEAR_SECONDS).realm;
    rows.push(row(realm, y + 1));
  }
  return rows;
}

const COLUMNS: { title: string; cell: (r: YearRow) => string }[] = [
  { title: 'Year', cell: (r) => String(r.year) },
  ...RESOURCES.map((k) => ({
    title: k[0]!.toUpperCase() + k.slice(1),
    cell: (r: YearRow) => String(Math.floor(r.stores[k])),
  })),
  { title: 'Pop', cell: (r) => String(r.population) },
  { title: 'Army', cell: (r) => String(r.soldiers) },
  { title: 'Power', cell: (r) => r.power.toFixed(1) },
  { title: 'Conquests', cell: (r) => String(r.conquests) },
];

/** The rows as a right-aligned plain-text table, one line per year under a header. */
export function formatTable(rows: readonly YearRow[]): string {
  const cells = [COLUMNS.map((c) => c.title), ...rows.map((r) => COLUMNS.map((c) => c.cell(r)))];
  const widths = COLUMNS.map((_, i) => Math.max(...cells.map((line) => line[i]!.length)));
  return cells.map((line) => line.map((s, i) => s.padStart(widths[i]!)).join('  ')).join('\n');
}

/**
 * Reads `--years N` and `--seed N` from command-line arguments. Values must be
 * plain digits (years 1..10 000, seed 0..2³²−1); anything else, an unknown
 * or repeated flag, or a missing value is an error message rather than a guess.
 */
export function parseArgs(
  args: readonly string[],
): { years: number; seed: number } | { error: string } {
  const out: { years: number; seed: number } = {
    years: SIM_LIMITS.defaultYears,
    seed: SIM_LIMITS.defaultSeed,
  };
  const max = { years: SIM_LIMITS.maxYears, seed: 0xffff_ffff };
  const min = { years: 1, seed: 0 };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const key = flag === '--years' ? 'years' : flag === '--seed' ? 'seed' : null;
    if (key === null)
      return { error: `Unknown argument. Usage: npm run sim -- [--years N] [--seed N]` };
    if (seen.has(key)) return { error: `--${key} is given more than once.` };
    seen.add(key);
    const value = args[i + 1] ?? '';
    const n = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (!(n >= min[key] && n <= max[key]))
      return { error: `--${key} must be a whole number from ${min[key]} to ${max[key]}.` };
    out[key] = n;
  }
  return out;
}
