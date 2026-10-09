/** The simulation's public face: createRealm(), tick() and every core module re-exported, so callers import from here. */
export * from './model.ts';
export * from './traits.ts';
export * from './goals.ts';
export * from './rivals.ts';
export * from './battle.ts';
export * from './events.ts';
export * from './chronicle.ts';
export * from './stores.ts';
export * from './buildings.ts';
export * from './army.ts';
export * from './people.ts';
export * from './fallen.ts';

import { pick } from './rng.ts';
import { FORGE, forged } from './army.ts';
import { RAID, raid, raidRng } from './battle.ts';
import { buildRate, construct, housingCap } from './buildings.ts';
import {
  applyEvent,
  type Away,
  awayEventDue,
  EVENT,
  eventRng,
  GOOD_EVENTS,
  randomEvent,
} from './events.ts';
import { isFallen, markFallen } from './fallen.ts';
import { CHALLENGE, traitSources } from './goals.ts';
import { type Realm, RESOURCES, YEAR_SECONDS } from './model.ts';
import { loseOne, PEOPLE, population, production, shortfall, workers } from './people.ts';
import { growRivals, startingRivals } from './rivals.ts';
import { storeCaps } from './stores.ts';
import { isSlotted } from './traits.ts';

/** The starting state (docs/design.md §3). */
export function createRealm(seed: number): Realm {
  return {
    seed: seed >>> 0,
    name: 'Hearthmoor',
    time: 0,
    year: 1,
    stores: { food: 80, wood: 40, iron: 10, gold: 40, weapons: 0 },
    idle: 3,
    jobs: { farmer: 4, woodcutter: 2, miner: 0, builder: 1 },
    growth: 0,
    hunger: 0,
    soldiers: 0,
    desertion: 0,
    buildings: {
      hut: 0,
      hutLevel: 1,
      market: 0,
      marketLevel: 1,
      barracks: 0,
      forge: 0,
      forgeLevel: 1,
      wall: 0,
      tower: 0,
    },
    storehouse: 0,
    queue: [],
    annexedHousing: 0,
    rivals: startingRivals(seed),
    traits: {},
    slots: [null, null, null],
    slotReadyYear: [1, 1, 1],
    battlesWon: 0,
    raidsRepelled: 0,
    milestones: [],
    offers: [],
    challenge: null,
    challengeYear: 1 + CHALLENGE.every,
    trader: [],
    traderYear: 0,
    chronicle: [],
  };
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
 * condition fails, so a freshly opened house waits a full 4 s. A slotted
 * Warrior creed also stops growth while no rival is hostile (§9). Rates are
 * fixed for the whole step, so keep `dt` small (the loop uses STEP).
 *
 * Years (§10): year n begins at (n − 1) × 8 s of game time. Every year passed
 * in the step, however large `dt` is, runs the yearly hooks once (rival growth, §7).
 *
 * Raids (§7): raid number n lands at n × 45 s of game time, rolled on
 * raidRng(seed, n). A step that crosses a raid is split there, so a big step
 * (offline catch-up) refills the stores between raids just as live play does.
 *
 * Events (§11): event number n lands at n × 25 s, rolled on eventRng(seed, n),
 * and splits the step the same way. When a raid and an event share a moment,
 * the raid comes first.
 *
 * Construction (§5): the queue gets buildRate() × dt of work, with the builders
 * and shortfall at the start of the step.
 *
 * Fallen (§4): once no one is left, the step ends there, the Chronicle gets
 * one "has fallen" line, and every later tick returns the realm unchanged.
 *
 * Away (§10): while `away` is set, the economy runs as above but what needs a
 * decision waits: no raids, only good events and at most one per hour away,
 * no challenge offers, an active challenge's deadline paused, and at most one
 * trader restock.
 */
export function tick(realm: Realm, dt: number, away: Away | null = null): Realm {
  // A fallen realm stands still: no clock, growth, raids or events (§4 Fallen realm).
  if (isFallen(realm)) return markFallen(realm);
  // An infinite step would split at raids forever; NaN would poison every store.
  if (!Number.isFinite(dt)) return realm;
  let next = realm;
  let left = dt;
  const until = (every: number) => (Math.floor(next.time / every) + 1) * every - next.time;
  for (;;) {
    const toNext = Math.min(until(RAID.every), until(EVENT.every));
    // `!(>)` also ends on NaN; toNext ≤ 0 only at float limits, where no split can help.
    if (!(left > toNext) || !(toNext > 0)) return markFallen(step(next, left, away));
    next = step(next, toNext, away);
    // The step the last person left in is the realm's last: the rest of `dt` is dropped.
    if (isFallen(next)) return markFallen(next);
    left -= toNext;
  }
}

/** A raid or event landing at game time `at`. */
interface Happening {
  at: number;
  run: (realm: Realm) => Realm;
}

/**
 * Every raid and event in (from, to], in time order; a raid before an event at
 * the same moment. While `away`, no raids and only the hourly good events (§10).
 */
function happenings(seed: number, from: number, to: number, away: Away | null): Happening[] {
  const list: Happening[] = [];
  const add = (every: number, run: (n: number, at: number) => Happening['run'] | null) => {
    for (let n = Math.floor(from / every) + 1; n <= Math.floor(to / every); n++) {
      const happen = run(n, n * every);
      if (happen) list.push({ at: n * every, run: happen });
    }
  };
  if (!away) add(RAID.every, (n) => (r) => raid(r, raidRng(seed, n)));
  add(EVENT.every, (n, at) => {
    if (!away) return (r) => randomEvent(r, eventRng(seed, n));
    if (!awayEventDue(away, at)) return null;
    return (r) => {
      const rng = eventRng(seed, n);
      return applyEvent(r, pick(rng, GOOD_EVENTS), rng);
    };
  });
  // Array.sort is stable, so raids stay ahead of events at the same moment.
  return list.sort((a, b) => a.at - b.at);
}

/** One stretch of tick() that ends on or before the next raid or event. */
function step(realm: Realm, dt: number, away: Away | null): Realm {
  const r = production(realm);
  const caps = storeCaps(realm);
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] = Math.min(caps[k], Math.max(0, stores[k] + r[k] * dt));
  const made = forged(realm, stores, dt);
  stores.iron -= made * FORGE.iron;
  stores.weapons += made;

  let idle = realm.idle;
  let growth = realm.growth + dt;
  const cap = housingCap(realm);
  const others = workers(realm) + realm.soldiers;
  // Warrior creed's downside (§9): no growth while at peace with every rival.
  const creedHalts = isSlotted(realm, 'warriorCreed') && !realm.rivals.some((r) => r.hostile);
  const canGrow = () => !creedHalts && stores.food > PEOPLE.growthMinFood && idle + others < cap;
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

  next = construct({ ...next, hunger, soldiers, desertion }, buildRate(realm) * dt);
  // Years, raids and events run in time order, so each meets the rivals and year of its moment.
  // TODO(#35): unpaid tribute must not end the peace while away (§10 Away time).
  const toYear = (year: number) => {
    while (next.year < year) {
      const c = next.challenge;
      // Away, an active challenge's deadline moves with the year, so its years left stay put (§10).
      const challenge = away && c ? { ...c, deadline: c.deadline + 1 } : c;
      next = traitSources({ ...growRivals(next), year: next.year + 1, challenge }, away);
    }
  };
  for (const h of happenings(next.seed, realm.time, next.time, away)) {
    toYear(1 + Math.floor(h.at / YEAR_SECONDS));
    next = h.run(next);
  }
  toYear(1 + Math.floor(next.time / YEAR_SECONDS));
  return traitSources(next, away);
}
