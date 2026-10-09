/** Buildings, upgrades and the construction queue (docs/design.md §5). */
import { chronicle } from './chronicle.ts';
import { type Construction, type Cost, type Order, type Realm, RESOURCES } from './model.ts';
import { PEOPLE, population, shortfall } from './people.ts';
import { addStore, canAfford, pay, STOREHOUSE_MAX, storehouseLevel } from './stores.ts';

/** Top level of Huts, Markets and Forges (§5). */
export const UPGRADE_MAX = 5;

/** Each level past 1 adds this share of a Hut's, Market's or Forge's level-1 effect (§5). */
export const UPGRADE_STEP = 0.5;

/** The effect multiplier of a kind at `level`: 1 at level 1, +50% per level after. */
export function upgradeBonus(level: number): number {
  return 1 + UPGRADE_STEP * (level - 1);
}

/** A requirement (§5): a whole population, or a finished building at a level. */
export type Need = { people: number } | { building: Construction; level: number };

interface ConstructionInfo {
  name: string;
  /** Cost and build work of one, each × its growthⁿ for a level (§5). */
  cost: Cost;
  costGrowth: number;
  work: number;
  workGrowth: number;
  /** Most that can be built, or the top level. */
  max: number;
  /** Built once and then upgraded level by level. */
  levelled: boolean;
  needs: Need[];
}

/**
 * The building table of docs/design.md §5. The Storehouse's cost comes from its
 * level table instead (storehouseLevel()).
 *
 * TODO(#85 Scouting levels and facts): each Defence tower level allows one more
 * scout level; the tower can be built now but has no effect until then.
 */
export const CONSTRUCTION_INFO: Record<Construction, ConstructionInfo> = {
  hut: {
    name: 'Hut',
    cost: { wood: 25 },
    costGrowth: 1,
    work: 20,
    workGrowth: 1,
    max: Infinity,
    levelled: false,
    needs: [],
  },
  hutLevel: {
    name: 'Huts',
    // Level 2 costs 150 wood and 50 gold; each level after costs 2× the last.
    cost: { wood: 75, gold: 25 },
    costGrowth: 2,
    work: 30,
    workGrowth: 2,
    max: UPGRADE_MAX,
    levelled: true,
    needs: [{ building: 'hut', level: 1 }],
  },
  market: {
    name: 'Market',
    cost: { wood: 40, gold: 30 },
    costGrowth: 1,
    work: 40,
    workGrowth: 1,
    max: Infinity,
    levelled: false,
    needs: [{ building: 'storehouse', level: 1 }],
  },
  marketLevel: {
    name: 'Markets',
    cost: { wood: 100, gold: 75 },
    costGrowth: 2,
    work: 40,
    workGrowth: 2,
    max: UPGRADE_MAX,
    levelled: true,
    needs: [{ building: 'market', level: 1 }],
  },
  barracks: {
    name: 'Barracks',
    cost: { wood: 50, gold: 20 },
    costGrowth: 1,
    work: 40,
    workGrowth: 1,
    max: 1,
    levelled: false,
    needs: [{ people: 15 }],
  },
  forge: {
    name: 'Forge',
    cost: { wood: 60, iron: 20 },
    costGrowth: 1,
    work: 60,
    workGrowth: 1,
    max: Infinity,
    levelled: false,
    needs: [{ building: 'barracks', level: 1 }],
  },
  forgeLevel: {
    name: 'Forges',
    cost: { wood: 75, iron: 30 },
    costGrowth: 2,
    work: 40,
    workGrowth: 2,
    max: UPGRADE_MAX,
    levelled: true,
    needs: [{ building: 'forge', level: 1 }],
  },
  wall: {
    name: 'Wall',
    cost: { wood: 50, iron: 15 },
    costGrowth: 2,
    work: 40,
    workGrowth: 2,
    max: 5,
    levelled: true,
    needs: [{ building: 'barracks', level: 1 }],
  },
  tower: {
    name: 'Defence tower',
    cost: { wood: 40, gold: 20 },
    costGrowth: 2,
    work: 40,
    workGrowth: 2,
    max: 3,
    levelled: true,
    needs: [{ building: 'wall', level: 1 }],
  },
  storehouse: {
    name: 'Storehouse',
    cost: {},
    costGrowth: 1,
    work: 30,
    workGrowth: 2,
    max: STOREHOUSE_MAX,
    levelled: true,
    needs: [],
  },
};

/** Orders the construction queue holds at most (§5). */
export const QUEUE_MAX = 5;

/** Most Huts, Markets or Forges one order builds (§5). */
export const BUILD_MAX = 10;

/** Capital defence against raids per Wall level (§7). */
export const WALL_BONUS = 0.2;

/** How many of `c` are built, or its level. */
export function built(realm: Realm, c: Construction): number {
  return c === 'storehouse' ? realm.storehouse : realm.buildings[c];
}

/** How many of `c` the queue will build: the sum of its orders' counts. */
export function queued(realm: Realm, c: Construction): number {
  return realm.queue.reduce((sum, o) => (o.building === c ? sum + o.count : sum), 0);
}

/**
 * n for the next order of `c` (§5): built plus already queued. For a building
 * with levels that is the level being ordered, minus 1.
 */
function nextN(realm: Realm, c: Construction): number {
  return built(realm, c) + queued(realm, c);
}

/**
 * How many the next order of `c` builds when `count` are asked for: 1 for a
 * level, else `count` kept to BUILD_MAX; either way no more than is left below
 * its max. 0 when `count` is not a whole number of at least 1, or at the max.
 */
function orderCount(realm: Realm, c: Construction, count: number): number {
  if (!Number.isInteger(count) || count < 1) return 0;
  const { levelled, max } = CONSTRUCTION_INFO[c];
  const room = max - nextN(realm, c);
  return Math.max(0, Math.min(levelled ? 1 : count, BUILD_MAX, room));
}

/**
 * What the next order of `count` × `c` costs (§5): a level costs base × growthⁿ,
 * rounded up (the Storehouse by its table); anything else base × count.
 */
export function orderCost(realm: Realm, c: Construction, count = 1): Cost {
  const n = nextN(realm, c);
  if (c === 'storehouse') return storehouseLevel(n + 1).cost;
  const { cost: base, costGrowth } = CONSTRUCTION_INFO[c];
  const times = Math.max(1, orderCount(realm, c, count));
  const cost: Cost = {};
  for (const k of RESOURCES)
    if (base[k] !== undefined) cost[k] = Math.ceil(base[k] * costGrowth ** n) * times;
  return cost;
}

/** The build work of the next order of `count` × `c`, like orderCost() (§5). */
export function orderWork(realm: Realm, c: Construction, count = 1): number {
  const { work, workGrowth } = CONSTRUCTION_INFO[c];
  const times = Math.max(1, orderCount(realm, c, count));
  return Math.ceil(work * workGrowth ** nextN(realm, c)) * times;
}

/** True when `need` is met; buildings count only once finished (§5). */
function needMet(realm: Realm, need: Need): boolean {
  return 'people' in need
    ? population(realm) >= need.people
    : built(realm, need.building) >= need.level;
}

/** "15 people", "Barracks" or "Wall level 1", for "Needs: …" (§5). */
export function needText(need: Need): string {
  if ('people' in need) return `${need.people} people`;
  const { name, levelled } = CONSTRUCTION_INFO[need.building];
  return levelled ? `${name} level ${need.level}` : name;
}

/** The requirements of `c` not yet met, empty once it is unlocked. */
export function unmetNeeds(realm: Realm, c: Construction): Need[] {
  return CONSTRUCTION_INFO[c].needs.filter((n) => !needMet(realm, n));
}

/** True once `c` is built (or queued) as many times, or to as high a level, as it can be. */
export function atMax(realm: Realm, c: Construction): boolean {
  return nextN(realm, c) >= CONSTRUCTION_INFO[c].max;
}

/**
 * "a Hut", "3 Huts" or "Wall level 2": an order of `count` × `c`, or the one
 * that raises `c` to level `n`.
 */
function orderLabel(c: Construction, n: number, count = 1, article = 'a '): string {
  const { name, levelled } = CONSTRUCTION_INFO[c];
  if (levelled) return `${name} level ${n}`;
  return count > 1 ? `${count} ${name}s` : `${article}${name}`;
}

/**
 * True when an order of `count` × `c` would be taken now: queue room, room
 * below its max for all of them, unlocked and affordable.
 */
export function canOrder(realm: Realm, c: Construction, count = 1): boolean {
  const n = orderCount(realm, c, count);
  return (
    realm.queue.length < QUEUE_MAX &&
    n >= 1 &&
    (CONSTRUCTION_INFO[c].levelled || n === count) &&
    unmetNeeds(realm, c).length === 0 &&
    canAfford(realm, orderCost(realm, c, n))
  );
}

/**
 * Orders `count` × `c` as one queue order (§5): pays its cost and adds it to
 * the end of the queue with its cost and build work fixed. A level is always
 * one. Nothing changes if canOrder() is false.
 */
export function order(realm: Realm, c: Construction, count = 1): Realm {
  if (!canOrder(realm, c, count)) return realm;
  const n = orderCount(realm, c, count);
  const cost = orderCost(realm, c, n);
  const label = orderLabel(c, nextN(realm, c) + 1, n);
  const work = orderWork(realm, c, n);
  const next = {
    ...pay(realm, cost),
    queue: [...realm.queue, { building: c, count: n, cost, work, done: 0 }],
  };
  return chronicle(next, 'buildings', `Ordered ${label}.`);
}

/**
 * Cancels queue order `index` (§5) and refunds exactly what was paid; any refund
 * past a store's cap is lost. Cancelling a level also cancels every higher
 * level of the same building queued after it. Nothing changes if there is no
 * such order.
 */
export function cancelOrder(realm: Realm, index: number): Realm {
  const target = realm.queue[index];
  if (!Number.isInteger(index) || !target) return realm;
  const c = target.building;
  const cascade = CONSTRUCTION_INFO[c].levelled;
  const gone = (o: Order, i: number) => i === index || (cascade && i > index && o.building === c);
  let next: Realm = { ...realm, queue: realm.queue.filter((o, i) => !gone(o, i)) };
  // The k-th queued order of c makes built + k.
  let n = built(realm, c);
  realm.queue.forEach((o, i) => {
    if (o.building === c) n += o.count;
    if (!gone(o, i)) return;
    const stores = { ...next.stores };
    for (const k of RESOURCES) stores[k] = addStore(next, k, o.cost[k] ?? 0);
    const label = orderLabel(c, n, o.count);
    next = chronicle({ ...next, stores }, 'buildings', `Cancelled ${label}.`);
  });
  return next;
}

/** Build work done per second (§5): one per builder, × (1 − s) while starving (§4). */
export function buildRate(realm: Realm): number {
  return realm.jobs.builder * (1 - shortfall(realm));
}

/**
 * Seconds until each queued order is done at the current build rate, counting
 * the orders ahead of it; null while no work is being done (§5).
 */
export function timeLeft(realm: Realm): number[] | null {
  const rate = buildRate(realm);
  if (!(rate > 0)) return null;
  let ahead = 0;
  return realm.queue.map((o) => (ahead += o.work - o.done) / rate);
}

/** One queue row for the build panel (§5). */
export interface OrderView {
  /** "Hut", "3 Huts" or "Wall level 2". */
  label: string;
  done: number;
  work: number;
  /** Seconds until done at the current build rate, counting the orders ahead; null with no builders. */
  secondsLeft: number | null;
}

/** The queue as the build panel shows it: each order with its progress and time left (§5). */
export function queueView(realm: Realm): OrderView[] {
  const left = timeLeft(realm);
  const made: Partial<Record<Construction, number>> = {};
  return realm.queue.map((o, i) => {
    const n = (made[o.building] = (made[o.building] ?? built(realm, o.building)) + o.count);
    return {
      label: orderLabel(o.building, n, o.count, ''),
      done: o.done,
      work: o.work,
      secondsLeft: left?.[i] ?? null,
    };
  });
}

/** Finishes the first order: the building takes effect and is written to the Chronicle (§5). */
function finishOrder(realm: Realm): Realm {
  const { building: c, count } = realm.queue[0]!;
  const n = built(realm, c) + count;
  const queue = realm.queue.slice(1);
  if (c === 'storehouse')
    return chronicle(
      { ...realm, queue, storehouse: n },
      'buildings',
      `Raised the Storehouse to level ${n}.`,
    );
  const next = { ...realm, queue, buildings: { ...realm.buildings, [c]: n } };
  const { name, levelled } = CONSTRUCTION_INFO[c];
  const text = levelled
    ? `Raised ${c === 'wall' || c === 'tower' ? 'the ' : ''}${name} to level ${n}.`
    : `Built ${orderLabel(c, n, count)}.`;
  return chronicle(next, 'buildings', text);
}

/**
 * Puts `work` builder-seconds into the queue (§5): all of it goes to the first
 * order, and what is left once that one is done carries on to the next.
 */
export function construct(realm: Realm, work: number): Realm {
  let next = realm;
  while (work > 0 && next.queue.length > 0) {
    const first = next.queue[0]!;
    const need = first.work - first.done;
    // The epsilon keeps float noise in summed steps from leaving a sliver of work.
    if (work >= need - 1e-9) {
      next = finishOrder(next);
      work -= need;
    } else {
      next = { ...next, queue: [{ ...first, done: first.done + work }, ...next.queue.slice(1)] };
      work = 0;
    }
  }
  return next;
}

/** Housing (§4, §5): base + each Hut's housing at the Huts level (rounded down) + annexed. */
export function housingCap(realm: Realm): number {
  const { hut, hutLevel } = realm.buildings;
  const huts = Math.floor(hut * PEOPLE.hutHousing * upgradeBonus(hutLevel));
  return PEOPLE.baseHousing + huts + realm.annexedHousing;
}
