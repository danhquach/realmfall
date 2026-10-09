import { awayFrom, awaySummary, tick, type Away, type Realm } from './realm.ts';

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
 * `away` replays the time as an absence (§10 Away time).
 */
export function advance(
  realm: Realm,
  pending: number,
  away: Away | null = null,
): { realm: Realm; pending: number } {
  let left = pending > 0 ? Math.min(pending, MAX_CATCHUP) : 0;
  while (left >= STEP) {
    realm = tick(realm, STEP, away);
    left -= STEP;
  }
  return { realm, pending: left };
}

/**
 * Shorter absences (a reload) are replayed exactly as live play and not
 * written to the Chronicle; longer ones are time away (§10).
 */
export const AWAY_SUMMARY_MIN = 60;

/**
 * The realm after `away` seconds with the game closed or hidden (§10, §14):
 * replayed in the same fixed steps as live play, so the economy, caps, growth,
 * hunger and construction behave as they would have online, capped at
 * MAX_CATCHUP. From a minute up it is time away: what needs a decision waits
 * for the player (see tick()), and one Chronicle line sums it up. A negative
 * or non-finite `away` (a clock set back, a bad timestamp) replays nothing.
 */
export function catchUp(realm: Realm, away: number): Realm {
  const seconds = Number.isFinite(away) ? away : 0;
  if (seconds < AWAY_SUMMARY_MIN) return advance(realm, seconds).realm;
  return summarise(realm, advance(realm, seconds, awayFrom(realm)).realm);
}

/** Adds the "Away" line for the time from `realm` to `next`. */
function summarise(realm: Realm, next: Realm): Realm {
  // Whole steps, so float drift in a loaded clock can't print 59m for an hour.
  const seconds = Math.round((next.time - realm.time) / STEP) * STEP;
  return awaySummary(next, realm, seconds);
}

/**
 * One frame of the live loop, `real` seconds after the last, run at `speed`.
 * A real gap of a minute or more is a background tab coming back, replayed as
 * time away like offline catch-up (§10); anything shorter runs as live play,
 * so a short stall at a dev speed is never mistaken for an absence.
 */
export function play(
  realm: Realm,
  pending: number,
  real: number,
  speed = 1,
): { realm: Realm; pending: number } {
  // A non-finite gap replays nothing, as in catchUp().
  const elapsed = Number.isFinite(real) ? real * speed : 0;
  if (!(real >= AWAY_SUMMARY_MIN) || elapsed === 0) return advance(realm, pending + elapsed);
  const away = advance(realm, pending + elapsed, awayFrom(realm));
  return { realm: summarise(realm, away.realm), pending: away.pending };
}
