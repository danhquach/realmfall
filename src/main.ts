import { advance, parseSpeed } from './core/loop.ts';
import { RESOURCES, createRealm, rates } from './core/realm.ts';

// Placeholder screen: proves the simulation runs in the page. The real text UI
// replaces this.
const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const title = document.createElement('h1');
title.textContent = 'Realmfall';
const clock = document.createElement('p');
const list = document.createElement('ul');
root.append(title, clock, list);

const rows = new Map(
  RESOURCES.map((k) => {
    const li = document.createElement('li');
    list.append(li);
    return [k, li] as const;
  }),
);

// The run seed comes from the platform's random source; Math.random is banned.
let realm = createRealm(crypto.getRandomValues(new Uint32Array(1))[0]!);

// Dev builds only: ?speed=1|5|20 runs game time faster for testing.
const speed = import.meta.env.DEV
  ? parseSpeed(new URLSearchParams(location.search).get('speed'))
  : 1;

function render(): void {
  const r = rates(realm);
  clock.textContent = `Year ${realm.year} · ${Math.floor(realm.time)} s${speed > 1 ? ` · ${speed}×` : ''}`;
  for (const k of RESOURCES) {
    const sign = r[k] >= 0 ? '+' : '';
    rows.get(k)!.textContent = `${k}: ${Math.floor(realm.stores[k])} (${sign}${r[k].toFixed(1)}/s)`;
  }
}

// Fixed-step loop: real time (scaled by speed) accumulates and the simulation
// consumes it in whole STEP-sized ticks, whatever the frame rate.
let pending = 0;
let last = performance.now();

function frame(now: number): void {
  pending += ((now - last) / 1000) * speed;
  last = now;
  ({ realm, pending } = advance(realm, pending));
  render();
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
