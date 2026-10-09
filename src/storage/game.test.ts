import { describe, expect, it } from 'vitest';
import { STEP } from '../core/loop.ts';
import { createRealm, fallenText, isFallen, train, type Realm } from '../core/realm.ts';
import { serialize } from '../core/save.ts';
import { AUTOSAVE_MS, SAVE_KEY, loadSave, startAutosave, type KeyValueStore } from './autosave.ts';
import { resetSave, startGame, type GameDeps } from './game.ts';

const NOW = 1_800_000_000_000;
const TAB_KEY = 'realmfall.tab';

/** A stand-in localStorage over a Map, logging every call. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: KeyValueStore = {
    getItem: (k) => (calls.push(`get ${k}`), items.get(k) ?? null),
    setItem: (k, v) => void (calls.push(`set ${k}`), items.set(k, v)),
    removeItem: (k) => void (calls.push(`remove ${k}`), items.delete(k)),
  };
  return { store, items, calls };
}

function throwing(): KeyValueStore {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

/** Seeds handed out in order: 1001, 1002, … */
function deps(store: KeyValueStore, now = NOW): GameDeps & { seeds: number[] } {
  const seeds: number[] = [];
  return {
    store,
    now: () => now,
    newSeed: () => {
      seeds.push(1001 + seeds.length);
      return seeds.at(-1)!;
    },
    seeds,
  };
}

/** A realm some way into its run, saved at NOW. */
function playedSave(): { realm: Realm; save: string } {
  let realm = createRealm(7);
  realm = { ...realm, time: 40, year: 6, stores: { ...realm.stores, gold: 123 } };
  return { realm, save: serialize(realm, NOW) };
}

/** No one left; the save validates (people are 0, everything else in range). */
function fallen(seed = 7): Realm {
  const realm = createRealm(seed);
  return {
    ...realm,
    idle: 0,
    jobs: { farmer: 0, woodcutter: 0, miner: 0, builder: 0 },
    soldiers: 0,
    stores: { ...realm.stores, food: 0 },
  };
}

describe('resetSave', () => {
  it('removes the save and writes the starting realm on the given seed', () => {
    const { store, items, calls } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const realm = resetSave(store, 42, NOW);
    expect(realm).toEqual(createRealm(42));
    expect(calls).toEqual([`remove ${SAVE_KEY}`, `set ${SAVE_KEY}`]);
    expect(loadSave(store)).toEqual({ realm: createRealm(42), savedAt: NOW });
    expect(items.get(SAVE_KEY)).not.toContain('"gold":123');
  });

  it('starts the same realm from the same seed', () => {
    const a = resetSave(memoryStorage().store, 99, NOW);
    const b = resetSave(memoryStorage().store, 99, NOW + 5);
    expect(a).toEqual(b);
    expect(a).toEqual(createRealm(99));
    expect(resetSave(memoryStorage().store, 100, NOW)).not.toEqual(a);
  });

  it('keeps the remembered tab, a view setting rather than part of the run', () => {
    const { store, items } = memoryStorage({ [SAVE_KEY]: playedSave().save, [TAB_KEY]: 'army' });
    resetSave(store, 1, NOW);
    expect(items.get(TAB_KEY)).toBe('army');
  });

  it('still starts a new realm when storage is blocked', () => {
    expect(resetSave(throwing(), 5, NOW)).toEqual(createRealm(5));
  });
});

describe('startGame', () => {
  it('starts the starting realm on a fresh seed when there is no save', () => {
    const d = deps(memoryStorage().store);
    const game = startGame(d);
    expect(game.realm).toEqual(createRealm(1001));
  });

  it('resumes a save, replaying the time since it was saved', () => {
    const { realm, save } = playedSave();
    const { store } = memoryStorage({ [SAVE_KEY]: save });
    const game = startGame(deps(store, NOW + 10_000));
    expect(game.realm.seed).toBe(realm.seed);
    expect(game.realm.time).toBe(realm.time + 10);
  });

  it.each([
    ['not JSON', '{'],
    ['a prototype key', `{"__proto__":{"version":4},"version":4}`],
    ['markup in the name', playedSave().save.replace('"Hearthmoor"', '"<b>x</b>"')],
    [
      'a bidi override in the name',
      playedSave().save.replace('"Hearthmoor"', '"\\u202eHearthmoor"'),
    ],
    ['negative people', playedSave().save.replace('"idle":3', '"idle":-1')],
    ['an oversized save', `"${'x'.repeat(300 * 1024)}"`],
  ])('starts over from a hostile save: %s', (_, bad) => {
    const { store } = memoryStorage({ [SAVE_KEY]: bad });
    const game = startGame(deps(store));
    expect(game.realm).toEqual(createRealm(1001));
    expect(Object.getPrototypeOf(game.realm)).toBe(Object.prototype);
  });

  it('plays on unsaved when storage is blocked', () => {
    const game = startGame(deps(throwing()));
    expect(game.realm).toEqual(createRealm(1001));
    expect(() => game.save()).not.toThrow();
    expect(() => game.newGame()).not.toThrow();
  });
});

describe('a new game', () => {
  it('replaces the realm and the save with the starting realm on a new seed', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const d = deps(store);
    const game = startGame(d);
    expect(game.realm.seed).toBe(7);
    game.newGame();
    expect(game.realm).toEqual(createRealm(1001));
    // The next load starts there.
    expect(startGame(deps(store)).realm).toEqual(createRealm(1001));
  });

  it("can't be overwritten by autosave or a page-leave save afterwards", () => {
    const { store } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const game = startGame(deps(store));
    // Autosave is wired to the game before the new game, as the page does.
    const timers: (() => void)[] = [];
    const leaves: (() => void)[] = [];
    startAutosave(() => game.save(), {
      every: (ms, save) => {
        expect(ms).toBe(AUTOSAVE_MS);
        timers.push(save);
      },
      onLeave: (save) => leaves.push(save),
    });
    game.newGame();
    for (const save of [...timers, ...leaves]) {
      save();
      expect(loadSave(store)!.realm).toEqual(createRealm(1001));
    }
  });

  it('drops time left over from the old realm', () => {
    const game = startGame(deps(memoryStorage().store));
    game.frame(STEP * 0.9, 1);
    game.newGame();
    game.frame(STEP * 0.2, 1);
    expect(game.realm.time).toBe(0);
  });

  it('is picked up by another tab, so its autosave keeps the new run', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const here = startGame(deps(store));
    const there = startGame(deps(store));
    there.newGame();
    here.sync();
    expect(here.realm).toEqual(createRealm(1001));
    here.save();
    expect(loadSave(store)!.realm.seed).toBe(1001);
  });

  it('puts the new run back when a tab that had not heard of it saves the old one', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const here = startGame(deps(store));
    const there = startGame(deps(store));
    here.newGame();
    // The other tab autosaves the old run before its storage event arrives.
    there.save();
    here.sync();
    expect(here.realm).toEqual(createRealm(1001));
    expect(loadSave(store)!.realm.seed).toBe(1001);
    // Then the other tab hears of it and adopts the new run.
    there.sync();
    expect(there.realm.seed).toBe(1001);
  });

  it("leaves another tab's saves of the same run alone", () => {
    const { store } = memoryStorage({ [SAVE_KEY]: playedSave().save });
    const here = startGame(deps(store));
    const before = here.realm;
    store.setItem(SAVE_KEY, serialize({ ...before, stores: { ...before.stores, gold: 1 } }, NOW));
    here.sync();
    expect(here.realm).toBe(before);
    // A removed or bad save is no new game either.
    store.removeItem(SAVE_KEY);
    here.sync();
    store.setItem(SAVE_KEY, '{"version":4,"realm":{"__proto__":{"seed":1}}}');
    here.sync();
    expect(here.realm).toBe(before);
  });
});

describe('a fallen realm', () => {
  it('is fallen with its line written right after load', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: serialize(fallen(), NOW) });
    const game = startGame(deps(store, NOW + 3_600_000));
    expect(isFallen(game.realm)).toBe(true);
    expect(game.realm.chronicle.map((c) => c.text)).toEqual([fallenText(game.realm)]);
    // Stood still through the hour away, with no "Away" line.
    expect(game.realm.time).toBe(0);
  });

  it('is fallen right after load from a save with no stamp', () => {
    const save = JSON.stringify({ ...JSON.parse(serialize(fallen())), savedAt: undefined });
    const game = startGame(deps(memoryStorage({ [SAVE_KEY]: save }).store));
    expect(isFallen(game.realm)).toBe(true);
    expect(game.realm.chronicle).toHaveLength(1);
  });

  it('keeps one fallen line across saves, loads and frames', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: serialize(fallen(), NOW) });
    let game = startGame(deps(store, NOW + 120_000));
    for (let i = 0; i < 3; i++) {
      game.frame(1, 1);
      game.frame(3600, 1);
      game.save();
      game = startGame(deps(store, NOW + 7_200_000 * (i + 2)));
    }
    const lines = game.realm.chronicle.filter((c) => c.kind === 'realm');
    expect(lines).toHaveLength(1);
    expect(game.realm.chronicle).toHaveLength(1);
  });

  it('falls during offline catch-up and is fallen once loaded', () => {
    // Nothing to eat and no farmers: everyone leaves within the hour away.
    const realm = createRealm(3);
    const starving = { ...realm, stores: { ...realm.stores, food: 0 } };
    const jobs = { farmer: 0, woodcutter: 2, miner: 0, builder: 1 };
    const save = serialize({ ...starving, jobs, idle: 3 }, NOW);
    const game = startGame(deps(memoryStorage({ [SAVE_KEY]: save }).store, NOW + 3_600_000));
    expect(isFallen(game.realm)).toBe(true);
    const kinds = game.realm.chronicle.map((c) => c.kind);
    expect(kinds.filter((k) => k === 'realm')).toHaveLength(1);
    // The "Away" line covers the time up to the fall.
    expect(kinds.at(-1)).toBe('away');
    expect(game.realm.chronicle.at(-1)!.text).toMatch(/people 6 to 0; soldiers 0 to 0/);
  });

  it('takes no player actions', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: serialize(fallen(), NOW) });
    const game = startGame(deps(store));
    const before = game.realm;
    game.act((r) => ({ ...r, idle: 5 }));
    game.act((r) => train(r));
    expect(game.realm).toBe(before);
  });

  it('can start a new game', () => {
    const { store } = memoryStorage({ [SAVE_KEY]: serialize(fallen(), NOW) });
    const game = startGame(deps(store));
    game.newGame();
    expect(isFallen(game.realm)).toBe(false);
    expect(loadSave(store)!.realm).toEqual(createRealm(1001));
  });
});
