import { describe, expect, it } from 'vitest';
import { AWAY_SUMMARY_MIN, MAX_CATCHUP, STEP, advance, catchUp, parseSpeed, play } from './loop.ts';
import {
  CHALLENGE_INFO,
  CHRONICLE_MAX,
  RESOURCES,
  awaySummary,
  challengeText,
  createRealm,
  order,
  storeCaps,
  tick,
  train,
  type ChronicleEntry,
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
  const stores = { food: 50, wood: 190, iron: 20, gold: 100, weapons: 0 };
  const rivals = realm.rivals.map((r, i) => ({ ...r, hostile: i === 0 }));
  const buildings = { ...realm.buildings, barracks: 1 };
  return train({ ...realm, jobs, idle: 1, stores, rivals, buildings }, 1);
}

/** `n` ticks of live play. */
function live(realm: Realm, seconds: number): Realm {
  for (let i = 0; i < seconds / STEP; i++) realm = tick(realm, STEP);
  return realm;
}

describe('catchUp', () => {
  it('replays an absence under a minute exactly as live play, raids and events included', () => {
    // From year 11 (80 s), past the raid grace period with a Barracks (§7),
    // 59.75 s crosses the raids at 90 s and 135 s and the events at 100 s and 125 s.
    const start = { ...busy(77), time: 80, year: 11 };
    const live60 = live(start, AWAY_SUMMARY_MIN - STEP);
    expect(live60.chronicle.some((c) => c.kind === 'raids')).toBe(true);
    expect(live60.chronicle.filter((c) => c.kind !== 'raids').length).toBeGreaterThan(0);
    expect(catchUp(start, AWAY_SUMMARY_MIN - STEP)).toEqual(live60);
  });

  it('keeps store caps and hunger while away', () => {
    const start = busy(77);
    const since = { since: start.time, traderYear: start.traderYear };
    let away = start;
    let atWoodCap = 0;
    let starving = 0;
    for (let i = 0; i < 3600 / STEP; i++) {
      away = tick(away, STEP, since);
      const caps = storeCaps(away);
      for (const k of RESOURCES) expect(away.stores[k]).toBeLessThanOrEqual(caps[k]);
      if (away.stores.wood === caps.wood) atWoodCap++;
      if (away.hunger > 0) starving++;
    }
    // The run really pressed on the cap and on hunger.
    expect(atWoodCap).toBeGreaterThan(0);
    expect(starving).toBeGreaterThan(0);
    expect(catchUp(start, 3600)).toEqual(awaySummary(away, start, 3600));
  });

  it('matches live play for the economy, construction and training', () => {
    // Fed and with no rivals, so live play has no raids, hunger or Change of
    // heart. Spare idle peasants take any Plague, so
    // jobs and soldiers match; no event touches wood.
    const realm = createRealm(77);
    const jobs = { farmer: 8, woodcutter: 4, miner: 0, builder: 1 };
    const stores = { ...realm.stores, wood: 100 };
    const base = {
      ...realm,
      jobs,
      idle: 3,
      stores,
      rivals: [],
      buildings: { ...realm.buildings, barracks: 1 },
    };
    const start = order(order(train(base, 1), 'hut'), 'storehouse');
    expect(start.queue).toHaveLength(2);
    const online = live(start, 3600);
    const offline = catchUp(start, 3600);
    const economy = (r: Realm) => ({
      time: r.time,
      year: r.year,
      wood: r.stores.wood,
      jobs: r.jobs,
      soldiers: r.soldiers,
      buildings: r.buildings,
      storehouse: r.storehouse,
      queue: r.queue,
    });
    expect(offline.buildings.hut).toBe(1);
    expect(offline.storehouse).toBe(1);
    expect(offline.soldiers).toBe(1);
    expect(economy(offline)).toEqual(economy(online));
    expect(offline.chronicle.at(-1)).toMatchObject({ kind: 'away', year: online.year });
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
    const online = live(start, 120);
    const away = catchUp(start, 120);
    expect(away.queue).toEqual(online.queue);
    expect(away.buildings).toEqual(online.buildings);
    expect(away.storehouse).toBe(online.storehouse);
    expect(away.buildings.hut).toBe(1);
    expect(away.storehouse).toBe(1);
    expect(away.queue).toEqual([]);
    const partway = catchUp(start, 30);
    expect(partway.queue).toEqual([{ ...start.queue[1]!, done: 10 }]);
  });

  it('keeps the Chronicle at its cap', () => {
    const full = Array.from({ length: CHRONICLE_MAX }, (_, i) => line(i));
    const away = catchUp({ ...busy(9), chronicle: full }, MAX_CATCHUP);
    expect(away.chronicle).toHaveLength(CHRONICLE_MAX);
    expect(away.chronicle.at(-1)!.kind).toBe('away');
  });
});

/** An old Chronicle line. */
function line(i: number): ChronicleEntry {
  return { year: 1, kind: 'battles', text: `Old line ${i}.` };
}

/**
 * busy() with a Market and every rival hostile, so live play would raid, roll
 * every kind of event, offer challenges and restock the trader.
 */
function contested(seed: number): Realm {
  const realm = busy(seed);
  const rivals = realm.rivals.map((r) => ({ ...r, hostile: true }));
  return { ...realm, rivals, buildings: { ...realm.buildings, market: 1 } };
}

/** The Chronicle lines `after` added to `before`. */
function added(before: Realm, after: Realm): ChronicleEntry[] {
  const old = new Set(before.chronicle);
  return after.chronicle.filter((c) => !old.has(c));
}

describe('time away (§10)', () => {
  it('8 h away: no raids, Plague, Change of heart or challenges; at most 8 good events and 1 restock', () => {
    const start = contested(5);
    // Live play over the same hour would raid, roll bad events and offer a challenge.
    const hour = added(start, live(start, 3600));
    expect(hour.some((c) => c.kind === 'raids')).toBe(true);
    expect(hour.some((c) => /^(Plague|Change of heart)/.test(c.text))).toBe(true);
    expect(hour.some((c) => c.text.startsWith('Challenge:'))).toBe(true);

    const away = catchUp(start, MAX_CATCHUP);
    const lines = added(start, away);
    expect(lines.filter((c) => c.kind === 'raids')).toEqual([]);
    expect(lines.filter((c) => c.kind === 'rivals')).toEqual([]);
    expect(lines.filter((c) => c.text.startsWith('Plague'))).toEqual([]);
    expect(lines.filter((c) => c.text.startsWith('Challenge'))).toEqual([]);
    expect(away.challenge).toBeNull();
    expect(away.raidsRepelled).toBe(start.raidsRepelled);
    expect(away.rivals.map((r) => r.hostile)).toEqual(start.rivals.map((r) => r.hostile));
    const events = lines.filter((c) => c.kind === 'events');
    expect(events).toHaveLength(8);
    for (const e of events)
      expect(e.text).toMatch(/^(Bountiful harvest|Envoy's gifts|Rich vein): /);
    expect(lines.filter((c) => c.text.startsWith('The trader offers'))).toHaveLength(1);
    expect(away.chronicle.at(-1)!.text).toMatch(/; 8 events, 1 trader restock; at peace\.$/);
  });

  it('has no good event in under an hour away, then one per hour', () => {
    const start = contested(6);
    const events = (seconds: number) =>
      added(start, catchUp(start, seconds)).filter((c) => c.kind === 'events').length;
    expect(events(3599)).toBe(0);
    expect(events(3600)).toBe(1);
    expect(events(2 * 3600 - 1)).toBe(1);
    expect(events(2 * 3600)).toBe(2);
  });

  it('pauses an active challenge: same years left, neither met nor failed', () => {
    const start = { ...contested(7), challenge: { kind: 'raid' as const, deadline: 3 } };
    expect(start.year).toBe(1);
    const away = catchUp(start, MAX_CATCHUP);
    expect(away.challenge).toEqual({ kind: 'raid', deadline: away.year + 2 });
    expect(challengeText(away)).toContain('2 years left');
    // The player is back: the deadline runs again, and the next raid ends it.
    expect(parse(serialize(away))).toEqual(away);
    const back = live(away, 2 * 45);
    expect(back.challenge).toBeNull();
  });

  it('pauses a challenge already due when the player left, and the save still loads it', () => {
    const start = { ...contested(19), challenge: { kind: 'raid' as const, deadline: 1 } };
    const away = catchUp(start, MAX_CATCHUP);
    expect(away.challenge).toEqual({ kind: 'raid', deadline: away.year });
    expect(parse(serialize(away))).toEqual(away);
  });

  it('leaves a food challenge met while away for the player to collect', () => {
    const realm = createRealm(8);
    const base = { ...realm, storehouse: 3, jobs: { ...realm.jobs, farmer: 10 } };
    const start = {
      ...base,
      challenge: { kind: 'food' as const, deadline: 1 + CHALLENGE_INFO.food.years },
    };
    const away = catchUp(start, 3600);
    expect(away.stores.food).toBeGreaterThanOrEqual(500);
    expect(away.challenge).toEqual({ ...start.challenge, deadline: away.year + 3 });
    const back = tick(away, STEP);
    expect(back.challenge).toBeNull();
    expect(back.chronicle.some((c) => c.text.startsWith('Challenge met'))).toBe(true);
  });

  it('offers no new challenge while away; one comes once the player is back', () => {
    const start = contested(9);
    const away = catchUp(start, 3600);
    expect(away.year).toBeGreaterThan(start.challengeYear);
    expect(away.challenge).toBeNull();
    expect(tick(away, STEP).challenge).not.toBeNull();
  });

  it('restocks a trader that had already opened at most once', () => {
    const start = { ...contested(10), traderYear: 1, trader: [] };
    const away = catchUp(start, MAX_CATCHUP);
    expect(added(start, away).filter((c) => c.text.startsWith('The trader offers'))).toHaveLength(
      1,
    );
    expect(away.trader).toHaveLength(3);
  });

  it('keeps the history from before the absence', () => {
    const history = Array.from({ length: 150 }, (_, i) => line(i));
    const start = { ...contested(11), chronicle: history };
    const away = catchUp(start, MAX_CATCHUP);
    expect(away.chronicle.slice(0, history.length)).toEqual(history);
  });

  it('still pays out milestones while away', () => {
    const start = { ...contested(16), raidsRepelled: 5 };
    const away = catchUp(start, 3600);
    expect(away.milestones).toContain('raids');
    expect(away.offers.some((o) => o.source === 'milestone')).toBe(true);
  });

  it('keeps Warrior creed halting growth while every rival stays at peace', () => {
    const realm = createRealm(17);
    const rivals = realm.rivals.map((r) => ({ ...r, hostile: false }));
    const start = {
      ...realm,
      rivals,
      traits: { warriorCreed: { level: 1, duplicates: 0 } },
      slots: ['warriorCreed' as const, null, null],
    };
    const away = catchUp(start, MAX_CATCHUP);
    expect(away.idle).toBe(start.idle);
    // Without the creed the same realm grows.
    expect(catchUp({ ...start, slots: [null, null, null] }, 3600).idle).toBeGreaterThan(start.idle);
    expect(away.rivals.every((r) => !r.hostile)).toBe(true);
  });

  it('pauses a challenge through its deadline year while the trader restocks once', () => {
    const start = {
      ...contested(18),
      traderYear: 1,
      trader: [],
      challenge: { kind: 'raid' as const, deadline: 2 },
    };
    const away = catchUp(start, MAX_CATCHUP);
    expect(away.challenge).toEqual({ kind: 'raid', deadline: away.year + 1 });
    const lines = added(start, away);
    expect(lines.filter((c) => c.text.startsWith('The trader offers'))).toHaveLength(1);
    expect(lines.filter((c) => c.text.startsWith('Challenge'))).toEqual([]);
  });

  it('gives the same result for the same seed', () => {
    expect(catchUp(contested(12), MAX_CATCHUP)).toEqual(catchUp(contested(12), MAX_CATCHUP));
  });
});

describe('play', () => {
  it('runs a short frame gap as live play, carrying the remainder', () => {
    const start = busy(13);
    expect(play(start, 0.1, 30)).toEqual(advance(start, 30.1));
    expect(play(start, 0, AWAY_SUMMARY_MIN - STEP)).toEqual(
      advance(start, AWAY_SUMMARY_MIN - STEP),
    );
  });

  it('times the gap in real seconds, so a short stall at a dev speed is live play', () => {
    // 5 real seconds at 20× is 100 game seconds, raids and events included.
    const start = busy(13);
    const { realm } = play(start, 0, 5, 20);
    expect(realm).toEqual(advance(start, 100).realm);
    expect(realm.chronicle.some((c) => c.kind === 'raids')).toBe(true);
  });

  it('replays a background tab coming back as time away, like offline catch-up', () => {
    const start = contested(14);
    const { realm, pending } = play(start, 0.1, 3600);
    expect(pending).toBeCloseTo(0.1);
    expect(realm).toEqual(catchUp(start, 3600));
    expect(added(start, realm).filter((c) => c.kind === 'raids')).toEqual([]);
    expect(realm.chronicle.at(-1)!.kind).toBe('away');
    // At a dev speed the minute is still real time, and the replay is scaled.
    expect(play(start, 0, 60, 20).realm).toEqual(catchUp(start, 1200));
  });

  it.each([NaN, -60, Infinity, -Infinity])('replays nothing for a %s second gap', (real) => {
    const start = busy(15);
    expect(play(start, 0, real)).toEqual({ realm: start, pending: 0 });
    expect(play(start, NaN, real)).toEqual({ realm: start, pending: 0 });
  });

  it('caps a huge gap at MAX_CATCHUP', () => {
    const start = busy(15);
    const { realm, pending } = play(start, 0, Number.MAX_VALUE);
    expect(realm.time).toBe(MAX_CATCHUP);
    expect(Number.isFinite(pending) && pending >= 0).toBe(true);
    expect(play(start, NaN, 100).pending).toBe(0);
  });
});

describe('awaySummary', () => {
  it('sums up time, stores, people and soldiers', () => {
    const before = busy(1);
    const after = {
      ...before,
      stores: { food: 0, wood: 250.6, iron: 15.4, gold: 145, weapons: 0 },
      idle: before.idle + 2,
      soldiers: 0,
    };
    expect(awaySummary(after, before, 2 * 3600 + 5 * 60 + 59).chronicle.at(-1)!.text).toBe(
      'Away 2h 5m: food -50, wood +61, iron +0, gold +55, weapons +0; people 10 to 11; soldiers 1 to 0; ' +
        '0 events, 0 trader restocks; at peace.',
    );
  });

  it('stays short, ASCII and loadable however big the numbers', () => {
    const before = createRealm(1);
    const huge = SAVE_LIMITS.amount;
    const after = {
      ...before,
      stores: { food: huge, wood: huge, iron: huge, gold: huge, weapons: 0 },
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

  it('stays short with every store lost and a full Chronicle of events', () => {
    const huge = SAVE_LIMITS.amount;
    const before = {
      ...createRealm(1),
      stores: { food: huge, wood: huge, iron: huge, gold: huge, weapons: 0 },
      idle: SAVE_LIMITS.count,
      soldiers: SAVE_LIMITS.count,
    };
    const events = Array.from({ length: CHRONICLE_MAX - 1 }, (_, i) => ({
      year: 1,
      kind: 'events' as const,
      text: `The trader offers ${i}.`,
    }));
    const after = {
      ...createRealm(1),
      idle: 0,
      soldiers: 0,
      traderYear: 1,
      chronicle: events,
      stores: { food: 0, wood: 0, iron: 0, gold: 0, weapons: 0 },
    };
    const realm = awaySummary(after, before, MAX_CATCHUP);
    const { text } = realm.chronicle.at(-1)!;
    expect(text).toContain(`${CHRONICLE_MAX - 1} events, 1 trader restock`);
    expect(text.length).toBeLessThanOrEqual(SAVE_LIMITS.textChars);
    expect(text).toMatch(/^[\x20-\x7e]+$/);
    expect(parse(serialize(realm))).toEqual(realm);
  });

  it('round-trips through the save after a real catch-up', () => {
    const realm = catchUp(busy(2), MAX_CATCHUP);
    expect(parse(serialize(realm, 0))).toEqual(realm);
  });
});
