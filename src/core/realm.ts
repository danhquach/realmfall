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
  soldiers: number;
  buildings: Record<Building, number>;
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
} as const;

/** docs/design.md §3 and §4. */
export const PEOPLE = {
  baseHousing: 15,
  hutHousing: 5,
  growthEvery: 4,
  growthMinFood: 5,
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
    soldiers: 0,
    buildings: { hut: 0, market: 0, forge: 0 },
    rivals: [],
    traits: [],
    chronicle: [],
  };
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

/** Net change per second of every store. */
export function rates(realm: Realm): Record<Resource, number> {
  const civilians = realm.idle + workers(realm);
  return {
    food:
      realm.jobs.farmer * RATES.farmerFood -
      civilians * RATES.civilianEats -
      realm.soldiers * RATES.soldierEats,
    wood: realm.jobs.woodcutter * RATES.woodcutterWood,
    iron: realm.jobs.miner * RATES.minerIron,
    gold: workers(realm) * RATES.taxPerWorker - realm.soldiers * RATES.soldierUpkeep,
  };
}

/**
 * Advances the realm by `dt` seconds. Pure: returns a new realm and leaves the
 * input untouched, so the same function drives live play and offline catch-up.
 * It copies only what it changes and shares the rest with the input, so treat
 * every Realm as immutable: build a new one rather than editing in place.
 * Stores never go below zero; what happens when they run dry (starvation,
 * desertion) is a later system.
 *
 * Growth (§4): while food > 5 and population is under the housing cap, one
 * idle peasant arrives per 4 s banked. The bank empties whenever either
 * condition fails, so a freshly opened house waits a full 4 s. Rates are
 * fixed for the whole step, so keep `dt` small (the loop uses STEP).
 */
export function tick(realm: Realm, dt: number): Realm {
  const r = rates(realm);
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] = Math.max(0, stores[k] + r[k] * dt);

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

  return { ...realm, time: realm.time + dt, stores, idle, growth };
}
