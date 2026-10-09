import type { Realm } from '../core/realm.ts';
import { parseSave, serialize, type Save } from '../core/save.ts';

const KEY = 'realmfall.save';

/** Real milliseconds between autosaves (docs/design.md §14). */
export const AUTOSAVE_MS = 10_000;

/** The save, or null when there is none, it is bad, or storage is blocked. */
export function loadSave(): Save | null {
  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Saves `realm`, stamped with the current time; a full or blocked storage is ignored and the game plays on unsaved. */
export function saveRealm(realm: Realm): void {
  try {
    localStorage.setItem(KEY, serialize(realm, Date.now()));
  } catch {
    // Quota exceeded or storage disabled.
  }
}

/** Saves `current()` every AUTOSAVE_MS and whenever the page is hidden or left. */
export function startAutosave(current: () => Realm): void {
  const save = () => saveRealm(current());
  setInterval(save, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  addEventListener('pagehide', save);
}
