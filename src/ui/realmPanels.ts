import {
  BUILDINGS,
  JOBS,
  RESOURCES,
  RIVAL_ACTIONS,
  SOLDIER,
  armyPower,
  assign,
  attack,
  build,
  buildingCost,
  canAfford,
  disband,
  housingCap,
  population,
  rates,
  rivalView,
  scout,
  storeCaps,
  traitLabel,
  train,
  tribute,
  unassign,
  upgradeCost,
  upgradeStorehouse,
  winChance,
  type Building,
  type Cost,
  type Job,
  type Realm,
} from '../core/realm.ts';
import type { Rng } from '../core/rng.ts';
import { button, el, panel, setEnabled, setText, setTraitText } from './dom.ts';
import { mountGoalsPanel } from './goalsPanel.ts';
import { mountTraitPanel } from './traitPanel.ts';

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

/**
 * The Chronicle lines `after` added on top of `before`. Entries are shared, so
 * the old last line is found by identity; this holds at the 200-line cap as
 * long as one action writes fewer than 200 lines (it writes at most three).
 */
function newLines(before: Realm, after: Realm): string[] {
  const last = before.chronicle.at(-1);
  const from = last ? after.chronicle.lastIndexOf(last) + 1 : 0;
  return after.chronicle.slice(from).map((e) => e.text);
}

interface RivalRow {
  li: HTMLLIElement;
  label: HTMLSpanElement;
  info: HTMLSpanElement;
  scoutBtn: HTMLButtonElement;
  tributeBtn: HTMLButtonElement;
  attackBtn: HTMLButtonElement;
}

/**
 * Builds the header, Goals, Stores, People, Buildings, Army, Rivals and Traits panels inside
 * `root` once, and returns the function that refreshes them from a realm.
 * Controls are created once and kept, so keyboard focus survives the per-frame
 * redraw. `battleRng` rolls the battles the player starts.
 */
export function mountRealmPanels(
  root: HTMLElement,
  act: Act,
  battleRng: Rng,
): (realm: Realm) => void {
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

  const army = panel('Army');
  const armyLine = el('p');
  const armyList = el('ul', 'rows');
  army.append(armyLine, armyList);
  const soldiersLabel = el('span', 'label');
  const disbandBtn = button('−', () => act((r) => disband(r)));
  disbandBtn.setAttribute('aria-label', 'Disband one spearman');
  const trainBtn = button('+', () => act((r) => train(r)));
  trainBtn.setAttribute('aria-label', `Train one spearman (${formatCost(SOLDIER.cost)})`);
  const trainLi = el('li');
  trainLi.append(soldiersLabel, el('span', 'controls'));
  trainLi.lastElementChild!.append(disbandBtn, trainBtn);
  armyList.append(trainLi);
  army.append(el('p', 'note', `Each takes an idle peasant and ${formatCost(SOLDIER.cost)}.`));

  const rivals = panel('Rivals');
  const rivalList = el('ul', 'rivals');
  // Battle, scouting and tribute results, announced as they happen.
  const report = el('p', 'report');
  report.setAttribute('aria-live', 'polite');
  rivals.append(rivalList, report);
  // Rows are keyed by rival name (names are unique), so when a conquered rival
  // leaves the list the rows after it never start pointing at another rival.
  const rivalRows = new Map<string, RivalRow>();

  /** Runs a rival action and shows the Chronicle lines it wrote, dated. */
  const rivalAct = (change: (realm: Realm) => Realm) =>
    act((r) => {
      const next = change(r);
      const lines = newLines(r, next);
      if (lines.length > 0) setText(report, `Year ${next.year}: ${lines.join(' ')}`);
      return next;
    });

  /** The rival named `name` in `realm`, by index; -1 (a no-op for every action) once it's gone. */
  const at = (realm: Realm, name: string) => realm.rivals.findIndex((r) => r.name === name);

  const rivalRow = (name: string): RivalRow => {
    const label = el('span', 'label');
    const info = el('span', 'info');
    const scoutText = `Scout (${RIVAL_ACTIONS.scoutGold} gold)`;
    const scoutBtn = button(scoutText, () => rivalAct((r) => scout(r, at(r, name))));
    // Accessible names start with the visible text, so voice control can use it.
    scoutBtn.setAttribute('aria-label', `${scoutText} ${name}`);
    const tributeText = `Tribute (${RIVAL_ACTIONS.tributeGold} gold)`;
    const tributeBtn = button(tributeText, () => rivalAct((r) => tribute(r, at(r, name))));
    tributeBtn.setAttribute('aria-label', `${tributeText} to ${name}`);
    const attackBtn = button('Attack', () => rivalAct((r) => attack(r, at(r, name), battleRng)));
    attackBtn.setAttribute('aria-label', `Attack ${name}`);
    const li = el('li');
    li.append(label, info, el('span', 'controls'));
    li.lastElementChild!.append(scoutBtn, tributeBtn, attackBtn);
    return { li, label, info, scoutBtn, tributeBtn, attackBtn };
  };

  const panels = el('div', 'panels');
  panels.append(stores, people, buildings, army, rivals);
  const renderTraits = mountTraitPanel(panels, act);
  const renderGoals = mountGoalsPanel(panels);
  root.append(header, panels);

  return (realm) => {
    renderTraits(realm);
    renderGoals(realm);
    setText(title, realm.name);
    setText(subtitle, `Year ${realm.year}`);

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

    const power = armyPower(realm);
    setText(armyLine, `Army power ${Math.round(power)}`);
    setText(soldiersLabel, `Spearmen ${realm.soldiers}`);
    setEnabled(disbandBtn, realm.soldiers > 0);
    setEnabled(trainBtn, realm.idle > 0 && canAfford(realm, SOLDIER.cost));

    const names = new Set(realm.rivals.map((r) => r.name));
    for (const [name, row] of rivalRows) {
      if (!names.has(name)) {
        row.li.remove();
        rivalRows.delete(name);
      }
    }
    const scoutGold = { gold: RIVAL_ACTIONS.scoutGold };
    const tributeGold = { gold: RIVAL_ACTIONS.tributeGold };
    realm.rivals.forEach((rival, i) => {
      // The UI reads rivals only through rivalView, so unscouted stats stay hidden.
      const v = rivalView(rival);
      let row = rivalRows.get(v.name);
      if (!row) {
        row = rivalRow(v.name);
        rivalRows.set(v.name, row);
      }
      // Moves a row only when it is out of place, so a focused button keeps focus.
      if (rivalList.children[i] !== row.li)
        rivalList.insertBefore(row.li, rivalList.children[i] ?? null);
      setText(row.label, `${v.name} · ${v.hostile ? 'hostile' : 'at peace'}`);
      row.label.classList.toggle('negative', v.hostile);
      setTraitText(
        row.info,
        v.scouted
          ? `Power ${Math.round(v.power)} · ${traitLabel(v.trait)} · Win chance ${Math.round(winChance(power, v.power) * 100)}%`
          : 'Power ? · Not scouted',
      );
      setEnabled(row.scoutBtn, !v.scouted && canAfford(realm, scoutGold));
      setEnabled(row.tributeBtn, v.hostile && canAfford(realm, tributeGold));
      setEnabled(row.attackBtn, realm.soldiers > 0);
    });
  };
}
