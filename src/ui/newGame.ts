import { isFallen, type Realm } from '../core/realm.ts';
import { el, setText } from './dom.ts';
import type { Layout } from './layout.ts';

/**
 * Builds the New game button in the status bar, its confirmation, and the
 * fallen-realm notice (docs/design.md §4, §14) inside `layout` once, and
 * returns the function that refreshes them from a realm.
 *
 * New game asks first, in the page: Start new game runs `start`; Cancel, Esc
 * or pressing New game again closes the question and changes nothing. While
 * the realm has fallen, a notice says so and offers the same new game, and
 * the Build, Army, Rivals and Traits panels are locked (inert); the Chronicle
 * stays readable.
 */
export function mountNewGame(layout: Layout, start: () => void): (realm: Realm) => void {
  const open = el('button', 'new-game-button', 'New game');
  open.type = 'button';
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', 'new-game-confirm');
  layout.tools.prepend(open);

  const confirm = el('section', 'notice confirm');
  confirm.id = 'new-game-confirm';
  confirm.setAttribute('role', 'group');
  confirm.setAttribute('aria-labelledby', 'new-game-question');
  confirm.hidden = true;
  const question = el('p');
  question.id = 'new-game-question';
  const yes = el('button', undefined, 'Start new game');
  yes.type = 'button';
  const no = el('button', undefined, 'Cancel');
  no.type = 'button';
  confirm.append(question, yes, no);

  const fallen = el('section', 'notice fallen');
  // Announced once when it appears.
  fallen.setAttribute('role', 'alert');
  fallen.hidden = true;
  const fallenTitle = el('strong');
  const fallenText = el('p');
  fallenText.append(fallenTitle, ' Everyone has left. Nothing more will happen here.');
  const again = el('button', undefined, 'Start a new game');
  again.type = 'button';
  fallen.append(fallenText, again);

  layout.notices.append(fallen, confirm);

  /** The button that opened the question, where focus goes back on Cancel. */
  let opener: HTMLButtonElement = open;

  const ask = (from: HTMLButtonElement) => {
    opener = from;
    confirm.hidden = false;
    open.setAttribute('aria-expanded', 'true');
    // The safe answer has focus, so a stray Enter cancels.
    no.focus();
  };
  const close = () => {
    confirm.hidden = true;
    open.setAttribute('aria-expanded', 'false');
    // A hidden opener (the fallen notice's button after a new game) can't take focus.
    (opener.offsetParent ? opener : open).focus();
  };

  open.addEventListener('click', () => (confirm.hidden ? ask(open) : close()));
  again.addEventListener('click', () => ask(again));
  no.addEventListener('click', () => close());
  yes.addEventListener('click', () => {
    start();
    opener = open;
    close();
  });
  confirm.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  });

  const locked = [layout.tabs.build, layout.tabs.army, layout.tabs.rivals, layout.tabs.traits];
  let wasFallen: boolean | null = null;

  return (realm) => {
    setText(question, `Start a new game? ${realm.name} and its save will be lost.`);
    setText(fallenTitle, `${realm.name} has fallen.`);
    const down = isFallen(realm);
    if (down === wasFallen) return;
    wasFallen = down;
    fallen.hidden = !down;
    for (const panel of locked) panel.inert = down;
  };
}
