import { parseSpeed } from './core/loop.ts';
import { type Realm } from './core/realm.ts';
import { createRng } from './core/rng.ts';
import { mountChronicle } from './ui/chronicle.ts';
import { mountLayout } from './ui/layout.ts';
import { mountNewGame } from './ui/newGame.ts';
import { mountRealmPanels } from './ui/realmPanels.ts';
import { SAVE_KEY, browserStorage, startAutosave } from './storage/autosave.ts';
import { startGame } from './storage/game.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

/** A seed from the platform's random source; Math.random is banned. */
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

// A saved realm resumes after replaying the time away since it was saved; with
// none, or a bad one, a new run starts on a random seed.
const game = startGame({ store: browserStorage, now: Date.now, newSeed: randomSeed });
// Battles the player starts roll on their own stream, seeded the same way.
const battleRng = createRng(randomSeed());

// Dev builds only: ?speed=1|5|20 runs game time faster for testing.
const speed = import.meta.env.DEV
  ? parseSpeed(new URLSearchParams(location.search).get('speed'))
  : 1;

const layout = mountLayout(root);

const renderPanels = mountRealmPanels(
  layout,
  (change) => {
    game.act(change);
    render(game.realm);
  },
  battleRng,
);
const renderChronicle = mountChronicle(layout.tabs.chronicle);
const renderNewGame = mountNewGame(layout, () => {
  game.newGame();
  render(game.realm);
});

if (speed > 1) {
  const note = document.createElement('p');
  note.textContent = `Dev speed ${speed}×`;
  layout.status.append(note);
}

function render(next: Realm): void {
  renderPanels(next);
  renderChronicle(next);
  renderNewGame(next);
}

// Fixed-step loop: real time (scaled by speed) accumulates and the simulation
// consumes it in whole STEP-sized ticks, whatever the frame rate. A background
// tab gets no frames, so its return is one long gap, replayed as time away.
let last = performance.now();

function frame(now: number): void {
  game.frame((now - last) / 1000, speed);
  last = now;
  render(game.realm);
  requestAnimationFrame(frame);
}

// Autosave reads the game's realm when it runs, so after a new game it saves the new one.
startAutosave(() => game.save());
// A new game started in another tab replaces this tab's realm, so this tab's
// autosave can't write the old run back over it.
addEventListener('storage', (e) => {
  if (e.key === SAVE_KEY) game.sync();
});
render(game.realm);
requestAnimationFrame(frame);
