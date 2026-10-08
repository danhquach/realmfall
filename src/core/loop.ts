import { tick, type Realm } from './realm.ts';

/** Fixed simulation step in game seconds. */
export const STEP = 0.25;

/** Game-speed multipliers the dev-only `?speed=` URL param may select. */
export const SPEEDS = [1, 5, 20] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * The most game time one `advance` call will simulate. A tab left in the
 * background can come back with hours pending; past this the surplus is
 * dropped rather than freezing the page. Offline progress is a later system.
 */
export const MAX_CATCHUP = 8 * 60 * 60;

/**
 * Reads a `?speed=` value. Only the exact strings "1", "5" and "20" are
 * accepted; anything else (missing, padded, "5.0", "1e1", huge) gives 1.
 */
export function parseSpeed(value: string | null): Speed {
  return SPEEDS.find((s) => String(s) === value) ?? 1;
}

/**
 * Runs as many fixed steps as fit in `pending` game seconds and returns the new
 * realm with the remainder to carry into the next call. Every step is exactly
 * STEP long, so the result does not depend on how real time was sliced.
 */
export function advance(realm: Realm, pending: number): { realm: Realm; pending: number } {
  let left = pending > 0 ? Math.min(pending, MAX_CATCHUP) : 0;
  while (left >= STEP) {
    realm = tick(realm, STEP);
    left -= STEP;
  }
  return { realm, pending: left };
}
