import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';
import {
  RESOURCES,
  SOLDIER,
  STATS,
  STOREHOUSE,
  TIER_INFO,
  TRAIT_INFO,
  TRAITS,
  armyPower,
  assign,
  attack,
  awaySummary,
  BATTLE,
  build,
  buildingCost,
  RIVAL,
  RIVAL_ACTIONS,
  RAID,
  EVENT,
  EVENTS,
  applyEvent,
  eventRng,
  possibleEvents,
  randomEvent,
  raid,
  raidRng,
  canAfford,
  CHRONICLE_KINDS,
  CHRONICLE_MAX,
  chronicleView,
  createRealm,
  createRival,
  growRivals,
  disband,
  forgeBonus,
  gainTrait,
  housingCap,
  pay,
  population,
  rates,
  rivalTraits,
  rivalView,
  safeAmounts,
  scout,
  sellDuplicate,
  shortfall,
  slotTrait,
  startingRivals,
  storeCaps,
  storehouseLevel,
  swapCost,
  tick,
  traitLabel,
  traitModifiers,
  traitUpgradeCost,
  train,
  tribute,
  unassign,
  upgradeCost,
  upgradeStorehouse,
  upgradeTrait,
  winChance,
  YEAR_SECONDS,
  CHALLENGE,
  CHALLENGE_INFO,
  MILESTONES,
  MILESTONE_INFO,
  OFFER_CHOICES,
  OFFER_MAX,
  TIERS,
  TRADER,
  buyTrait,
  pickOffer,
  possibleChallenges,
  rollTrait,
  traitRng,
  type Building,
  type Realm,
  type Trait,
} from './realm.ts';

/** The realm with every rival at peace, so no raid lands during a long run (§7). */
const atPeace = (realm: Realm): Realm => ({
  ...realm,
  rivals: realm.rivals.map((r) => ({ ...r, hostile: false })),
});

/**
 * Runs `seconds` of 0.25 s ticks with the clock rewound before each, so no
 * year, raid or event (§11) lands: for tests of the economy alone.
 */
const untimed = (realm: Realm, seconds: number): Realm => {
  for (let t = 0; t < seconds; t += 0.25) realm = tick({ ...realm, time: 0 }, 0.25);
  return realm;
};

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
    // One big step, ending before the first event at 25 s.
    const realm = { ...createRealm(1), soldiers: 50 };
    const next = tick(realm, EVENT.every - 1);
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
    expect(realm.name).toBe('Hearthmoor');
    expect(realm.time).toBe(0);
    expect(realm.year).toBe(1);
    expect(realm.buildings).toEqual({ hut: 0, market: 0, forge: 0 });
    expect(realm.rivals.map((r) => r.power)).toEqual([20, 45, 90]);
    expect(realm.traits).toEqual({});
    expect(realm.slots).toEqual([null, null, null]);
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
      ring: 1,
      trait: 'timberClans',
      power: 1,
      hostile: true,
      scouted: false,
    });
    expect(createRealm(1).rivals).toHaveLength(3);
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
      traits: { horseLords: { level: 2, duplicates: 1 } },
      slots: ['horseLords' as const, null, null],
      chronicle: [{ year: 1, kind: 'events' as const, text: 'A reign begins.' }],
    };
    const before = structuredClone(realm);
    tick(realm, 0.25);
    expect(realm).toEqual(before);
  });

  it.each([Infinity, -Infinity, NaN])('returns the realm unchanged for a %s step', (dt) => {
    const realm = createRealm(3);
    expect(tick(realm, dt)).toBe(realm);
  });

  it('1 000 ticks of 0.25 s equal 250 s of game time', () => {
    // A full house (15 of 15) rules out growth, so rates stay fixed and one big step must match.
    const full = { ...atPeace(createRealm(1)), jobs: { farmer: 9, woodcutter: 2, miner: 0 } };
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
    const full = run(atPeace(createRealm(1)), 60);
    expect(population(full)).toBe(15);
    const built = { ...full, buildings: { ...full.buildings, hut: 1 } };
    expect(population(run(built, 4))).toBe(16);
  });

  it('a single 8 s step adds two peasants', () => {
    expect(tick(createRealm(1), 8).idle).toBe(6);
  });
});

describe('starvation (design §4)', () => {
  const run = untimed;
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
      const next = untimed(realm, 0.25);
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

describe('store caps (design §3)', () => {
  it('starts every store under its level 0 cap', () => {
    const realm = createRealm(1);
    expect(realm.storehouse).toBe(0);
    for (const k of RESOURCES) expect(realm.stores[k]).toBeLessThan(storeCaps(realm)[k]);
  });

  it('stops each store at its cap and loses the rest', () => {
    const realm = {
      ...atPeace(createRealm(1)),
      idle: 0,
      jobs: { farmer: 20, woodcutter: 10, miner: 10 },
    };
    const next = untimed(realm, 1000);
    expect(next.stores).toEqual({ food: 200, wood: 200, iron: 50, gold: 150 });
    expect(untimed(next, 10).stores).toEqual(next.stores);
  });

  it('clamps a store already over its cap down to the cap', () => {
    const over = { ...createRealm(1), stores: { food: 900, wood: 900, iron: 900, gold: 900 } };
    expect(tick(over, 0.25).stores).toEqual(storeCaps(over));
  });

  it('uses the caps of the current Storehouse level', () => {
    const realm = {
      ...atPeace(createRealm(1)),
      storehouse: 2,
      // 12 farmers feed all 36 people, so starvation never cuts wood.
      jobs: { farmer: 12, woodcutter: 20, miner: 0 },
    };
    expect(untimed(realm, 1000).stores.wood).toBe(2000);
  });
});

describe('Storehouse (design §5)', () => {
  const rich = (level: number): Realm => ({
    ...createRealm(1),
    storehouse: level,
    stores: { ...storehouseLevel(level).caps },
  });

  it('matches the design table for levels 0–3', () => {
    expect(STOREHOUSE.map((l) => l.caps)).toEqual([
      { food: 200, wood: 200, iron: 50, gold: 150 },
      { food: 500, wood: 600, iron: 120, gold: 400 },
      { food: 1500, wood: 2000, iron: 400, gold: 1200 },
      { food: 5000, wood: 6000, iron: 1200, gold: 4000 },
    ]);
    expect(STOREHOUSE.map((l) => l.safe)).toEqual([
      { food: 0, wood: 0, iron: 0, gold: 0 },
      { food: 50, wood: 60, iron: 12, gold: 40 },
      { food: 200, wood: 250, iron: 50, gold: 150 },
      { food: 750, wood: 900, iron: 180, gold: 600 },
    ]);
    expect(STOREHOUSE.map((l) => l.cost)).toEqual([
      {},
      { wood: 60 },
      { wood: 200, iron: 30 },
      { wood: 600, iron: 120, gold: 100 },
    ]);
  });

  it('multiplies caps, safe amounts and cost by 3 at level 4, and again at 5', () => {
    expect(storehouseLevel(4)).toEqual({
      caps: { food: 15000, wood: 18000, iron: 3600, gold: 12000 },
      safe: { food: 2250, wood: 2700, iron: 540, gold: 1800 },
      cost: { wood: 1800, iron: 360, gold: 300 },
    });
    expect(storehouseLevel(5).caps.food).toBe(45000);
    expect(storehouseLevel(5).cost).toEqual({ wood: 5400, iron: 1080, gold: 900 });
  });

  it('upgrades level by level, paying each cost and raising the caps', () => {
    for (let level = 0; level <= 4; level++) {
      const before = rich(level);
      const cost = upgradeCost(before);
      const after = upgradeStorehouse(before);
      expect(after.storehouse).toBe(level + 1);
      for (const k of RESOURCES) {
        expect(after.stores[k]).toBe(before.stores[k] - (cost[k] ?? 0));
        expect(storeCaps(after)[k]).toBeGreaterThan(storeCaps(before)[k]);
        expect(safeAmounts(after)[k]).toBeGreaterThan(safeAmounts(before)[k]);
      }
    }
  });

  it('charges 60 wood for level 1', () => {
    const after = upgradeStorehouse({
      ...createRealm(1),
      stores: { food: 0, wood: 60, iron: 0, gold: 0 },
    });
    expect(after.storehouse).toBe(1);
    expect(after.stores.wood).toBe(0);
  });

  it("can't upgrade without the stores", () => {
    const poor = { ...createRealm(1), stores: { food: 0, wood: 59, iron: 0, gold: 0 } };
    expect(upgradeStorehouse(poor)).toBe(poor);
    // Level 2 needs iron too: wood alone isn't enough.
    const noIron = { ...rich(1), stores: { food: 0, wood: 600, iron: 29, gold: 0 } };
    expect(upgradeStorehouse(noIron)).toBe(noIron);
  });

  it('does not mutate its input', () => {
    const realm = rich(2);
    const before = structuredClone(realm);
    upgradeStorehouse(realm);
    expect(realm).toEqual(before);
  });

  it('gives no safe amount at level 0', () => {
    expect(safeAmounts(createRealm(1))).toEqual({ food: 0, wood: 0, iron: 0, gold: 0 });
  });
});

describe('canAfford / pay', () => {
  it('pays only when every store covers its share', () => {
    const realm = createRealm(1);
    expect(canAfford(realm, { wood: 40, gold: 40 })).toBe(true);
    expect(pay(realm, { wood: 40, gold: 40 }).stores).toEqual({
      food: 80,
      wood: 0,
      iron: 10,
      gold: 0,
    });
    expect(canAfford(realm, { wood: 40, iron: 11 })).toBe(false);
    expect(pay(realm, { wood: 40, iron: 11 })).toBe(realm);
  });

  it("can't pay a cost above the store cap, however long you wait", () => {
    const realm = { ...createRealm(1), jobs: { farmer: 4, woodcutter: 6, miner: 0 } };
    expect(canAfford(tick(realm, 10000), { wood: 201 })).toBe(false);
  });
});

describe('buildings (design §5)', () => {
  const owning = (building: Building, n: number): Realm => {
    const realm = createRealm(1);
    return { ...realm, buildings: { ...realm.buildings, [building]: n } };
  };
  const costs = (building: Building) =>
    [0, 1, 2, 3, 4, 5].map((n) => buildingCost(owning(building, n), building));

  it('Hut costs 25 × 1.3ⁿ wood, rounded up, for n = 0..5', () => {
    expect(costs('hut')).toEqual([25, 33, 43, 55, 72, 93].map((wood) => ({ wood })));
  });

  it('Market costs 40 × 1.5ⁿ wood and 30 × 1.5ⁿ gold, rounded up, for n = 0..5', () => {
    expect(costs('market')).toEqual([
      { wood: 40, gold: 30 },
      { wood: 60, gold: 45 },
      { wood: 90, gold: 68 },
      { wood: 135, gold: 102 },
      { wood: 203, gold: 152 },
      { wood: 304, gold: 228 },
    ]);
  });

  it('Forge costs 60 × 2ⁿ wood and 20 × 2ⁿ iron for n = 0..5', () => {
    expect(costs('forge')).toEqual([
      { wood: 60, iron: 20 },
      { wood: 120, iron: 40 },
      { wood: 240, iron: 80 },
      { wood: 480, iron: 160 },
      { wood: 960, iron: 320 },
      { wood: 1920, iron: 640 },
    ]);
  });

  it('builds one, pays its cost and raises the next price', () => {
    const realm = createRealm(1); // 40 wood
    const next = build(realm, 'hut');
    expect(next.buildings.hut).toBe(1);
    expect(next.stores.wood).toBe(15);
    expect(buildingCost(next, 'hut')).toEqual({ wood: 33 });
  });

  it("can't build without the stores", () => {
    const realm = createRealm(1); // 40 wood, 10 iron, 40 gold
    const noWood = { ...realm, stores: { ...realm.stores, wood: 24 } };
    expect(build(noWood, 'hut')).toBe(noWood);
    // Each resource in the cost must be covered: wood alone isn't enough.
    const noGold = { ...realm, stores: { ...realm.stores, wood: 100, gold: 29 } };
    expect(build(noGold, 'market')).toBe(noGold);
    const noIron = { ...realm, stores: { ...realm.stores, wood: 100 } };
    expect(build(noIron, 'forge')).toBe(noIron);
  });

  it("can't build when the cost is above the store cap", () => {
    // The 4th Forge needs 160 iron; level 0 holds at most 50.
    const realm = {
      ...owning('forge', 3),
      jobs: { farmer: 6, woodcutter: 10, miner: 10 },
    };
    const later = tick(realm, 10000);
    expect(later.stores.iron).toBe(50);
    expect(build(later, 'forge')).toBe(later);
    const upgraded = { ...later, storehouse: 2, stores: { ...later.stores, wood: 480, iron: 160 } };
    expect(build(upgraded, 'forge').buildings.forge).toBe(4);
  });

  it('does not mutate its input', () => {
    const realm = createRealm(1);
    const before = structuredClone(realm);
    build(realm, 'hut');
    expect(realm).toEqual(before);
  });

  it('Hut adds 5 housing', () => {
    expect(housingCap(owning('hut', 2))).toBe(housingCap(createRealm(1)) + 10);
  });

  it('Market adds 1 gold/s, untouched by starvation', () => {
    const base = rates(createRealm(1)).gold;
    expect(rates(owning('market', 3)).gold).toBeCloseTo(base + 3);
    const starving = {
      ...owning('market', 2),
      stores: { food: 0, wood: 0, iron: 0, gold: 0 },
      soldiers: 100,
    };
    const s = shortfall(starving);
    expect(s).toBeGreaterThan(0);
    expect(rates(starving).gold).toBeCloseTo(6 * 0.25 * (1 - s) + 2 - 100 * 0.5);
  });

  it('Forge adds +50% army power each', () => {
    expect(forgeBonus(createRealm(1))).toBe(1);
    expect(forgeBonus(owning('forge', 1))).toBe(1.5);
    expect(forgeBonus(owning('forge', 3))).toBe(2.5);
  });
});

describe('soldiers and army power (design §6)', () => {
  const rich = (): Realm => {
    const realm = createRealm(1);
    return { ...realm, stores: { ...realm.stores, iron: 50, gold: 150 } };
  };

  it('training costs 1 idle peasant, 5 iron and 10 gold', () => {
    expect(SOLDIER.cost).toEqual({ iron: 5, gold: 10 });
    const realm = createRealm(1); // 4 idle, 10 iron, 40 gold
    const next = train(realm);
    expect(next.soldiers).toBe(1);
    expect(next.idle).toBe(3);
    expect(next.stores).toEqual({ ...realm.stores, iron: 5, gold: 30 });
    expect(population(next)).toBe(population(realm));
  });

  it('trains several at once, stopping at what the stores pay for', () => {
    const realm = createRealm(1); // 10 iron: enough for 2
    const next = train(realm, 4);
    expect(next.soldiers).toBe(2);
    expect(next.idle).toBe(2);
    expect(next.stores.iron).toBe(0);
    expect(next.stores.gold).toBe(20);
  });

  it('trains only from idle peasants, never from workers', () => {
    const next = train(rich(), 10);
    expect(next.soldiers).toBe(4);
    expect(next.idle).toBe(0);
    expect(next.jobs).toEqual(createRealm(1).jobs);
    expect(train(next)).toBe(next);
  });

  it("can't train without iron or gold", () => {
    const realm = createRealm(1);
    const noIron = { ...realm, stores: { ...realm.stores, iron: 4 } };
    expect(train(noIron)).toBe(noIron);
    const noGold = { ...realm, stores: { ...realm.stores, gold: 9 } };
    expect(train(noGold)).toBe(noGold);
  });

  it('ignores zero, negative, fractional and non-finite counts', () => {
    const realm = rich();
    for (const count of [0, -1, Number.NaN, Infinity]) {
      expect(train(realm, count)).toBe(realm);
      expect(disband({ ...realm, soldiers: 2 }, count).soldiers).toBe(2);
    }
    expect(train(realm, 2.9).soldiers).toBe(2);
  });

  it('disband returns soldiers to idle with no refund', () => {
    const trained = train(rich(), 3);
    const next = disband(trained, 2);
    expect(next.soldiers).toBe(1);
    expect(next.idle).toBe(trained.idle + 2);
    expect(next.stores).toEqual(trained.stores);
    expect(disband(next, 5).soldiers).toBe(0);
    expect(disband(createRealm(1))).toEqual(createRealm(1));
  });

  it('upkeep shows in rates: 1 food/s and 0.5 gold/s per soldier', () => {
    const realm = rich();
    const before = rates(realm);
    const after = rates(train(realm, 3));
    // Trained from idle: an idle peasant ate 0.5 food/s, a soldier eats 1.
    expect(after.food).toBeCloseTo(before.food - 3 * (1 - 0.5));
    expect(after.gold).toBeCloseTo(before.gold - 3 * 0.5);
    expect(rates(disband(train(realm, 3), 3))).toEqual(before);
  });

  it('army power is 2 per soldier × (1 + 0.5 × forges)', () => {
    const army = { ...createRealm(1), soldiers: 10 };
    const withForges = (forge: number) => ({ ...army, buildings: { ...army.buildings, forge } });
    expect(armyPower(createRealm(1))).toBe(0);
    expect(armyPower(withForges(0))).toBe(20);
    expect(armyPower(withForges(1))).toBe(30);
    expect(armyPower(withForges(2))).toBe(40);
  });

  it('train and disband do not mutate their input', () => {
    const realm = rich();
    const before = structuredClone(realm);
    train(realm, 2);
    disband({ ...realm, soldiers: 2 });
    expect(realm).toEqual(before);
  });
});

describe('rivals', () => {
  it('rolls the same rivals from the same seed', () => {
    expect(createRealm(99).rivals).toEqual(createRealm(99).rivals);
    expect(startingRivals(12345)).toEqual(startingRivals(12345));
  });

  it('rolls different rivals from different seeds', () => {
    const names = (seed: number) => startingRivals(seed).map((r) => r.name);
    expect(names(1)).not.toEqual(names(2));
  });

  it('starts at power 20, 45 and 90, unscouted (design §7)', () => {
    for (const seed of [0, 1, 2, 0xffffffff]) {
      const rivals = startingRivals(seed);
      expect(rivals.map((r) => r.power)).toEqual([20, 45, 90]);
      expect(rivals.every((r) => !r.scouted)).toBe(true);
    }
  });

  it('never repeats a name within a run', () => {
    for (let seed = 0; seed < 500; seed++) {
      const names = startingRivals(seed).map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('keeps names unique past the end of the name pool', () => {
    const rng = createRng(3);
    const taken = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const { name } = createRival(rng, 1, 1, taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
  });

  it('gives each rival a place name only, no ruler, and a trait of its ring', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const r of startingRivals(seed)) {
        expect(r.name).toMatch(/^[A-Z][a-z]+$/);
        expect(Object.keys(r).sort()).toEqual([
          'hostile',
          'name',
          'power',
          'ring',
          'scouted',
          'trait',
        ]);
        expect(rivalTraits(r.ring)).toContain(r.trait);
      }
    }
  });

  it('starts about 60% of rivals hostile', () => {
    const rng = createRng(8);
    const n = 10_000;
    let hostile = 0;
    for (let i = 0; i < n; i++) if (createRival(rng, 1, 1, new Set()).hostile) hostile++;
    expect(hostile / n).toBeCloseTo(RIVAL.hostileChance, 1);
  });

  it('grows every rival 4% per year and leaves the input untouched', () => {
    const realm = createRealm(5);
    const before = structuredClone(realm);
    const next = growRivals(growRivals(realm));
    expect(next.rivals.map((r) => r.power)).toEqual([20, 45, 90].map((p) => p * 1.04 * 1.04));
    expect(next.rivals.map((r) => r.name)).toEqual(realm.rivals.map((r) => r.name));
    expect(realm).toEqual(before);
  });
});

describe('years (design §10)', () => {
  const powers = (realm: Realm) => realm.rivals.map((r) => r.power);
  const grown = (years: number) => [20, 45, 90].map((p) => p * 1.04 ** years);

  it('is 8 s of game time', () => {
    expect(YEAR_SECONDS).toBe(8);
  });

  it('advances exactly once per 8 s in fixed steps', () => {
    let realm = createRealm(1);
    const seen: number[] = [];
    for (let i = 1; i <= 96; i++) {
      realm = tick(realm, 0.25);
      seen.push(realm.year);
    }
    // Steps 1–31 are year 1; step 32 lands on 8 s and starts year 2, and so on.
    expect(seen.slice(0, 31).every((y) => y === 1)).toBe(true);
    expect(seen[31]).toBe(2);
    expect(seen[63]).toBe(3);
    expect(seen[95]).toBe(4);
    expect(realm.year).toBe(4);
  });

  it('stays in year 1 until 8 s have passed', () => {
    expect(tick(createRealm(1), 7.99).year).toBe(1);
    expect(tick(createRealm(1), 8).year).toBe(2);
  });

  it('advances every year passed in one large dt', () => {
    const realm = tick(createRealm(1), 8 * 25 + 3);
    expect(realm.year).toBe(26);
    expect(tick(realm, 5).year).toBe(27);
  });

  it('grows rivals once per year passed, across one large dt', () => {
    const next = tick(createRealm(5), 8 * 10);
    expect(next.year).toBe(11);
    powers(next).forEach((p, i) => expect(p).toBeCloseTo(grown(10)[i]!, 9));
  });

  it('grows rivals once per year in fixed steps, and not between years', () => {
    let realm = createRealm(5);
    for (let i = 0; i < 31; i++) realm = tick(realm, 0.25);
    expect(powers(realm)).toEqual([20, 45, 90]);
    realm = tick(realm, 0.25);
    expect(powers(realm)).toEqual(grown(1));
    for (let i = 0; i < 31; i++) realm = tick(realm, 0.25);
    expect(powers(realm)).toEqual(grown(1));
  });

  it('gives the same years and rival powers however time is sliced', () => {
    let small = createRealm(9);
    for (let i = 0; i < 400; i++) small = tick(small, 0.25);
    const big = tick(createRealm(9), 100);
    expect(small.year).toBe(13);
    expect(big.year).toBe(13);
    powers(small).forEach((p, i) => expect(p).toBeCloseTo(powers(big)[i]!, 9));
  });

  it('runs no yearly hooks for a zero or negative dt', () => {
    const realm = createRealm(2);
    expect(tick(realm, 0).year).toBe(1);
    expect(tick(realm, -100).year).toBe(1);
    expect(powers(tick(realm, -100))).toEqual([20, 45, 90]);
  });
});

describe('scout and tribute (design §7)', () => {
  const withGold = (gold: number, hostile = true): Realm => {
    const realm = createRealm(7);
    return {
      ...realm,
      stores: { ...realm.stores, gold },
      rivals: realm.rivals.map((r) => ({ ...r, hostile })),
    };
  };

  it('costs 15 gold to scout and 30 to pay tribute', () => {
    expect(RIVAL_ACTIONS).toEqual({ scoutGold: 15, tributeGold: 30 });
  });

  it('scouting takes 15 gold and marks only that rival scouted', () => {
    const realm = withGold(40);
    const before = structuredClone(realm);
    const next = scout(realm, 1);
    expect(next.stores.gold).toBe(25);
    expect(next.rivals.map((r) => r.scouted)).toEqual([false, true, false]);
    expect(next.rivals[1]).toEqual({ ...realm.rivals[1], scouted: true });
    expect(realm).toEqual(before);
  });

  it('does not scout a rival twice or charge for it', () => {
    const once = scout(withGold(40), 0);
    expect(scout(once, 0)).toBe(once);
  });

  it('does nothing when gold is short or the rival does not exist', () => {
    const poor = withGold(14.9);
    expect(scout(poor, 0)).toBe(poor);
    const realm = withGold(100);
    for (const i of [-1, 3, 1.5, NaN]) expect(scout(realm, i)).toBe(realm);
  });

  it('scouts with exactly 15 gold, leaving 0', () => {
    expect(scout(withGold(15), 2).stores.gold).toBe(0);
  });

  it('tribute takes 30 gold and puts only that hostile rival at peace', () => {
    const realm = withGold(40);
    const before = structuredClone(realm);
    const next = tribute(realm, 2);
    expect(next.stores.gold).toBe(10);
    expect(next.rivals.map((r) => r.hostile)).toEqual([true, true, false]);
    expect(next.rivals[2]).toEqual({ ...realm.rivals[2], hostile: false });
    expect(realm).toEqual(before);
  });

  it('charges nothing for tribute to a rival already at peace', () => {
    const realm = withGold(100, false);
    expect(tribute(realm, 0)).toBe(realm);
  });

  it('does no tribute when gold is short or the rival does not exist', () => {
    const poor = withGold(29.9);
    expect(tribute(poor, 0)).toBe(poor);
    const realm = withGold(100);
    for (const i of [-1, 3, 0.5, NaN]) expect(tribute(realm, i)).toBe(realm);
  });

  it('pays tribute with exactly 30 gold, leaving 0', () => {
    expect(tribute(withGold(30), 0).stores.gold).toBe(0);
  });

  it('tribute does not scout, and scouting does not change stance', () => {
    const realm = withGold(100);
    expect(tribute(realm, 0).rivals[0]!.scouted).toBe(false);
    expect(scout(realm, 0).rivals[0]!.hostile).toBe(true);
  });
});

describe('rivalView (design §7)', () => {
  const rival = createRealm(3).rivals[0]!;

  it('shows only name and stance of an unscouted rival', () => {
    const view = rivalView(rival);
    expect(view).toEqual({ name: rival.name, hostile: rival.hostile, scouted: false });
    expect(Object.keys(view).sort()).toEqual(['hostile', 'name', 'scouted']);
    const text = JSON.stringify(view);
    expect(text).not.toContain(rival.trait);
    expect(text).not.toContain('power');
  });

  it('shows trait and power once scouted', () => {
    expect(rivalView({ ...rival, scouted: true })).toEqual({
      name: rival.name,
      hostile: rival.hostile,
      scouted: true,
      trait: rival.trait,
      power: rival.power,
    });
  });

  it('reveals a rival after scouting it', () => {
    const realm = { ...createRealm(3), stores: { ...createRealm(3).stores, gold: 50 } };
    expect(rivalView(realm.rivals[0]!).scouted).toBe(false);
    const view = rivalView(scout(realm, 0).rivals[0]!);
    expect(view.scouted && view.power).toBe(realm.rivals[0]!.power);
  });
});

describe('battle and annexation (design §7)', () => {
  const WIN = () => 0;
  const LOSE = () => 0.999999;
  /** A realm with `soldiers` spearmen and rival 0 at `power`. */
  const armed = (soldiers: number, power: number): Realm => {
    const realm = createRealm(11);
    return {
      ...realm,
      soldiers,
      stores: { ...realm.stores, gold: 50 },
      rivals: realm.rivals.map((r, i) => (i === 0 ? { ...r, power, hostile: false } : r)),
    };
  };

  it('twice the enemy power wins 80% of the time', () => {
    expect(winChance(40, 20)).toBeCloseTo(0.8, 12);
    expect(winChance(20, 40)).toBeCloseTo(0.2, 12);
    expect(winChance(30, 30)).toBe(0.5);
  });

  it('follows P² / (P² + E²), with no army never winning', () => {
    expect(winChance(3, 4)).toBeCloseTo(9 / 25, 12);
    expect(winChance(0, 20)).toBe(0);
    expect(winChance(NaN, 20)).toBe(0);
    expect(winChance(10, 0)).toBe(1);
    expect(winChance(1e200, 1e200)).toBe(0.5);
  });

  it('rolls the win chance: an 80% battle is won by rolls under 0.8 only', () => {
    // 10 spearmen = 20 power against 10: 80%.
    const realm = armed(10, 10);
    expect(attack(realm, 0, () => 0.79).rivals).toHaveLength(3);
    expect(attack(realm, 0, () => 0.79).annexedHousing).toBe(10);
    expect(attack(realm, 0, () => 0.8).annexedHousing).toBe(0);
  });

  it('a win loses ⌈soldiers × (0.1 + 0.3 × (1 − chance))⌉ soldiers', () => {
    // 80%: ⌈10 × 0.16⌉ = 2.
    expect(attack(armed(10, 10), 0, WIN).soldiers).toBe(8);
    // 25 soldiers = 50 power against 50: 50%, ⌈25 × 0.25⌉ = 7.
    expect(attack(armed(25, 50), 0, WIN).soldiers).toBe(18);
    // E/P = 0.25: ⌈51 × 2/17⌉ is exactly 6, not 7 from float noise.
    expect(attack(armed(51, 25.5), 0, WIN).soldiers).toBe(45);
    // A sure win still costs ⌈10%⌉: 1 soldier against power 0.
    expect(attack(armed(1, 0), 0, WIN).soldiers).toBe(0);
  });

  it('a loss loses ⌈50%⌉ of soldiers; the rival gains 10% power and turns hostile', () => {
    const realm = armed(7, 100);
    const before = structuredClone(realm);
    const next = attack(realm, 0, LOSE);
    expect(next.soldiers).toBe(3);
    expect(next.rivals[0]).toEqual({
      ...realm.rivals[0],
      power: expect.closeTo(110),
      hostile: true,
    });
    expect(next.rivals.slice(1)).toEqual(realm.rivals.slice(1));
    expect(next.stores).toEqual(realm.stores);
    expect(next.annexedHousing).toBe(0);
    expect(realm).toEqual(before);
  });

  it('a loss with one soldier loses that soldier', () => {
    expect(attack(armed(1, 100), 0, LOSE).soldiers).toBe(0);
  });

  it('annexation adds 10 housing, ⌊E / 8⌋ people, E gold and the trait', () => {
    const realm = armed(40, 45);
    const before = structuredClone(realm);
    const next = attack(realm, 0, WIN);
    expect(next.annexedHousing).toBe(10);
    expect(housingCap(next)).toBe(housingCap(realm) + 10);
    expect(next.idle).toBe(realm.idle + 5);
    expect(next.stores.gold).toBe(95);
    expect(next.traits).toEqual({ [realm.rivals[0]!.trait]: { level: 1, duplicates: 0 } });
    expect(next.rivals.map((r) => r.name)).not.toContain(realm.rivals[0]!.name);
    expect(realm).toEqual(before);
  });

  it('annexed gold stops at the gold cap', () => {
    const realm = armed(100, 120);
    expect(attack(realm, 0, WIN).stores.gold).toBe(storeCaps(realm).gold);
  });

  it('annexed gold never lowers gold already over the cap', () => {
    const realm = armed(100, 10);
    const over = { ...realm, stores: { ...realm.stores, gold: 999 } };
    expect(attack(over, 0, WIN).stores.gold).toBe(999);
  });

  it('annexed people arrive even past the housing cap', () => {
    const realm = armed(40, 80);
    const full = { ...realm, idle: housingCap(realm) };
    expect(attack(full, 0, WIN).idle).toBe(full.idle + 10);
  });

  it('annexing a trait the realm already owns gives a duplicate', () => {
    const realm = armed(40, 20);
    const trait = realm.rivals[0]!.trait;
    const owned = { ...realm, traits: { [trait]: { level: 2, duplicates: 1 } } };
    expect(attack(owned, 0, WIN).traits).toEqual({ [trait]: { level: 2, duplicates: 2 } });
  });

  it('places the new rival one ring past the farthest', () => {
    const realm = armed(200, 20);
    expect(attack(realm, 0, WIN).rivals[2]!.ring).toBe(3);
  });

  it('replaces the annexed rival with a new one at 1.5× the strongest', () => {
    const realm = armed(200, 20);
    const strongest = Math.max(...realm.rivals.map((r) => r.power));
    const next = attack(realm, 0, WIN);
    expect(next.rivals).toHaveLength(3);
    expect(next.rivals.slice(0, 2)).toEqual(realm.rivals.slice(1));
    const fresh = next.rivals[2]!;
    expect(fresh.power).toBe(strongest * BATTLE.nextRivalScale);
    expect(fresh.scouted).toBe(false);
    expect(new Set(next.rivals.map((r) => r.name)).size).toBe(3);
    expect(fresh.name).not.toBe(realm.rivals[0]!.name);
  });

  it('annexing the strongest rival scales the next from its power', () => {
    const realm = armed(500, 1000);
    expect(attack(realm, 0, WIN).rivals[2]!.power).toBe(1500);
  });

  it('is deterministic for the same seeded roll', () => {
    const realm = armed(30, 45);
    expect(attack(realm, 0, createRng(5))).toEqual(attack(realm, 0, createRng(5)));
  });

  it('does nothing with no soldiers or no such rival', () => {
    const empty = armed(0, 1);
    expect(attack(empty, 0, WIN)).toBe(empty);
    const realm = armed(10, 10);
    for (const i of [-1, 3, 0.5, NaN]) expect(attack(realm, i, WIN)).toBe(realm);
  });
});

describe('traits (design §9)', () => {
  /** A working realm (4 farmers, 2 woodcutters, 2 miners, 2 soldiers) owning `owned` at their levels, `slotted` in slots. */
  const withTraits = (
    owned: Partial<Record<Trait, number>>,
    slotted: Trait[] = Object.keys(owned) as Trait[],
  ): Realm => {
    const realm = createRealm(4);
    const traits: Realm['traits'] = {};
    for (const t of TRAITS) if (owned[t]) traits[t] = { level: owned[t], duplicates: 0 };
    return {
      ...realm,
      idle: 0,
      jobs: { farmer: 4, woodcutter: 2, miner: 2 },
      soldiers: 2,
      traits,
      slots: [0, 1, 2].map((i) => slotted[i] ?? null),
    };
  };
  const base = withTraits({});
  const baseRates = rates(base);
  const basePower = armyPower(base);
  // Base per-second output: food 4 × 1.5, wood 2 × 0.8, iron 2 × 0.4, tax 8 × 0.25, upkeep 2 × 0.5.
  const made = { food: 6, wood: 1.6, iron: 0.8, tax: 2, upkeep: 1 };

  describe('each trait while slotted', () => {
    it('Fertile valleys: farmer output +50%, miner output −25%', () => {
      const r = rates(withTraits({ fertileValleys: 1 }));
      expect(r.food).toBeCloseTo(baseRates.food + made.food * 0.5);
      expect(r.iron).toBeCloseTo(made.iron * 0.75);
      expect(r.wood).toBeCloseTo(baseRates.wood);
      expect(r.gold).toBeCloseTo(baseRates.gold);
    });

    it('Timber clans: woodcutter output +75%, farmer output −20%', () => {
      const r = rates(withTraits({ timberClans: 1 }));
      expect(r.wood).toBeCloseTo(made.wood * 1.75);
      expect(r.food).toBeCloseTo(baseRates.food - made.food * 0.2);
      expect(r.iron).toBeCloseTo(baseRates.iron);
    });

    it('Dwarven smiths: miner output +100%, woodcutter output −25%', () => {
      const r = rates(withTraits({ dwarvenSmiths: 1 }));
      expect(r.iron).toBeCloseTo(made.iron * 2);
      expect(r.wood).toBeCloseTo(made.wood * 0.75);
      expect(r.food).toBeCloseTo(baseRates.food);
    });

    it('Merchant guilds: tax +50%, soldier gold upkeep +25%', () => {
      const r = rates(withTraits({ merchantGuilds: 1 }));
      expect(r.gold).toBeCloseTo(made.tax * 1.5 - made.upkeep * 1.25);
      expect(r.food).toBeCloseTo(baseRates.food);
    });

    it('Poison archers: archers +50% power, spearmen −20% power', () => {
      const realm = withTraits({ poisonArchers: 1 });
      expect(traitModifiers(realm).archers).toBeCloseTo(0.5);
      expect(traitModifiers(realm).spearmen).toBeCloseTo(-0.2);
      expect(armyPower(realm)).toBeCloseTo(basePower * 0.8);
    });

    it('Horse lords: cavalry +50% power and −25% march, cavalry upkeep +50%; spearmen untouched', () => {
      const realm = withTraits({ horseLords: 1 });
      const m = traitModifiers(realm);
      expect([m.cavalry, m.march, m.cavalryUpkeep]).toEqual([0.5, -0.25, 0.5]);
      expect(armyPower(realm)).toBeCloseTo(basePower);
      expect(rates(realm)).toEqual(baseRates);
    });

    it('Warrior creed: army power +30%', () => {
      expect(armyPower(withTraits({ warriorCreed: 1 }))).toBeCloseTo(basePower * 1.3);
    });

    it('Warrior creed: no growth while at peace with every rival', () => {
      const room = { ...withTraits({ warriorCreed: 1 }), annexedHousing: 20 };
      const peace = { ...room, rivals: room.rivals.map((r) => ({ ...r, hostile: false })) };
      expect(tick(peace, 4).idle).toBe(0);
      expect(tick(peace, 4).growth).toBe(0);
      const war = { ...peace, rivals: peace.rivals.map((r, i) => ({ ...r, hostile: i === 0 })) };
      expect(tick(war, 4).idle).toBe(1);
    });

    it('Golden age: all production and tax +25%', () => {
      const r = rates(withTraits({ goldenAge: 1 }));
      expect(r.food).toBeCloseTo(baseRates.food + made.food * 0.25);
      expect(r.wood).toBeCloseTo(made.wood * 1.25);
      expect(r.iron).toBeCloseTo(made.iron * 1.25);
      expect(r.gold).toBeCloseTo(made.tax * 1.25 - made.upkeep);
    });

    it('Golden age: rivals gain +6% power per year instead of +4%', () => {
      const realm = withTraits({ goldenAge: 1 });
      const grown = growRivals(realm).rivals.map((r) => r.power);
      expect(grown).toEqual(realm.rivals.map((r) => expect.closeTo(r.power * 1.06)));
    });

    it('starvation shortfall counts the farmer modifier', () => {
      // 4 farmers make 6 food/s, 12 people eat 6 food/s: fed. −20% output: 1.2 short of 6.
      const empty = { ...base, idle: 4, soldiers: 0, stores: { ...base.stores, food: 0 } };
      expect(shortfall(empty)).toBe(0);
      expect(
        shortfall({
          ...empty,
          traits: { timberClans: { level: 1, duplicates: 0 } },
          slots: ['timberClans', null, null],
        }),
      ).toBeCloseTo(0.2);
    });
  });

  it('owned but unslotted traits do nothing', () => {
    const owned = Object.fromEntries(TRAITS.map((t) => [t, 5]));
    const realm = withTraits(owned, []);
    expect(Object.values(traitModifiers(realm)).every((v) => v === 0)).toBe(true);
    expect(rates(realm)).toEqual(baseRates);
    expect(armyPower(realm)).toBe(basePower);
    const calm = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: false })) };
    const calmBase = { ...base, rivals: calm.rivals };
    expect(growRivals(calm).rivals).toEqual(growRivals(calmBase).rivals);
    expect(tick({ ...calm, annexedHousing: 20 }, 4).idle).toBe(1);
  });

  it('modifiers on the same stat add up: +50% and −20% make +30%', () => {
    const realm = withTraits({ fertileValleys: 1, timberClans: 1 });
    expect(traitModifiers(realm).farmer).toBeCloseTo(0.3);
    expect(rates(realm).food).toBeCloseTo(baseRates.food + made.food * 0.3);
    // A unit bonus and the army bonus add up for that unit: −20% + 30%.
    expect(armyPower(withTraits({ poisonArchers: 1, warriorCreed: 1 }))).toBeCloseTo(
      basePower * 1.1,
    );
  });

  describe('upgrades', () => {
    it('cost 2ⁿ⁻¹ duplicates per level: 1, 2, 4, 8', () => {
      expect([1, 2, 3, 4].map(traitUpgradeCost)).toEqual([1, 2, 4, 8]);
      let realm: Realm = { ...createRealm(1), traits: { goldenAge: { level: 1, duplicates: 15 } } };
      for (let i = 0; i < 4; i++) realm = upgradeTrait(realm, 'goldenAge');
      expect(realm.traits.goldenAge).toEqual({ level: 5, duplicates: 0 });
    });

    it('needs enough duplicates and stops at level 5', () => {
      const short = { ...createRealm(1), traits: { goldenAge: { level: 2, duplicates: 1 } } };
      expect(upgradeTrait(short, 'goldenAge')).toBe(short);
      const top = { ...createRealm(1), traits: { goldenAge: { level: 5, duplicates: 99 } } };
      expect(upgradeTrait(top, 'goldenAge')).toBe(top);
      expect(upgradeTrait(createRealm(1), 'goldenAge').traits).toEqual({});
    });

    it('each level adds +25% of the upside; level 5 is 2×, the downside stays', () => {
      for (const t of TRAITS) {
        const { upside, downside } = TRAIT_INFO[t];
        for (const level of [1, 3, 5]) {
          const m = traitModifiers(withTraits({ [t]: level }));
          const by = 1 + 0.25 * (level - 1);
          for (const s of STATS)
            expect(m[s]).toBeCloseTo((upside[s] ?? 0) * by + (downside[s] ?? 0));
        }
      }
      const r = rates(withTraits({ fertileValleys: 5 }));
      expect(r.food).toBeCloseTo(baseRates.food + made.food * 1);
      expect(r.iron).toBeCloseTo(made.iron * 0.75);
    });
  });

  describe('slots', () => {
    const owning = (gold: number): Realm => ({
      ...withTraits({ fertileValleys: 1, timberClans: 1, dwarvenSmiths: 1, goldenAge: 1 }, []),
      stores: { ...base.stores, gold },
    });

    it('fills an empty slot for free', () => {
      const next = slotTrait(owning(0), 1, 'goldenAge');
      expect(next.slots).toEqual([null, 'goldenAge', null]);
      expect(next.stores.gold).toBe(0);
    });

    it('a swap costs 5 × population gold and cools the slot for 5 years', () => {
      const realm = slotTrait(owning(200), 0, 'fertileValleys');
      expect(swapCost(realm)).toEqual({ gold: 50 });
      const swapped = slotTrait(realm, 0, 'timberClans');
      expect(swapped.slots[0]).toBe('timberClans');
      expect(swapped.stores.gold).toBe(150);
      expect(slotTrait(swapped, 0, 'fertileValleys')).toBe(swapped);
      const year5 = { ...swapped, year: 5 };
      expect(slotTrait(year5, 0, 'fertileValleys')).toBe(year5);
      const year6 = slotTrait({ ...swapped, year: 6 }, 0, 'fertileValleys');
      expect(year6.slots[0]).toBe('fertileValleys');
      expect(year6.stores.gold).toBe(100);
    });

    it('the cooldown holds only that slot', () => {
      let realm = slotTrait(slotTrait(owning(200), 0, 'fertileValleys'), 1, 'timberClans');
      realm = slotTrait(realm, 0, 'dwarvenSmiths');
      expect(slotTrait(realm, 1, 'goldenAge').slots).toEqual(['dwarvenSmiths', 'goldenAge', null]);
    });

    it('a swap needs the gold', () => {
      const realm = slotTrait(owning(49), 0, 'fertileValleys');
      expect(slotTrait(realm, 0, 'timberClans')).toBe(realm);
    });

    it('a fourth slot is impossible', () => {
      let realm = owning(0);
      realm = slotTrait(
        slotTrait(slotTrait(realm, 0, 'fertileValleys'), 1, 'timberClans'),
        2,
        'dwarvenSmiths',
      );
      for (const i of [3, -1, 0.5, NaN]) expect(slotTrait(realm, i, 'goldenAge')).toBe(realm);
      expect(realm.slots).toHaveLength(3);
    });

    it('rejects an unowned or already slotted trait', () => {
      const realm = slotTrait(owning(500), 0, 'fertileValleys');
      expect(slotTrait(realm, 1, 'horseLords')).toBe(realm);
      expect(slotTrait(realm, 1, 'fertileValleys')).toBe(realm);
      expect(slotTrait(realm, 0, 'fertileValleys')).toBe(realm);
    });
  });

  describe('duplicates', () => {
    it('gaining an owned trait gives a duplicate', () => {
      const once = gainTrait(createRealm(1), 'horseLords');
      expect(once.traits.horseLords).toEqual({ level: 1, duplicates: 0 });
      expect(gainTrait(once, 'horseLords').traits.horseLords).toEqual({ level: 1, duplicates: 1 });
    });

    it('a duplicate sells for its tier price', () => {
      for (const t of TRAITS) {
        const realm = {
          ...createRealm(1),
          storehouse: 3,
          traits: { [t]: { level: 1, duplicates: 2 } },
        };
        const next = sellDuplicate(realm, t);
        expect(next.stores.gold).toBe(40 + TIER_INFO[TRAIT_INFO[t].tier].sellGold);
        expect(next.traits[t]).toEqual({ level: 1, duplicates: 1 });
      }
      expect(Object.values(TIER_INFO).map((i) => i.sellGold)).toEqual([40, 75, 150, 300, 600]);
    });

    it('the sale is capped by the gold store cap', () => {
      const realm = {
        ...createRealm(1),
        stores: { ...createRealm(1).stores, gold: 140 },
        traits: { goldenAge: { level: 1, duplicates: 1 } },
      };
      const next = sellDuplicate(realm, 'goldenAge');
      expect(next.stores.gold).toBe(storeCaps(realm).gold);
      expect(next.traits.goldenAge!.duplicates).toBe(0);
    });

    it('needs a duplicate to sell', () => {
      const realm = { ...createRealm(1), traits: { goldenAge: { level: 1, duplicates: 0 } } };
      expect(sellDuplicate(realm, 'goldenAge')).toBe(realm);
      expect(sellDuplicate(createRealm(1), 'goldenAge').stores.gold).toBe(40);
    });
  });

  it('every gain, slot, swap, upgrade and sale writes a Chronicle line', () => {
    let realm: Realm = { ...createRealm(1), year: 3 };
    realm = gainTrait(realm, 'fertileValleys');
    realm = gainTrait(realm, 'fertileValleys');
    realm = gainTrait(realm, 'fertileValleys');
    realm = gainTrait(realm, 'goldenAge');
    realm = slotTrait(realm, 0, 'fertileValleys');
    realm = upgradeTrait(realm, 'fertileValleys');
    realm = sellDuplicate(realm, 'fertileValleys');
    realm = slotTrait(realm, 0, 'goldenAge');
    expect(realm.chronicle).toEqual([
      { year: 3, kind: 'traits', text: 'Gained the trait Fertile valleys (Common).' },
      { year: 3, kind: 'traits', text: 'Gained a duplicate of Fertile valleys (Common).' },
      { year: 3, kind: 'traits', text: 'Gained a duplicate of Fertile valleys (Common).' },
      { year: 3, kind: 'traits', text: 'Gained the trait Golden age (Mythic).' },
      { year: 3, kind: 'traits', text: 'Slotted Fertile valleys (Common).' },
      { year: 3, kind: 'traits', text: 'Raised Fertile valleys (Common) to level 2.' },
      {
        year: 3,
        kind: 'traits',
        text: 'Sold a duplicate of Fertile valleys (Common) for 40 gold.',
      },
      {
        year: 3,
        kind: 'traits',
        text: 'Swapped Fertile valleys (Common) for Golden age (Mythic) for 50 gold.',
      },
    ]);
  });

  it('trait actions leave their input untouched', () => {
    const realm = {
      ...withTraits({ fertileValleys: 1, goldenAge: 1 }, ['fertileValleys']),
      stores: { ...base.stores, gold: 100 },
    };
    realm.traits.goldenAge!.duplicates = 3;
    const before = structuredClone(realm);
    gainTrait(realm, 'goldenAge');
    slotTrait(realm, 1, 'goldenAge');
    slotTrait(realm, 0, 'goldenAge');
    upgradeTrait(realm, 'goldenAge');
    sellDuplicate(realm, 'goldenAge');
    expect(realm).toEqual(before);
  });

  describe('rival traits by ring', () => {
    it('unlocks each tier from its ring', () => {
      expect(rivalTraits(1)).toEqual(['fertileValleys', 'timberClans']);
      expect(rivalTraits(2)).toHaveLength(4);
      expect(rivalTraits(3)).toHaveLength(6);
      expect(rivalTraits(5)).toHaveLength(7);
      expect(rivalTraits(6)).toEqual([...TRAITS]);
    });

    it('rivals draw only from tiers unlocked at their ring', () => {
      const rng = createRng(21);
      for (let ring = 1; ring <= 7; ring++) {
        const seen = new Set<Trait>();
        for (let i = 0; i < 400; i++) seen.add(createRival(rng, 1, ring, new Set()).trait);
        expect([...seen].sort()).toEqual(rivalTraits(ring).sort());
      }
    });

    it('starting rivals sit on rings 1, 1 and 2', () => {
      expect(startingRivals(9).map((r) => r.ring)).toEqual([1, 1, 2]);
    });
  });
});

describe('raids (design §7)', () => {
  /** Rolls: the first picks the raider, the second sets its strength. */
  const rolls = (...values: number[]) => {
    let i = 0;
    return () => values[i++] ?? 0;
  };
  /** Only rival 0 hostile, at `power`; `soldiers` spearmen; the given stores and Storehouse level. */
  const target = (soldiers: number, power: number, food: number, wood: number, storehouse = 1) => {
    const realm = createRealm(5);
    return {
      ...realm,
      soldiers,
      storehouse,
      stores: { food, wood, iron: 10, gold: 40 },
      rivals: realm.rivals.map((r, i) => ({ ...r, power, hostile: i === 0 })),
    } satisfies Realm;
  };

  it('is repelled when field army power ≥ strength, losing nothing', () => {
    // 10 spearmen = 20 power against 25 × 0.8 = 20 at the top roll.
    const realm = target(10, 25, 300, 300);
    const after = raid(realm, rolls(0, 0.999999));
    expect(after.stores).toEqual(realm.stores);
    expect(after.chronicle.at(-1)!.text).toBe(`Repelled a raid from ${realm.rivals[0]!.name}.`);
  });

  it('takes 25% of the food and wood above the safe amount when not repelled', () => {
    // Level 1: 50 food and 60 wood safe. 9 soldiers = 18 power < 25 × 0.8 = 20.
    const realm = target(9, 25, 250, 160);
    const after = raid(realm, rolls(0, 0.999999));
    expect(after.stores.food).toBe(200);
    expect(after.stores.wood).toBe(135);
    expect(after.stores.iron).toBe(10);
    expect(after.stores.gold).toBe(40);
    expect(after.chronicle.at(-1)!.text).toBe(
      `${realm.rivals[0]!.name} raided the capital: lost 50 food and 25 wood.`,
    );
  });

  it('rolls strength E × (0.4–0.8): the same army holds a low roll and falls to a high one', () => {
    // 10 spearmen = 20 power; rival 40 → strength 16 (roll 0) or ~32 (roll ~1).
    const realm = target(10, 40, 300, 300);
    expect(raid(realm, rolls(0, 0)).stores).toEqual(realm.stores);
    expect(raid(realm, rolls(0, 0.999999)).stores.food).toBeLessThan(300);
    // Exactly equal power is repelled: 40 × (0.4 + 0.4 × 0.25) = 20.
    expect(raid(realm, rolls(0, 0.25)).stores).toEqual(realm.stores);
  });

  it('never takes the safe amount, and a realm under it loses nothing', () => {
    for (const level of [1, 2, 3, 4]) {
      const safe = safeAmounts({ ...createRealm(1), storehouse: level });
      const under = target(0, 100, safe.food - 1, safe.wood, level);
      expect(raid(under, rolls(0, 0.5)).stores).toEqual(under.stores);
      let realm = target(0, 100, safe.food + 1000, safe.wood + 1000, level);
      for (let i = 0; i < 200; i++) realm = raid(realm, rolls(0, 0.5));
      expect(realm.stores.food).toBeGreaterThanOrEqual(safe.food);
      expect(realm.stores.wood).toBeGreaterThanOrEqual(safe.wood);
    }
    // Each store is judged on its own: food under safe keeps all, wood over loses a quarter of the excess.
    const mixed = raid(target(0, 100, 40, 160), rolls(0, 0.5));
    expect(mixed.stores.food).toBe(40);
    expect(mixed.stores.wood).toBe(135);
    // Level 0 protects nothing: an unarmed realm loses a quarter of everything.
    const bare = raid(target(0, 100, 80, 40, 0), rolls(0, 0.5));
    expect(bare.stores.food).toBe(60);
    expect(bare.stores.wood).toBe(30);
  });

  it('says so when a lost raid finds nothing above the safe amount', () => {
    const realm = target(0, 100, 50, 60);
    const after = raid(realm, rolls(0, 0.5));
    expect(after.stores).toEqual(realm.stores);
    expect(after.chronicle.at(-1)!.text).toBe(
      `${realm.rivals[0]!.name} raided the capital but found nothing to take.`,
    );
  });

  it('a big step splits at each raid, matching steps of exactly 45 s', () => {
    // A full house (15 of 15) rules out growth; woodcutters refill wood between raids.
    const base = createRealm(1);
    const full = {
      ...base,
      storehouse: 1,
      jobs: { farmer: 9, woodcutter: 2, miner: 0 },
      rivals: base.rivals.map((r) => ({ ...r, hostile: true })),
    };
    let split = full;
    for (let i = 0; i < 10; i++) split = tick(split, RAID.every);
    const big = tick(full, RAID.every * 10);
    expect(big).toEqual(split);
    expect(big.chronicle.filter((c) => c.kind === 'raids')).toHaveLength(10);
  });

  it('does nothing while no rival is hostile', () => {
    const realm = target(0, 100, 300, 300);
    const peace = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: false })) };
    expect(raid(peace, rolls(0, 0.999999))).toBe(peace);
    // With no rival at all, no Change of heart (§11) can make one hostile: events land, raids never.
    const kinds = tick({ ...peace, rivals: [] }, RAID.every * 3).chronicle.map((c) => c.kind);
    expect(kinds.filter((k) => k === 'events')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'raids')).toEqual([]);
  });

  it('picks only among hostile rivals', () => {
    const realm = createRealm(5);
    const rivals = realm.rivals.map((r, i) => ({ ...r, power: 1000, hostile: i !== 1 }));
    const names = new Set<string>();
    for (const roll of [0, 0.4, 0.6, 0.999999]) {
      const text = raid({ ...realm, rivals }, rolls(roll, 0.5)).chronicle.at(-1)!.text;
      names.add(text.split(' raided')[0]!);
    }
    expect(names).toEqual(new Set([rivals[0]!.name, rivals[2]!.name]));
  });

  it('tick raids once every 45 s of game time, rolled on raidRng(seed, n)', () => {
    // No one works, so only raids and events (§11) move the stores.
    const realm = target(0, 100, 5, 300, 1);
    const frozen = { ...realm, idle: 0, jobs: { farmer: 0, woodcutter: 0, miner: 0 } };
    const raids = (r: Realm) => r.chronicle.filter((c) => /raided|Repelled a raid/.test(c.text));
    expect(raids(tick(frozen, RAID.every - 0.25))).toHaveLength(0);
    let stepped = frozen;
    for (let t = 0; t < RAID.every * 2; t += 0.25) stepped = tick(stepped, 0.25);
    expect(raids(stepped)).toHaveLength(2);
    // One big step runs the same two raids as many small ones. (The harvest at 25 s
    // lets peasants grow, which a big step counts coarsely, so food can drift.)
    const big = tick(frozen, RAID.every * 2);
    const other = (r: Realm) => r.chronicle.filter((c) => !/raided|Repelled a raid/.test(c.text));
    expect(other(big)).toEqual(other(stepped));
    expect(big.stores.wood).toBeCloseTo(stepped.stores.wood, 9);
    expect(raids(big).map((c) => c.year)).toEqual([6, 12]);
    // The first raid matches a direct roll on raidRng(seed, 1): same raider, same wood taken.
    const at25 = tick(frozen, EVENT.every);
    const first = raid({ ...at25, time: RAID.every, year: 6 }, raidRng(frozen.seed, 1));
    const who = (text: string) => text.replace(/lost \d+ food/, '');
    expect(who(raids(stepped)[0]!.text)).toBe(who(first.chronicle.at(-1)!.text));
  });

  it('replays the same raids from the same seed', () => {
    const run = (seed: number) => {
      const base = createRealm(seed);
      let r = { ...base, soldiers: 3, rivals: base.rivals.map((v) => ({ ...v, hostile: true })) };
      for (let t = 0; t < RAID.every * 10; t += 0.25) r = tick(r, 0.25);
      return r.chronicle.filter((c) => c.kind === 'raids');
    };
    expect(run(42)).toHaveLength(10);
    expect(run(42)).toEqual(run(42));
    expect(raidRng(42, 1)()).not.toBe(raidRng(42, 2)());
    expect(raidRng(42, 1)()).not.toBe(raidRng(43, 1)());
  });
});

describe('events (design §11)', () => {
  const roll = (value: number) => () => value;
  /** Seed 5 with 4 idle and 6 workers: population 10, under every cap. */
  const base = (): Realm => ({ ...createRealm(5), storehouse: 1 });
  const last = (r: Realm) => r.chronicle.at(-1)!;

  it('Bountiful harvest gives 50 + 3 × population food', () => {
    const realm = base();
    const after = applyEvent(realm, 'harvest', roll(0));
    expect(after.stores.food).toBe(80 + 50 + 3 * 10);
    expect(last(after)).toEqual({ year: 1, kind: 'events', text: 'Bountiful harvest: +80 food.' });
  });

  it("Envoy's gifts give 40 gold and Rich vein 15 iron", () => {
    const realm = base();
    const envoy = applyEvent(realm, 'envoy', roll(0));
    expect(envoy.stores).toEqual({ ...realm.stores, gold: 80 });
    expect(last(envoy).text).toBe("Envoy's gifts: +40 gold.");
    const vein = applyEvent(realm, 'vein', roll(0));
    expect(vein.stores).toEqual({ ...realm.stores, iron: 25 });
    expect(last(vein).text).toBe('Rich vein: +15 iron.');
  });

  it('gains stop at the store cap and say only what was kept (§3)', () => {
    const realm = { ...createRealm(5), stores: { food: 190, wood: 0, iron: 50, gold: 140 } };
    const harvest = applyEvent(realm, 'harvest', roll(0));
    expect(harvest.stores.food).toBe(200);
    expect(last(harvest).text).toBe('Bountiful harvest: +10 food.');
    expect(applyEvent(realm, 'vein', roll(0)).stores.iron).toBe(50);
    expect(last(applyEvent(realm, 'vein', roll(0))).text).toBe('Rich vein: +0 iron.');
    expect(applyEvent(realm, 'envoy', roll(0)).stores.gold).toBe(150);
    // A store already over its cap is never lowered.
    const over = { ...realm, stores: { ...realm.stores, gold: 900 } };
    expect(applyEvent(over, 'envoy', roll(0)).stores.gold).toBe(900);
  });

  it('Plague takes 2 people, idle first and farmers last', () => {
    const realm = { ...base(), idle: 1, jobs: { farmer: 3, woodcutter: 2, miner: 1 } };
    const after = applyEvent(realm, 'plague', roll(0));
    expect(population(after)).toBe(population(realm) - 2);
    expect(after.idle).toBe(0);
    expect(after.jobs).toEqual({ farmer: 3, woodcutter: 2, miner: 0 });
    expect(last(after).text).toBe('Plague: 2 people died.');
  });

  it('Plague is skipped while population ≤ 6', () => {
    const six = { ...base(), idle: 0, jobs: { farmer: 4, woodcutter: 2, miner: 0 } };
    expect(population(six)).toBe(6);
    expect(possibleEvents(six)).not.toContain('plague');
    expect(possibleEvents({ ...six, idle: 1 })).toContain('plague');
    // Every roll still lands one of the other four events; none is a plague.
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
      const after = randomEvent(six, roll(value));
      expect(population(after)).toBe(6);
      expect(after.chronicle).toHaveLength(1);
      expect(last(after).text).not.toMatch(/Plague/);
    }
  });

  it('Change of heart flips a random rival between hostile and at peace', () => {
    const realm = base();
    const rivals = realm.rivals.map((r, i) => ({ ...r, hostile: i === 1 }));
    const peaceful = { ...realm, rivals };
    // Roll 0 picks rival 0 (at peace), the top roll rival 2, the middle one rival 1 (hostile).
    const turned = applyEvent(peaceful, 'changeOfHeart', roll(0));
    expect(turned.rivals.map((r) => r.hostile)).toEqual([true, true, false]);
    expect(last(turned).text).toBe(`Change of heart: ${rivals[0]!.name} turned hostile.`);
    const calmed = applyEvent(peaceful, 'changeOfHeart', roll(0.5));
    expect(calmed.rivals.map((r) => r.hostile)).toEqual([false, false, false]);
    expect(last(calmed).text).toBe(`Change of heart: ${rivals[1]!.name} is now at peace.`);
    expect(applyEvent(peaceful, 'changeOfHeart', roll(0.999999)).rivals[2]!.hostile).toBe(true);
    // Only `hostile` changes.
    expect({ ...turned.rivals[0]!, hostile: false }).toEqual(rivals[0]);
  });

  it('picks each of the five events, equally likely', () => {
    const realm = base();
    expect(possibleEvents(realm)).toEqual([...EVENTS]);
    const titles = [0, 0.2, 0.4, 0.6, 0.8].map((v) => last(randomEvent(realm, roll(v))).text);
    expect(titles.map((t) => t.split(':')[0])).toEqual([
      'Bountiful harvest',
      'Plague',
      "Envoy's gifts",
      'Rich vein',
      'Change of heart',
    ]);
  });

  it('tick runs one event every 25 s of game time, rolled on eventRng(seed, n)', () => {
    const realm = atPeace(base());
    const events = (r: Realm) => r.chronicle.filter((c) => !/raid/.test(c.text));
    expect(events(tick(realm, EVENT.every - 0.25))).toHaveLength(0);
    let stepped = realm;
    for (let t = 0; t < EVENT.every * 4; t += 0.25) stepped = tick(stepped, 0.25);
    expect(events(stepped)).toHaveLength(4);
    // Events take the year of their moment: 25 s is in year 4, 50 s in year 7.
    expect(events(stepped).map((c) => c.year)).toEqual([4, 7, 10, 13]);
    // The first event is the one a direct roll on eventRng(seed, 1) picks.
    const first = randomEvent(realm, eventRng(realm.seed, 1));
    const title = (text: string) => text.split(':')[0];
    expect(title(events(stepped)[0]!.text)).toBe(title(last(first).text));
  });

  it('a big step splits at each event, matching steps of exactly 25 s', () => {
    const realm = atPeace(base());
    let split = realm;
    for (let i = 0; i < 12; i++) split = tick(split, EVENT.every);
    expect(tick(realm, EVENT.every * 12)).toEqual(split);
  });

  it('a raid lands before an event at the same moment (225 s)', () => {
    const realm = createRealm(5);
    const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
    const before = tick(hostile, 225 - 0.25);
    const after = tick(before, 0.25);
    const added = after.chronicle.slice(before.chronicle.length).map((c) => c.text);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatch(/raid/);
    expect(added[1]).not.toMatch(/raid/);
  });

  it('replays the same events from the same seed', () => {
    const run = (seed: number) => {
      let r = atPeace(createRealm(seed));
      for (let t = 0; t < EVENT.every * 10; t += 0.25) r = tick(r, 0.25);
      return r.chronicle;
    };
    expect(run(42)).toEqual(run(42));
    expect(eventRng(42, 1)()).not.toBe(eventRng(42, 2)());
    expect(eventRng(42, 1)()).not.toBe(eventRng(43, 1)());
    expect(eventRng(42, 1)()).not.toBe(raidRng(42, 1)());
  });
});

describe('Chronicle (design §12)', () => {
  const WIN = () => 0;
  const LOSE = () => 0.999999;
  const lines = (r: Realm) => r.chronicle.map((c) => c.text);
  /** Rival 0 at `power` and at peace, the realm with `soldiers` and gold to spend. */
  const armed = (soldiers: number, power: number): Realm => {
    const realm = createRealm(11);
    return {
      ...realm,
      year: 3,
      soldiers,
      stores: { ...realm.stores, wood: 150, iron: 20, gold: 100 },
      rivals: realm.rivals.map((r, i) => (i === 0 ? { ...r, power, hostile: false } : r)),
    };
  };

  it('tags each line with the year it happened', () => {
    const next = build(armed(0, 20), 'hut');
    expect(next.chronicle).toEqual([{ year: 3, kind: 'buildings', text: 'Built a hut.' }]);
  });

  it('writes buildings raised and Storehouse upgrades', () => {
    let realm = armed(0, 20);
    for (const b of ['hut', 'market', 'forge'] as const) realm = build(realm, b);
    realm = upgradeStorehouse({ ...realm, stores: { ...realm.stores, wood: 100 } });
    expect(lines(realm)).toEqual([
      'Built a hut.',
      'Built a market.',
      'Built a forge.',
      'Raised the Storehouse to level 1.',
    ]);
  });

  it('writes scouting reports and tribute', () => {
    const realm = armed(0, 20.4);
    const name = realm.rivals[0]!.name;
    const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
    expect(lines(scout(realm, 0))).toEqual([
      `Scouted ${name}: power 20, ${traitLabel(realm.rivals[0]!.trait)}.`,
    ]);
    expect(lines(tribute(hostile, 0))).toEqual([
      `Paid 30 gold of tribute to ${name}; now at peace.`,
    ]);
  });

  it('writes a won battle, the new rival and the trait gained', () => {
    const realm = armed(10, 10);
    const next = attack(realm, 0, WIN);
    const fresh = next.rivals.at(-1)!.name;
    expect(lines(next)).toEqual([
      `Conquered ${realm.rivals[0]!.name}: 2 soldiers fell; ${fresh} appears beyond it.`,
      `Gained the trait ${traitLabel(realm.rivals[0]!.trait)}.`,
    ]);
    expect(next.chronicle.every((c) => c.year === 3)).toBe(true);
  });

  it('writes a lost battle, with "soldier" for one', () => {
    const name = armed(1, 100).rivals[0]!.name;
    expect(lines(attack(armed(7, 100), 0, LOSE))).toEqual([
      `Lost a battle against ${name}: 4 soldiers fell.`,
    ]);
    expect(lines(attack(armed(1, 100), 0, LOSE))).toEqual([
      `Lost a battle against ${name}: 1 soldier fell.`,
    ]);
  });

  it('writes raids and events during tick, each in the year it landed', () => {
    const realm = createRealm(5);
    const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
    const next = tick(hostile, RAID.every);
    const yearAt = (t: number) => 1 + Math.floor(t / YEAR_SECONDS);
    // The event at 25 s comes first, then the raid at 45 s, each in its own year.
    expect(next.chronicle).toHaveLength(2);
    expect(next.chronicle[0]!.year).toBe(yearAt(EVENT.every));
    expect(next.chronicle[0]!.text).not.toMatch(/raided|Repelled a raid/);
    expect(next.chronicle[1]!.year).toBe(yearAt(RAID.every));
    expect(next.chronicle[1]!.text).toMatch(/raided|Repelled a raid/);
  });

  it('writes nothing when an action does nothing', () => {
    const broke = { ...armed(0, 20), stores: { food: 0, wood: 0, iron: 0, gold: 0 } };
    for (const r of [
      build(broke, 'hut'),
      upgradeStorehouse(broke),
      scout(broke, 0),
      tribute(broke, 0),
      attack(broke, 0, WIN),
    ]) {
      expect(r.chronicle).toEqual([]);
    }
  });

  it(`keeps the latest ${CHRONICLE_MAX}, dropping the oldest`, () => {
    const old = Array.from({ length: CHRONICLE_MAX }, (_, i) => ({
      year: 1,
      kind: 'events' as const,
      text: `old ${i}`,
    }));
    const next = build({ ...armed(0, 20), chronicle: old }, 'hut');
    expect(next.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(next.chronicle[0]!.text).toBe('old 1');
    expect(next.chronicle.at(-1)).toEqual({ year: 3, kind: 'buildings', text: 'Built a hut.' });
    expect(old).toHaveLength(CHRONICLE_MAX);
  });

  it(`trims a longer Chronicle to ${CHRONICLE_MAX} on the next line`, () => {
    const old = Array.from({ length: 250 }, (_, i) => ({
      year: 1,
      kind: 'events' as const,
      text: `old ${i}`,
    }));
    const next = build({ ...armed(0, 20), chronicle: old }, 'hut');
    expect(next.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(next.chronicle[0]!.text).toBe('old 51');
  });

  it(`stays at ${CHRONICLE_MAX} over a long run`, () => {
    const next = tick(atPeace(createRealm(3)), EVENT.every * 300);
    expect(next.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(next.chronicle.at(-1)!.year).toBe(next.year);
  });

  it('tags every line with exactly one kind', () => {
    const base = armed(10, 20);
    const hostile = { ...base, rivals: base.rivals.map((r) => ({ ...r, hostile: true })) };
    const rng = () => 0.5;
    /** The kinds of the lines `after` added. */
    const kinds = (after: Realm, before: Realm = base) =>
      after.chronicle.slice(before.chronicle.length).map((c) => c.kind);
    const traited = gainTrait(
      gainTrait(gainTrait(base, 'fertileValleys'), 'fertileValleys'),
      'goldenAge',
    );
    const slotted = slotTrait(traited, 0, 'fertileValleys');
    const cases: [Realm, Realm, string[]][] = [
      [build(base, 'hut'), base, ['buildings']],
      [build(base, 'market'), base, ['buildings']],
      [build(base, 'forge'), base, ['buildings']],
      [upgradeStorehouse(base), base, ['buildings']],
      [scout(base, 0), base, ['rivals']],
      [tribute(hostile, 0), hostile, ['rivals']],
      [applyEvent(base, 'changeOfHeart', rng), base, ['rivals']],
      [applyEvent(base, 'harvest', rng), base, ['events']],
      [applyEvent({ ...base, idle: 10 }, 'plague', rng), base, ['events']],
      [applyEvent(base, 'envoy', rng), base, ['events']],
      [applyEvent(base, 'vein', rng), base, ['events']],
      [raid(hostile, rng), hostile, ['raids']],
      [raid({ ...hostile, soldiers: 0 }, rng), hostile, ['raids']],
      [attack(base, 0, WIN), base, ['battles', 'traits']],
      [attack(armed(1, 100), 0, LOSE), base, ['battles']],
      [gainTrait(base, 'fertileValleys'), base, ['traits']],
      [gainTrait(gainTrait(base, 'goldenAge'), 'goldenAge'), base, ['traits', 'traits']],
      [slotted, traited, ['traits']],
      [upgradeTrait(slotted, 'fertileValleys'), slotted, ['traits']],
      [sellDuplicate(slotted, 'fertileValleys'), slotted, ['traits']],
      [slotTrait(slotted, 0, 'goldenAge'), slotted, ['traits']],
      [awaySummary(base, base, 3600), base, ['away']],
    ];
    for (const [after, before, expected] of cases) expect(kinds(after, before)).toEqual(expected);
    const seen = new Set(cases.flatMap(([a, b]) => kinds(a, b)));
    expect([...seen].sort()).toEqual([...CHRONICLE_KINDS].sort());
  });

  it('tags raid and event lines written during tick', () => {
    const realm = createRealm(5);
    const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
    const next = tick(hostile, RAID.every * 20);
    for (const c of next.chronicle) {
      expect(c.kind).toBe(
        /raided|Repelled a raid/.test(c.text)
          ? 'raids'
          : /Change of heart/.test(c.text)
            ? 'rivals'
            : /Challenge|trait/.test(c.text)
              ? 'traits'
              : 'events',
      );
    }
  });
});

describe('chronicleView (design §12)', () => {
  const entry = (i: number) => ({
    year: 1 + Math.floor(i / 3),
    // A fixed rotation, so adding a kind doesn't reshuffle these fixtures.
    kind: (['events', 'raids', 'battles', 'rivals', 'buildings', 'traits'] as const)[i % 6]!,
    text: `line ${i}`,
  });

  it('shows every line newest first with every kind on', () => {
    const all = Array.from({ length: 12 }, (_, i) => entry(i));
    expect(chronicleView(all, new Set(CHRONICLE_KINDS))).toEqual([...all].reverse());
  });

  it('hides exactly the lines of the kinds turned off, keeping order and years', () => {
    const all = Array.from({ length: 12 }, (_, i) => entry(i));
    const view = chronicleView(all, new Set(['raids', 'traits'] as const));
    expect(view.map((e) => e.text)).toEqual(['line 11', 'line 7', 'line 5', 'line 1']);
    expect(view.map((e) => e.year)).toEqual([4, 3, 2, 1]);
  });

  it('shows nothing with every kind off, and leaves the Chronicle untouched', () => {
    const all = Array.from({ length: 12 }, (_, i) => entry(i));
    const before = structuredClone(all);
    expect(chronicleView(all, new Set())).toEqual([]);
    expect(all).toEqual(before);
  });

  it(`hidden lines still count toward the ${CHRONICLE_MAX}-line cap`, () => {
    const old = Array.from({ length: CHRONICLE_MAX }, (_, i) => entry(i));
    let realm: Realm = { ...createRealm(11), year: 99, chronicle: old };
    realm = build({ ...realm, stores: { ...realm.stores, wood: 100 } }, 'hut');
    expect(realm.chronicle).toHaveLength(CHRONICLE_MAX);
    const view = chronicleView(realm.chronicle, new Set(['buildings'] as const));
    expect(view[0]).toEqual({ year: 99, kind: 'buildings', text: 'Built a hut.' });
    // line 0 (events) fell off the oldest end; the oldest buildings line left is line 4.
    expect(view.at(-1)!.text).toBe('line 4');
    expect(view).toHaveLength(1 + old.slice(1).filter((e) => e.kind === 'buildings').length);
  });
});

describe('trait sources (design §9)', () => {
  /** A realm with every rival at peace and no market: no challenge or trader unless a test adds one. */
  const calm = (seed = 9): Realm => atPeace(createRealm(seed));
  /** One 0.25 s tick, which runs the trait sources at its end. */
  const nudge = (realm: Realm): Realm => tick(realm, 0.25);
  /** The realm at the start of `year`. */
  const inYear = (realm: Realm, year: number): Realm => ({
    ...realm,
    year,
    time: (year - 1) * YEAR_SECONDS,
  });
  /** Chronicle lines `after` added on top of `before`. */
  const added = (before: Realm, after: Realm) =>
    after.chronicle.slice(before.chronicle.length).map((c) => c.text);

  describe('rolled traits', () => {
    it('lands on each tier at its roll odds over a seeded sample', () => {
      const rng = createRng(2026);
      const n = 200_000;
      const counts = new Map<Trait, number>();
      for (let i = 0; i < n; i++) {
        const t = rollTrait(rng);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const tier of TIERS) {
        const inTier = TRAITS.filter((t) => TRAIT_INFO[t].tier === tier);
        const share = inTier.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0) / n;
        expect(share).toBeCloseTo(TIER_INFO[tier].odds, 2);
        // Within a tier, each trait is equally likely.
        for (const t of inTier) {
          expect((counts.get(t) ?? 0) / n).toBeCloseTo(TIER_INFO[tier].odds / inTier.length, 2);
        }
      }
    });

    it('rolls the same traits from the same seed', () => {
      const roll = (seed: number) => {
        const rng = createRng(seed);
        return Array.from({ length: 50 }, () => rollTrait(rng));
      };
      expect(roll(7)).toEqual(roll(7));
      expect(roll(7)).not.toEqual(roll(8));
    });

    it('takes the last tier on a roll past the summed odds', () => {
      const rolls = [0.9999999999999999, 0];
      expect(rollTrait(() => rolls.shift()!)).toBe('goldenAge');
    });

    it('gives each source its own stream', () => {
      const first = (s: Parameters<typeof traitRng>[1], seed = 1, n = 1) => traitRng(seed, s, n)();
      const streams = (['milestone', 'challenge', 'reward', 'trader'] as const).map((s) =>
        first(s),
      );
      expect(new Set(streams).size).toBe(4);
      expect(first('trader', 1, 1)).not.toBe(first('trader', 1, 2));
      expect(first('trader', 1, 1)).not.toBe(first('trader', 2, 1));
    });

    it('sets each tier odds and price range as in the tier table', () => {
      expect(TIERS.map((t) => TIER_INFO[t].odds)).toEqual([0.45, 0.3, 0.15, 0.07, 0.03]);
      expect(TIERS.map((t) => TIER_INFO[t].price)).toEqual([
        [150, 250],
        [300, 500],
        [600, 1000],
        [1200, 1800],
        [2500, 4000],
      ]);
      // Buying to resell always loses gold.
      for (const t of TIERS) expect(TIER_INFO[t].sellGold).toBeLessThan(TIER_INFO[t].price[0]);
    });
  });

  describe('milestones', () => {
    const reach: Record<(typeof MILESTONES)[number], (r: Realm) => Realm> = {
      people: (r) => ({ ...r, idle: 50 - workers(r), annexedHousing: 100 }),
      battles: (r) => ({ ...r, battlesWon: 10 }),
      storehouse: (r) => ({ ...r, storehouse: 3 }),
      raids: (r) => ({ ...r, raidsRepelled: 5 }),
    };
    const workers = (r: Realm) => r.jobs.farmer + r.jobs.woodcutter + r.jobs.miner + r.soldiers;

    it.each(MILESTONES)('%s pays out exactly once, as 1 of 3 rolled traits', (m) => {
      const before = reach[m](calm());
      expect(MILESTONE_INFO[m].reached(before)).toBe(true);
      const once = nudge(before);
      expect(once.milestones).toEqual([m]);
      expect(once.offers).toHaveLength(1);
      expect(once.offers[0]!.source).toBe('milestone');
      expect(once.offers[0]!.choices).toHaveLength(OFFER_CHOICES.milestone);
      // The choices are rolled on the milestone's own stream.
      const rng = traitRng(before.seed, 'milestone', MILESTONES.indexOf(m));
      expect(once.offers[0]!.choices).toEqual([rollTrait(rng), rollTrait(rng), rollTrait(rng)]);
      const line = once.chronicle.find((c) => c.text.startsWith('Milestone reached'))!;
      expect(line.kind).toBe('traits');
      expect(line.text).toContain(MILESTONE_INFO[m].goal);
      // Still reached later, never paid again.
      const later = tick(once, YEAR_SECONDS * 3);
      expect(later.milestones).toEqual([m]);
      expect(later.offers.filter((o) => o.source === 'milestone')).toHaveLength(1);
    });

    it('is not paid before its goal is reached', () => {
      const realm = calm();
      const short = {
        ...realm,
        storehouse: 2,
        battlesWon: 9,
        raidsRepelled: 4,
      };
      const next = nudge(short);
      expect(next.milestones).toEqual([]);
      expect(next.offers).toEqual([]);
    });

    it('counts battles won, not battles lost', () => {
      const realm = { ...calm(), soldiers: 10 };
      expect(attack(realm, 0, () => 0).battlesWon).toBe(1);
      expect(attack(realm, 0, () => 0.999999).battlesWon).toBe(0);
    });

    it('counts raids repelled, not raids lost', () => {
      const realm = createRealm(3);
      const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
      expect(raid({ ...hostile, soldiers: 1000 }, () => 0).raidsRepelled).toBe(1);
      expect(raid({ ...hostile, soldiers: 0 }, () => 0).raidsRepelled).toBe(0);
    });

    it('pays every milestone reached in the same tick', () => {
      let realm = calm();
      for (const m of MILESTONES) realm = reach[m](realm);
      const next = nudge(realm);
      expect(next.milestones).toEqual([...MILESTONES]);
      expect(next.offers).toHaveLength(MILESTONES.length);
    });
  });

  describe('offers', () => {
    const withOffer = (choices: Trait[], source: 'milestone' | 'challenge' = 'milestone') => ({
      ...calm(),
      offers: [{ source, choices }],
    });

    it('picking a new trait gains it at level 1 and closes the offer', () => {
      const realm = withOffer(['timberClans', 'goldenAge', 'horseLords']);
      const next = pickOffer(realm, 0, 1);
      expect(next.traits.goldenAge).toEqual({ level: 1, duplicates: 0 });
      expect(next.offers).toEqual([]);
      expect(added(realm, next)).toEqual([
        `Picked ${traitLabel('goldenAge')} from a milestone offer.`,
        `Gained the trait ${traitLabel('goldenAge')}.`,
      ]);
      expect(next.chronicle.at(-2)!.kind).toBe('traits');
    });

    it('picking an owned trait gives a duplicate', () => {
      const realm = gainTrait(withOffer(['timberClans', 'goldenAge'], 'challenge'), 'timberClans');
      const next = pickOffer(realm, 0, 0);
      expect(next.traits.timberClans).toEqual({ level: 1, duplicates: 1 });
      expect(added(realm, next)[1]).toBe(`Gained a duplicate of ${traitLabel('timberClans')}.`);
    });

    it('picks from the offer asked for and leaves the others', () => {
      const realm = {
        ...calm(),
        offers: [
          { source: 'milestone' as const, choices: ['timberClans', 'goldenAge', 'horseLords'] },
          { source: 'challenge' as const, choices: ['warriorCreed', 'fertileValleys'] },
        ] as Realm['offers'],
      };
      const next = pickOffer(realm, 1, 0);
      expect(next.traits).toEqual({ warriorCreed: { level: 1, duplicates: 0 } });
      expect(next.offers).toEqual([realm.offers[0]]);
    });

    it.each([
      [-1, 0],
      [1, 0],
      [0, 3],
      [0, -1],
      [0.5, 0],
      [0, 0.5],
      [NaN, 0],
      [0, Infinity],
    ])('ignores offer %s, choice %s', (index, choice) => {
      const realm = withOffer(['timberClans', 'goldenAge', 'horseLords']);
      expect(pickOffer(realm, index, choice)).toBe(realm);
    });

    it(`keeps at most ${OFFER_MAX} offers, dropping the oldest`, () => {
      let realm = calm();
      // Each pass reaches a milestone and then forgets it, so it pays again.
      for (let i = 0; i < OFFER_MAX + 2; i++) {
        realm = nudge({ ...realm, storehouse: 3, milestones: [] });
      }
      expect(realm.offers).toHaveLength(OFFER_MAX);
    });
  });

  describe('challenges', () => {
    /** A realm whose only possible challenge is food: Storehouse 1 (food cap 500), every rival at peace. */
    const foodOnly = (seed = 9) => ({ ...calm(seed), storehouse: 1 });

    it('offers one every 15 years, starting at year 16', () => {
      const realm = foodOnly();
      expect(realm.challengeYear).toBe(1 + CHALLENGE.every);
      expect(nudge(inYear(realm, 15)).challenge).toBeNull();
      const offered = nudge(inYear(realm, 16));
      expect(offered.challenge).toEqual({ kind: 'food', deadline: 16 + CHALLENGE.foodYears });
      const line = offered.chronicle.at(-1)!;
      expect(line).toEqual({
        year: 16,
        kind: 'traits',
        text: `Challenge: stockpile ${CHALLENGE.food} food by year 19.`,
      });
    });

    it('is offered only when none is active', () => {
      const active = { kind: 'raid' as const, deadline: 30 };
      const realm = { ...inYear(foodOnly(), 25), challenge: active, challengeYear: 1 };
      expect(nudge(realm).challenge).toBe(active);
    });

    it('offers only challenges that can be met', () => {
      expect(possibleChallenges(calm())).toEqual([]);
      expect(nudge(inYear(calm(), 16)).challenge).toBeNull();
      expect(possibleChallenges(foodOnly())).toEqual(['food']);
      const full = { ...foodOnly(), stores: { food: 500, wood: 0, iron: 0, gold: 0 } };
      expect(possibleChallenges(full)).toEqual([]);
      const realm = createRealm(9);
      const hostile = { ...realm, rivals: realm.rivals.map((r) => ({ ...r, hostile: true })) };
      expect(possibleChallenges(hostile)).toEqual(['raid']);
      expect(possibleChallenges({ ...hostile, storehouse: 1 })).toEqual(['food', 'raid']);
    });

    it('picks the challenge on the challenge stream of its year', () => {
      const realm = createRealm(11);
      const both = {
        ...inYear(realm, 16),
        storehouse: 1,
        rivals: realm.rivals.map((r) => ({ ...r, hostile: true })),
      };
      const kinds = new Set<string>();
      for (let seed = 0; seed < 40; seed++) {
        const next = nudge({ ...both, seed });
        const rng = traitRng(seed, 'challenge', 16);
        expect(next.challenge!.kind).toBe(['food', 'raid'][Math.floor(rng() * 2)]);
        kinds.add(next.challenge!.kind);
      }
      expect(kinds).toEqual(new Set(['food', 'raid']));
    });

    it('a met food challenge offers 1 of 2 rolled traits', () => {
      const realm = {
        ...inYear(foodOnly(), 17),
        challenge: { kind: 'food' as const, deadline: 19 },
        stores: { food: 499, wood: 0, iron: 0, gold: 0 },
        jobs: { farmer: 20, woodcutter: 0, miner: 0 },
      };
      const next = nudge(realm);
      expect(next.challenge).toBeNull();
      expect(next.challengeYear).toBe(17 + CHALLENGE.every);
      expect(next.offers).toHaveLength(1);
      expect(next.offers[0]!.source).toBe('challenge');
      expect(next.offers[0]!.choices).toHaveLength(OFFER_CHOICES.challenge);
      const rng = traitRng(realm.seed, 'reward', 17);
      expect(next.offers[0]!.choices).toEqual([rollTrait(rng), rollTrait(rng)]);
      const [a, b] = next.offers[0]!.choices.map((t) => traitLabel(t));
      expect(added(realm, next)).toEqual([
        `Challenge met: ${CHALLENGE_INFO.food.goal}. Pick a trait: ${a} or ${b}.`,
      ]);
    });

    it('failing at the deadline costs nothing', () => {
      const realm = {
        ...inYear(foodOnly(), 18),
        time: 18 * YEAR_SECONDS - 0.25,
        challenge: { kind: 'food' as const, deadline: 19 },
      };
      const next = nudge(realm);
      expect(next.year).toBe(19);
      expect(next.challenge).toBeNull();
      expect(next.challengeYear).toBe(19 + CHALLENGE.every);
      expect(next.offers).toEqual([]);
      expect(next.traits).toEqual(realm.traits);
      expect(added(realm, next)).toContain(
        `Challenge failed: ${CHALLENGE_INFO.food.goal}. No penalty.`,
      );
      // Nothing else moves beyond what the same tick does without a challenge.
      const plain = nudge({ ...realm, challenge: null, challengeYear: 1000 });
      expect({ ...next.stores }).toEqual(plain.stores);
      expect(population(next)).toBe(population(plain));
    });

    it('is still active the year before its deadline', () => {
      const realm = {
        ...inYear(foodOnly(), 18),
        challenge: { kind: 'food' as const, deadline: 19 },
      };
      expect(nudge(realm).challenge).toEqual({ kind: 'food', deadline: 19 });
    });

    it('"repel the next raid" is met by a repelled raid and failed by a lost one', () => {
      const realm = createRealm(3);
      const hostile = {
        ...inYear(realm, 20),
        rivals: realm.rivals.map((r) => ({ ...r, hostile: true })),
        challenge: { kind: 'raid' as const, deadline: 26 },
      };
      const won = raid({ ...hostile, soldiers: 1000 }, () => 0);
      expect(won.challenge).toBeNull();
      expect(won.offers).toHaveLength(1);
      expect(won.chronicle.at(-1)!.text).toMatch(
        new RegExp(`^Challenge met: ${CHALLENGE_INFO.raid.goal}\\. Pick a trait: .+ or .+\\.$`),
      );
      const lost = raid({ ...hostile, soldiers: 0 }, () => 0);
      expect(lost.challenge).toBeNull();
      expect(lost.offers).toEqual([]);
      expect(lost.chronicle.at(-1)!.text).toBe(
        `Challenge failed: ${CHALLENGE_INFO.raid.goal}. No penalty.`,
      );
      // A raid leaves a food challenge alone.
      const food = { ...hostile, challenge: { kind: 'food' as const, deadline: 22 } };
      expect(raid({ ...food, soldiers: 1000 }, () => 0).challenge).toEqual(food.challenge);
    });
  });

  describe('Market trader', () => {
    const market = (realm: Realm): Realm => ({
      ...realm,
      buildings: { ...realm.buildings, market: 1 },
    });

    it('needs a Market', () => {
      const realm = tick(calm(), YEAR_SECONDS * 30);
      expect(realm.trader).toEqual([]);
      expect(realm.traderYear).toBe(0);
    });

    it('opens with 3 rolled traits as soon as there is a Market', () => {
      const realm = inYear(market(calm()), 4);
      const next = nudge(realm);
      expect(next.traderYear).toBe(4);
      expect(next.trader).toHaveLength(TRADER.stock);
      const rng = traitRng(realm.seed, 'trader', 4);
      for (const item of next.trader) {
        expect(item.trait).toBe(rollTrait(rng));
        const [min, max] = TIER_INFO[TRAIT_INFO[item.trait].tier].price;
        expect(item.price).toBe(min + Math.floor(rng() * (max - min + 1)));
      }
      const line = next.chronicle.at(-1)!;
      expect(line.kind).toBe('traits');
      expect(line.text).toMatch(
        /^The trader offers .+ for \d+ gold, .+ for \d+ gold and .+ for \d+ gold\.$/,
      );
    });

    it('restocks every 10 years', () => {
      const opened = nudge(inYear(market(calm()), 4));
      const at13 = nudge(inYear(opened, 13));
      expect(at13.trader).toBe(opened.trader);
      const at14 = nudge(inYear(opened, 14));
      expect(at14.traderYear).toBe(14);
      expect(at14.trader).not.toEqual(opened.trader);
      // Over a long run: one restock per 10 years.
      const long = tick(opened, YEAR_SECONDS * 50);
      const restocks = long.chronicle.filter((c) => c.text.startsWith('The trader offers'));
      expect(restocks.map((c) => c.year)).toEqual([4, 14, 24, 34, 44, 54]);
    });

    it('keeps every price within its tier range', () => {
      for (let seed = 0; seed < 300; seed++) {
        const next = nudge({ ...market(calm()), seed });
        for (const { trait, price } of next.trader) {
          const [min, max] = TIER_INFO[TRAIT_INFO[trait].tier].price;
          expect(Number.isInteger(price)).toBe(true);
          expect(price).toBeGreaterThanOrEqual(min);
          expect(price).toBeLessThanOrEqual(max);
        }
      }
    });

    const shop = (gold: number, storehouse = 3): Realm => ({
      ...calm(),
      storehouse,
      stores: { food: 100, wood: 0, iron: 0, gold },
      trader: [
        { trait: 'timberClans', price: 200 },
        { trait: 'goldenAge', price: 3000 },
      ],
      traderYear: 1,
    });

    it('sells a trait for its price', () => {
      const realm = shop(3500);
      const next = buyTrait(realm, 1);
      expect(next.stores.gold).toBe(500);
      expect(next.traits.goldenAge).toEqual({ level: 1, duplicates: 0 });
      expect(next.trader).toEqual([{ trait: 'timberClans', price: 200 }]);
      expect(added(realm, next)).toEqual([
        `Bought ${traitLabel('goldenAge')} from the trader for 3000 gold.`,
        `Gained the trait ${traitLabel('goldenAge')}.`,
      ]);
      // An owned trait bought again is a duplicate.
      const again = buyTrait(buyTrait(shop(3500), 0), 0);
      expect(again.traits.timberClans).toEqual({ level: 1, duplicates: 0 });
      const twice = buyTrait({ ...realm, traits: { goldenAge: { level: 1, duplicates: 0 } } }, 1);
      expect(twice.traits.goldenAge).toEqual({ level: 1, duplicates: 1 });
    });

    it('cannot sell while gold is short', () => {
      const realm = shop(2999);
      expect(buyTrait(realm, 1)).toBe(realm);
    });

    it('cannot sell above the gold cap', () => {
      // Storehouse 2 caps gold at 1,200; even gold held past the cap can't pay a 3,000 price.
      const realm = shop(5000, 2);
      expect(buyTrait(realm, 1)).toBe(realm);
      expect(buyTrait(realm, 0).trader).toHaveLength(1);
    });

    it.each([-1, 2, 0.5, NaN, Infinity])('ignores item %s', (index) => {
      const realm = shop(5000);
      expect(buyTrait(realm, index)).toBe(realm);
    });
  });

  it('a long run rolls the same trait sources from the same seed', () => {
    const run = (seed: number) => {
      const realm = createRealm(seed);
      const busy = {
        ...realm,
        storehouse: 1,
        soldiers: 5,
        buildings: { ...realm.buildings, market: 1 },
      };
      return tick(busy, YEAR_SECONDS * 120);
    };
    const a = run(77);
    expect(a.chronicle.some((c) => c.text.startsWith('Challenge'))).toBe(true);
    expect(a).toEqual(run(77));
    expect(a.trader).not.toEqual(run(78).trader);
  });
});
