import { describe, expect, it } from 'vitest';
import { AWAY_SUMMARY_MIN, MAX_CATCHUP, STEP, advance, catchUp, parseSpeed } from './loop.ts';
import {
  CHRONICLE_MAX,
  RESOURCES,
  awaySummary,
  createRealm,
  order,
  storeCaps,
  tick,
  train,
  type Realm,
} from './realm.ts';
import { SAVE_LIMITS, parse, serialize } from './save.ts';

describe('parseSpeed', () => {
  it.each([
    ['1', 1],
    ['5', 5],
    ['20', 20],
  ])('accepts %s', (value, speed) => {
    expect(parseSpeed(value)).toBe(speed);
  });

  it.each([
    null,
    '',
    '0',
    '-5',
    '2',
    '5.0',
    ' 5',
    '5 ',
    '05',
    '1e1',
    '0x14',
    'Infinity',
    'NaN',
    '20\u200b', // zero-width space
    '\u202e02', // bidi override
    '５', // fullwidth 5
    '9'.repeat(100_000),
    '<img src=x onerror=alert(1)>',
    '__proto__',
    'constructor',
  ])('falls back to 1 for %j', (value) => {
    expect(parseSpeed(value)).toBe(1);
  });
});

describe('advance', () => {
  it('runs whole steps and carries the remainder', () => {
    const { realm, pending } = advance(createRealm(1), 1.1);
    expect(realm.time).toBeCloseTo(1);
    expect(pending).toBeCloseTo(0.1);
  });

  it('does not depend on how real time is sliced', () => {
    let a = { realm: createRealm(9), pending: 0 };
    // 1/64 and STEP are exact in binary, so the sums below compare exactly.
    for (let i = 0; i < 640; i++) a = advance(a.realm, a.pending + 1 / 64);
    const b = advance(createRealm(9), 10);
    expect(a.realm.time).toBe(b.realm.time);
    expect(a.realm).toEqual(b.realm);
  });

  it('matches ticking by hand', () => {
    let manual = createRealm(4);
    for (let i = 0; i < 40; i++) manual = tick(manual, STEP);
    expect(advance(createRealm(4), 40 * STEP).realm).toEqual(manual);
  });

  it('caps a single catch-up and drops the surplus', () => {
    const { realm, pending } = advance(createRealm(1), MAX_CATCHUP * 3);
    expect(realm.time).toBe(MAX_CATCHUP);
    expect(pending).toBe(0);
  });

  it.each([-5, NaN, -Infinity, 0])('treats %s pending as nothing to do', (value) => {
    const start = createRealm(1);
    const { realm, pending } = advance(start, value);
    expect(realm).toBe(start);
    expect(pending).toBe(0);
  });
});

/**
 * A run with no farmers, a Barracks, a soldier and a hostile rival: wood hits
 * its cap, food runs out, raids land.
 */
function busy(seed: number): Realm {
  const realm = createRealm(seed);
  const jobs = { farmer: 0, woodcutter: 8, miner: 1, builder: 0 };
  const stores = { food: 50, wood: 190, iron: 20, gold: 100 };
  const rivals = realm.rivals.map((r, i) => ({ ...r, hostile: i === 0 }));
  const buildings = { ...realm.buildings, barracks: 1 };
  return train({ ...realm, jobs, idle: 1, stores, rivals, buildings }, 1);
}

describe('catchUp', () => {
  it('1 h offline matches 1 h of live ticks for the same seed, caps and hunger included', () => {
    const start = busy(77);
    let live = start;
    let atWoodCap = 0;
    let starving = 0;
    for (let i = 0; i < 3600 / STEP; i++) {
      live = tick(live, STEP);
      const caps = storeCaps(live);
      for (const k of RESOURCES) expect(live.stores[k]).toBeLessThanOrEqual(caps[k]);
      if (live.stores.wood === caps.wood) atWoodCap++;
      if (live.hunger > 0) starving++;
    }
    // The run really pressed on the cap and on hunger, and raids landed.
    expect(atWoodCap).toBeGreaterThan(0);
    expect(starving).toBeGreaterThan(0);
    expect(live.chronicle.some((c) => c.kind === 'raids')).toBe(true);

    const offline = catchUp(start, 3600);
    expect(offline).toEqual(awaySummary(live, start, 3600));
    expect(offline.chronicle.at(-1)).toMatchObject({ kind: 'away', year: live.year });
  });

  it('replays at most MAX_CATCHUP (8 h)', () => {
    const start = createRealm(3);
    expect(MAX_CATCHUP).toBe(8 * 60 * 60);
    const away = catchUp(start, 30 * 24 * 3600);
    expect(away.time).toBe(MAX_CATCHUP);
    expect(away.chronicle.at(-1)!.text).toMatch(/^Away 8h 0m: /);
  });

  it('replays a short absence without a Chronicle line', () => {
    const start = createRealm(3);
    const away = catchUp(start, AWAY_SUMMARY_MIN - 1);
    expect(away.time).toBe(AWAY_SUMMARY_MIN - 1);
    expect(away.chronicle.filter((c) => c.kind === 'away')).toEqual([]);
    expect(catchUp(start, AWAY_SUMMARY_MIN).chronicle.at(-1)!.kind).toBe('away');
  });

  it.each([-3600, NaN, Infinity, -Infinity, 0])('replays nothing for %s seconds away', (value) => {
    const start = createRealm(3);
    expect(catchUp(start, value)).toBe(start);
  });

  it('reports whole hours from a clock with float drift', () => {
    // 1/3 + 14,400 steps of 0.25 comes out at 3599.9999999999995 s.
    const start = { ...createRealm(3), time: 1 / 3 };
    expect(catchUp(start, 3600).chronicle.at(-1)!.text).toMatch(/^Away 1h 0m: /);
  });

  it('carries the construction queue through time away, as live play would', () => {
    // One builder: Hut (20 work) then Storehouse level 1 (30) are done after 50 s.
    const realm = createRealm(4);
    const start = order(
      order({ ...realm, stores: { ...realm.stores, wood: 100 } }, 'hut'),
      'storehouse',
    );
    expect(start.queue).toHaveLength(2);
    let live = start;
    for (let t = 0; t < 120; t += STEP) live = tick(live, STEP);
    const away = catchUp(start, 120);
    // The same realm, plus the "Away" summary line.
    expect({ ...away, chronicle: away.chronicle.slice(0, -1) }).toEqual(live);
    expect(away.buildings.hut).toBe(1);
    expect(away.storehouse).toBe(1);
    expect(away.queue).toEqual([]);
    const partway = catchUp(start, 30);
    expect(partway.queue).toEqual([{ ...start.queue[1]!, done: 10 }]);
  });

  it('keeps the Chronicle at its cap', () => {
    const away = catchUp(busy(9), MAX_CATCHUP);
    expect(away.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(away.chronicle.at(-1)!.kind).toBe('away');
  });
});

describe('awaySummary', () => {
  it('sums up time, stores, people and soldiers', () => {
    const before = busy(1);
    const after = {
      ...before,
      stores: { food: 0, wood: 250.6, iron: 15.4, gold: 145 },
      idle: before.idle + 2,
      soldiers: 0,
    };
    expect(awaySummary(after, before, 2 * 3600 + 5 * 60 + 59).chronicle.at(-1)!.text).toBe(
      'Away 2h 5m: food -50, wood +61, iron +0, gold +55; people 10 to 11; soldiers 1 to 0.',
    );
  });

  it('stays short, ASCII and loadable however big the numbers', () => {
    const before = createRealm(1);
    const huge = SAVE_LIMITS.amount;
    const after = {
      ...before,
      stores: { food: huge, wood: huge, iron: huge, gold: huge },
      idle: SAVE_LIMITS.count,
      soldiers: SAVE_LIMITS.count,
    };
    const realm = awaySummary(after, before, MAX_CATCHUP);
    const { text } = realm.chronicle.at(-1)!;
    expect(text.length).toBeLessThanOrEqual(SAVE_LIMITS.textChars);
    expect(text).toMatch(/^[\x20-\x7e]+$/);
    expect(text).toContain('food +1.00e+300');
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('round-trips through the save after a real catch-up', () => {
    const realm = catchUp(busy(2), MAX_CATCHUP);
    expect(parse(serialize(realm, 0))).toEqual(realm);
  });
});
