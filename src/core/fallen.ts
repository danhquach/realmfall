/** A fallen realm: everyone has left, so the run is over (docs/design.md §4 Fallen realm). */
import { chronicle } from './chronicle.ts';
import { type Realm } from './model.ts';
import { population } from './people.ts';

/**
 * True once no one is left: no idle peasants, no workers and no soldiers.
 * Anyone at all, a lone soldier included, keeps the realm standing. People who
 * may come later (recruits in training, armies in the field) must be counted in
 * population() so they keep it standing too.
 *
 * The fall is final: tick() stops a fallen realm, so no growth, raid or event
 * changes it again, and only a new game moves on.
 */
export function isFallen(realm: Realm): boolean {
  return population(realm) === 0;
}

/** The Chronicle line written once when `realm` falls. */
export function fallenText(realm: Realm): string {
  return `${realm.name} has fallen: everyone has left.`;
}

/**
 * True once the fallen line for `realm` is in its Chronicle. A fallen realm's
 * year never moves on, so the line is dated to the current year; one from an
 * earlier year (a hand-edited save) doesn't count.
 */
function hasFallenLine(realm: Realm): boolean {
  const text = fallenText(realm);
  return realm.chronicle.some(
    (e) => e.kind === 'realm' && e.text === text && e.year === realm.year,
  );
}

/**
 * `realm` with its fallen line written, once: a realm that is still standing,
 * or whose line is already there, comes back unchanged (the same object), so
 * calling this every tick, after a reload or after catch-up never adds a second
 * line. The line is a whole sentence of printable ASCII under the save's text
 * limit, so a save always accepts it.
 */
export function markFallen(realm: Realm): Realm {
  if (!isFallen(realm) || hasFallenLine(realm)) return realm;
  return chronicle(realm, 'realm', fallenText(realm));
}
