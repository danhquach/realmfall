import { describe, expect, it } from 'vitest';
import {
  RESOURCES,
  assign,
  createRealm,
  housingCap,
  population,
  rates,
  shortfall,
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
    // 9 farmers feed the full 20, so the realm never starves on the way up.
    const realm = {
      ...createRealm(1),
      jobs: { farmer: 9, woodcutter: 2, miner: 0 },
      buildings: { hut: 1, market: 0, forge: 0 },
    };
    expect(housingCap(realm)).toBe(20);
    expect(population(run(realm, 100))).toBe(20);
  });

  it('needs more than 5 food', () => {
    // 2 farmers feed 6 civilians exactly: food holds at 5.
    const hungry = {
      ...createRealm(1),
      stores: { food: 5, wood: 0, iron: 0, gold: 0 },
      jobs: { farmer: 2, woodcutter: 0, miner: 0 },
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

describe('starvation (design §4)', () => {
  const run = (realm: Realm, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.25) realm = tick(realm, 0.25);
    return realm;
  };
  const empty = { food: 0, wood: 0, iron: 0, gold: 1000 };

  it('s is 0 while any food is left or production covers what is eaten', () => {
    expect(shortfall(createRealm(1))).toBe(0);
    const fed = { ...createRealm(1), stores: { ...empty } };
    expect(shortfall(fed)).toBe(0);
  });

  it('at s = 1 one person leaves every 4 s', () => {
    // No farmers: 6 civilians eat 3 food/s and nothing is produced.
    const starving = {
      ...createRealm(1),
      stores: { ...empty },
      jobs: { farmer: 0, woodcutter: 2, miner: 0 },
    };
    expect(shortfall(starving)).toBe(1);
    expect(population(run(starving, 3.75))).toBe(6);
    expect(population(run(starving, 4))).toBe(5);
    expect(population(run(starving, 8))).toBe(4);
    expect(population(run(starving, 16))).toBe(2);
  });

  it('at s = 0.1 one person leaves every 40 s', () => {
    // 10 civilians eat 5 food/s, 3 farmers make 4.5: s = 0.1. Once one leaves, 9 eat 4.5 and s = 0.
    const short = {
      ...createRealm(1),
      stores: { ...empty },
      idle: 5,
      jobs: { farmer: 3, woodcutter: 2, miner: 0 },
    };
    expect(shortfall(short)).toBeCloseTo(0.1);
    expect(population(run(short, 39.5))).toBe(10);
    const after = run(short, 40.25);
    expect(population(after)).toBe(9);
    expect(shortfall(after)).toBe(0);
    expect(population(run(after, 60))).toBe(9);
  });

  it('loses idle, miners, woodcutters, farmers, then soldiers', () => {
    let realm: Realm = {
      ...createRealm(1),
      stores: { ...empty },
      idle: 1,
      jobs: { farmer: 1, woodcutter: 1, miner: 1 },
      soldiers: 2,
    };
    const lost: string[] = [];
    for (let i = 0; i < 400 && population(realm) > 0; i++) {
      const next = tick(realm, 0.25);
      if (next.idle < realm.idle) lost.push('idle');
      for (const job of ['miner', 'woodcutter', 'farmer'] as const) {
        if (next.jobs[job] < realm.jobs[job]) lost.push(job);
      }
      if (next.soldiers < realm.soldiers) lost.push('soldier');
      realm = next;
    }
    expect(lost).toEqual(['idle', 'miner', 'woodcutter', 'farmer', 'soldier', 'soldier']);
    expect(population(realm)).toBe(0);
  });

  it('cuts wood, iron and tax by (1 − s) but not food or upkeep', () => {
    // 6 civilians and 1 soldier eat 4, 1 farmer makes 1.5: s = 0.625.
    const realm = {
      ...createRealm(1),
      stores: { ...empty },
      idle: 1,
      jobs: { farmer: 1, woodcutter: 2, miner: 2 },
      soldiers: 1,
    };
    expect(shortfall(realm)).toBeCloseTo(0.625);
    const r = rates(realm);
    expect(r.food).toBeCloseTo(1.5 - 4);
    expect(r.wood).toBeCloseTo(1.6 * 0.375);
    expect(r.iron).toBeCloseTo(0.8 * 0.375);
    expect(r.gold).toBeCloseTo(5 * 0.25 * 0.375 - 0.5);
    const fed = rates({ ...realm, stores: { ...empty, food: 1 } });
    expect(fed.wood).toBeCloseTo(1.6);
    expect(fed.iron).toBeCloseTo(0.8);
    expect(fed.gold).toBeCloseTo(1.25 - 0.5);
  });

  it('a single 8 s step at s = 1 loses two people', () => {
    const starving = {
      ...createRealm(1),
      stores: { ...empty },
      jobs: { farmer: 0, woodcutter: 2, miner: 0 },
    };
    expect(tick(starving, 8).idle).toBe(2);
  });

  it('does not grow while hungry', () => {
    const starving = {
      ...createRealm(1),
      stores: { ...empty },
      jobs: { farmer: 0, woodcutter: 2, miner: 0 },
      growth: 3.75,
    };
    const next = tick(starving, 0.25);
    expect(next.idle).toBe(4);
    expect(next.growth).toBe(0);
  });

  it('resets hunger once food is above 0', () => {
    const starving = {
      ...createRealm(1),
      stores: { ...empty },
      jobs: { farmer: 0, woodcutter: 2, miner: 0 },
    };
    const hungry = run(starving, 1.5);
    expect(hungry.hunger).toBeCloseTo(1.5);
    const fed = tick({ ...hungry, stores: { ...hungry.stores, food: 10 } }, 0.25);
    expect(fed.hunger).toBe(0);
    expect(population(fed)).toBe(6);
    // Back at 0 food, the full 4 s must pass again before anyone leaves.
    const again = { ...fed, stores: { ...fed.stores, food: 0 } };
    expect(population(run(again, 3.75))).toBe(6);
    expect(population(run(again, 4))).toBe(5);
  });

  it('never drives a store below zero or a headcount below zero', () => {
    const doomed = {
      ...createRealm(1),
      stores: { food: 0, wood: 0, iron: 0, gold: 0 },
      jobs: { farmer: 0, woodcutter: 2, miner: 2 },
      soldiers: 3,
    };
    const realm = run(doomed, 200);
    for (const k of RESOURCES) expect(realm.stores[k]).toBeGreaterThanOrEqual(0);
    expect(population(realm)).toBe(0);
    expect(realm.idle).toBe(0);
    expect(realm.soldiers).toBe(0);
    expect(Object.values(realm.jobs)).toEqual([0, 0, 0]);
  });
});

describe('desertion (design §6)', () => {
  const run = (realm: Realm, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.25) realm = tick(realm, 0.25);
    return realm;
  };
  // A full house (15 of 15), food to spare and no tax: no growth, no hunger, no income.
  const broke = {
    ...createRealm(1),
    stores: { food: 10000, wood: 0, iron: 0, gold: 0 },
    jobs: { farmer: 0, woodcutter: 0, miner: 0 },
    idle: 9,
    soldiers: 6,
  };

  it('one soldier deserts every 2 s while gold is at 0', () => {
    expect(rates(broke).gold).toBeLessThan(0);
    expect(run(broke, 1.75).soldiers).toBe(6);
    expect(run(broke, 2).soldiers).toBe(5);
    expect(run(broke, 6).soldiers).toBe(3);
  });

  it('deserters leave the realm rather than turning idle', () => {
    const realm = run(broke, 2);
    expect(realm.idle).toBe(9);
    expect(population(realm)).toBe(population(broke) - 1);
  });

  it('stops once the upkeep is paid by tax', () => {
    // 9 workers pay 2.25 gold/s; 4 soldiers cost 2. Two desert, then gold climbs.
    const realm = run({ ...broke, idle: 0, jobs: { farmer: 9, woodcutter: 0, miner: 0 } }, 30);
    expect(realm.soldiers).toBe(4);
    expect(realm.stores.gold).toBeGreaterThan(0);
    expect(realm.desertion).toBe(0);
  });

  it('resets the 2 s wait once gold is above 0', () => {
    const waiting = run(broke, 1.5);
    expect(waiting.desertion).toBeCloseTo(1.5);
    const paid = tick({ ...waiting, stores: { ...waiting.stores, gold: 100 } }, 0.25);
    expect(paid.desertion).toBe(0);
    const again = { ...paid, stores: { ...paid.stores, gold: 0 } };
    expect(run(again, 1.75).soldiers).toBe(6);
    expect(run(again, 2).soldiers).toBe(5);
  });

  it('a single 6 s step loses three soldiers', () => {
    expect(tick(broke, 6).soldiers).toBe(3);
  });

  it('does nothing without soldiers', () => {
    const realm = run({ ...broke, soldiers: 0 }, 10);
    expect(realm.soldiers).toBe(0);
    expect(realm.desertion).toBe(0);
  });
});
