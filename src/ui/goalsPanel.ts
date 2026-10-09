import {
  MILESTONES,
  challengeText,
  milestoneProgress,
  nextGoal,
  type Realm,
} from '../core/realm.ts';
import { el, panel, setText } from './dom.ts';

/**
 * Builds the Goals panel (docs/design.md §9) inside `panels` once,
 * and returns the function that refreshes it from a realm: the "Next" hint,
 * every milestone with its progress or ✓, and the challenge line shared with
 * the Traits panel.
 */
export function mountGoalsPanel(panels: HTMLElement): (realm: Realm) => void {
  const section = panel('Goals');
  section.classList.add('goals');
  const next = el('p', 'next');
  const milestoneList = el('ul', 'rows milestones');
  // Keeps `list-style: none` from dropping the list's semantics in Safari.
  milestoneList.setAttribute('role', 'list');
  const rows = MILESTONES.map(() => {
    const li = el('li');
    milestoneList.append(li);
    return li;
  });
  const challengeLine = el('p');

  section.append(
    next,
    el('h3', undefined, 'Milestones'),
    milestoneList,
    el('h3', undefined, 'Challenge'),
    challengeLine,
  );
  panels.append(section);

  return (realm) => {
    setText(next, nextGoal(realm));
    milestoneProgress(realm).forEach((p, i) => {
      setText(rows[i]!, `${p.goal}: ${p.reached ? '✓ reached' : `${p.count} / ${p.target}`}`);
    });
    setText(challengeLine, challengeText(realm));
  };
}
