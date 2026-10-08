import { describe, expect, it } from 'vitest';
import { MAX_CATCHUP, STEP, advance, parseSpeed } from './loop.ts';
import { createRealm, tick } from './realm.ts';

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
