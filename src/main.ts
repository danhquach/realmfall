import { advance, parseSpeed } from './core/loop.ts';
import { createRealm } from './core/realm.ts';
import { mountRealmPanels } from './ui/realmPanels.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

// The run seed comes from the platform's random source; Math.random is banned.
let realm = createRealm(crypto.getRandomValues(new Uint32Array(1))[0]!);

// Dev builds only: ?speed=1|5|20 runs game time faster for testing.
const speed = import.meta.env.DEV
  ? parseSpeed(new URLSearchParams(location.search).get('speed'))
  : 1;

if (speed > 1) {
  const note = document.createElement('p');
  note.textContent = `Dev speed ${speed}×`;
  root.append(note);
}

const render = mountRealmPanels(root, (change) => {
  realm = change(realm);
  render(realm);
});

// Fixed-step loop: real time (scaled by speed) accumulates and the simulation
// consumes it in whole STEP-sized ticks, whatever the frame rate.
let pending = 0;
let last = performance.now();

function frame(now: number): void {
  pending += ((now - last) / 1000) * speed;
  last = now;
  ({ realm, pending } = advance(realm, pending));
  render(realm);
  requestAnimationFrame(frame);
}

render(realm);
requestAnimationFrame(frame);
