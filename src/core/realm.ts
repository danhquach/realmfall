import { chance, createRng, int, pick, type Rng } from './rng.ts';

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
  'fertileValleys',
  'timberClans',
  'dwarvenSmiths',
  'merchantGuilds',
  'poisonArchers',
  'horseLords',
  'warriorCreed',
  'goldenAge',
] as const;
export type Trait = (typeof TRAITS)[number];

export const TIERS = ['common', 'fine', 'noble', 'royal', 'mythic'] as const;
export type Tier = (typeof TIERS)[number];

/** Sell price of a duplicate and the first ring whose rivals hold the tier (§9). */
export const TIER_INFO: Record<Tier, { name: string; sellGold: number; fromRing: number }> = {
  common: { name: 'Common', sellGold: 40, fromRing: 1 },
  fine: { name: 'Fine', sellGold: 75, fromRing: 2 },
  noble: { name: 'Noble', sellGold: 150, fromRing: 3 },
  royal: { name: 'Royal', sellGold: 300, fromRing: 4 },
  mythic: { name: 'Mythic', sellGold: 600, fromRing: 6 },
};

/**
 * What a slotted trait can change, each as an added fraction (+0.5 is +50%):
 * job output, tax, upkeep, unit and army power, march time and rival growth per year.
 */
export const STATS = [
  'farmer',
  'woodcutter',
  'miner',
  'tax',
  'soldierUpkeep',
  'cavalryUpkeep',
  'spearmen',
  'archers',
  'cavalry',
  'army',
  'march',
  'rivalGrowth',
] as const;
export type Stat = (typeof STATS)[number];
export type Modifiers = Partial<Record<Stat, number>>;

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

/** A trait the realm owns: its level (1–5) and spare duplicates. */
export interface OwnedTrait {
  level: number;
  duplicates: number;
}

/** A rival kingdom, known only by its place name (docs/design.md §7). */
export interface Rival {
  name: string;
  /** Map ring it sits on, from 1; sets which trait tiers it can hold (§9). */
  ring: number;
  trait: Trait;
  power: number;
  hostile: boolean;
  scouted: boolean;
}

/** What a Chronicle line is about; the panel filters by it (docs/design.md §12). */
export const CHRONICLE_KINDS = [
  'events',
  'raids',
  'battles',
  'rivals',
  'buildings',
  'traits',
] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];

/** One Chronicle line, tagged with the year it happened and its kind (docs/design.md §12). */
export interface ChronicleEntry {
  year: number;
  kind: ChronicleKind;
  text: string;
}

export interface Realm {
  /** The run's seed: every random roll in the run derives from it. */
  seed: number;
  /** The player's realm, shown in the header. */
  name: string;
  /** Game seconds elapsed since the run began. */
  time: number;
  year: number;
  stores: Record<Resource, number>;
  idle: number;
  jobs: Record<Job, number>;
  /** Seconds banked toward the next peasant (docs/design.md §4). */
  growth: number;
  /** Hunger built up while food is at 0; each 4 points, one person leaves (docs/design.md §4). */
  hunger: number;
  soldiers: number;
  /** Seconds banked toward the next deserter while gold is at 0 (docs/design.md §6). */
  desertion: number;
  buildings: Record<Building, number>;
  /** Storehouse level, from 0 (docs/design.md §5). */
  storehouse: number;
  /** Housing gained from annexed rivals, +10 each (docs/design.md §7). */
  annexedHousing: number;
  rivals: Rival[];
  /** Every trait owned; only slotted ones take effect (§9). */
  traits: Partial<Record<Trait, OwnedTrait>>;
  /** The trait slots, null while empty. */
  slots: (Trait | null)[];
  /** Per slot, the first year it can be swapped again. */
  slotReadyYear: number[];
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

/** Game seconds per year (docs/design.md §10). */
export const YEAR_SECONDS = 8;

/** The starting state (docs/design.md §3). */
export function createRealm(seed: number): Realm {
  return {
    seed: seed >>> 0,
    name: 'Hearthmoor',
    time: 0,
    year: 1,
    stores: { food: 80, wood: 40, iron: 10, gold: 40 },
    idle: 4,
    jobs: { farmer: 4, woodcutter: 2, miner: 0 },
    growth: 0,
    hunger: 0,
    soldiers: 0,
    desertion: 0,
    buildings: { hut: 0, market: 0, forge: 0 },
    storehouse: 0,
    annexedHousing: 0,
    rivals: startingRivals(seed),
    traits: {},
    slots: [null, null, null],
    slotReadyYear: [1, 1, 1],
    chronicle: [],
  };
}

/** docs/design.md §7. */
export const RIVAL = {
  startingPowers: [20, 45, 90],
  startingRings: [1, 1, 2],
  hostileChance: 0.6,
  growthPerYear: 0.04,
} as const;

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
 * A new, unscouted rival of `power` on `ring` (§7); its name differs from every
 * name in `taken`, and its trait is one of rivalTraits(ring), each equally likely.
 */
export function createRival(
  rng: Rng,
  power: number,
  ring: number,
  taken: ReadonlySet<string>,
): Rival {
  return {
    name: rivalName(rng, taken),
    ring,
    trait: pick(rng, rivalTraits(ring)),
    power,
    hostile: chance(rng, RIVAL.hostileChance),
    scouted: false,
  };
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
    rivals.push(createRival(rng, power, RIVAL.startingRings[i]!, taken));
  });
  return rivals;
}

/** One year of rival growth: every rival's power × 1.04, or × 1.06 under Golden age (§7, §9). */
export function growRivals(realm: Realm): Realm {
  const by = 1 + RIVAL.growthPerYear + traitModifiers(realm).rivalGrowth;
  return { ...realm, rivals: realm.rivals.map((r) => ({ ...r, power: r.power * by })) };
}

/** Gold prices of the rival actions (docs/design.md §7). */
export const RIVAL_ACTIONS = { scoutGold: 15, tributeGold: 30 } as const;

/** What the UI may show of a rival: trait and power only once it is scouted (§7). */
export type RivalView =
  | { name: string; hostile: boolean; scouted: false }
  | { name: string; hostile: boolean; scouted: true; trait: Trait; power: number };

/** A rival as the UI may see it; an unscouted rival's hidden stats are left out, not blanked. */
export function rivalView(rival: Rival): RivalView {
  const { name, hostile } = rival;
  if (!rival.scouted) return { name, hostile, scouted: false };
  return {
    name,
    hostile,
    scouted: true,
    trait: rival.trait,
    power: rival.power,
  };
}

/** Returns the realm with rival `index` replaced by `change(rival)`. */
function updateRival(realm: Realm, index: number, change: (r: Rival) => Rival): Realm {
  return { ...realm, rivals: realm.rivals.map((r, i) => (i === index ? change(r) : r)) };
}

/**
 * Scouts rival `index` for 15 gold, revealing its power and trait (§7).
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
    `Scouted ${rival.name}: power ${power}, ${traitLabel(rival.trait)}.`,
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

/** Battle and annexation numbers (docs/design.md §7). */
export const BATTLE = {
  winLossBase: 0.1,
  winLossRisk: 0.3,
  defeatLoss: 0.5,
  defeatRivalGrowth: 0.1,
  annexHousing: 10,
  annexPeoplePer: 8,
  nextRivalScale: 1.5,
} as const;

/**
 * Win chance P² / (P² + E²) (§7), written as 1 / (1 + (E/P)²) so huge powers
 * don't overflow. No army never wins; a powerless defender always loses.
 */
export function winChance(p: number, e: number): number {
  if (!(p > 0)) return 0;
  if (!(e > 0)) return 1;
  return 1 / (1 + (e / p) ** 2);
}

/**
 * Sends the field army against rival `index`, rolling the win chance on `rng` (§7).
 * Win: lose ⌈soldiers × (0.1 + 0.3 × (1 − chance))⌉ soldiers and annex the
 * rival: +10 housing, +⌊E / 8⌋ idle people, +E gold (up to the cap) and its
 * trait; a new rival appears at 1.5× the strongest rival's power.
 * Loss: lose ⌈50%⌉ of soldiers; the rival gains +10% power and turns hostile.
 * Nothing changes if there is no such rival or no soldiers.
 */
export function attack(realm: Realm, index: number, rng: Rng): Realm {
  const rival = realm.rivals[index];
  if (!rival || realm.soldiers === 0) return realm;
  const odds = winChance(armyPower(realm), rival.power);
  if (!chance(rng, odds)) {
    const lost = Math.ceil(realm.soldiers * BATTLE.defeatLoss);
    const next = updateRival({ ...realm, soldiers: realm.soldiers - lost }, index, (r) => ({
      ...r,
      power: r.power * (1 + BATTLE.defeatRivalGrowth),
      hostile: true,
    }));
    return chronicle(next, 'battles', `Lost a battle against ${rival.name}: ${fell(lost)}.`);
  }
  const share = BATTLE.winLossBase + BATTLE.winLossRisk * (1 - odds);
  // The epsilon keeps float noise from rounding an exact whole loss up by one.
  const lost = Math.min(realm.soldiers, Math.ceil(realm.soldiers * share - 1e-9));
  const strongest = Math.max(...realm.rivals.map((r) => r.power));
  const rest = realm.rivals.filter((_, i) => i !== index);
  const taken = new Set([rival.name, ...rest.map((r) => r.name)]);
  const ring = Math.max(...realm.rivals.map((r) => r.ring)) + 1;
  const fresh = createRival(rng, strongest * BATTLE.nextRivalScale, ring, taken);
  const annexed: Realm = {
    ...realm,
    soldiers: realm.soldiers - lost,
    idle: realm.idle + Math.floor(rival.power / BATTLE.annexPeoplePer),
    annexedHousing: realm.annexedHousing + BATTLE.annexHousing,
    stores: { ...realm.stores, gold: addStore(realm, 'gold', rival.power) },
    rivals: [...rest, fresh],
  };
  const won = chronicle(
    annexed,
    'battles',
    `Conquered ${rival.name}: ${fell(lost)}; ${fresh.name} appears beyond it.`,
  );
  return gainTrait(won, rival.trait);
}

/** Raid timing, strength range and loss (docs/design.md §7). */
export const RAID = {
  every: 45,
  minStrength: 0.4,
  maxStrength: 0.8,
  loss: 0.25,
} as const;

/** The stores a raid on the capital takes from (§7). */
const RAIDED = ['food', 'wood'] as const;

/**
 * The rng for raid number `n` (the one at n × 45 s), from its own stream
 * derived from the run's seed, so offline catch-up replays the same raids.
 */
export function raidRng(seed: number, n: number): Rng {
  return createRng((seed ^ 0x52414944 ^ Math.imul(n, 0x9e3779b9)) >>> 0);
}

/**
 * One raid on the capital (§7): a random hostile rival attacks with strength
 * E × (0.4–0.8). If field army power ≥ strength it is repelled; otherwise the
 * realm loses 25% of the food and wood above the Storehouse's safe amount.
 * Nothing happens while no rival is hostile.
 */
export function raid(realm: Realm, rng: Rng): Realm {
  const hostile = realm.rivals.filter((r) => r.hostile);
  if (hostile.length === 0) return realm;
  const rival = pick(rng, hostile);
  const strength = rival.power * (RAID.minStrength + (RAID.maxStrength - RAID.minStrength) * rng());
  if (armyPower(realm) >= strength) {
    return chronicle(realm, 'raids', `Repelled a raid from ${rival.name}.`);
  }
  const safe = safeAmounts(realm);
  const stores = { ...realm.stores };
  for (const k of RAIDED) stores[k] -= Math.max(0, stores[k] - safe[k]) * RAID.loss;
  const lost = RAIDED.map((k) => Math.floor(realm.stores[k] - stores[k]));
  const text = lost.some((n) => n > 0)
    ? `${rival.name} raided the capital: lost ${lost[0]} food and ${lost[1]} wood.`
    : `${rival.name} raided the capital but found nothing to take.`;
  return chronicle({ ...realm, stores }, 'raids', text);
}

/** Store `k` after adding `amount`, stopped at its cap but never lowering a store already over it. */
function addStore(realm: Realm, k: Resource, amount: number): number {
  const have = realm.stores[k];
  return Math.max(have, Math.min(storeCaps(realm)[k], have + amount));
}

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

/** A trait's name with its tier, so colour is never the only cue (§9). */
export function traitLabel(trait: Trait): string {
  const { name, tier } = TRAIT_INFO[trait];
  return `${name} (${TIER_INFO[tier].name})`;
}

/** "1 soldier fell" or "n soldiers fell", for battle lines. */
function fell(n: number): string {
  return `${n} ${n === 1 ? 'soldier' : 'soldiers'} fell`;
}

/** The Chronicle keeps only this many of its latest lines (§12). */
export const CHRONICLE_MAX = 200;

/**
 * Adds a `kind` Chronicle line dated to the current year, dropping the oldest past
 * CHRONICLE_MAX (§12).
 *
 * TODO(#27 Garrisons and claiming, #32 Rival expansion and site raids): write
 * "sites claimed and lost" lines (§8, §12) through here once sites exist.
 */
function chronicle(realm: Realm, kind: ChronicleKind, text: string): Realm {
  const entries = [...realm.chronicle, { year: realm.year, kind, text }];
  return { ...realm, chronicle: entries.slice(-CHRONICLE_MAX) };
}

/** The lines of the `shown` kinds, newest first. Hidden lines stay in the Chronicle (§12). */
export function chronicleView(
  chronicle: readonly ChronicleEntry[],
  shown: ReadonlySet<ChronicleKind>,
): ChronicleEntry[] {
  return chronicle.filter((e) => shown.has(e.kind)).reverse();
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

/** An amount of each store; resources left out cost nothing. */
export type Cost = Partial<Record<Resource, number>>;

interface StorehouseLevel {
  caps: Record<Resource, number>;
  safe: Record<Resource, number>;
  /** What it costs to reach this level from the one below. */
  cost: Cost;
}

/** Storehouse levels 0–3 (docs/design.md §5). */
export const STOREHOUSE: readonly StorehouseLevel[] = [
  {
    caps: { food: 200, wood: 200, iron: 50, gold: 150 },
    safe: { food: 0, wood: 0, iron: 0, gold: 0 },
    cost: {},
  },
  {
    caps: { food: 500, wood: 600, iron: 120, gold: 400 },
    safe: { food: 50, wood: 60, iron: 12, gold: 40 },
    cost: { wood: 60 },
  },
  {
    caps: { food: 1500, wood: 2000, iron: 400, gold: 1200 },
    safe: { food: 200, wood: 250, iron: 50, gold: 150 },
    cost: { wood: 200, iron: 30 },
  },
  {
    caps: { food: 5000, wood: 6000, iron: 1200, gold: 4000 },
    safe: { food: 750, wood: 900, iron: 180, gold: 600 },
    cost: { wood: 600, iron: 120, gold: 100 },
  },
];

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

/** What the next Storehouse level costs. */
export function upgradeCost(realm: Realm): Cost {
  return storehouseLevel(realm.storehouse + 1).cost;
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

/** Raises the Storehouse one level if its cost can be paid; otherwise nothing changes. */
export function upgradeStorehouse(realm: Realm): Realm {
  const cost = upgradeCost(realm);
  if (!canAfford(realm, cost)) return realm;
  const storehouse = realm.storehouse + 1;
  return chronicle(
    { ...pay(realm, cost), storehouse },
    'buildings',
    `Raised the Storehouse to level ${storehouse}.`,
  );
}

/** Base cost and growth per building owned (docs/design.md §5). */
export const BUILDING_COSTS: Record<Building, { base: Cost; growth: number }> = {
  hut: { base: { wood: 25 }, growth: 1.3 },
  market: { base: { wood: 40, gold: 30 }, growth: 1.5 },
  forge: { base: { wood: 60, iron: 20 }, growth: 2 },
};

/** Army power bonus per Forge (§6: power × (1 + 0.5 × forges)). */
export const FORGE_BONUS = 0.5;

/** What the next `building` costs: base × growthⁿ for n already built, rounded up. */
export function buildingCost(realm: Realm, building: Building): Cost {
  const { base, growth } = BUILDING_COSTS[building];
  const by = growth ** realm.buildings[building];
  const cost: Cost = {};
  for (const k of RESOURCES) if (base[k] !== undefined) cost[k] = Math.ceil(base[k] * by);
  return cost;
}

/** Builds one `building` if its cost can be paid; otherwise nothing changes. */
export function build(realm: Realm, building: Building): Realm {
  const cost = buildingCost(realm, building);
  if (!canAfford(realm, cost)) return realm;
  const paid = pay(realm, cost);
  const next = {
    ...paid,
    buildings: { ...paid.buildings, [building]: paid.buildings[building] + 1 },
  };
  return chronicle(next, 'buildings', `Built a ${building}.`);
}

/** The Forge multiplier on army power (§6). */
export function forgeBonus(realm: Realm): number {
  return 1 + FORGE_BONUS * realm.buildings.forge;
}

/** Spearmen, the one Phase 1 unit (docs/design.md §6): 1 peasant + this cost each. */
export const SOLDIER: { readonly cost: Cost; readonly power: number } = {
  cost: { iron: 5, gold: 10 },
  power: 2,
};

/**
 * Field army power (§6): base power of every soldier × its slotted trait
 * modifiers (spearmen and army bonuses add up) × the Forge multiplier.
 */
export function armyPower(realm: Realm): number {
  const m = traitModifiers(realm);
  return realm.soldiers * SOLDIER.power * (1 + m.spearmen + m.army) * forgeBonus(realm);
}

export function workers(realm: Realm): number {
  return realm.jobs.farmer + realm.jobs.woodcutter + realm.jobs.miner;
}

export function population(realm: Realm): number {
  return realm.idle + workers(realm) + realm.soldiers;
}

export function housingCap(realm: Realm): number {
  return PEOPLE.baseHousing + realm.buildings.hut * PEOPLE.hutHousing + realm.annexedHousing;
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

/**
 * Trains up to `count` soldiers, each taking one idle peasant and paying
 * SOLDIER.cost; stops at the first one the idle pool or stores can't cover.
 */
export function train(realm: Realm, count = 1): Realm {
  let next = realm;
  for (let i = wholeCount(count); i > 0 && next.idle > 0 && canAfford(next, SOLDIER.cost); i--) {
    next = { ...pay(next, SOLDIER.cost), idle: next.idle - 1, soldiers: next.soldiers + 1 };
  }
  return next;
}

/** Sends up to `count` soldiers back to idle; the training cost is not refunded (§6). */
export function disband(realm: Realm, count = 1): Realm {
  const n = Math.min(wholeCount(count), realm.soldiers);
  if (n === 0) return realm;
  return { ...realm, idle: realm.idle + n, soldiers: realm.soldiers - n };
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

/**
 * Net change per second of every store, after slotted trait modifiers (§9).
 * Wood, iron and tax shrink by (1 − s) while starving; Market gold doesn't.
 */
export function rates(realm: Realm): Record<Resource, number> {
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
      realm.buildings.market * RATES.marketGold -
      realm.soldiers * RATES.soldierUpkeep * (1 + m.soldierUpkeep),
  };
}

/**
 * Removes one starving person (§4): idle peasants first, then miners,
 * woodcutters and farmers (so farmers stay longest), then soldiers.
 */
function loseOne(realm: Realm): Realm {
  if (realm.idle > 0) return { ...realm, idle: realm.idle - 1 };
  for (const job of ['miner', 'woodcutter', 'farmer'] as const) {
    if (realm.jobs[job] > 0)
      return { ...realm, jobs: { ...realm.jobs, [job]: realm.jobs[job] - 1 } };
  }
  if (realm.soldiers > 0) return { ...realm, soldiers: realm.soldiers - 1 };
  return realm;
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
 */
export function tick(realm: Realm, dt: number): Realm {
  let next = realm;
  let left = dt;
  const until = (every: number) => (Math.floor(next.time / every) + 1) * every - next.time;
  for (;;) {
    const toNext = Math.min(until(RAID.every), until(EVENT.every));
    // `!(>)` also ends on NaN; toNext ≤ 0 only at float limits, where no split can help.
    if (!(left > toNext) || !(toNext > 0)) return step(next, left);
    next = step(next, toNext);
    left -= toNext;
  }
}

/** A raid or event landing at game time `at`. */
interface Happening {
  at: number;
  run: (realm: Realm) => Realm;
}

/** Every raid and event in (from, to], in time order; a raid before an event at the same moment. */
function happenings(seed: number, from: number, to: number): Happening[] {
  const list: Happening[] = [];
  const add = (every: number, run: (n: number) => Happening['run']) => {
    for (let n = Math.floor(from / every) + 1; n <= Math.floor(to / every); n++) {
      list.push({ at: n * every, run: run(n) });
    }
  };
  add(RAID.every, (n) => (r) => raid(r, raidRng(seed, n)));
  add(EVENT.every, (n) => (r) => randomEvent(r, eventRng(seed, n)));
  // Array.sort is stable, so raids stay ahead of events at the same moment.
  return list.sort((a, b) => a.at - b.at);
}

/** One stretch of tick() that ends on or before the next raid or event. */
function step(realm: Realm, dt: number): Realm {
  const r = rates(realm);
  const caps = storeCaps(realm);
  const stores = { ...realm.stores };
  for (const k of RESOURCES) stores[k] = Math.min(caps[k], Math.max(0, stores[k] + r[k] * dt));

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

  next = { ...next, hunger, soldiers, desertion };
  // Years, raids and events run in time order, so each meets the rivals and year of its moment.
  const toYear = (year: number) => {
    while (next.year < year) next = { ...growRivals(next), year: next.year + 1 };
  };
  for (const h of happenings(next.seed, realm.time, next.time)) {
    toYear(1 + Math.floor(h.at / YEAR_SECONDS));
    next = h.run(next);
  }
  toYear(1 + Math.floor(next.time / YEAR_SECONDS));
  return next;
}
