import type { ChronicleEntry, Realm } from '../core/realm.ts';

function line(entry: ChronicleEntry): HTMLLIElement {
  const li = document.createElement('li');
  const year = document.createElement('span');
  year.className = 'year';
  year.textContent = `Year ${entry.year}`;
  li.append(year, ` ${entry.text}`);
  return li;
}

/**
 * Builds the Chronicle panel (docs/design.md §12) inside `root` once, and
 * returns the function that refreshes it from a realm, newest line first.
 * The redraw runs every frame, so it does no work while the Chronicle is
 * unchanged and otherwise adds only the new lines; the list never holds more
 * lines than the Chronicle does (CHRONICLE_MAX).
 */
export function mountChronicle(root: HTMLElement): (realm: Realm) => void {
  const section = document.createElement('section');
  section.className = 'panel chronicle';
  const heading = document.createElement('h2');
  heading.id = 'chronicle-heading';
  heading.textContent = 'Chronicle';
  const empty = document.createElement('p');
  empty.className = 'note';
  empty.textContent = 'Nothing has happened yet.';
  const list = document.createElement('ol');
  // list-style: none drops list semantics in Safari; the role restores them.
  list.setAttribute('role', 'list');
  list.setAttribute('aria-labelledby', heading.id);
  // A scrolling region needs focus to be scrolled from the keyboard.
  list.tabIndex = 0;
  section.append(heading, empty, list);
  root.append(section);

  let shown: ChronicleEntry[] = [];

  return (realm) => {
    const entries = realm.chronicle;
    if (entries === shown) return;
    // Entries are shared between realms, so the newest shown line is found by
    // identity. When it's gone (a whole Chronicle's worth of lines at once, or
    // a different realm), redraw from scratch.
    const last = shown.at(-1);
    const from = last ? entries.lastIndexOf(last) + 1 : 0;
    if (last && from === 0) list.replaceChildren();
    const fresh = entries.slice(from).reverse().map(line);
    list.prepend(...fresh);
    // Lines past the cap leave the Chronicle from the oldest end.
    while (list.childElementCount > entries.length) list.lastElementChild!.remove();
    empty.hidden = entries.length > 0;
    list.hidden = entries.length === 0;
    shown = entries;
  };
}
