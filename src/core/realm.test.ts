import { describe, expect, it } from 'vitest';
import {
  RESOURCES,
  assign,
  createRealm,
  housingCap,
  population,
  rates,
  tick,
  unassign,
  type Realm,
} from './realm.ts';

describe('rates', () => {
  it('opens with a thin +1.0 food/s surplus (design §3)', () => {
    const r = rates(createRealm(1));
    expect(r.food).toBeCloseTo(1.0);
    expect(r.wood).toBeCloseTo(1.6);
    expect(r.iron).toBe(0);
    expect(r.gold).toBeCloseTo(1.5);
  });

  it('charges soldiers food and gold upkeep', () => {
    const realm = { ...createRealm(1), soldiers: 4 };
    const r = rates(realm);
    expect(r.food).toBeCloseTo(1.0 - 4);
    expect(r.gold).toBeCloseTo(1.5 - 2);
  });

  it('idle peasants eat but pay no tax', () => {
    const base = rates(createRealm(1));
    const realm = createRealm(1);
    realm.idle += 2;
    const r = rates(realm);
    expect(r.food).toBeCloseTo(base.food - 1);
    expect(r.gold).toBeCloseTo(base.gold);
  });
});

describe('tick', () => {
  it('integrates rates over dt', () => {
    const next = tick(createRealm(1), 10);
    expect(next.stores.food).toBeCloseTo(90);
    expect(next.stores.wood).toBeCloseTo(56);
    expect(next.stores.gold).toBeCloseTo(55);
  });

  it('never drives a store below zero', () => {
    const realm = { ...createRealm(1), soldiers: 50 };
    const next = tick(realm, 1000);
    expect(next.stores.food).toBe(0);
    expect(next.stores.gold).toBe(0);
  });

  it('does not mutate its input', () => {
    const realm = createRealm(1);
    const before = structuredClone(realm);
    tick(realm, 5);
    expect(realm).toEqual(before);
  });
});

describe('createRealm', () => {
  it('holds the Phase 1 state, starting empty (design §3)', () => {
    const realm = createRealm(7);
    expect(realm.seed).toBe(7);
    expect(realm.time).toBe(0);
    expect(realm.year).toBe(1);
    expect(realm.ruler.age).toBe(45);
    expect(realm.buildings).toEqual({ hut: 0, market: 0, forge: 0 });
    expect(realm.rivals).toEqual([]);
    expect(realm.traits).toEqual([]);
    expect(realm.chronicle).toEqual([]);
  });

  it('stores the seed as an unsigned 32-bit integer', () => {
    expect(createRealm(-1).seed).toBe(0xffffffff);
    expect(createRealm(2 ** 32 + 5).seed).toBe(5);
  });

  it('returns independent realms', () => {
    const a = createRealm(1);
    a.rivals.push({
      name: 'X',
      ruler: 'Y',
      trait: 'stoneHalls',
      power: 1,
      hostile: true,
      scouted: false,
    });
    expect(createRealm(1).rivals).toEqual([]);
  });
});

describe('tick purity and time', () => {
  // tick rolls no dice yet; this guards determinism once systems draw from the seed.
  it('is deterministic for a given seed', () => {
    let a = createRealm(42);
    let b = createRealm(42);
    for (let i = 0; i < 500; i++) {
      a = tick(a, 0.25);
      b = tick(b, 0.25);
    }
    expect(a).toEqual(b);
  });

  it('leaves a populated input untouched', () => {
    const realm = {
      ...createRealm(3),
      traits: ['horseLords' as const],
      chronicle: [{ year: 1, text: 'A reign begins.' }],
    };
    const before = structuredClone(realm);
    tick(realm, 0.25);
    expect(realm).toEqual(before);
  });

  it('1 000 ticks of 0.25 s equal 250 s of game time', () => {
    // A full house (15 of 15) rules out growth, so rates stay fixed and one big step must match.
    const full = { ...createRealm(1), jobs: { farmer: 9, woodcutter: 2, miner: 0 } };
    let realm = full;
    for (let i = 0; i < 1000; i++) realm = tick(realm, 0.25);
    expect(realm.time).toBeCloseTo(250, 9);
    const once = tick(full, 250);
    for (const k of RESOURCES) expect(realm.stores[k]).toBeCloseTo(once.stores[k], 6);
  });
});

describe('assign / unassign (design §4)', () => {
  it('moves idle peasants into a job and back', () => {
    let realm = assign(createRealm(1), 'miner', 3);
    expect(realm.idle).toBe(1);
    expect(realm.jobs.miner).toBe(3);
    realm = unassign(realm, 'miner', 2);
    expect(realm.idle).toBe(3);
    expect(realm.jobs.miner).toBe(1);
  });

  it('defaults to one peasant', () => {
    const realm = assign(createRealm(1), 'farmer');
    expect(realm.idle).toBe(3);
    expect(realm.jobs.farmer).toBe(5);
  });

  it('cannot assign more than the idle pool', () => {
    const realm = assign(createRealm(1), 'woodcutter', 99);
    expect(realm.idle).toBe(0);
    expect(realm.jobs.woodcutter).toBe(6);
    expect(assign(realm, 'farmer', 1)).toBe(realm);
  });

  it('cannot unassign more than the job holds', () => {
    const realm = unassign(createRealm(1), 'woodcutter', 99);
    expect(realm.idle).toBe(6);
    expect(realm.jobs.woodcutter).toBe(0);
    expect(unassign(realm, 'woodcutter', 1)).toBe(realm);
    expect(unassign(realm, 'miner', 1)).toBe(realm);
  });

  it('keeps population constant', () => {
    const start = createRealm(1);
    let realm = start;
    realm = assign(realm, 'miner', 2);
    realm = unassign(realm, 'farmer', 3);
    realm = assign(realm, 'woodcutter', 4);
    expect(population(realm)).toBe(population(start));
  });

  it.each([0, -3, 0.5, NaN, Infinity, -Infinity])('treats a count of %s as a no-op', (n) => {
    const realm = createRealm(1);
    expect(assign(realm, 'farmer', n)).toBe(realm);
    expect(unassign(realm, 'farmer', n)).toBe(realm);
  });

  it('floors fractional counts', () => {
    const realm = assign(createRealm(1), 'farmer', 2.9);
    expect(realm.jobs.farmer).toBe(6);
  });

  it('does not mutate its input', () => {
    const realm = createRealm(1);
    const before = structuredClone(realm);
    assign(realm, 'miner', 2);
    unassign(realm, 'farmer', 2);
    expect(realm).toEqual(before);
  });
});

describe('growth (design §4)', () => {
  const run = (realm: Realm, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.25) realm = tick(realm, 0.25);
    return realm;
  };

  it('starts with 10 people under a cap of 15', () => {
    const realm = createRealm(1);
    expect(population(realm)).toBe(10);
    expect(housingCap(realm)).toBe(15);
  });

  it('adds one idle peasant every 4 s below the cap', () => {
    const start = createRealm(1);
    expect(run(start, 3.75).idle).toBe(4);
    expect(run(start, 4).idle).toBe(5);
    expect(run(start, 8).idle).toBe(6);
  });

  it('stops at the housing cap', () => {
    const realm = run(createRealm(1), 60);
    expect(population(realm)).toBe(15);
    expect(realm.idle).toBe(9);
  });

  it('does not grow when already at the cap', () => {
    const full = { ...createRealm(1), idle: 9 };
    expect(run(full, 20).idle).toBe(9);
  });

  it('grows one below the cap, then stops', () => {
    const almost = { ...createRealm(1), idle: 8 };
    const realm = run(almost, 20);
    expect(realm.idle).toBe(9);
    expect(population(realm)).toBe(15);
  });

  it('counts soldiers against the cap', () => {
    const realm = { ...createRealm(1), soldiers: 5 };
    expect(run(realm, 20).idle).toBe(4);
  });

  it('raises the cap by 5 per hut', () => {
    const realm = { ...createRealm(1), buildings: { hut: 1, market: 0, forge: 0 } };
    expect(housingCap(realm)).toBe(20);
    expect(population(run(realm, 100))).toBe(20);
  });

  it('needs more than 5 food', () => {
    const hungry = {
      ...createRealm(1),
      stores: { food: 5, wood: 0, iron: 0, gold: 0 },
      jobs: { farmer: 0, woodcutter: 0, miner: 0 },
    };
    expect(run(hungry, 20).idle).toBe(4);
  });

  it('restarts the 4 s wait after the cap opens', () => {
    const full = run({ ...createRealm(1), idle: 9 }, 10);
    expect(full.growth).toBe(0);
    const opened = { ...full, idle: 8 };
    expect(run(opened, 3.75).idle).toBe(8);
    expect(run(opened, 4).idle).toBe(9);
  });

  it('grows with food just above 5', () => {
    // 3 farmers feed 9 civilians exactly: food holds at 5.01.
    const fed = {
      ...createRealm(1),
      stores: { food: 5.01, wood: 0, iron: 0, gold: 0 },
      idle: 4,
      jobs: { farmer: 3, woodcutter: 2, miner: 0 },
    };
    expect(rates(fed).food).toBeCloseTo(0);
    expect(run(fed, 4).idle).toBe(5);
  });

  it('empties the bank when food falls to 5 mid-wait', () => {
    // No farmers: 6 civilians eat 3 food/s, so 5.5 food drops to 4.75 in one step.
    const hungry = {
      ...createRealm(1),
      stores: { food: 5.5, wood: 0, iron: 0, gold: 0 },
      jobs: { farmer: 0, woodcutter: 2, miner: 0 },
      growth: 3,
    };
    const next = tick(hungry, 0.25);
    expect(next.stores.food).toBeCloseTo(4.75);
    expect(next.growth).toBe(0);
    expect(next.idle).toBe(4);
  });

  it('resumes growth when a hut raises the cap mid-run', () => {
    const full = run(createRealm(1), 60);
    expect(population(full)).toBe(15);
    const built = { ...full, buildings: { ...full.buildings, hut: 1 } };
    expect(population(run(built, 4))).toBe(16);
  });

  it('a single 8 s step adds two peasants', () => {
    expect(tick(createRealm(1), 8).idle).toBe(6);
  });
});
