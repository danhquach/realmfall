import { TRAIT_INFO, TRAITS, traitLabel, type Trait } from '../core/realm.ts';

/** Writes only on change, so the per-frame redraw doesn't churn the DOM. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function panel(title: string): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', undefined, title));
  return section;
}

/**
 * A button greyed out with aria-disabled rather than `disabled`, so it keeps
 * keyboard focus when a press uses up the last idle peasant or the last of a cost.
 */
export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') !== 'true') onClick();
  });
  return b;
}

export function setEnabled(b: HTMLButtonElement, enabled: boolean): void {
  const value = String(!enabled);
  if (b.getAttribute('aria-disabled') !== value) b.setAttribute('aria-disabled', value);
}

/** A trait's name and tier, in its tier colour (§9). */
export function traitName(trait: Trait): HTMLSpanElement {
  return el('span', `tier-${TRAIT_INFO[trait].tier}`, traitLabel(trait));
}

const LABELS = TRAITS.map((t) => ({ trait: t, label: traitLabel(t) }));

/** `text` as text nodes, with every trait label in it coloured by tier (§9). */
export function traitText(text: string): (string | Node)[] {
  const out: (string | Node)[] = [];
  let rest = text;
  for (;;) {
    let next: { at: number; trait: Trait; label: string } | null = null;
    for (const { trait, label } of LABELS) {
      const at = rest.indexOf(label);
      if (at >= 0 && (!next || at < next.at)) next = { at, trait, label };
    }
    if (!next) break;
    if (next.at > 0) out.push(rest.slice(0, next.at));
    out.push(traitName(next.trait));
    rest = rest.slice(next.at + next.label.length);
  }
  if (rest) out.push(rest);
  return out;
}

/** Like setText, colouring trait labels. */
export function setTraitText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.replaceChildren(...traitText(text));
}
