import { describe, expect, it } from 'vitest';
import {
  RESOURCES,
  createRealm,
  housingCap,
  population,
  rates,
  STOREHOUSE,
  type Realm,
} from './realm.ts';
import { createRng } from './rng.ts';
import {
  SIM_LIMITS,
  STRATEGY,
  conquests,
  decide,
  formatTable,
  parseArgs,
  simulate,
} from './sim.ts';

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
      jobs: { farmer: 0, woodcutter: 0, miner: 0 },
    };
    const next = decide(realm, rng());
    expect(next.idle).toBe(0);
    expect(rates(next).food).toBeGreaterThanOrEqual(STRATEGY.foodMargin);
  });

  it('builds a hut when housing is full and wood allows', () => {
    const base = createRealm(1);
    const realm: Realm = {
      ...base,
      idle: housingCap(base) - population(base) + base.idle,
      stores: { ...base.stores, wood: 100, gold: 0 },
    };
    expect(decide(realm, rng()).buildings.hut).toBe(1);
  });

  it('raises the Storehouse when a store is nearly full', () => {
    const base = createRealm(1);
    const realm: Realm = {
      ...base,
      stores: { ...STOREHOUSE[0]!.caps }, // every store at its level-0 cap
    };
    expect(decide(realm, rng()).storehouse).toBe(1);
  });

  it('trains on thin income only while the gold stockpile covers the shortfall', () => {
    // 2 workers pay 0.5 gold/s; with a second soldier, upkeep makes that −0.5/s,
    // so 10 years (80 s) of shortfall needs 40 gold in hand. Food stays level.
    const realm: Realm = {
      ...createRealm(1),
      idle: 1,
      soldiers: 1,
      jobs: { farmer: 2, woodcutter: 0, miner: 0 },
      stores: { food: 80, wood: 0, iron: 50, gold: 39 },
    };
    expect(decide(realm, rng()).soldiers).toBe(1);
    const stocked = { ...realm, stores: { ...realm.stores, gold: 60 } };
    expect(decide(stocked, rng()).soldiers).toBe(2);
  });

  it('trains no soldier the food cannot feed', () => {
    // 2 farmers exactly feed 6 civilians; a soldier would eat 0.5/s more than they did.
    const realm: Realm = {
      ...createRealm(1),
      jobs: { farmer: 2, woodcutter: 0, miner: 0 },
      stores: { food: 80, wood: 0, iron: 50, gold: 1000 },
    };
    expect(decide(realm, rng()).soldiers).toBe(0);
  });

  it('trains at most its yearly quota', () => {
    const realm: Realm = {
      ...createRealm(1),
      jobs: { farmer: 8, woodcutter: 0, miner: 0 },
      stores: { food: 80, wood: 0, iron: 50, gold: 140 },
    };
    expect(decide(realm, rng()).soldiers).toBe(STRATEGY.trainPerYear);
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
