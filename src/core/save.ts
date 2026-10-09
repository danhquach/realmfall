import {
  BUILDINGS,
  RIVAL,
  CHRONICLE_KINDS,
  CHRONICLE_MAX,
  JOBS,
  RESOURCES,
  TRAITS,
  TRAIT_RULES,
  YEAR_SECONDS,
  type ChronicleEntry,
  type OwnedTrait,
  type Realm,
  type Rival,
  type Trait,
} from './realm.ts';

/** Bump when the saved shape changes; a save of any other version starts a new game. */
export const SAVE_VERSION = 1;

/**
 * Bounds that keep a hand-edited save from freezing the page: the simulation
 * loops over years, levels and people, so none of them may be absurd.
 */
export const SAVE_LIMITS = {
  /** Longest save string read, in characters; a full Chronicle is ~25 KB. */
  chars: 256 * 1024,
  /** Game seconds, ~31,000 years of play. */
  time: 1e12,
  /**
   * Growth, hunger and desertion backlog. Play keeps each under a few seconds;
   * tick() works a backlog off one person at a time, so a huge one would freeze it.
   */
  backlog: 1000,
  /**
   * People, soldiers, buildings, duplicates. Nothing loops over these, and
   * conquering a rival near RIVAL.maxPower can bring in that many people.
   */
  count: 1e300,
  /** Store amounts. */
  amount: 1e300,
  /** Far past any reachable level; caps stay finite up to ~640. */
  storehouse: 500,
  rivals: 50,
  ring: 1000,
  nameChars: 40,
  textChars: 200,
} as const;

/** Realm and rival names: "Fenmere", or a numbered one "Fenmere 2". */
const NAME = /^[A-Z][a-z]+(?: [1-9][0-9]{0,8})?$/;
/** Chronicle text: printable ASCII only, so no control, bidi, zero-width or look-alike characters. */
const TEXT = /^[\x20-\x7e]+$/;

/** Latest time a Date can hold, in ms since the epoch. */
const MAX_DATE_MS = 8.64e15;

/**
 * The save string for `realm`, stamped with `savedAt` (ms since the epoch) so
 * the time away can be replayed on load (§14).
 */
export function serialize(realm: Realm, savedAt?: number): string {
  return JSON.stringify({ version: SAVE_VERSION, savedAt, realm });
}

/** A parsed save: the realm, and when it was saved (null for a save without a stamp). */
export interface Save {
  realm: Realm;
  savedAt: number | null;
}

/** Rejects the save; caught in parse(), never escapes it. */
function fail(): never {
  throw new Error('bad save');
}

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail();
  return v as Raw;
}

function arr(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) fail();
  return v;
}

/** An own property only: inherited ones (e.g. from a polluted prototype) are never read. */
function own(o: Raw, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function num(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail();
  return v;
}

function int(v: unknown, min: number, max: number): number {
  const n = num(v, min, max);
  if (!Number.isInteger(n)) fail();
  return n;
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') fail();
  return v;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T {
  if (!list.includes(v as T)) fail();
  return v as T;
}

function text(v: unknown, pattern: RegExp, max: number): string {
  if (typeof v !== 'string' || v.length > max || !pattern.test(v)) fail();
  return v;
}

/** A record holding exactly `keys`, each read with `read`. */
function record<K extends string, V>(v: unknown, keys: readonly K[], read: (v: unknown) => V) {
  const o = obj(v);
  const out = {} as Record<K, V>;
  for (const k of keys) out[k] = read(own(o, k));
  return out;
}

function rival(v: unknown): Rival {
  const o = obj(v);
  return {
    name: text(own(o, 'name'), NAME, SAVE_LIMITS.nameChars),
    ring: int(own(o, 'ring'), 1, SAVE_LIMITS.ring),
    trait: oneOf(own(o, 'trait'), TRAITS),
    power: num(own(o, 'power'), 0, RIVAL.maxPower),
    hostile: bool(own(o, 'hostile')),
    scouted: bool(own(o, 'scouted')),
  };
}

function traits(v: unknown): Partial<Record<Trait, OwnedTrait>> {
  const o = obj(v);
  const out: Partial<Record<Trait, OwnedTrait>> = {};
  for (const t of TRAITS) {
    const raw = own(o, t);
    if (raw === undefined) continue;
    const owned = obj(raw);
    out[t] = {
      level: int(own(owned, 'level'), 1, TRAIT_RULES.maxLevel),
      duplicates: int(own(owned, 'duplicates'), 0, SAVE_LIMITS.count),
    };
  }
  return out;
}

function entry(v: unknown, year: number): ChronicleEntry {
  const o = obj(v);
  return {
    year: int(own(o, 'year'), 1, year),
    kind: oneOf(own(o, 'kind'), CHRONICLE_KINDS),
    text: text(own(o, 'text'), TEXT, SAVE_LIMITS.textChars),
  };
}

function realm(v: unknown): Realm {
  const o = obj(v);
  const count = (x: unknown) => int(x, 0, SAVE_LIMITS.count);
  const time = num(own(o, 'time'), 0, SAVE_LIMITS.time);
  // The year must match the clock: tick() catches the year up one at a time.
  const year = int(own(o, 'year'), 1, SAVE_LIMITS.time);
  if (year !== 1 + Math.floor(time / YEAR_SECONDS)) fail();
  const owned = traits(own(o, 'traits'));
  const slots = arr(own(o, 'slots'), TRAIT_RULES.slots).map((s) =>
    s === null ? null : oneOf(s, TRAITS),
  );
  const filled = slots.filter((s) => s !== null);
  if (slots.length !== TRAIT_RULES.slots) fail();
  if (filled.some((s) => !owned[s]) || new Set(filled).size !== filled.length) fail();
  const slotReadyYear = arr(own(o, 'slotReadyYear'), TRAIT_RULES.slots).map((y) =>
    int(y, 1, SAVE_LIMITS.time),
  );
  if (slotReadyYear.length !== TRAIT_RULES.slots) fail();
  const rivals = arr(own(o, 'rivals'), SAVE_LIMITS.rivals).map(rival);
  if (rivals.length === 0) fail();
  return {
    seed: int(own(o, 'seed'), 0, 0xffffffff),
    name: text(own(o, 'name'), NAME, SAVE_LIMITS.nameChars),
    time,
    year,
    stores: record(own(o, 'stores'), RESOURCES, (x) => num(x, 0, SAVE_LIMITS.amount)),
    idle: count(own(o, 'idle')),
    jobs: record(own(o, 'jobs'), JOBS, count),
    growth: num(own(o, 'growth'), 0, SAVE_LIMITS.backlog),
    hunger: num(own(o, 'hunger'), 0, SAVE_LIMITS.backlog),
    soldiers: count(own(o, 'soldiers')),
    desertion: num(own(o, 'desertion'), 0, SAVE_LIMITS.backlog),
    buildings: record(own(o, 'buildings'), BUILDINGS, count),
    storehouse: int(own(o, 'storehouse'), 0, SAVE_LIMITS.storehouse),
    annexedHousing: count(own(o, 'annexedHousing')),
    rivals,
    traits: owned,
    slots,
    slotReadyYear,
    chronicle: arr(own(o, 'chronicle'), CHRONICLE_MAX).map((e) => entry(e, year)),
  };
}

/**
 * The realm in save string `save`, or null when there is none or it can't be
 * trusted: too long, not JSON, another version, or any field missing, of the
 * wrong type or out of range. The realm is rebuilt field by field from the
 * allow-list above, so unknown keys (including `__proto__`) are never copied.
 */
export function parse(save: string | null): Realm | null {
  return parseSave(save)?.realm ?? null;
}

/**
 * Like parse(), with the save's timestamp. A save without one (written before
 * offline progress) loads with savedAt null; one that is present must be a
 * whole, non-negative Date value or the whole save is rejected.
 */
export function parseSave(save: string | null): Save | null {
  if (typeof save !== 'string' || save.length > SAVE_LIMITS.chars) return null;
  try {
    const o = obj(JSON.parse(save));
    if (own(o, 'version') !== SAVE_VERSION) return null;
    const stamp = own(o, 'savedAt');
    const savedAt = stamp === undefined ? null : int(stamp, 0, MAX_DATE_MS);
    return { realm: realm(own(o, 'realm')), savedAt };
  } catch {
    // Not JSON, or a fail() from the checks above.
    return null;
  }
}
