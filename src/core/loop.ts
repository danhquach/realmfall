import { awaySummary, tick, type Realm } from './realm.ts';

/** Fixed simulation step in game seconds. */
export const STEP = 0.25;

/** Game-speed multipliers the dev-only `?speed=` URL param may select. */
export const SPEEDS = [1, 5, 20] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * The most game time one `advance` call will simulate, and so the cap on
 * offline progress (§14). A tab left in the background can come back with
 * hours pending; past this the surplus is dropped rather than freezing the page.
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

/** Shorter absences (a reload) are still replayed, but not written to the Chronicle. */
export const AWAY_SUMMARY_MIN = 60;

/**
 * The realm after `away` real seconds with the game closed (§14): replayed in
 * the same fixed steps as live play, so caps, growth, hunger, raids and events
 * behave as they would have online, capped at MAX_CATCHUP, and summed up in
 * one Chronicle line. A negative or non-finite `away` (a clock set back, a bad
 * timestamp) replays nothing.
 */
export function catchUp(realm: Realm, away: number): Realm {
  const next = advance(realm, Number.isFinite(away) ? away : 0).realm;
  // Whole steps, so float drift in a loaded clock can't print 59m for an hour.
  const seconds = Math.round((next.time - realm.time) / STEP) * STEP;
  return seconds >= AWAY_SUMMARY_MIN ? awaySummary(next, realm, seconds) : next;
}
