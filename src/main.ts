import { catchUp, parseSpeed, play } from './core/loop.ts';
import { createRealm, type Realm } from './core/realm.ts';
import { createRng } from './core/rng.ts';
import { mountChronicle } from './ui/chronicle.ts';
import { mountLayout } from './ui/layout.ts';
import { mountRealmPanels } from './ui/realmPanels.ts';
import { loadSave, saveRealm, startAutosave } from './storage/autosave.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

// A saved realm resumes after replaying the time away since it was saved; with
// none, or a bad one, a new run starts. Its seed comes from the platform's
// random source; Math.random is banned.
const saved = loadSave();
let realm = saved
  ? catchUp(saved.realm, saved.savedAt === null ? 0 : (Date.now() - saved.savedAt) / 1000)
  : createRealm(crypto.getRandomValues(new Uint32Array(1))[0]!);
// Stamp the replayed realm at once, so a crash before the next autosave can't replay it twice.
if (saved) saveRealm(realm);
// Battles the player starts roll on their own stream, seeded the same way.
const battleRng = createRng(crypto.getRandomValues(new Uint32Array(1))[0]!);

// Dev builds only: ?speed=1|5|20 runs game time faster for testing.
const speed = import.meta.env.DEV
  ? parseSpeed(new URLSearchParams(location.search).get('speed'))
  : 1;

const layout = mountLayout(root);

const renderPanels = mountRealmPanels(
  layout,
  (change) => {
    realm = change(realm);
    // Save each action at once, so a reload can't undo a lost battle.
    saveRealm(realm);
    render(realm);
  },
  battleRng,
);
const renderChronicle = mountChronicle(layout.tabs.chronicle);

if (speed > 1) {
  const note = document.createElement('p');
  note.textContent = `Dev speed ${speed}×`;
  layout.status.append(note);
}

function render(next: Realm): void {
  renderPanels(next);
  renderChronicle(next);
}

// Fixed-step loop: real time (scaled by speed) accumulates and the simulation
// consumes it in whole STEP-sized ticks, whatever the frame rate. A background
// tab gets no frames, so its return is one long gap, replayed as time away.
let pending = 0;
let last = performance.now();

function frame(now: number): void {
  ({ realm, pending } = play(realm, pending, (now - last) / 1000, speed));
  last = now;
  render(realm);
  requestAnimationFrame(frame);
}

startAutosave(() => realm);
render(realm);
requestAnimationFrame(frame);
