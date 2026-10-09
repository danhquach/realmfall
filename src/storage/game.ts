/** The running game: the realm on show, its save, and starting over (docs/design.md §4, §14). */
import { catchUp, play } from '../core/loop.ts';
import { createRealm, isFallen, type Realm } from '../core/realm.ts';
import type { Save } from '../core/save.ts';
import { clearSave, loadSave, saveRealm, type KeyValueStore } from './autosave.ts';

/** What the game needs from the page; tests pass fakes. */
export interface GameDeps {
  store: KeyValueStore;
  /** Real time in ms since the epoch. */
  now: () => number;
  /** A fresh seed for a new run. */
  newSeed: () => number;
}

export interface Game {
  /** The realm on show. */
  readonly realm: Realm;
  /** Applies a player action and saves at once; a fallen realm takes no actions (§4). */
  act(change: (realm: Realm) => Realm): void;
  /** One frame of the live loop, `real` seconds after the last, at `speed` (see play()). */
  frame(real: number, speed: number): void;
  /** Saves the realm on show now. */
  save(): void;
  /**
   * Starts over (§14): the save is removed and a fresh starting realm on a new
   * seed takes its place, in memory and in storage, so the next load, and any
   * autosave after this, has the new realm.
   */
  newGame(): void;
  /**
   * Picks up a new game started in another tab: when the save holds a realm
   * from another run (another seed), it replaces the one on show, so this tab's
   * autosave can't write the old run back over it. Saves of the same run are
   * left alone, and a save of a run this tab has left behind (another tab
   * autosaving before it heard of the new game) is overwritten with ours.
   */
  sync(): void;
}

/** The starting realm on `seed` after clearing the save in `store`; the new realm is saved too. */
export function resetSave(store: KeyValueStore, seed: number, now: number): Realm {
  clearSave(store);
  const realm = createRealm(seed);
  saveRealm(realm, store, now);
  return realm;
}

/**
 * Loads the saved realm and replays the time since it was saved (§14), or
 * starts a new run when there is no save, it is bad, or storage is blocked.
 */
export function startGame({ store, now, newSeed }: GameDeps): Game {
  const saved = loadSave(store);
  let realm = saved ? resume(saved, now()) : createRealm(newSeed());
  // Stamp the replayed realm at once, so a crash before the next autosave can't replay it twice.
  if (saved) saveRealm(realm, store, now());
  let pending = 0;

  const save = () => saveRealm(realm, store, now());
  // Seeds of runs this tab has left behind: a save of one is stale, never adopted.
  const retired = new Set<number>();
  const replace = (next: Realm) => {
    if (next.seed !== realm.seed) retired.add(realm.seed);
    realm = next;
    pending = 0;
  };
  return {
    get realm() {
      return realm;
    },
    act(change) {
      if (isFallen(realm)) return;
      realm = change(realm);
      // Save each action at once, so a reload can't undo a lost battle.
      save();
    },
    frame(real, speed) {
      ({ realm, pending } = play(realm, pending, real, speed));
    },
    save,
    newGame() {
      replace(resetSave(store, newSeed(), now()));
    },
    sync() {
      const other = loadSave(store);
      if (!other || other.realm.seed === realm.seed) return;
      // A tab that hadn't heard of the new game yet saved the old run: put ours back.
      if (retired.has(other.realm.seed)) save();
      else replace(resume(other, now()));
    },
  };
}

/** The saved realm after the time since it was saved (§14); a save without a stamp replays none. */
function resume(save: Save, now: number): Realm {
  return catchUp(save.realm, save.savedAt === null ? 0 : (now - save.savedAt) / 1000);
}
