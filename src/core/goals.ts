/** What the realm works towards: milestones, challenges, offers and the trader (docs/design.md §9). */
import { int, pick, type Rng } from './rng.ts';
import { raidGraceOver } from './battle.ts';
import { atMax, built, CONSTRUCTION_INFO, type Need, queued, unmetNeeds } from './buildings.ts';
import { chronicle } from './chronicle.ts';
import { type Away } from './events.ts';
import {
  type ChallengeKind,
  CHALLENGES,
  CONSTRUCTIONS,
  type Milestone,
  MILESTONES,
  OFFER_CHOICES,
  type OfferSource,
  type Realm,
  UPGRADES,
} from './model.ts';
import { population } from './people.ts';
import { canAfford, pay, storeCaps } from './stores.ts';
import { gainTrait, rollTrait, TIER_INFO, TRAIT_INFO, traitLabel, traitRng } from './traits.ts';

/** Pending offers kept; past this the oldest is dropped, so an idle run can't pile them up. */
export const OFFER_MAX = 10;

/** A milestone's goal text and the count that must reach `target`. */
export interface MilestoneInfo {
  goal: string;
  target: number;
  count: (r: Realm) => number;
  reached: (r: Realm) => boolean;
}

export function milestone(
  goal: string,
  target: number,
  count: (r: Realm) => number,
): MilestoneInfo {
  return { goal, target, count, reached: (r) => count(r) >= target };
}

/**
 * What each milestone asks (§9).
 *
 * TODO(#27 Garrisons and claiming): add "hold 5 sites" once sites exist,
 * appended last so the other milestones keep their rng streams.
 */
export const MILESTONE_INFO: Record<Milestone, MilestoneInfo> = {
  people: milestone('50 people', 50, population),
  battles: milestone('win 10 battles', 10, (r) => r.battlesWon),
  storehouse: milestone('Storehouse level 3', 3, (r) => r.storehouse),
  raids: milestone('repel 5 raids', 5, (r) => r.raidsRepelled),
};

/** Challenge timing and goals (§9). */
export const CHALLENGE = {
  every: 15,
  food: 500,
  foodYears: 3,
  raidYears: 6,
} as const;

/**
 * What each challenge asks and its deadline in years (§9).
 *
 * TODO(#27 Garrisons and claiming): add "claim a site in 4 years" once sites exist.
 */
export const CHALLENGE_INFO: Record<ChallengeKind, { goal: string; years: number }> = {
  food: { goal: `stockpile ${CHALLENGE.food} food`, years: CHALLENGE.foodYears },
  raid: { goal: 'repel the next raid', years: CHALLENGE.raidYears },
};

/** "1 year" or "n years". */
function years(n: number): string {
  return `${n} ${n === 1 ? 'year' : 'years'}`;
}

/**
 * The challenge line shown in the Traits and Goals panels (§9): the active
 * challenge with its progress and years left, or when the next one comes.
 */
export function challengeText(realm: Realm): string {
  const c = realm.challenge;
  if (!c) {
    return realm.year < realm.challengeYear
      ? `None active. The next comes in year ${realm.challengeYear}.`
      : `None active. One comes once you can store ${CHALLENGE.food} food but hold less, or a rival is hostile and raids have begun.`;
  }
  const goal = CHALLENGE_INFO[c.kind].goal;
  const food = Math.min(Math.max(Math.floor(realm.stores.food), 0), CHALLENGE.food);
  const progress = c.kind === 'food' ? `${food} / ${CHALLENGE.food} food, ` : '';
  const left = years(Math.max(c.deadline - realm.year, 0));
  return (
    `${goal[0]!.toUpperCase()}${goal.slice(1)} by year ${c.deadline}: ` +
    `${progress}${left} left. Failing costs nothing.`
  );
}

/** One row of the Goals panel: a milestone and how close the realm is to it. */
export interface MilestoneProgress {
  milestone: Milestone;
  goal: string;
  count: number;
  target: number;
  reached: boolean;
}

/**
 * Every milestone with its progress (§9). One already paid out stays reached
 * even if its count later drops; an open one's count is capped at its target.
 */
export function milestoneProgress(realm: Realm): MilestoneProgress[] {
  return MILESTONES.map((m) => {
    const { goal, target, count } = MILESTONE_INFO[m];
    const n = Math.min(Math.max(Math.floor(count(realm)), 0), target);
    return { milestone: m, goal, count: n, target, reached: realm.milestones.includes(m) };
  });
}

/**
 * "reach 15 people", "build the Barracks" or "raise the Wall to level 1"; once
 * the building is queued, "finish the Barracks" or "finish Wall level 1".
 */
function needGoal(realm: Realm, need: Need): string {
  if ('people' in need) return `reach ${need.people} people`;
  const { name, levelled } = CONSTRUCTION_INFO[need.building];
  const ordered = built(realm, need.building) + queued(realm, need.building) >= need.level;
  if (ordered) return levelled ? `finish ${name} level ${need.level}` : `finish the ${name}`;
  return levelled ? `raise the ${name} to level ${need.level}` : `build the ${name}`;
}

/**
 * The "Next" hint in the Goals panel (§9): the first locked building's first
 * unmet requirement, in build-list order (upgrades left out); then the first milestone not yet
 * reached, with its progress; once all are reached, says so.
 */
export function nextGoal(realm: Realm): string {
  for (const c of CONSTRUCTIONS) {
    // An upgrade only waits for its own building, which the build list already shows.
    if (UPGRADES.some((u) => u === c)) continue;
    const [need] = unmetNeeds(realm, c);
    // A building already at its max stays built even if its requirement is lost (§5).
    if (need && !atMax(realm, c))
      return `Next: ${needGoal(realm, need)} to unlock the ${CONSTRUCTION_INFO[c].name}.`;
  }
  const open = milestoneProgress(realm).find((p) => !p.reached);
  return open ? `Next: ${open.goal} (${open.count} / ${open.target}).` : 'Every milestone reached.';
}

/** Trader restock interval and stock size (§9). */
export const TRADER = { every: 10, stock: 3 } as const;

/** "A", "A or B", "A, B or C". */
function orList(items: string[], last = 'or'): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`;
}

/** Adds an offer of rolled traits from `source`, dropping the oldest past OFFER_MAX. */
function offer(realm: Realm, source: OfferSource, rng: Rng, why: string): Realm {
  const choices = Array.from({ length: OFFER_CHOICES[source] }, () => rollTrait(rng));
  const offers = [...realm.offers, { source, choices }].slice(-OFFER_MAX);
  const text = `${why} Pick a trait: ${orList(choices.map(traitLabel))}.`;
  return chronicle({ ...realm, offers }, 'traits', text);
}

/**
 * Takes choice `choice` of pending offer `index` (§9): gains that trait, or a
 * duplicate if it is owned, and closes the offer. Nothing changes if there is
 * no such offer or choice.
 */
export function pickOffer(realm: Realm, index: number, choice: number): Realm {
  const trait = realm.offers[index]?.choices[choice];
  if (!Number.isInteger(index) || !Number.isInteger(choice) || trait === undefined) return realm;
  const offers = realm.offers.filter((_, i) => i !== index);
  const source = realm.offers[index]!.source;
  const next = chronicle(
    { ...realm, offers },
    'traits',
    `Picked ${traitLabel(trait)} from a ${source} offer.`,
  );
  return gainTrait(next, trait);
}

/**
 * The challenges that can be offered now: food needs a food cap of 500 and
 * less than 500 in store (or it would be met at once), a raid a hostile rival
 * and the raid grace period (§7) over, or no raid would come to repel.
 */
export function possibleChallenges(realm: Realm): ChallengeKind[] {
  return CHALLENGES.filter((c) => {
    if (c === 'food')
      return storeCaps(realm).food >= CHALLENGE.food && realm.stores.food < CHALLENGE.food;
    return raidGraceOver(realm) && realm.rivals.some((r) => r.hostile);
  });
}

/** Ends the active challenge; a met one offers 1 of 2 rolled traits, a failed one costs nothing. */
export function endChallenge(realm: Realm, met: boolean): Realm {
  const goal = CHALLENGE_INFO[realm.challenge!.kind].goal;
  const next = { ...realm, challenge: null, challengeYear: realm.year + CHALLENGE.every };
  if (!met) return chronicle(next, 'traits', `Challenge failed: ${goal}. No penalty.`);
  return offer(
    next,
    'challenge',
    traitRng(realm.seed, 'reward', realm.year),
    `Challenge met: ${goal}.`,
  );
}

/** Restocks the trader with 3 rolled traits, each priced within its tier's range (§9). */
function restock(realm: Realm): Realm {
  const rng = traitRng(realm.seed, 'trader', realm.year);
  const trader = Array.from({ length: TRADER.stock }, () => {
    const trait = rollTrait(rng);
    const [min, max] = TIER_INFO[TRAIT_INFO[trait].tier].price;
    return { trait, price: int(rng, min, max) };
  });
  const wares = trader.map((t) => `${traitLabel(t.trait)} for ${t.price} gold`);
  return chronicle(
    { ...realm, trader, traderYear: realm.year },
    'traits',
    `The trader offers ${orList(wares, 'and')}.`,
  );
}

/**
 * Buys item `index` of the trader's stock at its price (§9). Nothing changes
 * if there is no such item, gold is short, or the price is above the gold cap.
 */
export function buyTrait(realm: Realm, index: number): Realm {
  const item = realm.trader[index];
  if (!Number.isInteger(index) || !item) return realm;
  const cost = { gold: item.price };
  if (item.price > storeCaps(realm).gold || !canAfford(realm, cost)) return realm;
  const trader = realm.trader.filter((_, i) => i !== index);
  const next = chronicle(
    { ...pay(realm, cost), trader },
    'traits',
    `Bought ${traitLabel(item.trait)} from the trader for ${item.price} gold.`,
  );
  return gainTrait(next, item.trait);
}

/**
 * Runs the trait sources that trigger on the realm's state (§9): pays out each
 * newly reached milestone once, ends the active challenge when met or at its
 * deadline, offers a new one when none is active and its year has come, and
 * opens or restocks the trader. Every roll is on a stream keyed by the
 * milestone or the year, so the same seed always rolls the same traits.
 *
 * While `away` (§10 Away time), challenges wait for the player: none is
 * offered, met or failed (the deadline moves on with the years, see step()),
 * and the trader restocks at most once.
 */
export function traitSources(realm: Realm, away: Away | null): Realm {
  let next = realm;
  MILESTONES.forEach((m, i) => {
    if (next.milestones.includes(m) || !MILESTONE_INFO[m].reached(next)) return;
    next = { ...next, milestones: [...next.milestones, m] };
    const why = `Milestone reached: ${MILESTONE_INFO[m].goal}.`;
    next = offer(next, 'milestone', traitRng(next.seed, 'milestone', i), why);
  });
  const active = next.challenge;
  // Away, challenges wait for the player: neither offered, met nor failed.
  if (!away) {
    if (active?.kind === 'food' && next.stores.food >= CHALLENGE.food) {
      next = endChallenge(next, true);
    } else if (active && next.year >= active.deadline) {
      next = endChallenge(next, false);
    } else if (!active && next.year >= next.challengeYear) {
      const kinds = possibleChallenges(next);
      if (kinds.length > 0) {
        const kind = pick(traitRng(next.seed, 'challenge', next.year), kinds);
        const { goal, years } = CHALLENGE_INFO[kind];
        const deadline = next.year + years;
        next = chronicle(
          { ...next, challenge: { kind, deadline } },
          'traits',
          `Challenge: ${goal} by year ${deadline}.`,
        );
      }
    }
  }
  const restockDue = next.traderYear === 0 || next.year >= next.traderYear + TRADER.every;
  const restocked = away !== null && next.traderYear !== away.traderYear;
  if (next.buildings.market > 0 && restockDue && !restocked) next = restock(next);
  return next;
}
