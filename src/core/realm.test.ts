import { describe, expect, it } from 'vitest';
import { RESOURCES, createRealm, rates, tick } from './realm.ts';

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
    let realm = createRealm(1);
    for (let i = 0; i < 1000; i++) realm = tick(realm, 0.25);
    expect(realm.time).toBeCloseTo(250, 9);
    const once = tick(createRealm(1), 250);
    for (const k of RESOURCES) expect(realm.stores[k]).toBeCloseTo(once.stores[k], 6);
  });
});
