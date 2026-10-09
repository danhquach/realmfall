import { describe, expect, it } from 'vitest';
import { advance } from './loop.ts';
import {
  CHRONICLE_MAX,
  RIVAL,
  assign,
  attack,
  cancelOrder,
  createRealm,
  gainTrait,
  order,
  QUEUE_MAX,
  queueView,
  scout,
  storeCaps,
  slotTrait,
  tick,
  train,
  OFFER_MAX,
  TRADER,
  type Realm,
} from './realm.ts';
import { createRng } from './rng.ts';
import { SAVE_LIMITS, SAVE_VERSION, parse, parseSave, serialize } from './save.ts';

/**
 * A realm some way into a run: jobs, buildings, soldiers, traits, battles, a
 * Chronicle, and a construction queue part-way through its first order.
 */
function played(): Realm {
  let realm = createRealm(12345);
  realm = { ...realm, idle: 8, stores: { food: 200, wood: 200, iron: 50, gold: 150, weapons: 0 } };
  realm = assign(realm, 'miner', 2);
  realm = order(order(realm, 'hut'), 'barracks');
  // One builder: the Hut (20 work) and the Barracks (40) are done after 60 s.
  realm = advance(realm, 60).realm;
  realm = { ...realm, stores: { food: 200, wood: 200, iron: 50, gold: 150, weapons: 0 } };
  realm = train(realm, 2);
  realm = scout(realm, 0);
  realm = gainTrait(gainTrait(realm, 'timberClans'), 'timberClans');
  realm = slotTrait(realm, 1, 'timberClans');
  realm = attack(realm, 0, createRng(7));
  // Storehouse 3 pays a milestone offer, and its food cap allows a food challenge.
  realm = { ...realm, storehouse: 3 };
  realm = order(realm, 'market');
  realm = advance(realm, 600).realm;
  // Two builders, fed, so the first order is part-way done at save time.
  realm = {
    ...realm,
    jobs: { ...realm.jobs, builder: 2 },
    stores: { ...realm.stores, food: 500, wood: 1000, iron: 200 },
  };
  realm = order(order(order(realm, 'hut'), 'wall'), 'wall');
  return advance(realm, 5).realm;
}

/** The save of `realm` as a plain object to corrupt. */
function saved(realm = played()): { version: unknown; realm: Record<string, unknown> } {
  return JSON.parse(serialize(realm));
}

/** Sets `value` at `path` in a fresh save of played() and returns the string. */
function corrupt(path: (string | number)[], value: unknown): string {
  const save = saved();
  let at: Record<string | number, unknown> = save.realm;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
  at[path.at(-1)!] = value;
  return JSON.stringify(save);
}

/** Removes the key at `path` from a fresh save of played(). */
function without(path: (string | number)[]): string {
  const save = saved();
  let at: Record<string | number, unknown> = save.realm;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
  delete at[path.at(-1)!];
  return JSON.stringify(save);
}

describe('save round trip', () => {
  it('restores a played realm exactly', () => {
    const realm = played();
    expect(realm.chronicle.length).toBeGreaterThan(3);
    expect(realm.slots).toContain('timberClans');
    expect(realm.offers.length).toBeGreaterThan(0);
    expect(realm.trader.length).toBeGreaterThan(0);
    expect(realm.milestones).toContain('storehouse');
    expect(realm.battlesWon).toBeGreaterThan(0);
    expect(realm.buildings).toMatchObject({ hut: 1, barracks: 1, market: 1 });
    expect(realm.queue.map((o) => o.building)).toEqual(['hut', 'wall', 'wall']);
    expect(realm.queue[0]!.done).toBeGreaterThan(0);
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('keeps the queue and its progress through a load and offline time', () => {
    const realm = played();
    const loaded = parse(serialize(realm))!;
    // The builders carry on from where they were: the first Hut finishes on time.
    const left = realm.queue[0]!.work - realm.queue[0]!.done;
    const away = advance(loaded, Math.ceil(left / realm.jobs.builder)).realm;
    expect(away.buildings.hut).toBe(realm.buildings.hut + 1);
    expect(away.queue[0]!.building).toBe('wall');
  });

  it('starts a new game from an older save without a queue', () => {
    const old = saved();
    delete old.realm.queue;
    expect(parse(JSON.stringify({ ...old, version: 2 }))).toBeNull();
  });

  it('starts a new game from a save before rival levels', () => {
    const old = saved();
    for (const r of old.realm.rivals as Record<string, unknown>[]) {
      delete r.level;
      delete r.ceiling;
    }
    expect(parse(JSON.stringify({ ...old, version: 3 }))).toBeNull();
    expect(SAVE_VERSION).toBe(4);
  });

  it('rejects a rival past its ceiling', () => {
    const ceiling = played().rivals[0]!.ceiling;
    expect(parse(corrupt(['rivals', 0, 'power'], ceiling))).not.toBeNull();
    expect(parse(corrupt(['rivals', 0, 'power'], ceiling * 1.0001))).toBeNull();
  });

  it('rejects an infinite ceiling written as 1e999', () => {
    const save = corrupt(['rivals', 0, 'ceiling'], 12345.5);
    expect(save).toContain('"ceiling":12345.5');
    expect(parse(save.replace('"ceiling":12345.5', '"ceiling":1e999'))).toBeNull();
  });

  it.each(['level', 'ceiling'])('rejects a rival without its %s', (key) => {
    expect(parse(without(['rivals', 0, key]))).toBeNull();
  });

  it('restores a new realm exactly', () => {
    const realm = createRealm(0xffffffff);
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('plays on from a load exactly as without one', () => {
    const realm = played();
    const loaded = parse(serialize(realm))!;
    expect(advance(loaded, 3600).realm).toEqual(advance(realm, 3600).realm);
  });

  it('restores a realm with a full Chronicle', () => {
    const realm = advance(played(), 8 * 60 * 60).realm;
    expect(realm.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('restores an active challenge up to its furthest deadline', () => {
    const realm = played();
    for (const challenge of [
      { kind: 'food' as const, deadline: realm.year + 3 },
      { kind: 'raid' as const, deadline: realm.year + 6 },
    ]) {
      const next = { ...realm, challenge };
      expect(parse(serialize(next))).toEqual(next);
    }
  });

  it('writes the version', () => {
    expect(saved().version).toBe(SAVE_VERSION);
  });
});

describe('parse rejects bad saves', () => {
  it.each([
    ['no save', null],
    ['empty', ''],
    ['not JSON', '{realm:'],
    ['JSON null', 'null'],
    ['a number', '42'],
    ['an array', '[]'],
    ['a string', '"save"'],
    ['no realm', JSON.stringify({ version: SAVE_VERSION })],
    ['null realm', JSON.stringify({ version: SAVE_VERSION, realm: null })],
    ['array realm', JSON.stringify({ version: SAVE_VERSION, realm: [] })],
    ['no version', JSON.stringify({ realm: saved().realm })],
    ['a newer version', JSON.stringify({ version: SAVE_VERSION + 1, realm: saved().realm })],
    ['a string version', JSON.stringify({ version: String(SAVE_VERSION), realm: saved().realm })],
    ['deep nesting', '['.repeat(100_000) + ']'.repeat(100_000)],
  ])('%s', (_, save) => {
    expect(parse(save)).toBeNull();
  });

  it('rejects a store that JSON reads as Infinity', () => {
    const save = corrupt(['stores', 'food'], 12345.5).replace('12345.5', '1e999');
    expect(JSON.parse(save).realm.stores.food).toBe(Infinity);
    expect(parse(save)).toBeNull();
  });

  it('rejects an oversized save before parsing it', () => {
    const save = serialize(played());
    const padded = save.slice(0, -1) + ',"pad":"' + 'x'.repeat(SAVE_LIMITS.chars) + '"}';
    expect(JSON.parse(padded).pad).toBeDefined();
    expect(parse(padded)).toBeNull();
    expect(parse('9'.repeat(10_000_000))).toBeNull();
  });

  it.each([
    'seed',
    'name',
    'time',
    'year',
    'stores',
    'idle',
    'jobs',
    'growth',
    'hunger',
    'soldiers',
    'desertion',
    'buildings',
    'storehouse',
    'queue',
    'annexedHousing',
    'rivals',
    'traits',
    'slots',
    'slotReadyYear',
    'battlesWon',
    'raidsRepelled',
    'milestones',
    'offers',
    'challenge',
    'challengeYear',
    'trader',
    'traderYear',
    'chronicle',
  ])('a missing %s', (key) => {
    expect(parse(without([key]))).toBeNull();
  });

  it.each([
    ['seed', -1],
    ['seed', 2 ** 32],
    ['seed', 1.5],
    ['seed', '1'],
    ['name', ''],
    ['name', 'hearthmoor'],
    ['name', 'Hearth‮moor'], // bidi override
    ['name', 'Hearth​moor'], // zero-width space
    ['name', 'Неarthmoor'], // Cyrillic look-alike
    ['name', '<img src=x onerror=alert(1)>'],
    ['name', 'A' + 'a'.repeat(SAVE_LIMITS.nameChars)],
    ['name', 42],
    ['time', -1],
    ['time', null],
    ['time', SAVE_LIMITS.time + 1],
    ['time', '600'],
    ['year', 1e9], // doesn't match the clock: would loop catching up years
    ['year', 0],
    ['stores', null],
    ['stores', [1, 2, 3, 4]],
    [['stores', 'food'], -1],
    [['stores', 'gold'], '100'],
    [['stores', 'iron'], true],
    [['stores', 'weapons'], -1],
    [['stores', 'weapons'], 'NaN'],
    [['stores', 'weapons'], null],
    ['idle', -1],
    ['idle', 0.5],
    ['idle', SAVE_LIMITS.count * 10],
    [['jobs', 'farmer'], -2],
    [['jobs', 'miner'], null],
    ['growth', -0.1],
    ['hunger', 'lots'],
    ['soldiers', 1.25],
    ['desertion', -1],
    [['jobs', 'builder'], -1],
    [['jobs', 'builder'], '1'],
    [['buildings', 'hut'], 2.5],
    ['buildings', { hut: 0, market: 0, forge: 0 }], // a save from before the Barracks
    [['buildings', 'barracks'], 2], // built once
    [['buildings', 'wall'], 6], // levels 1–5
    [['buildings', 'tower'], 4], // levels 1–3
    ['queue', {}],
    ['queue', null],
    [
      'queue',
      Array(QUEUE_MAX + 1).fill({
        building: 'hut',
        count: 1,
        cost: { wood: 25 },
        work: 20,
        done: 0,
      }),
    ],
    ['queue', [null]],
    ['queue', [{ building: 'castle', count: 1, cost: {}, work: 20, done: 0 }]],
    ['queue', [{ building: '__proto__', count: 1, cost: {}, work: 20, done: 0 }]],
    ['queue', [{ building: 'toString', count: 1, cost: {}, work: 20, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: null, work: 20, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: [25], work: 20, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: { wood: -1 }, work: 20, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: { wood: '25' }, work: 20, done: 0 }]],
    [
      'queue',
      [{ building: 'hut', count: 1, cost: { wood: SAVE_LIMITS.amount * 10 }, work: 20, done: 0 }],
    ],
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: 0, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: -20, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: null, done: 0 }]], // Infinity reads back as null
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: SAVE_LIMITS.amount * 10, done: 0 }]],
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: 20, done: -1 }]],
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: 20, done: 21 }]], // more done than needed
    ['queue', [{ building: 'hut', count: 1, cost: {}, work: 20 }]],
    ['queue', [{ building: 'barracks', count: 1, cost: {}, work: 40, done: 0 }]], // a second Barracks
    ['queue', Array(4).fill({ building: 'tower', count: 1, cost: {}, work: 40, done: 0 })], // past level 3
    [['buildings', 'wall'], 4], // with two levels queued: past level 5
    ['storehouse', SAVE_LIMITS.storehouse + 1],
    ['storehouse', -1],
    ['annexedHousing', -10],
    ['rivals', []],
    ['rivals', {}],
    ['rivals', Array(SAVE_LIMITS.rivals + 1).fill(null)],
    [['rivals', 0], null],
    [['rivals', 0, 'name'], 'Fen‮mere'],
    [['rivals', 0, 'name'], 'Fenmere 0'],
    [['rivals', 0, 'ring'], 0],
    [['rivals', 0, 'trait'], 'dragonBlood'],
    [['rivals', 0, 'trait'], 'toString'],
    [['rivals', 0, 'power'], -5],
    [['rivals', 0, 'level'], 'legendary'],
    [['rivals', 0, 'level'], '__proto__'],
    [['rivals', 0, 'level'], 'constructor'],
    [['rivals', 0, 'level'], 'toString'],
    [['rivals', 0, 'level'], 'hasOwnProperty'],
    [['rivals', 0, 'level'], null],
    [['rivals', 0, 'level'], 0],
    [['rivals', 0, 'level'], '\u202eweak'],
    [['rivals', 0, 'level'], 'w\u0435ak'],
    [['rivals', 0, 'level'], 'Weak'],
    [['rivals', 0, 'level'], ['weak']],
    [['rivals', 0, 'level'], 'weak\u200b'],
    [['rivals', 0, 'level'], 'w'.repeat(100_000)],
    [['rivals', 0, 'ceiling'], -1],
    [['rivals', 0, 'ceiling'], 1e301],
    [['rivals', 0, 'ceiling'], '40'],
    [['rivals', 0, 'ceiling'], null],
    [['rivals', 0, 'hostile'], 'true'],
    [['rivals', 0, 'scouted'], 1],
    ['traits', null],
    ['traits', []],
    [['traits', 'timberClans'], null],
    [['traits', 'timberClans', 'level'], 0],
    [['traits', 'timberClans', 'level'], 6],
    [['traits', 'timberClans', 'duplicates'], -1],
    ['slots', [null, null]],
    ['slots', [null, null, null, null]],
    ['slots', [null, 'goldenAge', null]], // not owned
    ['slots', ['timberClans', 'timberClans', null]], // slotted twice
    ['slots', [null, '__proto__', null]],
    ['slotReadyYear', [1, 1]],
    ['slotReadyYear', [1, 0, 1]],
    ['battlesWon', -1],
    ['battlesWon', 1.5],
    ['raidsRepelled', '5'],
    ['milestones', {}],
    ['milestones', ['sites']],
    ['milestones', ['people', 'people']],
    ['milestones', ['__proto__']],
    ['milestones', ['people', 'battles', 'storehouse', 'raids', 'people']],
    ['offers', {}],
    [
      'offers',
      Array(OFFER_MAX + 1).fill({ source: 'challenge', choices: ['goldenAge', 'goldenAge'] }),
    ],
    ['offers', [null]],
    ['offers', [{ source: 'trader', choices: ['goldenAge', 'goldenAge'] }]],
    ['offers', [{ source: '__proto__', choices: ['goldenAge', 'goldenAge'] }]],
    ['offers', [{ source: 'challenge', choices: ['goldenAge'] }]],
    ['offers', [{ source: 'challenge', choices: ['goldenAge', 'goldenAge', 'goldenAge'] }]],
    ['offers', [{ source: 'milestone', choices: ['goldenAge', 'goldenAge'] }]],
    ['offers', [{ source: 'challenge', choices: ['goldenAge', 'dragonBlood'] }]],
    ['offers', [{ source: 'challenge', choices: 'goldenAge' }]],
    ['challenge', 'food'],
    ['challenge', { kind: 'sites', deadline: 5 }],
    ['challenge', { kind: 'food', deadline: 0 }],
    ['challenge', { kind: 'food', deadline: 1e9 }], // further off than a fresh challenge's
    ['challenge', { kind: 'raid', deadline: '5' }],
    ['challengeYear', 0],
    ['challengeYear', 1e9],
    ['trader', {}],
    ['trader', Array(TRADER.stock + 1).fill({ trait: 'timberClans', price: 200 })],
    ['trader', [{ trait: 'timberClans', price: 149 }]], // below its tier range
    ['trader', [{ trait: 'timberClans', price: 251 }]], // above it
    ['trader', [{ trait: 'goldenAge', price: 200.5 }]],
    ['trader', [{ trait: 'toString', price: 200 }]],
    ['trader', [{ trait: 'goldenAge' }]],
    ['traderYear', -1],
    ['traderYear', 1e9], // after the current year
    ['chronicle', {}],
    ['chronicle', Array(CHRONICLE_MAX + 1).fill({ year: 1, kind: 'events', text: 'x' })],
    [['chronicle', 0, 'year'], 1e6], // after the current year
    [['chronicle', 0, 'kind'], 'secrets'],
    [['chronicle', 0, 'text'], ''],
    [['chronicle', 0, 'text'], 'x'.repeat(SAVE_LIMITS.textChars + 1)],
    [['chronicle', 0, 'text'], 'Raided‮ by Fenmere.'],
    [['chronicle', 0, 'text'], 'line\nbreak'],
    [['chronicle', 0, 'text'], '<script>alert(1)</script>\u0000'],
  ])('%j set to %j', (path, value) => {
    expect(parse(corrupt(Array.isArray(path) ? path : [path], value))).toBeNull();
  });
});

describe('construction queue in a save', () => {
  const withQueue = (fields: Record<string, unknown>) => {
    const save = saved();
    Object.assign(save.realm, fields);
    return JSON.stringify(save);
  };
  const storehouseOrder = { building: 'storehouse', count: 1, cost: {}, work: 30, done: 0 };

  it('keeps Storehouse level plus queued levels within the save limit', () => {
    const at = { storehouse: SAVE_LIMITS.storehouse, queue: [] };
    expect(parse(withQueue(at))).not.toBeNull();
    expect(parse(withQueue({ ...at, queue: [storehouseOrder] }))).toBeNull();
  });

  it('loads an empty queue and a cost with resources left out', () => {
    expect(parse(withQueue({ queue: [] }))!.queue).toEqual([]);
    const free = { building: 'hut', count: 1, cost: {}, work: 20, done: 20 };
    expect(parse(withQueue({ queue: [free] }))!.queue).toEqual([free]);
  });

  it('does not copy __proto__ or unknown keys from an order or its cost', () => {
    const order = JSON.parse(
      '{"__proto__":{"polluted":true},"extra":1,"building":"hut","count":1,' +
        '"cost":{"__proto__":{"polluted":true},"wood":25,"stone":3},"work":20,"done":5}',
    );
    const loaded = parse(withQueue({ queue: [order] }))!;
    expect(loaded.queue).toEqual([
      { building: 'hut', count: 1, cost: { wood: 25 }, work: 20, done: 5 },
    ]);
    expect(Object.getPrototypeOf(loaded.queue[0])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(loaded.queue[0]!.cost)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refunds a hostile order cost only up to the store cap', () => {
    const huge = {
      building: 'hut',
      count: 1,
      cost: { wood: SAVE_LIMITS.amount },
      work: 20,
      done: 0,
    };
    const realm = parse(withQueue({ queue: [huge] }))!;
    const cancelled = cancelOrder(realm, 0);
    expect(cancelled.stores.wood).toBe(Math.max(realm.stores.wood, storeCaps(realm).wood));
    expect(cancelled.queue).toEqual([]);
  });

  it('accepts the smallest positive build work and finishes it at once', () => {
    const tiny = { building: 'hut', count: 1, cost: {}, work: Number.MIN_VALUE, done: 0 };
    const realm = parse(withQueue({ queue: [tiny] }))!;
    expect(realm.queue).toEqual([tiny]);
    expect(tick({ ...realm, jobs: { ...realm.jobs, builder: 1 } }, 0.25).queue).toEqual([]);
  });

  it('shows a huge loaded queue without throwing', () => {
    const big = { building: 'hut', count: 1, cost: {}, work: SAVE_LIMITS.amount, done: 0 };
    const realm = parse(withQueue({ queue: Array(QUEUE_MAX).fill(big) }))!;
    const view = queueView({ ...realm, jobs: { ...realm.jobs, builder: 1 } });
    expect(view).toHaveLength(QUEUE_MAX);
    for (const o of view) expect(o.secondsLeft === null || o.secondsLeft >= 0).toBe(true);
  });

  it('ticks a full queue with builders at the count limit quickly', () => {
    const big = { building: 'hut', count: 1, cost: {}, work: SAVE_LIMITS.amount, done: 0 };
    const save = saved();
    Object.assign(save.realm, {
      queue: Array(QUEUE_MAX).fill(big),
      jobs: { farmer: 0, woodcutter: 0, miner: 0, builder: SAVE_LIMITS.count },
    });
    const realm = parse(JSON.stringify(save))!;
    const start = performance.now();
    const next = tick(realm, 0.25);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(next.queue.length).toBeLessThanOrEqual(QUEUE_MAX);
    expect(parse(serialize(next))).toEqual(next);
  });
});

describe('weapons, levels and build counts in a save', () => {
  const orderAt = (fields: Record<string, unknown>) => ({
    building: 'hut',
    count: 1,
    cost: { wood: 25 },
    work: 20,
    done: 0,
    ...fields,
  });
  const withQueue = (queue: unknown[], buildings: Record<string, unknown> = {}) => {
    const save = saved();
    Object.assign(save.realm.buildings as object, buildings);
    save.realm.queue = queue;
    return JSON.stringify(save);
  };

  it('restores weapons, levels and a count order exactly', () => {
    const base = played();
    const realm: Realm = {
      ...base,
      stores: { ...base.stores, weapons: 7.5 },
      buildings: { ...base.buildings, hutLevel: 3, marketLevel: 2, forgeLevel: 5, forge: 2 },
      queue: [{ building: 'hut', count: 3, cost: { wood: 75 }, work: 60, done: 10 }],
    };
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('writes weapons and levels into the save', () => {
    const { realm } = saved(createRealm(1));
    expect((realm.stores as Record<string, number>).weapons).toBe(0);
    expect(realm.buildings).toMatchObject({ hutLevel: 1, marketLevel: 1, forgeLevel: 1 });
  });

  it.each([
    ['stores', 'weapons'],
    ['buildings', 'hutLevel'],
    ['buildings', 'marketLevel'],
    ['buildings', 'forgeLevel'],
  ])('a missing %s %s', (...path) => {
    expect(parse(without(path))).toBeNull();
  });

  it('rejects weapons that JSON reads as Infinity', () => {
    const save = corrupt(['stores', 'weapons'], 12345.5).replace('12345.5', '1e999');
    expect(JSON.parse(save).realm.stores.weapons).toBe(Infinity);
    expect(parse(save)).toBeNull();
  });

  it('accepts weapons at zero and at the amount limit, and clamps a loaded one to the cap on tick', () => {
    expect(parse(corrupt(['stores', 'weapons'], 0))).not.toBeNull();
    const huge = parse(corrupt(['stores', 'weapons'], SAVE_LIMITS.amount))!;
    expect(tick(huge, 0.25).stores.weapons).toBe(storeCaps(huge).weapons);
  });

  it.each(['hutLevel', 'marketLevel', 'forgeLevel'])('checks the %s range 1-5', (key) => {
    for (const level of [1, 5]) expect(parse(corrupt(['buildings', key], level))).not.toBeNull();
    for (const level of [0, 6, -1, '2', null, 2.5, Number.NaN])
      expect(parse(corrupt(['buildings', key], level))).toBeNull();
  });

  it('rejects a queued level on top of a built level 5', () => {
    const level = orderAt({ building: 'hutLevel', cost: { wood: 1 } });
    expect(parse(withQueue([level], { hutLevel: 4 }))).not.toBeNull();
    expect(parse(withQueue([level], { hutLevel: 5 }))).toBeNull();
    expect(parse(withQueue([level, level], { hutLevel: 4 }))).toBeNull();
  });

  it.each([1, 3, 10])('accepts a Hut order of %i', (count) => {
    expect(parse(withQueue([orderAt({ count })]))!.queue[0]!.count).toBe(count);
  });

  it.each([
    ['0', 0],
    ['11', 11],
    ['1.5', 1.5],
    ['negative', -1],
    ['a string', '3'],
    ['null', null],
    ['an array', [3]],
  ])('rejects a Hut order with count %s', (_, count) => {
    expect(played().queue[0]!.building).toBe('hut');
    expect(parse(corrupt(['queue', 0, 'count'], count))).toBeNull();
  });

  it('rejects a missing count, and one JSON reads as Infinity', () => {
    expect(parse(without(['queue', 0, 'count']))).toBeNull();
    const save = corrupt(['queue', 0, 'count'], 12345.5).replace('12345.5', '1e999');
    expect(JSON.parse(save).realm.queue[0].count).toBe(Infinity);
    expect(parse(save)).toBeNull();
  });

  it.each(['hutLevel', 'marketLevel', 'forgeLevel', 'wall', 'tower', 'storehouse'])(
    'rejects a count of 2 on a %s order, which is always one level',
    (building) => {
      const order = orderAt({ building, cost: {} });
      expect(parse(withQueue([order], { wall: 0, tower: 0 }))).not.toBeNull();
      expect(parse(withQueue([{ ...order, count: 2 }], { wall: 0, tower: 0 }))).toBeNull();
    },
  );

  it('counts every unit of a count order against the building max', () => {
    const barracks = (count: number) =>
      orderAt({ building: 'barracks', count, cost: {}, work: 40 });
    expect(parse(withQueue([barracks(1)], { barracks: 0 }))).not.toBeNull();
    expect(parse(withQueue([barracks(2)], { barracks: 0 }))).toBeNull();
    expect(parse(withQueue([barracks(1)], { barracks: 1 }))).toBeNull();
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects %s as the building of a count order',
    (building) => {
      expect(parse(withQueue([orderAt({ building, count: 3 })]))).toBeNull();
    },
  );

  it('does not pollute from a __proto__ key carrying a count', () => {
    const text = withQueue([orderAt({ count: 3 })]).replace(
      '"building":"hut"',
      '"__proto__":{"count":9,"polluted":true},"building":"hut"',
    );
    const loaded = parse(text)!;
    expect(loaded.queue[0]!.count).toBe(3);
    expect(Object.getPrototypeOf(loaded.queue[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refunds a loaded count order whole on cancel, up to the cap', () => {
    const realm = parse(withQueue([orderAt({ count: 4, cost: { wood: 100 } })]))!;
    const rich: Realm = { ...realm, storehouse: 3, stores: { ...realm.stores, wood: 0 } };
    const cancelled = cancelOrder(rich, 0);
    expect(cancelled.stores.wood).toBe(100);
    expect(cancelled.queue).toEqual([]);
  });

  it('finishes a loaded count order by its count', () => {
    const realm = parse(withQueue([orderAt({ count: 5, work: 1 })], { hut: 2 }))!;
    const next = tick({ ...realm, jobs: { ...realm.jobs, builder: 1 } }, 1);
    expect(next.buildings.hut).toBe(7);
    expect(next.queue).toEqual([]);
  });
});

describe('parse against prototype pollution', () => {
  it('does not copy __proto__, constructor or unknown keys', () => {
    const realm = played();
    const save = serialize(realm).replace(
      '"realm":{',
      '"realm":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"extra":1,',
    );
    const traits = save.replace(
      '"traits":{',
      '"traits":{"__proto__":{"level":5,"duplicates":0},"polluted":{"level":1,"duplicates":0},',
    );
    const offers = traits.replace('"offers":[{', '"offers":[{"__proto__":{"polluted":true},');
    expect(offers).not.toBe(traits);
    const loaded = parse(offers)!;
    expect(loaded).toEqual(realm);
    expect(Object.getPrototypeOf(loaded)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(loaded.traits)).toBe(Object.prototype);
    expect(Object.keys(loaded)).not.toContain('extra');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not copy __proto__ keys from challenge or trader objects', () => {
    const save = saved();
    const realm = save.realm as Record<string, unknown>;
    const year = realm.year as number;
    realm.challenge = JSON.parse(
      `{"__proto__":{"polluted":true},"kind":"raid","deadline":${year + 1}}`,
    );
    realm.trader = [
      JSON.parse('{"__proto__":{"polluted":true},"trait":"timberClans","price":200}'),
    ];
    const loaded = parse(JSON.stringify(save))!;
    expect(loaded.challenge).toEqual({ kind: 'raid', deadline: year + 1 });
    expect(loaded.trader).toEqual([{ trait: 'timberClans', price: 200 }]);
    expect(Object.getPrototypeOf(loaded.challenge)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(loaded.trader[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ignores fields inherited from a polluted Object.prototype', () => {
    const save = without(['soldiers']);
    const proto = Object.prototype as Record<string, unknown>;
    proto.soldiers = 5;
    try {
      expect(parse(save)).toBeNull();
    } finally {
      delete proto.soldiers;
    }
  });
});

describe('save timestamp', () => {
  it('round-trips savedAt', () => {
    const realm = played();
    expect(parseSave(serialize(realm, 1_800_000_000_123))).toEqual({
      realm,
      savedAt: 1_800_000_000_123,
    });
    expect(parseSave(serialize(realm, 0))!.savedAt).toBe(0);
  });

  it('loads a save without a stamp with savedAt null', () => {
    const realm = played();
    expect(parseSave(serialize(realm))).toEqual({ realm, savedAt: null });
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['past the last Date', 8.64e15 + 1],
    ['huge', 1e300],
    ['a string', '1800000000000'],
    ['null', null],
    ['an object', { valueOf: 1 }],
    ['an array', [1]],
    ['true', true],
  ])('rejects a %s savedAt', (_, savedAt) => {
    const save = JSON.stringify({ version: SAVE_VERSION, savedAt, realm: saved().realm });
    expect(parseSave(save)).toBeNull();
    expect(parse(save)).toBeNull();
  });

  it('rejects a savedAt JSON reads as Infinity', () => {
    const save = serialize(played(), 123456789).replace('123456789', '1e999');
    expect(parseSave(save)).toBeNull();
  });

  it('ignores a savedAt inherited from a polluted prototype', () => {
    const save = `{"__proto__":{"savedAt":5},"version":${SAVE_VERSION},"realm":${JSON.stringify(saved().realm)}}`;
    const loaded = parseSave(save)!;
    expect(loaded.savedAt).toBeNull();
    expect(({} as Record<string, unknown>).savedAt).toBeUndefined();
  });
});

describe('a loaded realm runs', () => {
  /** Ticks played() loaded with `fields` and returns the change in population and soldiers. */
  function tickLoaded(fields: Record<string, unknown>) {
    const save = saved();
    Object.assign(save.realm, fields);
    const realm = parse(JSON.stringify(save))!;
    expect(realm).not.toBeNull();
    const start = performance.now();
    const next = tick(realm, 0.25);
    expect(performance.now() - start).toBeLessThan(1000);
    return { idle: next.idle - realm.idle, soldiers: next.soldiers - realm.soldiers };
  }

  it('works off a starving backlog at the limit quickly', () => {
    const fed = { food: 0, wood: 0, iron: 0, gold: 0, weapons: 0 };
    const { idle } = tickLoaded({
      stores: fed,
      idle: SAVE_LIMITS.count,
      hunger: SAVE_LIMITS.backlog,
    });
    expect(-idle).toBeLessThanOrEqual(SAVE_LIMITS.backlog / 4 + 1);
  });

  it('works off a growth backlog at the limit quickly', () => {
    const buildings = { ...createRealm(1).buildings, hut: SAVE_LIMITS.count };
    const { idle } = tickLoaded({ buildings, growth: SAVE_LIMITS.backlog });
    expect(idle).toBeLessThanOrEqual(SAVE_LIMITS.backlog / 4 + 1);
  });

  it('works off a desertion backlog at the limit quickly', () => {
    const broke = { food: 200, wood: 0, iron: 0, gold: 0, weapons: 0 };
    const fields = { stores: broke, soldiers: SAVE_LIMITS.count, desertion: SAVE_LIMITS.backlog };
    const { soldiers } = tickLoaded(fields);
    expect(-soldiers).toBeLessThanOrEqual(SAVE_LIMITS.backlog / 2 + 1);
  });

  it('ticks a realm at the clock and Storehouse limits', () => {
    const year = 1 + Math.floor(SAVE_LIMITS.time / 8);
    tickLoaded({ time: SAVE_LIMITS.time, year, storehouse: SAVE_LIMITS.storehouse });
  });

  it.each(['growth', 'hunger', 'desertion'])('rejects a %s backlog past the limit', (key) => {
    expect(parse(corrupt([key], SAVE_LIMITS.backlog + 1))).toBeNull();
    expect(parse(corrupt([key], 1e9))).toBeNull();
  });
});

describe('late game', () => {
  it('holds rival power at the cap through battles', () => {
    let realm = played();
    const top = { ...realm.rivals[0]!, power: RIVAL.maxPower, ceiling: RIVAL.maxPower };
    realm = { ...realm, soldiers: 1, rivals: [top, ...realm.rivals.slice(1)] };
    const lost = attack(realm, 0, () => 0.99);
    expect(lost.rivals[0]!.power).toBe(RIVAL.maxPower);
    const far = { ...top, power: 1e9, ring: SAVE_LIMITS.ring };
    const won = attack({ ...realm, soldiers: 1e9, rivals: [far, top] }, 0, () => 0);
    const fresh = won.rivals.at(-1)!;
    expect(fresh.ring).toBe(SAVE_LIMITS.ring);
    expect(Number.isFinite(fresh.ceiling)).toBe(true);
    expect(fresh.ceiling).toBeLessThanOrEqual(RIVAL.maxPower);
    expect(parse(serialize(won))).toEqual(won);
  });

  it('holds rival power at the cap, so a very old realm still saves', () => {
    const save = saved();
    const rivals = (save.realm.rivals as object[]).map((r) => ({
      ...r,
      power: 1e299,
      ceiling: RIVAL.maxPower,
    }));
    Object.assign(save.realm, { time: 25_000 * 8, year: 25_001, rivals });
    const old = parse(JSON.stringify(save))!;
    const later = advance(old, 8 * 60 * 60).realm;
    expect(later.rivals.every((r) => r.power === RIVAL.maxPower)).toBe(true);
    expect(parse(serialize(later))).toEqual(later);
  });
});
