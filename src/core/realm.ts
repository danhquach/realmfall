/** The four stores (docs/design.md §3). */
export const RESOURCES = ['food', 'wood', 'iron', 'gold'] as const;
export type Resource = (typeof RESOURCES)[number];

export const JOBS = ['farmer', 'woodcutter', 'miner'] as const;
export type Job = (typeof JOBS)[number];

/** docs/design.md §5. */
export const BUILDINGS = ['hut', 'market', 'forge'] as const;
export type Building = (typeof BUILDINGS)[number];

/** docs/design.md §9. */
export const TRAITS = [
  'poisonArchers',
  'horseLords',
  'dwarvenSmiths',
  'fertileValleys',
  'timberClans',
  'merchantGuilds',
  'stoneHalls',
] as const;
export type Trait = (typeof TRAITS)[number];

export interface Ruler {
  name: string;
  age: number;
}

/** A rival kingdom (docs/design.md §7). */
export interface Rival {
  name: string;
  ruler: string;
  trait: Trait;
  power: number;
  hostile: boolean;
  scouted: boolean;
}

/** One Chronicle line, tagged with the year it happened (docs/design.md §12). */
export interface ChronicleEntry {
  year: number;
  text: string;
}

export interface Realm {
  /** The run's seed: every random roll in the run derives from it. */
  seed: number;
  /** Game seconds elapsed since the run began. */
  time: number;
  year: number;
  ruler: Ruler;
  stores: Record<Resource, number>;
  idle: number;
  jobs: Record<Job, number>;
  /** Seconds banked toward the next peasant (docs/design.md §4). */
  growth: number;
  /** Hunger built up while food is at 0; each 4 points, one person leaves (docs/design.md §4). */
  hunger: number;
  soldiers: number;
  /** Seconds banked toward the next deserter while gold is at 0 (docs/design.md §6). */
  desertion: number;
  buildings: Record<Building, number>;
  /** Storehouse level, from 0 (docs/design.md §5). */
  storehouse: number;
  rivals: Rival[];
  traits: Trait[];
  chronicle: ChronicleEntry[];
}

/** Per-second values from docs/design.md §3 and §6. Starting points for balancing. */
export const RATES = {
  farmerFood: 1.5,
  woodcutterWood: 0.8,
  minerIron: 0.4,
  civilianEats: 0.5,
  soldierEats: 1,
  taxPerWorker: 0.25,
  soldierUpkeep: 0.5,
  marketGold: 1,
} as const;

/** docs/design.md §3 and §4. */
export const PEOPLE = {
  baseHousing: 15,
  hutHousing: 5,
  growthEvery: 4,
  growthMinFood: 5,
  hungerPerLeaver: 4,
  desertEvery: 2,
} as const;

/** The starting state (docs/design.md §3). */
export function createRealm(seed: number): Realm {
  return {
    seed: seed >>> 0,
    time: 0,
    year: 1,
    ruler: { name: 'Edric', age: 45 },
    stores: { food: 80, wood: 40, iron: 10, gold: 40 },
    idle: 4,
    jobs: { farmer: 4, woodcutter: 2, miner: 0 },
    growth: 0,
    hunger: 0,
    soldiers: 0,
    desertion: 0,
    buildings: { hut: 0, market: 0, forge: 0 },
    storehouse: 0,
    rivals: [],
    traits: [],
    chronicle: [],
  };
}

/** An amount of each store; resources left out cost nothing. */
export type Cost = Partial<Record<Resource, number>>;

interface StorehouseLevel {
  caps: Record<Resource, number>;
  safe: Record<Resource, number>;
  /** What it costs to reach this level from the one below. */
  cost: Cost;
}

/** Storehouse levels 0–3 (docs/design.md §5). */
export const STOREHOUSE: readonly StorehouseLevel[] = [
  {
    caps: { food: 200, wood: 200, iron: 50, gold: 150 },
    safe: { food: 0, wood: 0, iron: 0, gold: 0 },
    cost: {},
  },
  {
    caps: { food: 500, wood: 600, iron: 120, gold: 400 },
    safe: { food: 50, wood: 60, iron: 12, gold: 40 },
    cost: { wood: 60 },
  },
  {
    caps: { food: 1500, wood: 2000, iron: 400, gold: 1200 },
    safe: { food: 200, wood: 250, iron: 50, gold: 150 },
    cost: { wood: 200, iron: 30 },
  },
  {
    caps: { food: 5000, wood: 6000, iron: 1200, gold: 4000 },
    safe: { food: 750, wood: 900, iron: 180, gold: 600 },
    cost: { wood: 600, iron: 120, gold: 100 },
  },
];

/** Each level past the table multiplies the previous one's caps, safe amounts and cost by this. */
export const STOREHOUSE_GROWTH = 3;

function scale<T extends Cost>(amounts: T, by: number): T {
  const out: Cost = {};
  for (const k of RESOURCES) if (amounts[k] !== undefined) out[k] = amounts[k] * by;
  return out as T;
}

/** Caps, safe amounts and upgrade cost of Storehouse `level`; past level 3 each step is ×3. */
export function storehouseLevel(level: number): StorehouseLevel {
  const top = STOREHOUSE.length - 1;
  if (level <= top) return STOREHOUSE[level]!;
  const base = STOREHOUSE[top]!;
  const by = STOREHOUSE_GROWTH ** (level - top);
  return { caps: scale(base.caps, by), safe: scale(base.safe, by), cost: scale(base.cost, by) };
}

/** The most each store can hold (§3). */
export function storeCaps(realm: Realm): Record<Resource, number> {
  return storehouseLevel(realm.storehouse).caps;
}

/** How much of each store a raid can't take (§5, §7). */
export function safeAmounts(realm: Realm): Record<Resource, number> {
  return storehouseLevel(realm.storehouse).safe;
}

/** What the next Storehouse level costs. */
export function upgradeCost(realm: Realm): Cost {
  return storehouseLevel(realm.storehouse + 1).cost;
}

/** True when every store holds at least its share of `cost`. */
export function canAfford(realm: Realm, cost: Cost): boolean {
  return RESOURCES.every((k) => realm.stores[k] >= (cost[k] ?? 0));
}

/** Takes `cost` from the stores, or returns the realm unchanged if it can't be paid. */
export function pay(realm: Realm, cost: Cost): Realm {
  if (!canAfford(realm, cost)) return realm;
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] -= cost[k] ?? 0;
  return { ...realm, stores };
}

/** Raises the Storehouse one level if its cost can be paid; otherwise nothing changes. */
export function upgradeStorehouse(realm: Realm): Realm {
  const cost = upgradeCost(realm);
  if (!canAfford(realm, cost)) return realm;
  return { ...pay(realm, cost), storehouse: realm.storehouse + 1 };
}

/** Base cost and growth per building owned (docs/design.md §5). */
export const BUILDING_COSTS: Record<Building, { base: Cost; growth: number }> = {
  hut: { base: { wood: 25 }, growth: 1.3 },
  market: { base: { wood: 40, gold: 30 }, growth: 1.5 },
  forge: { base: { wood: 60, iron: 20 }, growth: 2 },
};

/** Army power bonus per Forge (§6: power × (1 + 0.5 × forges)). */
export const FORGE_BONUS = 0.5;

/** What the next `building` costs: base × growthⁿ for n already built, rounded up. */
export function buildingCost(realm: Realm, building: Building): Cost {
  const { base, growth } = BUILDING_COSTS[building];
  const by = growth ** realm.buildings[building];
  const cost: Cost = {};
  for (const k of RESOURCES) if (base[k] !== undefined) cost[k] = Math.ceil(base[k] * by);
  return cost;
}

/** Builds one `building` if its cost can be paid; otherwise nothing changes. */
export function build(realm: Realm, building: Building): Realm {
  const cost = buildingCost(realm, building);
  if (!canAfford(realm, cost)) return realm;
  const paid = pay(realm, cost);
  return { ...paid, buildings: { ...paid.buildings, [building]: paid.buildings[building] + 1 } };
}

/** The Forge multiplier on army power (§6). */
export function forgeBonus(realm: Realm): number {
  return 1 + FORGE_BONUS * realm.buildings.forge;
}

/** Spearmen, the one Phase 1 unit (docs/design.md §6): 1 peasant + this cost each. */
export const SOLDIER: { readonly cost: Cost; readonly power: number } = {
  cost: { iron: 5, gold: 10 },
  power: 2,
};

/** Field army power (§6): base power of every soldier × the Forge multiplier. */
export function armyPower(realm: Realm): number {
  return realm.soldiers * SOLDIER.power * forgeBonus(realm);
}

export function workers(realm: Realm): number {
  return realm.jobs.farmer + realm.jobs.woodcutter + realm.jobs.miner;
}

export function population(realm: Realm): number {
  return realm.idle + workers(realm) + realm.soldiers;
}

export function housingCap(realm: Realm): number {
  return PEOPLE.baseHousing + realm.buildings.hut * PEOPLE.hutHousing;
}

/** Whole, non-negative count; anything else (NaN, negative, fractional part) is trimmed. */
function wholeCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** Moves up to `count` idle peasants into `job`; asks beyond the idle pool are capped. */
export function assign(realm: Realm, job: Job, count = 1): Realm {
  const n = Math.min(wholeCount(count), realm.idle);
  if (n === 0) return realm;
  return { ...realm, idle: realm.idle - n, jobs: { ...realm.jobs, [job]: realm.jobs[job] + n } };
}

/** Moves up to `count` workers from `job` back to idle; asks beyond the job's headcount are capped. */
export function unassign(realm: Realm, job: Job, count = 1): Realm {
  const n = Math.min(wholeCount(count), realm.jobs[job]);
  if (n === 0) return realm;
  return { ...realm, idle: realm.idle + n, jobs: { ...realm.jobs, [job]: realm.jobs[job] - n } };
}

/**
 * Trains up to `count` soldiers, each taking one idle peasant and paying
 * SOLDIER.cost; stops at the first one the idle pool or stores can't cover.
 */
export function train(realm: Realm, count = 1): Realm {
  let next = realm;
  for (let i = wholeCount(count); i > 0 && next.idle > 0 && canAfford(next, SOLDIER.cost); i--) {
    next = { ...pay(next, SOLDIER.cost), idle: next.idle - 1, soldiers: next.soldiers + 1 };
  }
  return next;
}

/** Sends up to `count` soldiers back to idle; the training cost is not refunded (§6). */
export function disband(realm: Realm, count = 1): Realm {
  const n = Math.min(wholeCount(count), realm.soldiers);
  if (n === 0) return realm;
  return { ...realm, idle: realm.idle + n, soldiers: realm.soldiers - n };
}

/**
 * Starvation shortfall s (§4): while food is at 0, the share of food eaten that
 * production doesn't cover, from 0 (fed) to 1 (no food at all). 0 while any
 * food is left.
 */
export function shortfall(realm: Realm): number {
  if (realm.stores.food > 0) return 0;
  const eaten =
    (realm.idle + workers(realm)) * RATES.civilianEats + realm.soldiers * RATES.soldierEats;
  const produced = realm.jobs.farmer * RATES.farmerFood;
  return eaten > produced ? (eaten - produced) / eaten : 0;
}

/**
 * Net change per second of every store. Wood, iron and tax shrink by (1 − s)
 * while starving; Market gold doesn't.
 */
export function rates(realm: Realm): Record<Resource, number> {
  const civilians = realm.idle + workers(realm);
  const fed = 1 - shortfall(realm);
  return {
    food:
      realm.jobs.farmer * RATES.farmerFood -
      civilians * RATES.civilianEats -
      realm.soldiers * RATES.soldierEats,
    wood: realm.jobs.woodcutter * RATES.woodcutterWood * fed,
    iron: realm.jobs.miner * RATES.minerIron * fed,
    gold:
      workers(realm) * RATES.taxPerWorker * fed +
      realm.buildings.market * RATES.marketGold -
      realm.soldiers * RATES.soldierUpkeep,
  };
}

/**
 * Removes one starving person (§4): idle peasants first, then miners,
 * woodcutters and farmers (so farmers stay longest), then soldiers.
 */
function loseOne(realm: Realm): Realm {
  if (realm.idle > 0) return { ...realm, idle: realm.idle - 1 };
  for (const job of ['miner', 'woodcutter', 'farmer'] as const) {
    if (realm.jobs[job] > 0)
      return { ...realm, jobs: { ...realm.jobs, [job]: realm.jobs[job] - 1 } };
  }
  if (realm.soldiers > 0) return { ...realm, soldiers: realm.soldiers - 1 };
  return realm;
}

/**
 * Advances the realm by `dt` seconds. Pure: returns a new realm and leaves the
 * input untouched, so the same function drives live play and offline catch-up.
 * It copies only what it changes and shares the rest with the input, so treat
 * every Realm as immutable: build a new one rather than editing in place.
 * Stores never go below zero, and anything over a store's cap is lost (§3).
 *
 * Starvation (§4): while food is at 0, hunger builds at s per second and one
 * person leaves per 4 hunger; hunger resets once s is 0 again (food above 0,
 * or production covering what is eaten). Growth needs food > 5, so a starving
 * realm never grows.
 *
 * Desertion (§6): while gold is at 0, one soldier deserts per 2 s banked; the
 * bank resets once gold is above 0 or the army is gone.
 *
 * Growth (§4): while food > 5 and population is under the housing cap, one
 * idle peasant arrives per 4 s banked. The bank empties whenever either
 * condition fails, so a freshly opened house waits a full 4 s. Rates are
 * fixed for the whole step, so keep `dt` small (the loop uses STEP).
 */
export function tick(realm: Realm, dt: number): Realm {
  const r = rates(realm);
  const caps = storeCaps(realm);
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] = Math.min(caps[k], Math.max(0, stores[k] + r[k] * dt));

  let idle = realm.idle;
  let growth = realm.growth + dt;
  const cap = housingCap(realm);
  const others = workers(realm) + realm.soldiers;
  const canGrow = () => stores.food > PEOPLE.growthMinFood && idle + others < cap;
  while (canGrow() && growth >= PEOPLE.growthEvery) {
    idle += 1;
    growth -= PEOPLE.growthEvery;
  }
  if (!canGrow()) growth = 0;

  let next: Realm = { ...realm, time: realm.time + dt, stores, idle, growth };

  const s = shortfall(realm);
  let hunger = s > 0 ? realm.hunger + s * dt : 0;
  while (hunger >= PEOPLE.hungerPerLeaver && population(next) > 0) {
    next = loseOne(next);
    hunger -= PEOPLE.hungerPerLeaver;
  }

  let desertion = stores.gold > 0 || next.soldiers === 0 ? 0 : realm.desertion + dt;
  let soldiers = next.soldiers;
  while (desertion >= PEOPLE.desertEvery && soldiers > 0) {
    soldiers -= 1;
    desertion -= PEOPLE.desertEvery;
  }

  return { ...next, hunger, soldiers, desertion };
}
