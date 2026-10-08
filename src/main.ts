import { RESOURCES, createRealm, rates, tick } from './core/realm.ts';

// Placeholder screen: proves the simulation runs in the page. The real text UI
// replaces this.
const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const title = document.createElement('h1');
title.textContent = 'Realmfall';
const list = document.createElement('ul');
root.append(title, list);

const rows = new Map(
  RESOURCES.map((k) => {
    const li = document.createElement('li');
    list.append(li);
    return [k, li] as const;
  }),
);

let realm = createRealm();
const STEP = 0.25;

function render(): void {
  const r = rates(realm);
  for (const k of RESOURCES) {
    const sign = r[k] >= 0 ? '+' : '';
    rows.get(k)!.textContent = `${k}: ${Math.floor(realm.stores[k])} (${sign}${r[k].toFixed(1)}/s)`;
  }
}

render();
setInterval(() => {
  realm = tick(realm, STEP);
  render();
}, STEP * 1000);
