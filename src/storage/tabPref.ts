const KEY = 'realmfall.tab';

/** The workspace tabs (docs/design.md §18). Chronicle is a tab at phone width only. */
export const TABS = ['build', 'army', 'rivals', 'traits', 'chronicle'] as const;
export type Tab = (typeof TABS)[number];
export const DEFAULT_TAB: Tab = 'build';

/** `value` when it is exactly one of TABS, else the default tab. */
export function parseTab(value: unknown): Tab {
  return TABS.find((t) => t === value) ?? DEFAULT_TAB;
}

/** The last tab used, or the default when there is none, it is bad, or storage is blocked. */
export function loadTab(): Tab {
  try {
    return parseTab(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_TAB;
  }
}

/** Remembers `tab`; a full or blocked storage is ignored. */
export function saveTab(tab: Tab): void {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    // Quota exceeded or storage disabled.
  }
}
