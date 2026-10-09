/** The Chronicle: one line per meaningful change (docs/design.md §12). */
import { type ChronicleEntry, type ChronicleKind, type Realm, RESOURCES } from './model.ts';
import { population } from './people.ts';

/** "1 soldier fell" or "n soldiers fell", for battle lines. */
export function fell(n: number): string {
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
export function chronicle(realm: Realm, kind: ChronicleKind, text: string): Realm {
  const entries = [...realm.chronicle, { year: realm.year, kind, text }];
  return { ...realm, chronicle: entries.slice(-CHRONICLE_MAX) };
}

/** A whole number for a Chronicle line, in exponent form once huge so the line stays short. */
export function amount(n: number): string {
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
