/** The four stores (docs/design.md §3). */
export const RESOURCES = ['food', 'wood', 'iron', 'gold'] as const;
export type Resource = (typeof RESOURCES)[number];

export const JOBS = ['farmer', 'woodcutter', 'miner'] as const;
export type Job = (typeof JOBS)[number];

export interface Realm {
  stores: Record<Resource, number>;
  idle: number;
  jobs: Record<Job, number>;
  soldiers: number;
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

/** The starting state (docs/design.md §3). */
export function createRealm(): Realm {
  return {
    stores: { food: 80, wood: 40, iron: 10, gold: 40 },
    idle: 4,
    jobs: { farmer: 4, woodcutter: 2, miner: 0 },
    soldiers: 0,
  };
}

export function workers(realm: Realm): number {
  return realm.jobs.farmer + realm.jobs.woodcutter + realm.jobs.miner;
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
 * Stores never go below zero; what happens when they run dry (starvation,
 * desertion) is a later system.
 */
export function tick(realm: Realm, dt: number): Realm {
  const r = rates(realm);
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] = Math.max(0, stores[k] + r[k] * dt);
  return { ...realm, stores, jobs: { ...realm.jobs } };
}
