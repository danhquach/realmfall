import {
  BUILD_MAX,
  CONSTRUCTION_INFO,
  CONSTRUCTIONS,
  JOBS,
  QUEUE_MAX,
  RESOURCES,
  RIVAL_ACTIONS,
  RIVAL_LEVEL_INFO,
  SOLDIER,
  armedSoldiers,
  armyPower,
  assign,
  atMax,
  attack,
  built,
  canAfford,
  canOrder,
  cancelOrder,
  disband,
  housingCap,
  needText,
  order,
  orderCost,
  orderWork,
  population,
  queueView,
  queued,
  rates,
  rivalView,
  scout,
  storeCaps,
  traitLabel,
  train,
  tribute,
  unassign,
  unmetNeeds,
  winChance,
  type Construction,
  type Cost,
  type Job,
  type Realm,
} from '../core/realm.ts';
import type { Rng } from '../core/rng.ts';
import { button, el, panel, setEnabled, setLabel, setText, setTraitText } from './dom.ts';
import { mountGoalsPanel } from './goalsPanel.ts';
import { mountTraitPanel } from './traitPanel.ts';

/** Applies a player action: the caller swaps in the returned realm and redraws. */
export type Act = (change: (realm: Realm) => Realm) => void;

const JOB_LABELS: Record<Job, string> = {
  farmer: 'Farmers',
  woodcutter: 'Woodcutters',
  miner: 'Miners',
  builder: 'Builders',
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

/** One build-list row; Huts, Markets and Forges also pick how many to build at once. */
interface BuildRow {
  c: Construction;
  li: HTMLLIElement;
  label: HTMLSpanElement;
  btn: HTMLButtonElement;
  count: number;
  picker: { less: HTMLButtonElement; shown: HTMLSpanElement; more: HTMLButtonElement } | null;
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
  const buildRows = CONSTRUCTIONS.map((c) => {
    const label = el('span', 'label');
    const btn = button('', () => act((r) => order(r, c, row.count)));
    const row: BuildRow = { c, li: el('li'), label, btn, count: 1, picker: null };
    const controls = el('span', 'controls');
    if (CONSTRUCTION_INFO[c].max > 1 && !CONSTRUCTION_INFO[c].levelled) {
      const { name } = CONSTRUCTION_INFO[c];
      const less = button('−', () => (row.count = Math.max(1, row.count - 1)));
      less.setAttribute('aria-label', `Build fewer ${name}s`);
      const more = button('+', () => (row.count = Math.min(BUILD_MAX, row.count + 1)));
      more.setAttribute('aria-label', `Build more ${name}s`);
      const shown = el('span', 'count');
      row.picker = { less, shown, more };
      controls.append(less, shown, more);
    }
    controls.append(row.btn);
    row.li.append(label, controls);
    buildList.append(row.li);
    return row;
  });
  const queueStatus = el('p', 'note');
  const queueList = el('ul', 'rows queue');
  // Keeps `list-style: none` from dropping the list's semantics in Safari.
  queueList.setAttribute('role', 'list');
  // One row per queue slot, made once so a focused Cancel button keeps focus.
  const queueRows = Array.from({ length: QUEUE_MAX }, (_, i) => {
    const label = el('span', 'label');
    const cancel = button('Cancel', () => act((r) => cancelOrder(r, i)));
    const li = el('li');
    li.append(label, cancel);
    li.hidden = true;
    queueList.append(li);
    return { li, label, cancel };
  });
  buildings.append(el('h3', undefined, 'Queue'), queueStatus, queueList);

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
  const armyNote = el('p', 'note');
  army.append(armyNote);

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

    for (const row of buildRows) {
      const { c, li, label, btn, count } = row;
      const { name, levelled } = CONSTRUCTION_INFO[c];
      const have = built(realm, c);
      setText(label, levelled ? `${name} level ${have}` : `${name} ${have}`);
      const needs = unmetNeeds(realm, c);
      // A building already at its max stays built even if its requirement is lost (§5).
      const locked = needs.length > 0 && !atMax(realm, c);
      li.classList.toggle('locked', locked);
      const done = have >= CONSTRUCTION_INFO[c].max;
      const price = `${formatCost(orderCost(realm, c, count))}; ${orderWork(realm, c, count)} work`;
      if (atMax(realm, c)) setText(btn, !done ? 'Queued' : levelled ? 'Top level' : 'Built');
      else if (locked) setText(btn, `Needs: ${needs.map(needText).join(', ')}`);
      else if (levelled) setText(btn, `Upgrade to level ${have + queued(realm, c) + 1} (${price})`);
      else if (row.picker) setText(btn, `Build ${count} (${price})`);
      else setText(btn, `Build (${price})`);
      setLabel(btn, `${btn.textContent} ${name}`);
      setEnabled(btn, canOrder(realm, c, count));
      if (row.picker) {
        setText(row.picker.shown, `×${count}`);
        setEnabled(row.picker.less, count > 1);
        setEnabled(row.picker.more, count < BUILD_MAX);
      }
    }
    const view = queueView(realm);
    setText(
      queueStatus,
      view.length === 0
        ? `Empty. Up to ${QUEUE_MAX} orders.`
        : realm.jobs.builder === 0
          ? 'Waiting: no builders.'
          : `${view.length} / ${QUEUE_MAX} orders.`,
    );
    queueRows.forEach(({ li, label, cancel }, i) => {
      const o = view[i];
      li.hidden = !o;
      if (!o) return;
      const left =
        o.secondsLeft === null || !Number.isFinite(o.secondsLeft)
          ? 'waiting'
          : `${Math.ceil(o.secondsLeft)} s left`;
      setText(label, `${o.label}: ${Math.floor(o.done)} / ${o.work} work, ${left}`);
      setLabel(cancel, `Cancel ${o.label}`);
    });

    const power = armyPower(realm);
    setText(
      armyLine,
      `Army power ${Math.round(power)} · Armed ${armedSoldiers(realm)} / ${realm.soldiers}`,
    );
    setText(soldiersLabel, `Spearmen ${realm.soldiers}`);
    setEnabled(disbandBtn, realm.soldiers > 0);
    const barracks = realm.buildings.barracks > 0;
    setEnabled(trainBtn, barracks && realm.idle > 0 && canAfford(realm, SOLDIER.cost));
    setText(
      armyNote,
      barracks ? `Each takes an idle peasant and ${formatCost(SOLDIER.cost)}.` : 'Needs: Barracks.',
    );

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
          ? `${RIVAL_LEVEL_INFO[v.level].name} · Power ${Math.round(v.power)} · ${traitLabel(v.trait)} · Win chance ${Math.round(winChance(power, v.power) * 100)}%`
          : 'Level ? · Power ? · Not scouted',
      );
      setEnabled(row.scoutBtn, !v.scouted && canAfford(realm, scoutGold));
      setEnabled(row.tributeBtn, v.hostile && canAfford(realm, tributeGold));
      setEnabled(row.attackBtn, realm.soldiers > 0);
    });
  };
}
