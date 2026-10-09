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

/** Game seconds per year (docs/design.md §10). */
export const YEAR_SECONDS = 8;

export const RIVAL_LEVELS = ['weak', 'average', 'strong', 'elite'] as const;

export type RivalLevel = (typeof RIVAL_LEVELS)[number];

/** An amount of each store; resources left out cost nothing. */
export type Cost = Partial<Record<Resource, number>>;
