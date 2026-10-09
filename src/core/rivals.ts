/** Rivals: levels, power ceilings, growth, scouting and tribute (docs/design.md §7). */
import { chance, createRng, pick, type Rng } from './rng.ts';
import { chronicle } from './chronicle.ts';
import {
  type Realm,
  type Rival,
  RIVAL_LEVELS,
  type RivalLevel,
  type Trait,
  TRAITS,
} from './model.ts';
import { canAfford, pay } from './stores.ts';
import { TIER_INFO, TRAIT_INFO, traitLabel, traitModifiers } from './traits.ts';

interface RivalLevelInfo {
  name: string;
  /** Starting power = ring base × factor. */
  factor: number;
  /** Power ceiling = starting power × ceiling. */
  ceiling: number;
  /** Power gained per year, as a fraction, until the ceiling. */
  growth: number;
}

/** The level table of docs/design.md §7. */
export const RIVAL_LEVEL_INFO: Record<RivalLevel, RivalLevelInfo> = {
  weak: { name: 'Weak', factor: 0.5, ceiling: 2, growth: 0.02 },
  average: { name: 'Average', factor: 1, ceiling: 3, growth: 0.03 },
  strong: { name: 'Strong', factor: 2, ceiling: 4, growth: 0.04 },
  elite: { name: 'Elite', factor: 3, ceiling: 5, growth: 0.04 },
};

/** docs/design.md §7. */
export const RIVAL = {
  startingPowers: [20, 45, 90],
  startingLevels: ['weak', 'average', 'strong'],
  startingRings: [1, 1, 2],
  hostileChance: 0.6,
  /** Ring 1's base power; each ring's base is `ringScale` × the last. */
  ringBase: 45,
  ringScale: 1.5,
  /** Level odds by ring, in RIVAL_LEVELS order; the last row holds for every ring past it. */
  levelOdds: [
    [0.6, 0.4, 0, 0],
    [0.3, 0.5, 0.2, 0],
    [0.1, 0.4, 0.35, 0.15],
    [0, 0.25, 0.45, 0.3],
  ],
  /** Power stops growing here, far past any fight, so it never reaches Infinity and breaks the save. */
  maxPower: 1e300,
  /** Farthest ring; new rivals stop moving out here, so the save stays in bounds. */
  maxRing: 1000,
} as const;

/** `power` held at RIVAL.maxPower. */
function capPower(power: number): number {
  return Math.min(power, RIVAL.maxPower);
}

/** Rolls a level by `ring`'s odds (§7 Levels). */
export function rollRivalLevel(rng: Rng, ring: number): RivalLevel {
  const odds = RIVAL.levelOdds[Math.min(ring, RIVAL.levelOdds.length) - 1]!;
  let r = rng();
  // The odds sum to 1 up to float error; a roll past them all lands on the last level with odds.
  const i = odds.findIndex((p) => (r -= p) < 0);
  return RIVAL_LEVELS[i >= 0 ? i : odds.findLastIndex((p) => p > 0)]!;
}

/** Starting power of a `level` rival on `ring`: ring base × level factor (§7). */
export function ringPower(ring: number, level: RivalLevel): number {
  return capPower(RIVAL.ringBase * RIVAL.ringScale ** (ring - 1) * RIVAL_LEVEL_INFO[level].factor);
}

const NAME_HEADS = [
  'Ash',
  'Bram',
  'Cold',
  'Dun',
  'Elder',
  'Fen',
  'Pale',
  'Holl',
  'Iron',
  'Mar',
  'Raven',
  'Briar',
];

const NAME_TAILS = [
  'ford',
  'mere',
  'wick',
  'hold',
  'moor',
  'vale',
  'crag',
  'stead',
  'reach',
  'wood',
];

/** The traits a rival on `ring` can hold: every trait whose tier is unlocked there (§9). */
export function rivalTraits(ring: number): Trait[] {
  return TRAITS.filter((t) => TIER_INFO[TRAIT_INFO[t].tier].fromRing <= ring);
}

/** A realm name not in `taken`; once every pairing is used, a numbered one ("Fenmere 2"). */
function rivalName(rng: Rng, taken: ReadonlySet<string>): string {
  const all = NAME_HEADS.flatMap((h) => NAME_TAILS.map((t) => h + t));
  const free = all.filter((n) => !taken.has(n));
  if (free.length > 0) return pick(rng, free);
  const base = pick(rng, all);
  let k = 2;
  while (taken.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}

/**
 * A new, unscouted `level` rival of `power` on `ring` (§7), its ceiling set by
 * its level; its name differs from every name in `taken`, and its trait is one
 * of rivalTraits(ring), each equally likely.
 */
export function createRival(
  rng: Rng,
  level: RivalLevel,
  power: number,
  ring: number,
  taken: ReadonlySet<string>,
): Rival {
  return {
    name: rivalName(rng, taken),
    ring,
    level,
    trait: pick(rng, rivalTraits(ring)),
    power,
    ceiling: capPower(power * RIVAL_LEVEL_INFO[level].ceiling),
    hostile: chance(rng, RIVAL.hostileChance),
    scouted: false,
  };
}

/** A new rival on `ring`: its level rolled by the ring's odds, its power ringPower() (§7, §8). */
export function ringRival(rng: Rng, ring: number, taken: ReadonlySet<string>): Rival {
  const level = rollRivalLevel(rng, ring);
  return createRival(rng, level, ringPower(ring, level), ring, taken);
}

/**
 * The three starting rivals (§7), rolled from their own stream derived from
 * the run's seed, so the same seed always gives the same rivals.
 */
export function startingRivals(seed: number): Rival[] {
  const rng = createRng((seed ^ 0x52495641) >>> 0);
  const rivals: Rival[] = [];
  RIVAL.startingPowers.forEach((power, i) => {
    const taken = new Set(rivals.map((r) => r.name));
    const level = RIVAL.startingLevels[i]!;
    rivals.push(createRival(rng, level, power, RIVAL.startingRings[i]!, taken));
  });
  return rivals;
}

/** `rival` with power `power`, held at its ceiling. */
export function withPower(rival: Rival, power: number): Rival {
  return { ...rival, power: Math.min(power, rival.ceiling) };
}

/**
 * One year of rival growth (§7): each rival's power × (1 + its level's growth),
 * +2% more under Golden age (§9), held at its ceiling.
 */
export function growRivals(realm: Realm): Realm {
  const extra = traitModifiers(realm).rivalGrowth;
  return {
    ...realm,
    rivals: realm.rivals.map((r) =>
      withPower(r, r.power * (1 + RIVAL_LEVEL_INFO[r.level].growth + extra)),
    ),
  };
}

/** Gold prices of the rival actions (docs/design.md §7). */
export const RIVAL_ACTIONS = { scoutGold: 15, tributeGold: 30 } as const;

/** What the UI may show of a rival: level, trait and power only once it is scouted (§7). */
export type RivalView =
  | { name: string; hostile: boolean; scouted: false }
  | {
      name: string;
      hostile: boolean;
      scouted: true;
      level: RivalLevel;
      trait: Trait;
      power: number;
    };

/** A rival as the UI may see it; an unscouted rival's hidden stats are left out, not blanked. */
export function rivalView(rival: Rival): RivalView {
  const { name, hostile } = rival;
  if (!rival.scouted) return { name, hostile, scouted: false };
  return {
    name,
    hostile,
    scouted: true,
    level: rival.level,
    trait: rival.trait,
    power: rival.power,
  };
}

/** Returns the realm with rival `index` replaced by `change(rival)`. */
export function updateRival(realm: Realm, index: number, change: (r: Rival) => Rival): Realm {
  return { ...realm, rivals: realm.rivals.map((r, i) => (i === index ? change(r) : r)) };
}

/**
 * Scouts rival `index` for 15 gold, revealing its level, power and trait (§7).
 * Nothing changes if there is no such rival, it is already scouted, or gold is short.
 */
export function scout(realm: Realm, index: number): Realm {
  const rival = realm.rivals[index];
  const cost = { gold: RIVAL_ACTIONS.scoutGold };
  if (!rival || rival.scouted || !canAfford(realm, cost)) return realm;
  const next = updateRival(pay(realm, cost), index, (r) => ({ ...r, scouted: true }));
  const power = Math.round(rival.power);
  return chronicle(
    next,
    'rivals',
    `Scouted ${rival.name}: ${RIVAL_LEVEL_INFO[rival.level].name}, power ${power}, ${traitLabel(rival.trait)}.`,
  );
}

/**
 * Pays rival `index` 30 gold of tribute, putting a hostile rival at peace (§7).
 * Nothing changes if there is no such rival, it is already at peace, or gold is short.
 */
export function tribute(realm: Realm, index: number): Realm {
  const rival = realm.rivals[index];
  const cost = { gold: RIVAL_ACTIONS.tributeGold };
  if (!rival || !rival.hostile || !canAfford(realm, cost)) return realm;
  const next = updateRival(pay(realm, cost), index, (r) => ({ ...r, hostile: false }));
  return chronicle(
    next,
    'rivals',
    `Paid ${cost.gold} gold of tribute to ${rival.name}; now at peace.`,
  );
}
