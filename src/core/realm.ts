import { chance, createRng, int, pick, type Rng } from './rng.ts';

/** The stores (docs/design.md §3); weapons are made by Forges (§5, §6). */
export const RESOURCES = ['food', 'wood', 'iron', 'gold', 'weapons'] as const;
export type Resource = (typeof RESOURCES)[number];

/** Peasant jobs (docs/design.md §4); builders do the construction work of §5. */
export const JOBS = ['farmer', 'woodcutter', 'miner', 'builder'] as const;
export type Job = (typeof JOBS)[number];

/**
 * docs/design.md §5. Huts, Markets and Forges each have a level shared by all
 * of that kind (from 1); Wall and Defence tower count levels; the others how
 * many are built.
 */
export const BUILDINGS = [
  'hut',
  'hutLevel',
  'market',
  'marketLevel',
  'barracks',
  'forge',
  'forgeLevel',
  'wall',
  'tower',
] as const;
export type Building = (typeof BUILDINGS)[number];

/** The kind-wide levels of Huts, Markets and Forges, from 1 (§5). */
export const UPGRADES = ['hutLevel', 'marketLevel', 'forgeLevel'] as const;

/** What can be ordered: every building, and the next Storehouse level (§5). */
export const CONSTRUCTIONS = [...BUILDINGS, 'storehouse'] as const;
export type Construction = (typeof CONSTRUCTIONS)[number];

/** One order in the construction queue: its cost and build work are fixed when ordered (§5). */
export interface Order {
  building: Construction;
  /** How many it builds: 1 to BUILD_MAX for Huts, Markets and Forges, 1 for anything else. */
  count: number;
  /** What was paid, refunded in full on cancel. */
  cost: Cost;
  /** Build work needed, in builder-seconds. */
  work: number;
  /** Build work done so far. */
  done: number;
}

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

/** One-off goals that each pay out a trait offer once (docs/design.md §9). */
export const MILESTONES = ['people', 'battles', 'storehouse', 'raids'] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Where a trait offer came from; each source offers a set number of choices (§9). */
export const OFFER_CHOICES = { milestone: 3, challenge: 2 } as const;
export type OfferSource = keyof typeof OFFER_CHOICES;
export const OFFER_SOURCES = Object.keys(OFFER_CHOICES) as OfferSource[];

/** Rolled traits waiting for the player to pick one. */
export interface TraitOffer {
  source: OfferSource;
  choices: Trait[];
}

/** The kinds of challenge that can be offered (docs/design.md §9). */
export const CHALLENGES = ['food', 'raid'] as const;
export type ChallengeKind = (typeof CHALLENGES)[number];

/** The active challenge; it fails once the year reaches `deadline`. */
export interface Challenge {
  kind: ChallengeKind;
  deadline: number;
}

/** A trait on the Market trader's shelf and its price in gold (§9). */
export interface TraderItem {
  trait: Trait;
  price: number;
}

/** A rival kingdom, known only by its place name (docs/design.md §7). */
export interface Rival {
  name: string;
  /** Map ring it sits on, from 1; sets which trait tiers it can hold (§9). */
  ring: number;
  /** Sets its growth per year and power ceiling (§7 Levels). */
  level: RivalLevel;
  trait: Trait;
  power: number;
  /** Power never grows past this: starting power × its level's ceiling (§7). */
  ceiling: number;
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
  'away',
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
  /** Construction orders, the first one being built (§5). */
  queue: Order[];
  /** Housing gained from annexed rivals, +10 each (docs/design.md §7). */
  annexedHousing: number;
  rivals: Rival[];
  /** Every trait owned; only slotted ones take effect (§9). */
  traits: Partial<Record<Trait, OwnedTrait>>;
  /** The trait slots, null while empty. */
  slots: (Trait | null)[];
  /** Per slot, the first year it can be swapped again. */
  slotReadyYear: number[];
  /** Battles won and raids on the capital repelled, for milestones (§9). */
  battlesWon: number;
  raidsRepelled: number;
  /** Milestones already paid out. */
  milestones: Milestone[];
  /** Trait offers not yet picked, oldest first. */
  offers: TraitOffer[];
  challenge: Challenge | null;
  /** First year a new challenge may be offered. */
  challengeYear: number;
  /** The trader's unsold stock. */
  trader: TraderItem[];
  /** Year the trader last restocked; 0 while it has never opened. */
  traderYear: number;
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

export const RIVAL_LEVELS = ['weak', 'average', 'strong', 'elite'] as const;
export type RivalLevel = (typeof RIVAL_LEVELS)[number];

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
function withPower(rival: Rival, power: number): Rival {
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
function updateRival(realm: Realm, index: number, change: (r: Rival) => Rival): Realm {
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

/** Battle and annexation numbers (docs/design.md §7). */
export const BATTLE = {
  winLossBase: 0.1,
  winLossRisk: 0.3,
  defeatLoss: 0.5,
  defeatRivalGrowth: 0.1,
  annexHousing: 10,
  annexPeoplePer: 8,
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
 * trait; a new rival appears on the next ring out (ringRival).
 * Loss: lose ⌈50%⌉ of soldiers; the rival gains +10% power, up to its
 * ceiling, and turns hostile.
 * Nothing changes if there is no such rival or no soldiers.
 */
export function attack(realm: Realm, index: number, rng: Rng): Realm {
  const rival = realm.rivals[index];
  if (!rival || realm.soldiers === 0) return realm;
  const odds = winChance(armyPower(realm), rival.power);
  if (!chance(rng, odds)) {
    const lost = Math.ceil(realm.soldiers * BATTLE.defeatLoss);
    const next = updateRival(withLosses(realm, lost), index, (r) => ({
      ...withPower(r, r.power * (1 + BATTLE.defeatRivalGrowth)),
      hostile: true,
    }));
    return chronicle(next, 'battles', `Lost a battle against ${rival.name}: ${fell(lost)}.`);
  }
  const share = BATTLE.winLossBase + BATTLE.winLossRisk * (1 - odds);
  // The epsilon keeps float noise from rounding an exact whole loss up by one.
  const lost = Math.min(realm.soldiers, Math.ceil(realm.soldiers * share - 1e-9));
  const rest = realm.rivals.filter((_, i) => i !== index);
  const taken = new Set([rival.name, ...rest.map((r) => r.name)]);
  const ring = Math.min(rival.ring + 1, RIVAL.maxRing);
  const fresh = ringRival(rng, ring, taken);
  const after = withLosses(realm, lost);
  const annexed: Realm = {
    ...after,
    battlesWon: realm.battlesWon + 1,
    idle: realm.idle + Math.floor(rival.power / BATTLE.annexPeoplePer),
    annexedHousing: realm.annexedHousing + BATTLE.annexHousing,
    stores: { ...after.stores, gold: addStore(after, 'gold', rival.power) },
    rivals: [...rest, fresh],
  };
  const won = chronicle(
    annexed,
    'battles',
    `Conquered ${rival.name}: ${fell(lost)}; ${fresh.name} appears beyond it.`,
  );
  return gainTrait(won, rival.trait);
}

/** The realm after losing `lost` soldiers in battle, with their weapons (§6). */
function withLosses(realm: Realm, lost: number): Realm {
  const weapons = realm.stores.weapons - weaponsLost(realm, lost);
  return { ...realm, soldiers: realm.soldiers - lost, stores: { ...realm.stores, weapons } };
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
 * E × (0.4–0.8). If capitalDefence() ≥ strength it is repelled; otherwise the
 * realm loses 25% of the food and wood above the Storehouse's safe amount.
 * Nothing happens while no rival is hostile.
 */
export function raid(realm: Realm, rng: Rng): Realm {
  const hostile = realm.rivals.filter((r) => r.hostile);
  if (hostile.length === 0) return realm;
  const rival = pick(rng, hostile);
  const strength = rival.power * (RAID.minStrength + (RAID.maxStrength - RAID.minStrength) * rng());
  // "Repel the next raid" (§9) ends with this raid, met or failed.
  const end = (next: Realm, met: boolean) =>
    realm.challenge?.kind === 'raid' ? endChallenge(next, met) : next;
  if (capitalDefence(realm) >= strength) {
    const next = { ...realm, raidsRepelled: realm.raidsRepelled + 1 };
    return end(chronicle(next, 'raids', `Repelled a raid from ${rival.name}.`), true);
  }
  const safe = safeAmounts(realm);
  const stores = { ...realm.stores };
  for (const k of RAIDED) stores[k] -= Math.max(0, stores[k] - safe[k]) * RAID.loss;
  const lost = RAIDED.map((k) => Math.floor(realm.stores[k] - stores[k]));
  const text = lost.some((n) => n > 0)
    ? `${rival.name} raided the capital: lost ${lost[0]} food and ${lost[1]} wood.`
    : `${rival.name} raided the capital but found nothing to take.`;
  return end(chronicle({ ...realm, stores }, 'raids', text), false);
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
function awayEventDue(away: Away, at: number): boolean {
  const hours = Math.floor((at - away.since) / AWAY_EVENT_EVERY);
  return hours >= 1 && at - EVENT.every < away.since + hours * AWAY_EVENT_EVERY;
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

/** A whole number for a Chronicle line, in exponent form once huge so the line stays short. */
function amount(n: number): string {
  const whole = Math.round(n);
  return Math.abs(whole) < 1e6 ? String(whole) : whole.toExponential(2);
}

/**
 * Adds the Chronicle summary of `seconds` simulated away from the game (§10,
 * §14): how stores, people and soldiers changed from `before` to `realm`, the
 * good events and trader restocks written meanwhile, and that the realm was
 * at peace. Plain ASCII and under the save's line limit, so the save always
 * accepts it.
 */
export function awaySummary(realm: Realm, before: Realm, seconds: number): Realm {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${amount(n)}`;
  const stores = RESOURCES.map((k) => `${k} ${signed(realm.stores[k] - before.stores[k])}`);
  const change = (of: (r: Realm) => number) => `${amount(of(before))} to ${amount(of(realm))}`;
  // Lines are shared, never copied, so the new ones are those `before` lacks.
  const old = new Set(before.chronicle);
  const events = realm.chronicle.filter((c) => !old.has(c) && c.kind === 'events').length;
  // Away, the trader restocks at most once (§10).
  const restocks = realm.traderYear === before.traderYear ? 0 : 1;
  return chronicle(
    realm,
    'away',
    `Away ${hours}h ${minutes}m: ${stores.join(', ')}; ` +
      `people ${change(population)}; soldiers ${change((r) => r.soldiers)}; ` +
      `${events} ${events === 1 ? 'event' : 'events'}, ${restocks} trader ${restocks === 1 ? 'restock' : 'restocks'}; at peace.`,
  );
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

/** Pending offers kept; past this the oldest is dropped, so an idle run can't pile them up. */
export const OFFER_MAX = 10;

/** A milestone's goal text and the count that must reach `target`. */
export interface MilestoneInfo {
  goal: string;
  target: number;
  count: (r: Realm) => number;
  reached: (r: Realm) => boolean;
}

function milestone(goal: string, target: number, count: (r: Realm) => number): MilestoneInfo {
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
      : `None active. One comes once you can store ${CHALLENGE.food} food but hold less, or a rival is hostile.`;
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
 * unmet requirement, in build-list order; then the first milestone not yet
 * reached, with its progress; once all are reached, says so.
 */
export function nextGoal(realm: Realm): string {
  for (const c of CONSTRUCTIONS) {
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
 * less than 500 in store (or it would be met at once), a raid a hostile rival.
 */
export function possibleChallenges(realm: Realm): ChallengeKind[] {
  return CHALLENGES.filter((c) => {
    if (c === 'food')
      return storeCaps(realm).food >= CHALLENGE.food && realm.stores.food < CHALLENGE.food;
    return realm.rivals.some((r) => r.hostile);
  });
}

/** Ends the active challenge; a met one offers 1 of 2 rolled traits, a failed one costs nothing. */
function endChallenge(realm: Realm, met: boolean): Realm {
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
function traitSources(realm: Realm, away: Away | null): Realm {
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
 * level, else `count` kept to 1..BUILD_MAX and to what is left below its max.
 * 0 when `count` is not a whole number of at least 1.
 */
function orderCount(realm: Realm, c: Construction, count: number): number {
  if (!Number.isInteger(count) || count < 1) return 0;
  const { levelled, max } = CONSTRUCTION_INFO[c];
  if (levelled) return 1;
  return Math.max(0, Math.min(count, BUILD_MAX, max - nextN(realm, c)));
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
function construct(realm: Realm, work: number): Realm {
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

/** Weapon making per Forge, and what a weapon adds (docs/design.md §5, §6). */
export const FORGE = {
  /** Seconds per weapon, per Forge. */
  every: 5,
  /** Iron used per weapon. */
  iron: 2,
  /** An armed soldier fights at × (1 + this × Forges level). */
  armedBonus: 0.5,
} as const;

/** Soldiers carrying a weapon: one per whole weapon in store, up to the soldiers (§6). */
export function armedSoldiers(realm: Realm): number {
  return Math.min(realm.soldiers, Math.floor(realm.stores.weapons));
}

/** The power multiplier of an armed soldier at the Forges level (§6). */
export function weaponBonus(realm: Realm): number {
  return 1 + FORGE.armedBonus * realm.buildings.forgeLevel;
}

/**
 * Weapons the Forges make in `dt` seconds (§5): each makes one per FORGE.every
 * seconds from FORGE.iron iron, while there is iron and room under the cap.
 */
function forged(realm: Realm, stores: Record<Resource, number>, dt: number): number {
  const room = storeCaps(realm).weapons - stores.weapons;
  const made = (realm.buildings.forge * dt) / FORGE.every;
  return Math.max(0, Math.min(made, stores.iron / FORGE.iron, room));
}

/** Weapons lost with `lost` of the realm's soldiers: their share of the armed ones (§6). */
function weaponsLost(realm: Realm, lost: number): number {
  if (realm.soldiers === 0) return 0;
  return Math.min(realm.stores.weapons, Math.round((lost * armedSoldiers(realm)) / realm.soldiers));
}

/** Spearmen, the one Phase 1 unit (docs/design.md §6): 1 peasant + this cost each. */
export const SOLDIER: { readonly cost: Cost; readonly power: number } = {
  cost: { iron: 5, gold: 10 },
  power: 2,
};

/**
 * Field army power (§6): base power of every soldier, × weaponBonus() for each
 * armed one, × slotted trait modifiers (spearmen and army bonuses add up).
 */
export function armyPower(realm: Realm): number {
  const m = traitModifiers(realm);
  const armed = armedSoldiers(realm);
  const soldiers = realm.soldiers - armed + armed * weaponBonus(realm);
  return soldiers * SOLDIER.power * (1 + m.spearmen + m.army);
}

/** What a raid on the capital must beat (§7): field army power × (1 + 0.2 × Wall level). */
export function capitalDefence(realm: Realm): number {
  return armyPower(realm) * (1 + WALL_BONUS * realm.buildings.wall);
}

/** Every peasant with a job, builders included; all of them pay tax (§3, §5). */
export function workers(realm: Realm): number {
  return JOBS.reduce((sum, job) => sum + realm.jobs[job], 0);
}

export function population(realm: Realm): number {
  return realm.idle + workers(realm) + realm.soldiers;
}

/** Housing (§4, §5): base + each Hut's housing at the Huts level (rounded down) + annexed. */
export function housingCap(realm: Realm): number {
  const { hut, hutLevel } = realm.buildings;
  const huts = Math.floor(hut * PEOPLE.hutHousing * upgradeBonus(hutLevel));
  return PEOPLE.baseHousing + huts + realm.annexedHousing;
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
 * Nothing is trained until a Barracks is finished (§6).
 */
export function train(realm: Realm, count = 1): Realm {
  if (realm.buildings.barracks === 0) return realm;
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

/** Net change per second of every store but the Forges' share, which step() works out exactly. */
function production(realm: Realm): Record<Resource, number> {
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
function loseOne(realm: Realm): Realm {
  if (realm.idle > 0) return { ...realm, idle: realm.idle - 1 };
  for (const job of ['builder', 'miner', 'woodcutter', 'farmer'] as const) {
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
 *
 * Construction (§5): the queue gets buildRate() × dt of work, with the builders
 * and shortfall at the start of the step.
 *
 * Away (§10): while `away` is set, the economy runs as above but what needs a
 * decision waits: no raids, only good events and at most one per hour away,
 * no challenge offers, an active challenge's deadline paused, and at most one
 * trader restock.
 */
export function tick(realm: Realm, dt: number, away: Away | null = null): Realm {
  // An infinite step would split at raids forever; NaN would poison every store.
  if (!Number.isFinite(dt)) return realm;
  let next = realm;
  let left = dt;
  const until = (every: number) => (Math.floor(next.time / every) + 1) * every - next.time;
  for (;;) {
    const toNext = Math.min(until(RAID.every), until(EVENT.every));
    // `!(>)` also ends on NaN; toNext ≤ 0 only at float limits, where no split can help.
    if (!(left > toNext) || !(toNext > 0)) return step(next, left, away);
    next = step(next, toNext, away);
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
