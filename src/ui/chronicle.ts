import {
  CHRONICLE_KINDS,
  chronicleView,
  type ChronicleEntry,
  type ChronicleKind,
  type Realm,
} from '../core/realm.ts';

const KIND_NAMES: Record<ChronicleKind, string> = {
  events: 'Events',
  raids: 'Raids',
  battles: 'Battles',
  rivals: 'Rivals',
  buildings: 'Buildings',
  traits: 'Traits',
  away: 'Away',
};

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
 * A row of toggles, one per kind, hides and shows lines; filtering is a view
 * setting only. The redraw runs every frame, so it does no work while the
 * Chronicle is unchanged and otherwise adds only the new lines; the list
 * never holds more lines than the Chronicle does (CHRONICLE_MAX).
 */
export function mountChronicle(root: HTMLElement): (realm: Realm) => void {
  const section = document.createElement('section');
  section.className = 'panel chronicle';
  const heading = document.createElement('h2');
  heading.id = 'chronicle-heading';
  heading.textContent = 'Chronicle';
  const filters = document.createElement('div');
  filters.className = 'filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show lines about');
  const empty = document.createElement('p');
  empty.className = 'note';
  empty.textContent = 'Nothing has happened yet.';
  const list = document.createElement('ol');
  // list-style: none drops list semantics in Safari; the role restores them.
  list.setAttribute('role', 'list');
  list.setAttribute('aria-labelledby', heading.id);
  // A scrolling region needs focus to be scrolled from the keyboard.
  list.tabIndex = 0;
  section.append(heading, filters, empty, list);
  root.append(section);

  const shownKinds = new Set<ChronicleKind>(CHRONICLE_KINDS);
  // The buttons are built once and only their state changes, so they keep
  // focus through the per-frame redraw.
  for (const kind of CHRONICLE_KINDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    // The mark repeats aria-pressed for sighted players, so state is not colour alone.
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    btn.append(mark, KIND_NAMES[kind]);
    const sync = () => {
      const on = shownKinds.has(kind);
      btn.setAttribute('aria-pressed', String(on));
      mark.textContent = on ? '[x] ' : '[ ] ';
    };
    sync();
    btn.addEventListener('click', () => {
      if (!shownKinds.delete(kind)) shownKinds.add(kind);
      sync();
      draw(shown, true);
    });
    filters.append(btn);
  }

  let shown: ChronicleEntry[] = [];
  // The list item of every entry currently in the list.
  let items = new Map<ChronicleEntry, HTMLLIElement>();
  const add = (entry: ChronicleEntry) => {
    const li = line(entry);
    items.set(entry, li);
    return li;
  };

  function draw(entries: ChronicleEntry[], refilter: boolean): void {
    // Entries are shared between realms, so the newest shown line is found by
    // identity. When it's gone (a whole Chronicle's worth of lines at once, or
    // a different realm) or the filters changed, redraw from scratch.
    const last = shown.at(-1);
    const from = last ? entries.lastIndexOf(last) + 1 : 0;
    if (refilter || (last && from === 0)) {
      items = new Map();
      list.replaceChildren(...chronicleView(entries, shownKinds).map(add));
    } else {
      // Lines past the cap leave the Chronicle from the oldest end.
      for (const old of shown) {
        if (old === entries[0]) break;
        items.get(old)?.remove();
        items.delete(old);
      }
      list.prepend(...chronicleView(entries.slice(from), shownKinds).map(add));
    }
    const none = list.childElementCount === 0;
    if (entries.length === 0) empty.textContent = 'Nothing has happened yet.';
    else if (shownKinds.size === 0) empty.textContent = 'Every kind is turned off.';
    else empty.textContent = 'No lines match the filters.';
    empty.hidden = !none;
    list.hidden = none;
    shown = entries;
  }

  return (realm) => {
    if (realm.chronicle !== shown) draw(realm.chronicle, false);
  };
}
