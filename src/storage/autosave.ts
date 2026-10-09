import type { Realm } from '../core/realm.ts';
import { parseSave, serialize, type Save } from '../core/save.ts';

/** Where the save lives. */
export const SAVE_KEY = 'realmfall.save';

/** Real milliseconds between autosaves (docs/design.md §14). */
export const AUTOSAVE_MS = 10_000;

/** The part of Web Storage the game uses, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The page's localStorage, looked up on each call: reading `localStorage`
 * itself throws where storage is blocked, and every caller catches that.
 */
export const browserStorage: KeyValueStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/** The save, or null when there is none, it is bad, or storage is blocked. */
export function loadSave(store: KeyValueStore = browserStorage): Save | null {
  try {
    return parseSave(store.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

/**
 * Saves `realm`, stamped with `now` (ms since the epoch); a full or blocked
 * storage is ignored and the game plays on unsaved.
 */
export function saveRealm(
  realm: Realm,
  store: KeyValueStore = browserStorage,
  now = Date.now(),
): void {
  try {
    store.setItem(SAVE_KEY, serialize(realm, now));
  } catch {
    // Quota exceeded or storage disabled.
  }
}

/** Removes the save; blocked storage is ignored (there is then no save to remove). */
export function clearSave(store: KeyValueStore = browserStorage): void {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Storage disabled.
  }
}

/** The page events autosave listens to; tests pass a fake. */
export interface AutosavePage {
  /** Calls `save` every `ms` milliseconds. */
  every(ms: number, save: () => void): void;
  /** Calls `save` when the page is hidden or left. */
  onLeave(save: () => void): void;
}

const browserPage: AutosavePage = {
  every: (ms, save) => void setInterval(save, ms),
  onLeave: (save) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
    });
    addEventListener('pagehide', save);
  },
};

/**
 * Calls `save` every AUTOSAVE_MS and whenever the page is hidden or left.
 * `save` must read the realm when it runs, never one captured earlier, so a
 * new game can't be overwritten by the realm it replaced.
 */
export function startAutosave(save: () => void, page: AutosavePage = browserPage): void {
  page.every(AUTOSAVE_MS, save);
  page.onLeave(save);
}
