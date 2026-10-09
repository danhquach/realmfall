/** Stores, their caps and the Storehouse levels that set them (docs/design.md §3, §5). */
import { type Cost, type Realm, type Resource, RESOURCES } from './model.ts';

/** Store `k` after adding `amount`, stopped at its cap but never lowering a store already over it. */
export function addStore(realm: Realm, k: Resource, amount: number): number {
  const have = realm.stores[k];
  return Math.max(have, Math.min(storeCaps(realm)[k], have + amount));
}

interface StorehouseLevel {
  caps: Record<Resource, number>;
  safe: Record<Resource, number>;
  /** What it costs to reach this level from the one below. */
  cost: Cost;
}

/** Storehouse levels 0–3 (docs/design.md §5). */
export const STOREHOUSE: readonly StorehouseLevel[] = [
  {
    caps: { food: 200, wood: 200, iron: 50, gold: 150, weapons: 20 },
    safe: { food: 0, wood: 0, iron: 0, gold: 0, weapons: 0 },
    cost: {},
  },
  {
    caps: { food: 500, wood: 600, iron: 120, gold: 400, weapons: 60 },
    safe: { food: 50, wood: 60, iron: 12, gold: 40, weapons: 0 },
    cost: { wood: 60 },
  },
  {
    caps: { food: 1500, wood: 2000, iron: 400, gold: 1200, weapons: 200 },
    safe: { food: 200, wood: 250, iron: 50, gold: 150, weapons: 0 },
    cost: { wood: 200, iron: 30 },
  },
  {
    caps: { food: 5000, wood: 6000, iron: 1200, gold: 4000, weapons: 600 },
    safe: { food: 750, wood: 900, iron: 180, gold: 600, weapons: 0 },
    cost: { wood: 600, iron: 120, gold: 100 },
  },
];

/** Highest Storehouse level: far past any reachable one, and caps stay finite up to ~640. */
export const STOREHOUSE_MAX = 500;

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
