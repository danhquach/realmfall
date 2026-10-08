import {
  BUILDINGS,
  JOBS,
  RESOURCES,
  assign,
  build,
  buildingCost,
  canAfford,
  housingCap,
  population,
  rates,
  storeCaps,
  unassign,
  upgradeCost,
  upgradeStorehouse,
  type Building,
  type Cost,
  type Job,
  type Realm,
} from '../core/realm.ts';

/** Applies a player action: the caller swaps in the returned realm and redraws. */
export type Act = (change: (realm: Realm) => Realm) => void;

const JOB_LABELS: Record<Job, string> = {
  farmer: 'Farmers',
  woodcutter: 'Woodcutters',
  miner: 'Miners',
};

const BUILDING_LABELS: Record<Building, string> = {
  hut: 'Hut',
  market: 'Market',
  forge: 'Forge',
};

/** "25 wood, 30 gold"; "free" for an empty cost. */
function formatCost(cost: Cost): string {
  const parts = RESOURCES.filter((k) => cost[k] !== undefined).map((k) => `${cost[k]} ${k}`);
  return parts.length > 0 ? parts.join(', ') : 'free';
}

/** Writes only on change, so the per-frame redraw doesn't churn the DOM. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title: string): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', undefined, title));
  return section;
}

/**
 * A button greyed out with aria-disabled rather than `disabled`, so it keeps
 * keyboard focus when a press uses up the last idle peasant or the last of a cost.
 */
function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') !== 'true') onClick();
  });
  return b;
}

function setEnabled(b: HTMLButtonElement, enabled: boolean): void {
  const value = String(!enabled);
  if (b.getAttribute('aria-disabled') !== value) b.setAttribute('aria-disabled', value);
}

/**
 * Builds the header, Stores, People and Buildings panels inside `root` once,
 * and returns the function that refreshes them from a realm. Controls are
 * created once and kept, so keyboard focus survives the per-frame redraw.
 */
export function mountRealmPanels(root: HTMLElement, act: Act): (realm: Realm) => void {
  const header = el('header');
  const title = el('h1');
  const subtitle = el('p', 'subtitle');
  header.append(title, subtitle);

  const stores = panel('Stores');
  const storeList = el('dl', 'stores');
  stores.append(storeList);
  const storeRows = RESOURCES.map((k) => {
    const amount = el('span', 'amount');
    const rate = el('span', 'rate');
    const value = el('dd');
    value.append(amount, ' ', rate);
    storeList.append(el('dt', undefined, k), value);
    return { k, amount, rate };
  });

  const people = panel('People');
  const census = el('p');
  const jobList = el('ul', 'rows');
  people.append(census, jobList);
  const jobRows = JOBS.map((job) => {
    const label = el('span', 'label');
    const less = button('−', () => act((r) => unassign(r, job)));
    less.setAttribute('aria-label', `Unassign one ${job}`);
    const more = button('+', () => act((r) => assign(r, job)));
    more.setAttribute('aria-label', `Assign one ${job}`);
    const li = el('li');
    li.append(label, el('span', 'controls'));
    li.lastElementChild!.append(less, more);
    jobList.append(li);
    return { job, label, less, more };
  });

  const buildings = panel('Buildings');
  const buildList = el('ul', 'rows');
  buildings.append(buildList);
  const buildRows = BUILDINGS.map((b) => {
    const label = el('span', 'label');
    const btn = button('', () => act((r) => build(r, b)));
    const li = el('li');
    li.append(label, btn);
    buildList.append(li);
    return { b, label, btn };
  });
  const storehouseLabel = el('span', 'label');
  const storehouseBtn = button('', () => act(upgradeStorehouse));
  const storehouseLi = el('li');
  storehouseLi.append(storehouseLabel, storehouseBtn);
  buildList.append(storehouseLi);

  const panels = el('div', 'panels');
  panels.append(stores, people, buildings);
  root.append(header, panels);

  return (realm) => {
    setText(title, realm.name);
    setText(
      subtitle,
      `Year ${realm.year} · ${realm.ruler.name}, age ${realm.ruler.age} · ${realm.dynasty}`,
    );

    const r = rates(realm);
    const caps = storeCaps(realm);
    for (const { k, amount, rate } of storeRows) {
      setText(amount, `${Math.floor(realm.stores[k])} / ${caps[k]}`);
      // Round first so a tiny drain doesn't show as a red "-0.0".
      const shown = Math.round(r[k] * 10) / 10;
      setText(rate, `${shown < 0 ? '−' : '+'}${Math.abs(shown).toFixed(1)}/s`);
      rate.classList.toggle('negative', shown < 0);
    }

    setText(census, `Population ${population(realm)} / ${housingCap(realm)} · Idle ${realm.idle}`);
    for (const { job, label, less, more } of jobRows) {
      setText(label, `${JOB_LABELS[job]} ${realm.jobs[job]}`);
      setEnabled(less, realm.jobs[job] > 0);
      setEnabled(more, realm.idle > 0);
    }

    for (const { b, label, btn } of buildRows) {
      const cost = buildingCost(realm, b);
      setText(label, `${BUILDING_LABELS[b]}s ${realm.buildings[b]}`);
      setText(btn, `Build ${BUILDING_LABELS[b]} (${formatCost(cost)})`);
      setEnabled(btn, canAfford(realm, cost));
    }
    const next = upgradeCost(realm);
    setText(storehouseLabel, `Storehouse level ${realm.storehouse}`);
    setText(storehouseBtn, `Upgrade to ${realm.storehouse + 1} (${formatCost(next)})`);
    setEnabled(storehouseBtn, canAfford(realm, next));
  };
}
