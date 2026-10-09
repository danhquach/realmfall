import { createRng, pick, type Rng } from './rng.ts';
import { chronicle } from './chronicle.ts';
import {
  type Cost,
  type Modifiers,
  type OwnedTrait,
  type Realm,
  type Stat,
  STATS,
  type Tier,
  TIERS,
  type Trait,
  TRAITS,
} from './model.ts';
import { population } from './people.ts';
import { addStore, canAfford, pay } from './stores.ts';

interface TierInfo {
  name: string;
  /** Trader price range in gold, both ends inclusive. */
  price: readonly [number, number];
  sellGold: number;
  /** Chance a rolled trait lands on this tier. */
  odds: number;
  /** First ring whose rivals hold the tier. */
  fromRing: number;
}

/** The tier table of docs/design.md §9. */
export const TIER_INFO: Record<Tier, TierInfo> = {
  common: { name: 'Common', price: [150, 250], sellGold: 40, odds: 0.45, fromRing: 1 },
  fine: { name: 'Fine', price: [300, 500], sellGold: 75, odds: 0.3, fromRing: 2 },
  noble: { name: 'Noble', price: [600, 1000], sellGold: 150, odds: 0.15, fromRing: 3 },
  royal: { name: 'Royal', price: [1200, 1800], sellGold: 300, odds: 0.07, fromRing: 4 },
  mythic: { name: 'Mythic', price: [2500, 4000], sellGold: 600, odds: 0.03, fromRing: 6 },
};

interface TraitInfo {
  name: string;
  tier: Tier;
  /** Level-1 upside; each level past 1 adds +25% of it. */
  upside: Modifiers;
  /** Fixed at every level. Warrior creed's no-growth-at-peace downside lives in tick(). */
  downside: Modifiers;
}

/** The trait table of docs/design.md §9. */
export const TRAIT_INFO: Record<Trait, TraitInfo> = {
  fertileValleys: {
    name: 'Fertile valleys',
    tier: 'common',
    upside: { farmer: 0.5 },
    downside: { miner: -0.25 },
  },
  timberClans: {
    name: 'Timber clans',
    tier: 'common',
    upside: { woodcutter: 0.75 },
    downside: { farmer: -0.2 },
  },
  dwarvenSmiths: {
    name: 'Dwarven smiths',
    tier: 'fine',
    upside: { miner: 1 },
    downside: { woodcutter: -0.25 },
  },
  merchantGuilds: {
    name: 'Merchant guilds',
    tier: 'fine',
    upside: { tax: 0.5 },
    downside: { soldierUpkeep: 0.25 },
  },
  poisonArchers: {
    name: 'Poison archers',
    tier: 'noble',
    upside: { archers: 0.5 },
    downside: { spearmen: -0.2 },
  },
  horseLords: {
    name: 'Horse lords',
    tier: 'noble',
    upside: { cavalry: 0.5, march: -0.25 },
    downside: { cavalryUpkeep: 0.5 },
  },
  warriorCreed: { name: 'Warrior creed', tier: 'royal', upside: { army: 0.3 }, downside: {} },
  goldenAge: {
    name: 'Golden age',
    tier: 'mythic',
    upside: { farmer: 0.25, woodcutter: 0.25, miner: 0.25, tax: 0.25 },
    downside: { rivalGrowth: 0.02 },
  },
};

/** Slots, swap price and cooldown, level cap and upside per level (docs/design.md §9). */
export const TRAIT_RULES = {
  slots: 3,
  swapGoldPerPerson: 5,
  swapCooldownYears: 5,
  maxLevel: 5,
  upsidePerLevel: 0.25,
} as const;

/** A trait's name with its tier, so colour is never the only cue (§9). */
export function traitLabel(trait: Trait): string {
  const { name, tier } = TRAIT_INFO[trait];
  return `${name} (${TIER_INFO[tier].name})`;
}

function setOwned(realm: Realm, trait: Trait, owned: OwnedTrait): Realm {
  return { ...realm, traits: { ...realm.traits, [trait]: owned } };
}

/** Gains `trait` at level 1, or a duplicate of it if already owned (§9). */
export function gainTrait(realm: Realm, trait: Trait): Realm {
  const owned = realm.traits[trait];
  if (!owned) {
    const next = setOwned(realm, trait, { level: 1, duplicates: 0 });
    return chronicle(next, 'traits', `Gained the trait ${traitLabel(trait)}.`);
  }
  const next = setOwned(realm, trait, { ...owned, duplicates: owned.duplicates + 1 });
  return chronicle(next, 'traits', `Gained a duplicate of ${traitLabel(trait)}.`);
}

/** What swapping a slotted trait costs: 5 gold per person (§9). */
export function swapCost(realm: Realm): Cost {
  return { gold: TRAIT_RULES.swapGoldPerPerson * population(realm) };
}

/**
 * Puts owned `trait` into slot `slot` (§9). An empty slot fills for free. A
 * filled slot swaps for swapCost() and then can't swap again for 5 years.
 * Nothing changes if the slot doesn't exist, the trait isn't owned or is
 * already slotted, the slot is cooling down, or gold is short.
 */
export function slotTrait(realm: Realm, slot: number, trait: Trait): Realm {
  if (!Number.isInteger(slot) || slot < 0 || slot >= realm.slots.length) return realm;
  if (!realm.traits[trait] || realm.slots.includes(trait)) return realm;
  const old = realm.slots[slot]!;
  const slots = realm.slots.map((t, i) => (i === slot ? trait : t));
  if (old === null)
    return chronicle({ ...realm, slots }, 'traits', `Slotted ${traitLabel(trait)}.`);
  const cost = swapCost(realm);
  if (realm.year < realm.slotReadyYear[slot]! || !canAfford(realm, cost)) return realm;
  const slotReadyYear = realm.slotReadyYear.map((y, i) =>
    i === slot ? realm.year + TRAIT_RULES.swapCooldownYears : y,
  );
  const next = { ...pay(realm, cost), slots, slotReadyYear };
  return chronicle(
    next,
    'traits',
    `Swapped ${traitLabel(old)} for ${traitLabel(trait)} for ${cost.gold} gold.`,
  );
}

/** Duplicates needed to raise a trait from `level` to the next: 2ⁿ⁻¹ (§9). */
export function traitUpgradeCost(level: number): number {
  return 2 ** (level - 1);
}

/** Spends duplicates to raise `trait` one level, up to level 5; otherwise nothing changes (§9). */
export function upgradeTrait(realm: Realm, trait: Trait): Realm {
  const owned = realm.traits[trait];
  if (!owned || owned.level >= TRAIT_RULES.maxLevel) return realm;
  const cost = traitUpgradeCost(owned.level);
  if (owned.duplicates < cost) return realm;
  const level = owned.level + 1;
  const next = setOwned(realm, trait, { level, duplicates: owned.duplicates - cost });
  return chronicle(next, 'traits', `Raised ${traitLabel(trait)} to level ${level}.`);
}

/**
 * Sells one duplicate of `trait` for its tier's sell price; gold past the cap
 * is lost (§3, §9). Nothing changes if there is no duplicate.
 */
export function sellDuplicate(realm: Realm, trait: Trait): Realm {
  const owned = realm.traits[trait];
  if (!owned || owned.duplicates === 0) return realm;
  const gold = addStore(realm, 'gold', TIER_INFO[TRAIT_INFO[trait].tier].sellGold);
  const paid = gold - realm.stores.gold;
  const next = setOwned({ ...realm, stores: { ...realm.stores, gold } }, trait, {
    ...owned,
    duplicates: owned.duplicates - 1,
  });
  return chronicle(next, 'traits', `Sold a duplicate of ${traitLabel(trait)} for ${paid} gold.`);
}

/**
 * Sum of every slotted trait's modifiers per stat (§9): the upside scaled by
 * 1 + 0.25 × (level − 1), the downside as is. Unslotted traits add nothing.
 */
export function traitModifiers(realm: Realm): Record<Stat, number> {
  const sum = Object.fromEntries(STATS.map((s) => [s, 0])) as Record<Stat, number>;
  for (const trait of realm.slots) {
    if (trait === null) continue;
    const level = realm.traits[trait]?.level ?? 1;
    const { upside, downside } = TRAIT_INFO[trait];
    const by = 1 + TRAIT_RULES.upsidePerLevel * (level - 1);
    for (const s of STATS) sum[s] += (upside[s] ?? 0) * by + (downside[s] ?? 0);
  }
  return sum;
}

/** True while `trait` sits in a slot. */
export function isSlotted(realm: Realm, trait: Trait): boolean {
  return realm.slots.includes(trait);
}

/**
 * Rolls one trait (§9): a tier by its roll odds, then a trait of that tier,
 * each equally likely. It may be one already owned.
 */
export function rollTrait(rng: Rng): Trait {
  let r = rng();
  // The odds sum to 1 up to float error; a roll past them all lands on the last tier.
  const tier = TIERS.find((t) => (r -= TIER_INFO[t].odds) < 0) ?? TIERS[TIERS.length - 1]!;
  return pick(
    rng,
    TRAITS.filter((t) => TRAIT_INFO[t].tier === tier),
  );
}

/** Seed salts of the trait-source streams. */
const TRAIT_STREAMS = {
  milestone: 0x4d494c45,
  challenge: 0x4348414c,
  reward: 0x52574152,
  trader: 0x54524144,
} as const;

/**
 * The rng for roll `n` of a trait source, from its own stream derived from the
 * run's seed, so offline catch-up rolls the same traits as live play.
 */
export function traitRng(seed: number, stream: keyof typeof TRAIT_STREAMS, n: number): Rng {
  return createRng((seed ^ TRAIT_STREAMS[stream] ^ Math.imul(n, 0x9e3779b9)) >>> 0);
}
