import { describe, expect, it } from 'vitest';
import { AWAY_SUMMARY_MIN, MAX_CATCHUP, STEP, advance, catchUp, play } from './loop.ts';
import {
  CHRONICLE_MAX,
  JOBS,
  createRealm,
  fallenText,
  isFallen,
  markFallen,
  population,
  tick,
  type Realm,
} from './realm.ts';
import { parse, serialize } from './save.ts';

const NO_JOBS = { farmer: 0, woodcutter: 0, miner: 0, builder: 0 };

/** No one left. */
function empty(seed = 1): Realm {
  return { ...createRealm(seed), idle: 0, jobs: { ...NO_JOBS }, soldiers: 0 };
}

const fallenLines = (r: Realm) => r.chronicle.filter((c) => c.kind === 'realm');

describe('isFallen (design §4)', () => {
  it('is fallen with no peasants, workers or soldiers', () => {
    expect(isFallen(empty())).toBe(true);
  });

  it('is standing at the start', () => {
    expect(isFallen(createRealm(1))).toBe(false);
  });

  it('is standing while one soldier is left', () => {
    expect(isFallen({ ...empty(), soldiers: 1 })).toBe(false);
  });

  it('is standing while one idle peasant is left', () => {
    expect(isFallen({ ...empty(), idle: 1 })).toBe(false);
  });

  it.each(JOBS)('is standing while one %s is left', (job) => {
    expect(isFallen({ ...empty(), jobs: { ...NO_JOBS, [job]: 1 } })).toBe(false);
  });

  it('ignores stores, buildings and the queue: only people count', () => {
    const rich = { ...empty(), stores: { food: 200, wood: 200, iron: 50, gold: 150, weapons: 20 } };
    expect(isFallen({ ...rich, buildings: { ...rich.buildings, barracks: 1, hut: 3 } })).toBe(true);
  });

  it('matches population() being 0', () => {
    for (const r of [empty(), { ...empty(), soldiers: 2 }, createRealm(3)])
      expect(isFallen(r)).toBe(population(r) === 0);
  });
});

describe('markFallen', () => {
  it('writes one "has fallen" line, dated to the year, of the realm kind', () => {
    const r = { ...empty(), time: 80, year: 11 };
    const next = markFallen(r);
    expect(next.chronicle).toEqual([{ year: 11, kind: 'realm', text: fallenText(r) }]);
    expect(fallenText(r)).toBe('Hearthmoor has fallen: everyone has left.');
  });

  it('writes it once: a second call returns the same realm', () => {
    const once = markFallen(empty());
    expect(markFallen(once)).toBe(once);
  });

  it('leaves a standing realm untouched', () => {
    const r = { ...empty(), soldiers: 1 };
    expect(markFallen(r)).toBe(r);
  });

  it('keeps the line through a save and load without writing another', () => {
    const once = markFallen(empty());
    const loaded = parse(serialize(once))!;
    expect(loaded).toEqual(once);
    expect(fallenLines(markFallen(loaded))).toHaveLength(1);
  });

  it('ignores a fallen line from an earlier year (a hand-edited save)', () => {
    const r = { ...empty(), time: 80, year: 11 };
    const planted = { ...r, chronicle: [{ year: 2, kind: 'realm' as const, text: fallenText(r) }] };
    expect(fallenLines(markFallen(planted))).toHaveLength(2);
    expect(markFallen(planted).chronicle.at(-1)!.year).toBe(11);
  });

  it.each([
    ['a bidi override', '\u202eHearthmoor has fallen: everyone has left.'],
    ['a zero-width space', 'Hearthmoor\u200b has fallen: everyone has left.'],
    ['a look-alike letter', 'Неarthmoor has fallen: everyone has left.'],
    ['an oversized line', 'x'.repeat(201)],
    ['a control character', 'Hearthmoor has fallen.\n'],
  ])('rejects a save whose realm line holds %s', (_, text) => {
    const save = JSON.parse(serialize(markFallen(empty())));
    save.realm.chronicle[0].text = text;
    expect(parse(JSON.stringify(save))).toBeNull();
  });

  it.each(['Realm', 'fallen', '__proto__', 'constructor'])(
    'rejects a save with Chronicle kind %j',
    (kind) => {
      const save = JSON.parse(serialize(markFallen(empty())));
      save.realm.chronicle[0].kind = kind;
      expect(parse(JSON.stringify(save))).toBeNull();
    },
  );

  it('renders markup in a realm line only as text: it loads as the same plain string', () => {
    const save = JSON.parse(serialize(markFallen(empty())));
    save.realm.chronicle[0].text = '<img src=x onerror=alert(1)>';
    expect(parse(JSON.stringify(save))!.chronicle[0]!.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('writes the line into a full Chronicle, dropping the oldest', () => {
    const full = Array.from({ length: CHRONICLE_MAX }, (_, i) => ({
      year: 1,
      kind: 'battles' as const,
      text: `Old line ${i}.`,
    }));
    const next = markFallen({ ...empty(), chronicle: full });
    expect(next.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(next.chronicle.at(-1)!.kind).toBe('realm');
  });
});

describe('tick on a fallen realm', () => {
  it('stands still: no clock, growth, raids or events, only the one line', () => {
    const start = { ...empty(), stores: { food: 200, wood: 0, iron: 0, gold: 0, weapons: 0 } };
    let r = start;
    for (let i = 0; i < 1000; i++) r = tick(r, STEP);
    expect(r.time).toBe(0);
    expect(r.idle).toBe(0);
    expect(r.stores).toEqual(start.stores);
    expect(r.chronicle).toEqual([{ year: 1, kind: 'realm', text: fallenText(start) }]);
    // Once written, the same realm comes back each tick.
    expect(tick(r, STEP)).toBe(r);
    expect(tick(r, 3600)).toBe(r);
    expect(tick(r, NaN)).toBe(r);
  });

  it('writes the line in the step the last person leaves, and drops the rest of it', () => {
    // One idle peasant, no food: hunger 4 after 4 s, and they leave.
    const last = { ...empty(), idle: 1, stores: { ...empty().stores, food: 0 } };
    const r = tick(last, 100);
    expect(population(r)).toBe(0);
    expect(fallenLines(r)).toHaveLength(1);
    // The big step was split at the first event (25 s); the realm stops there.
    expect(r.time).toBe(25);
    let stepped: Realm = last;
    for (let i = 0; i < 100 / STEP; i++) stepped = tick(stepped, STEP);
    expect(fallenLines(stepped)).toHaveLength(1);
    expect(stepped.time).toBe(4);
  });

  it("isn't reached while soldiers are left, though the peasants are gone", () => {
    // Soldiers are lost last to hunger (§4); while any is left the realm stands.
    const r: Realm = {
      ...empty(),
      soldiers: 3,
      stores: { food: 0, wood: 0, iron: 0, gold: 1000, weapons: 0 },
    };
    let next = r;
    const seen: number[] = [];
    while (!isFallen(next) && next.time < 600) {
      next = tick(next, STEP);
      if (next.soldiers > 0) expect(fallenLines(next)).toEqual([]);
      seen.push(next.soldiers);
    }
    expect(seen).toContain(1);
    expect(isFallen(next)).toBe(true);
    expect(fallenLines(next)).toHaveLength(1);
  });
});

describe('the loop on a fallen realm', () => {
  it('advance drops the time left once the realm falls', () => {
    const last = { ...empty(), idle: 1, stores: { ...empty().stores, food: 0 } };
    const { realm, pending } = advance(last, 600);
    expect(isFallen(realm)).toBe(true);
    expect(realm.time).toBe(4);
    expect(pending).toBe(0);
  });

  it('catchUp of a fallen realm replays nothing and writes no "Away" line', () => {
    const once = markFallen(empty());
    expect(catchUp(once, MAX_CATCHUP)).toBe(once);
    expect(catchUp(once, AWAY_SUMMARY_MIN - 1)).toBe(once);
  });

  it('catchUp writes the fallen line even with no time to replay', () => {
    expect(fallenLines(catchUp(empty(), 0))).toHaveLength(1);
    expect(fallenLines(catchUp(empty(), NaN))).toHaveLength(1);
  });

  it('play stands still on a fallen realm, also for a background tab coming back', () => {
    const once = markFallen(empty());
    expect(play(once, 0.2, 1 / 60)).toEqual({ realm: once, pending: 0 });
    expect(play(once, 0, 3600, 5)).toEqual({ realm: once, pending: 0 });
    expect(fallenLines(play(empty(), 0, 0).realm)).toHaveLength(1);
  });

  it('a realm that falls while away keeps one fallen line and an "Away" line up to the fall', () => {
    const last = { ...empty(), idle: 2, stores: { ...empty().stores, food: 0 } };
    const away = catchUp(last, 3600);
    expect(fallenLines(away)).toHaveLength(1);
    expect(away.chronicle.at(-1)!.text).toMatch(/^Away 0h 0m: .*people 2 to 0;/);
    // Coming back, nothing more is written.
    expect(play(away, 0, 3600)).toEqual({ realm: away, pending: 0 });
    expect(catchUp(away, 3600)).toBe(away);
  });
});
