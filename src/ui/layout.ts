import { loadTab, saveTab, TABS, type Tab } from '../storage/tabPref.ts';
import { el } from './dom.ts';

const TAB_NAMES: Record<Tab, string> = {
  build: 'Build',
  army: 'Army',
  rivals: 'Rivals',
  traits: 'Traits',
  chronicle: 'Chronicle',
};

/** Below this width the tabs move to a bottom bar and the Chronicle becomes a tab (§18). */
const NARROW = '(max-width: 699px)';

export interface Layout {
  /** The status bar's content, left of the Goals button. */
  status: HTMLElement;
  /** Where each tab's panels go; the Chronicle's is the right column on wide screens. */
  tabs: Record<Tab, HTMLElement>;
  /** The Goals dropdown's content. */
  goals: HTMLElement;
}

/**
 * Builds the one-screen layout (docs/design.md §18) inside `root`: a status
 * bar with the Goals button, a tabbed workspace, and the Chronicle beside it
 * (or as a tab at phone width). The last tab used is remembered; Goals always
 * starts closed.
 */
export function mountLayout(root: HTMLElement): Layout {
  root.classList.add('app');
  const header = el('header', 'status');
  const status = el('div', 'status-info');
  const goalsBtn = el('button', 'goals-button', 'Goals');
  goalsBtn.type = 'button';
  goalsBtn.id = 'goals-button';
  goalsBtn.setAttribute('aria-expanded', 'false');
  goalsBtn.setAttribute('aria-controls', 'goals-pop');
  header.append(status, goalsBtn);

  const workspace = el('div', 'workspace');
  const tablist = el('div', 'tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Workspace');

  const buttons = {} as Record<Tab, HTMLButtonElement>;
  const tabs = {} as Record<Tab, HTMLElement>;
  for (const tab of TABS) {
    const btn = el('button', `tab tab-${tab}`, TAB_NAMES[tab]);
    btn.type = 'button';
    btn.id = `tab-${tab}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `tabpanel-${tab}`);
    btn.addEventListener('click', () => select(tab));
    tablist.append(btn);
    buttons[tab] = btn;

    const tabpanel = el('div', `tabpanel tabpanel-${tab}`);
    tabpanel.id = `tabpanel-${tab}`;
    tabpanel.setAttribute('role', 'tabpanel');
    tabpanel.setAttribute('aria-labelledby', btn.id);
    // Focusable, so a panel that scrolls inside itself can be scrolled from the keyboard.
    tabpanel.tabIndex = 0;
    tabs[tab] = tabpanel;
  }
  // The Chronicle's column is a plain region on wide screens, a tab panel only at phone width.
  tabs.chronicle.classList.remove('tabpanel');
  tabs.chronicle.classList.add('side');
  tabs.chronicle.removeAttribute('tabindex');

  const goals = el('div', 'goals-pop');
  goals.id = 'goals-pop';
  goals.setAttribute('role', 'region');
  goals.setAttribute('aria-label', 'Goals');
  goals.hidden = true;

  workspace.append(tablist, ...TABS.map((t) => tabs[t]));
  // Right after the status bar, so Tab goes from the Goals button straight into it.
  root.append(header, goals, workspace);

  const narrow = matchMedia(NARROW);
  let selected = loadTab();
  /** The tab on show: on wide screens the Chronicle is always beside the tabs, so it shows Build. */
  const current = (): Tab => (!narrow.matches && selected === 'chronicle' ? 'build' : selected);

  function sync(): void {
    const on = current();
    for (const tab of TABS) {
      const active = tab === on;
      buttons[tab].setAttribute('aria-selected', String(active));
      // Roving tabindex: Tab enters the tablist on the selected tab; arrows move within it.
      buttons[tab].tabIndex = active ? 0 : -1;
      tabs[tab].hidden = !active && (tab !== 'chronicle' || narrow.matches);
    }
    const side = tabs.chronicle;
    if (narrow.matches) {
      side.setAttribute('role', 'tabpanel');
      side.setAttribute('aria-labelledby', buttons.chronicle.id);
    } else {
      side.removeAttribute('role');
      side.removeAttribute('aria-labelledby');
    }
  }

  function select(tab: Tab): void {
    selected = tab;
    saveTab(tab);
    sync();
  }

  tablist.addEventListener('keydown', (e) => {
    // The Chronicle tab is only on show (and reachable) at phone width.
    const shown = TABS.filter((t) => t !== 'chronicle' || narrow.matches);
    const at = shown.indexOf(current());
    let to: number;
    if (e.key === 'ArrowRight') to = (at + 1) % shown.length;
    else if (e.key === 'ArrowLeft') to = (at - 1 + shown.length) % shown.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = shown.length - 1;
    else return;
    e.preventDefault();
    select(shown[to]!);
    buttons[shown[to]!].focus();
  });
  // The Chronicle tab disappears on wide screens, and the browser drops its
  // focus before the width change is reported, so whether it had focus is tracked.
  let chronicleFocused = false;
  buttons.chronicle.addEventListener('focus', () => (chronicleFocused = true));
  buttons.chronicle.addEventListener('blur', (e) => {
    // A blur while it is still on show is the player moving on, not the button vanishing.
    if (e.relatedTarget || buttons.chronicle.offsetParent) chronicleFocused = false;
  });
  narrow.addEventListener('change', () => {
    sync();
    const lost = chronicleFocused && document.activeElement !== buttons.chronicle;
    if (!narrow.matches && lost) {
      chronicleFocused = false;
      buttons[current()].focus();
    }
  });
  sync();

  /**
   * Pins Goals right under its button, right-aligned (full width under the
   * status bar at phone width), and keeps it on screen: taller content scrolls inside.
   */
  const place = () => {
    if (goals.hidden) return;
    const gap = 4;
    const top = narrow.matches
      ? header.getBoundingClientRect().bottom
      : goalsBtn.getBoundingClientRect().bottom + gap;
    goals.style.top = `${top}px`;
    goals.style.right = narrow.matches
      ? '0px'
      : `${document.documentElement.clientWidth - goalsBtn.getBoundingClientRect().right}px`;
    const height = document.documentElement.clientHeight;
    goals.style.maxHeight = `${Math.max(0, height - top - (narrow.matches ? 0 : 16))}px`;
  };
  const setOpen = (open: boolean) => {
    goals.hidden = !open;
    goalsBtn.setAttribute('aria-expanded', String(open));
    place();
  };
  // The status bar's height changes as its numbers grow and the window resizes.
  new ResizeObserver(place).observe(header);
  addEventListener('resize', place);
  goalsBtn.addEventListener('click', () =>
    setOpen(goalsBtn.getAttribute('aria-expanded') !== 'true'),
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || goals.hidden) return;
    // Focus inside the dropdown would vanish with it, so it returns to the button.
    if (goals.contains(document.activeElement)) goalsBtn.focus();
    setOpen(false);
  });
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!goals.hidden && !goals.contains(target) && !goalsBtn.contains(target)) setOpen(false);
  });

  return { status, tabs, goals };
}
