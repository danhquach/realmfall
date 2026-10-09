import { describe, expect, it } from 'vitest';
import {
  RESOURCES,
  conquests,
  createRealm,
  housingCap,
  PEOPLE,
  population,
  rates,
  STOREHOUSE,
  type Realm,
} from './realm.ts';
import { createRng } from './rng.ts';
import { SIM_LIMITS, STRATEGY, decide, formatTable, parseArgs, simulate } from './sim.ts';

describe('simulate', () => {
  it('plays 100 years in well under 5 s, one row per year', () => {
    const started = performance.now();
    const rows = simulate(100, 1);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(rows.map((r) => r.year)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('is reproducible from the seed, and seeds differ', () => {
    expect(simulate(30, 7)).toEqual(simulate(30, 7));
    expect(simulate(30, 7)).not.toEqual(simulate(30, 8));
  });

  it('keeps every number finite and non-negative over a long run', () => {
    for (const r of simulate(300, 3)) {
      for (const n of [...RESOURCES.map((k) => r.stores[k]), r.population, r.soldiers, r.power])
        expect(n >= 0 && Number.isFinite(n)).toBe(true);
      expect(Number.isInteger(r.conquests)).toBe(true);
    }
  });

  it('grows the realm and raises an army', () => {
    const last = simulate(100, 1).at(-1)!;
    expect(last.population).toBeGreaterThan(population(createRealm(1)));
    expect(last.soldiers).toBeGreaterThan(0);
  });

  it('returns no rows for zero years', () => {
    expect(simulate(0, 1)).toEqual([]);
  });
});

describe('decide', () => {
  const rng = () => createRng(99);
  /** A new realm with a finished Barracks, so it can train. */
  const camp = (): Realm => {
    const realm = createRealm(1);
    return { ...realm, buildings: { ...realm.buildings, barracks: 1 } };
  };

  it('takes the first choice of every pending trait offer and slots it', () => {
    const offers: Realm['offers'] = [
      { source: 'milestone', choices: ['goldenAge', 'timberClans', 'horseLords'] },
      { source: 'challenge', choices: ['fertileValleys', 'goldenAge'] },
    ];
    const next = decide({ ...createRealm(1), offers }, rng());
    expect(next.offers).toEqual([]);
    expect(next.traits.goldenAge).toBeDefined();
    expect(next.traits.fertileValleys).toBeDefined();
    expect(next.slots).toEqual(expect.arrayContaining(['goldenAge', 'fertileValleys']));
  });

  it('attacks and annexes the weakest rival when the odds clear the bar', () => {
    const realm: Realm = { ...createRealm(1), soldiers: 200 };
    const weakest = realm.rivals.reduce((a, b) => (b.power < a.power ? b : a));
    const next = decide(realm, rng());
    expect(conquests(next)).toBe(1);
    expect(next.rivals.map((r) => r.name)).not.toContain(weakest.name);
    expect(realm.rivals.filter((r) => r !== weakest).every((r) => next.rivals.includes(r))).toBe(
      true,
    );
    // The annexed rival's trait goes straight into an empty slot.
    expect(next.slots.filter((t) => t !== null)).toHaveLength(1);
  });

  it('holds back when the odds are below the bar', () => {
    const realm: Realm = { ...createRealm(1), soldiers: 1 };
    const next = decide(realm, rng());
    expect(conquests(next)).toBe(0);
    expect(next.chronicle.some((e) => e.kind === 'battles')).toBe(false);
    expect(next.rivals).toEqual(realm.rivals);
  });

  it('puts every idle peasant to work, farms first while food is short', () => {
    const realm: Realm = {
      ...createRealm(1),
      idle: 6,
      jobs: { farmer: 0, woodcutter: 0, miner: 0, builder: 0 },
    };
    const next = decide(realm, rng());
    expect(next.idle).toBe(0);
    expect(rates(next).food).toBeGreaterThanOrEqual(STRATEGY.foodMargin);
  });

  it('orders a Hut when housing is one Hut from full and wood allows', () => {
    const base = createRealm(1);
    const realm: Realm = {
      ...base,
      idle: housingCap(base) - PEOPLE.hutHousing - population(base) + base.idle,
      stores: { ...base.stores, wood: 100, gold: 0 },
    };
    expect(decide(realm, rng()).queue.map((o) => o.building)).toEqual(['hut']);
    const roomy = { ...realm, idle: realm.idle - 1 };
    expect(decide(roomy, rng()).queue).toEqual([]);
  });

  it('orders the next Storehouse level when a store is nearly full', () => {
    const base = createRealm(1);
    const realm: Realm = {
      ...base,
      stores: { ...STOREHOUSE[0]!.caps }, // every store at its level-0 cap
    };
    expect(decide(realm, rng()).queue.map((o) => o.building)).toContain('storehouse');
  });

  it('orders the Barracks once 15 people live in the realm, and only once', () => {
    const base = createRealm(1);
    const realm: Realm = { ...base, idle: 8, stores: { ...base.stores, wood: 100, gold: 100 } };
    expect(population(realm)).toBe(15);
    const next = decide(realm, rng());
    expect(next.queue.filter((o) => o.building === 'barracks')).toHaveLength(1);
    expect(decide(next, rng()).queue.filter((o) => o.building === 'barracks')).toHaveLength(1);
    expect(decide({ ...realm, idle: 7 }, rng()).queue.map((o) => o.building)).not.toContain(
      'barracks',
    );
  });

  it('never queues two orders of the same kind', () => {
    let realm: Realm = { ...camp(), idle: 30, storehouse: 3, soldiers: 20 };
    realm = { ...realm, stores: { food: 5000, wood: 6000, iron: 1200, gold: 4000, weapons: 0 } };
    realm = decide(decide(realm, rng()), rng());
    const kinds = realm.queue.map((o) => o.building);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(expect.arrayContaining(['market', 'forge', 'wall']));
  });

  it(`keeps one builder per ${STRATEGY.peoplePerBuilder} people while orders wait, one otherwise`, () => {
    const busy = { ...createRealm(1), idle: 30 };
    const want = Math.floor(population(busy) / STRATEGY.peoplePerBuilder);
    expect(decide(busy, rng()).queue.length).toBeGreaterThan(0);
    expect(decide(busy, rng()).jobs.builder).toBe(want);
    const quiet: Realm = {
      ...createRealm(1),
      stores: { food: 80, wood: 0, iron: 0, gold: 0, weapons: 0 },
      jobs: { farmer: 4, woodcutter: 2, miner: 0, builder: 5 },
    };
    const next = decide(quiet, rng());
    expect(next.queue).toEqual([]);
    expect(next.jobs.builder).toBe(1);
  });

  it('trains no soldier before a Barracks stands', () => {
    const realm: Realm = {
      ...createRealm(1),
      stores: { food: 80, wood: 0, iron: 50, gold: 140, weapons: 0 },
    };
    expect(decide(realm, rng()).soldiers).toBe(0);
  });

  it('trains on thin income only while the gold stockpile covers the shortfall', () => {
    // 5 workers pay 1.25 gold/s; with a third soldier, upkeep makes that −0.25/s,
    // so 10 years (80 s) of shortfall needs 20 gold left after the 10 gold train cost.
    const realm: Realm = {
      ...camp(),
      idle: 1,
      soldiers: 2,
      jobs: { farmer: 4, woodcutter: 0, miner: 0, builder: 1 },
      stores: { food: 80, wood: 0, iron: 50, gold: 29, weapons: 0 },
    };
    expect(decide(realm, rng()).soldiers).toBe(2);
    const stocked = { ...realm, stores: { ...realm.stores, gold: 30 } };
    expect(decide(stocked, rng()).soldiers).toBe(3);
  });

  it('trains no soldier the food cannot feed', () => {
    // 2 farmers exactly feed 6 civilians; a soldier would eat 0.5/s more than they did.
    const realm: Realm = {
      ...camp(),
      jobs: { farmer: 2, woodcutter: 0, miner: 0, builder: 1 },
      stores: { food: 80, wood: 0, iron: 50, gold: 1000, weapons: 0 },
    };
    expect(decide(realm, rng()).soldiers).toBe(0);
  });

  it('trains at most its yearly quota', () => {
    const realm: Realm = {
      ...camp(),
      jobs: { farmer: 8, woodcutter: 0, miner: 0, builder: 1 },
      stores: { food: 80, wood: 0, iron: 50, gold: 140, weapons: 0 },
    };
    expect(decide(realm, rng()).soldiers).toBe(STRATEGY.trainPerYear);
  });
  describe('Forges and levels', () => {
    /** A rich realm with nobody idle, so decide() trains no soldiers of its own. */
    const rich = (soldiers: number, buildings: Partial<Realm['buildings']>): Realm => {
      const realm = createRealm(1);
      return {
        ...realm,
        idle: 0,
        soldiers,
        storehouse: 3,
        buildings: { ...realm.buildings, barracks: 1, ...buildings },
        stores: { food: 5000, wood: 6000, iron: 1200, gold: 4000, weapons: 0 },
      };
    };
    const queued = (realm: Realm) => decide(realm, rng()).queue.map((o) => o.building);

    it('orders one Forge per 10 soldiers, once there are 10', () => {
      expect(queued(rich(9, {}))).not.toContain('forge');
      expect(queued(rich(10, {}))).toContain('forge');
      expect(queued(rich(25, { forge: 2 }))).toContain('forge');
      expect(queued(rich(20, { forge: 2 }))).not.toContain('forge');
    });

    it('orders the next Forges level only once every soldier is armed', () => {
      const armed = (weapons: number) => {
        const realm = rich(5, { forge: 1 });
        return { ...realm, stores: { ...realm.stores, weapons } };
      };
      expect(queued(armed(4.9))).not.toContain('forgeLevel');
      expect(queued(armed(5))).toContain('forgeLevel');
    });

    it('orders no Forges level without a Forge', () => {
      expect(queued(rich(0, {}))).not.toContain('forgeLevel');
    });

    it(`orders the next Huts or Markets level once ${STRATEGY.upgradeAfter} stand`, () => {
      const few = STRATEGY.upgradeAfter - 1;
      expect(queued(rich(0, { hut: few, market: few }))).not.toContain('hutLevel');
      expect(queued(rich(0, { hut: few, market: few }))).not.toContain('marketLevel');
      const many = queued(rich(0, { hut: STRATEGY.upgradeAfter, market: STRATEGY.upgradeAfter }));
      expect(many).toEqual(expect.arrayContaining(['hutLevel', 'marketLevel']));
    });

    it('never queues two orders of one level kind', () => {
      const realm = rich(0, { hut: STRATEGY.upgradeAfter });
      const kinds = decide(decide(realm, rng()), rng()).queue.map((o) => o.building);
      expect(kinds.filter((k) => k === 'hutLevel')).toHaveLength(1);
    });
  });
});

describe('formatTable', () => {
  it('prints a header and one aligned line per row', () => {
    const lines = formatTable(simulate(12, 1)).split('\n');
    expect(lines).toHaveLength(13);
    expect(lines[0]!.trim().split(/\s+/)).toEqual([
      'Year',
      'Food',
      'Wood',
      'Iron',
      'Gold',
      'Weapons',
      'Pop',
      'Army',
      'Power',
      'Conquests',
    ]);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(lines[12]!.trim().startsWith('12 ')).toBe(true);
  });

  it('prints the conquests count in the last column', () => {
    const row = { ...simulate(1, 1)[0]!, conquests: 3 };
    const [, line] = formatTable([row]).split('\n');
    expect(line!.trim().split(/\s+/).at(-1)).toBe('3');
  });

  it('prints only the header for no rows', () => {
    expect(formatTable([]).split('\n')).toHaveLength(1);
  });
});

describe('parseArgs', () => {
  it('defaults to 100 years on seed 1', () => {
    expect(parseArgs([])).toEqual({ years: 100, seed: 1 });
  });

  it('reads --years and --seed in any order', () => {
    expect(parseArgs(['--seed', '42', '--years', '250'])).toEqual({ years: 250, seed: 42 });
    expect(parseArgs(['--years', String(SIM_LIMITS.maxYears)])).toEqual({
      years: SIM_LIMITS.maxYears,
      seed: 1,
    });
    expect(parseArgs(['--seed', '0', '--years', '1'])).toEqual({ years: 1, seed: 0 });
    expect(parseArgs(['--seed', '4294967295'])).toEqual({ years: 100, seed: 4294967295 });
  });

  it.each([
    [['--years']],
    [['--years', '']],
    [['--years', '0']],
    [['--years', '10001']],
    [['--years', '-5']],
    [['--years', '1.5']],
    [['--years', '1e3']],
    [['--years', '0x10']],
    [['--years', ' 10']],
    [['--years', '10\n']],
    [['--years', 'Infinity']],
    [['--years', 'NaN']],
    [['--years', '10\u200b']], // zero-width space
    [['--years', '\u202e01']], // bidi override
    [['--years', '１０']], // fullwidth digits
    [['--years', '٣']], // Arabic-Indic digit
    [['--years', '9'.repeat(100_000)]], // oversized
    [['--seed', '4294967296']],
    [['--seed', '-1']],
    [['--years=10']],
    [['--years', '3', '--years', '4']], // repeated flag
    [['--seed', '1', '--years', '3', '--seed', '2']],
    [['10']],
    [['--__proto__', '1']],
    [['--constructor', '1']],
  ])('rejects %j', (args) => {
    expect(parseArgs(args)).toHaveProperty('error');
  });
});
