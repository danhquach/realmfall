/** Random events and the good events of time away (docs/design.md §10, §11). */
import { createRng, int, pick, type Rng } from './rng.ts';
import { chronicle } from './chronicle.ts';
import { type Realm, type Resource } from './model.ts';
import { loseOne, population } from './people.ts';
import { updateRival } from './rivals.ts';
import { addStore } from './stores.ts';

/** Event timing and amounts (docs/design.md §11). */
export const EVENT = {
  every: 25,
  harvestBase: 50,
  harvestPerPerson: 3,
  plagueDeaths: 2,
  plagueMinPopulation: 7,
  envoyGold: 40,
  veinIron: 15,
} as const;

export const EVENTS = ['harvest', 'plague', 'envoy', 'vein', 'changeOfHeart'] as const;

export type RandomEvent = (typeof EVENTS)[number];

/**
 * The rng for event number `n` (the one at n × 25 s), from its own stream
 * derived from the run's seed, so offline catch-up replays the same events.
 */
export function eventRng(seed: number, n: number): Rng {
  return createRng((seed ^ 0x45564e54 ^ Math.imul(n, 0x9e3779b9)) >>> 0);
}

/** The events that can happen now: Plague needs population > 6, Change of heart a rival (§11). */
export function possibleEvents(realm: Realm): RandomEvent[] {
  return EVENTS.filter((e) => {
    if (e === 'plague') return population(realm) >= EVENT.plagueMinPopulation;
    if (e === 'changeOfHeart') return realm.rivals.length > 0;
    return true;
  });
}

/** Adds `amount` to store `k` up to its cap and writes what was actually gained. */
function windfall(realm: Realm, k: Resource, amount: number, title: string): Realm {
  const value = addStore(realm, k, amount);
  const gained = Math.floor(value - realm.stores[k]);
  const next = { ...realm, stores: { ...realm.stores, [k]: value } };
  return chronicle(next, 'events', `${title}: +${gained} ${k}.`);
}

/** Applies `event` (§11). Gains past a store's cap are lost. */
export function applyEvent(realm: Realm, event: RandomEvent, rng: Rng): Realm {
  switch (event) {
    case 'harvest': {
      const food = EVENT.harvestBase + EVENT.harvestPerPerson * population(realm);
      return windfall(realm, 'food', food, 'Bountiful harvest');
    }
    case 'plague': {
      let next = realm;
      for (let i = 0; i < EVENT.plagueDeaths; i++) next = loseOne(next);
      return chronicle(next, 'events', `Plague: ${EVENT.plagueDeaths} people died.`);
    }
    case 'envoy':
      return windfall(realm, 'gold', EVENT.envoyGold, "Envoy's gifts");
    case 'vein':
      return windfall(realm, 'iron', EVENT.veinIron, 'Rich vein');
    case 'changeOfHeart': {
      const index = int(rng, 0, realm.rivals.length - 1);
      const rival = realm.rivals[index]!;
      const next = updateRival(realm, index, (r) => ({ ...r, hostile: !r.hostile }));
      const now = rival.hostile ? 'is now at peace' : 'turned hostile';
      return chronicle(next, 'rivals', `Change of heart: ${rival.name} ${now}.`);
    }
  }
}

/** One random event (§11), each possible one equally likely, written to the Chronicle. */
export function randomEvent(realm: Realm, rng: Rng): Realm {
  return applyEvent(realm, pick(rng, possibleEvents(realm)), rng);
}

/** The events that need no decision, so they still happen while the player is away (§10). */
export const GOOD_EVENTS = ['harvest', 'envoy', 'vein'] as const satisfies readonly RandomEvent[];

/** Game seconds of time away per good event (§10 Away time). */
export const AWAY_EVENT_EVERY = 3600;

/**
 * An absence being replayed (§10 Away time), by offline catch-up or a
 * background tab: the game time it began and the trader's restock year then.
 */
export interface Away {
  since: number;
  traderYear: number;
}

/** The absence that begins now. */
export function awayFrom(realm: Realm): Away {
  return { since: realm.time, traderYear: realm.traderYear };
}

/**
 * Whether event slot `at` fires while away: only the first slot after each
 * full hour away does, so there is at most one good event per hour (§10).
 */
export function awayEventDue(away: Away, at: number): boolean {
  const hours = Math.floor((at - away.since) / AWAY_EVENT_EVERY);
  return hours >= 1 && at - EVENT.every < away.since + hours * AWAY_EVENT_EVERY;
}
