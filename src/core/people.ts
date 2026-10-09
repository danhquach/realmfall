import { FORGE } from './army.ts';
import { upgradeBonus } from './buildings.ts';
import { type Job, JOBS, type Realm, type Resource } from './model.ts';
import { storeCaps } from './stores.ts';
import { traitModifiers } from './traits.ts';

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

/** Every peasant with a job, builders included; all of them pay tax (§3, §5). */
export function workers(realm: Realm): number {
  return JOBS.reduce((sum, job) => sum + realm.jobs[job], 0);
}

export function population(realm: Realm): number {
  return realm.idle + workers(realm) + realm.soldiers;
}

/** Whole, non-negative count; anything else (NaN, negative, fractional part) is trimmed. */
export function wholeCount(count: number): number {
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
 * Starvation shortfall s (§4): while food is at 0, the share of food eaten that
 * production doesn't cover, from 0 (fed) to 1 (no food at all). 0 while any
 * food is left.
 */
export function shortfall(realm: Realm): number {
  if (realm.stores.food > 0) return 0;
  const eaten =
    (realm.idle + workers(realm)) * RATES.civilianEats + realm.soldiers * RATES.soldierEats;
  const produced = realm.jobs.farmer * RATES.farmerFood * (1 + traitModifiers(realm).farmer);
  return eaten > produced ? (eaten - produced) / eaten : 0;
}

/** Net change per second of every store but the Forges' share, which step() works out exactly. */
export function production(realm: Realm): Record<Resource, number> {
  const civilians = realm.idle + workers(realm);
  const fed = 1 - shortfall(realm);
  const m = traitModifiers(realm);
  return {
    food:
      realm.jobs.farmer * RATES.farmerFood * (1 + m.farmer) -
      civilians * RATES.civilianEats -
      realm.soldiers * RATES.soldierEats,
    wood: realm.jobs.woodcutter * RATES.woodcutterWood * (1 + m.woodcutter) * fed,
    iron: realm.jobs.miner * RATES.minerIron * (1 + m.miner) * fed,
    gold:
      workers(realm) * RATES.taxPerWorker * (1 + m.tax) * fed +
      realm.buildings.market * RATES.marketGold * upgradeBonus(realm.buildings.marketLevel) -
      realm.soldiers * RATES.soldierUpkeep * (1 + m.soldierUpkeep),
    weapons: 0,
  };
}

/**
 * Net change per second of every store, after slotted trait modifiers (§9).
 * Wood, iron and tax shrink by (1 − s) while starving; Market gold doesn't.
 * Forges turn iron into weapons while there is iron and room for them (§5).
 */
export function rates(realm: Realm): Record<Resource, number> {
  const r = production(realm);
  const room = storeCaps(realm).weapons > realm.stores.weapons;
  const forging = room && realm.stores.iron > 0 ? realm.buildings.forge / FORGE.every : 0;
  return { ...r, iron: r.iron - forging * FORGE.iron, weapons: forging };
}

/**
 * Removes one starving person (§4): idle peasants first, then builders, miners,
 * woodcutters and farmers (so farmers stay longest), then soldiers.
 */
export function loseOne(realm: Realm): Realm {
  if (realm.idle > 0) return { ...realm, idle: realm.idle - 1 };
  for (const job of ['builder', 'miner', 'woodcutter', 'farmer'] as const) {
    if (realm.jobs[job] > 0)
      return { ...realm, jobs: { ...realm.jobs, [job]: realm.jobs[job] - 1 } };
  }
  if (realm.soldiers > 0) return { ...realm, soldiers: realm.soldiers - 1 };
  return realm;
}
