import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TAB, TABS, loadTab, parseTab, saveTab } from './tabPref.ts';

/** A stand-in localStorage over a Map. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  } as Storage;
}

function throwing(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail } as unknown as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTab', () => {
  it('accepts every tab exactly as written', () => {
    for (const tab of TABS) expect(parseTab(tab)).toBe(tab);
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['another case', 'Army'],
    ['padding', ' army'],
    ['a trailing newline', 'army\n'],
    ['a JSON string', '"army"'],
    ['a prototype key', '__proto__'],
    ['an inherited name', 'constructor'],
    ['an Object method', 'toString'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['a bidi override', '‮army'],
    ['a zero-width space', 'ar​my'],
    ['a look-alike letter', 'аrmy'],
    ['an oversized value', 'army'.repeat(1_000_000)],
    ['a number', 1],
    ['an object', { toString: () => 'army' }],
    ['an array', ['army']],
  ])('falls back to the default tab for %s', (_, value) => {
    expect(parseTab(value)).toBe(DEFAULT_TAB);
  });
});

describe('loadTab and saveTab', () => {
  it('restores the tab saved last', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    saveTab('rivals');
    expect(loadTab()).toBe('rivals');
  });

  it('opens on the default tab when nothing is stored', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadTab()).toBe(DEFAULT_TAB);
  });

  it('opens on the default tab when the stored value is bad', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    for (const bad of ['__proto__', '<img src=x onerror=alert(1)>', '‮army']) {
      storage.setItem('realmfall.tab', bad);
      expect(loadTab()).toBe(DEFAULT_TAB);
    }
  });

  it('plays on when storage is blocked', () => {
    vi.stubGlobal('localStorage', throwing());
    expect(loadTab()).toBe(DEFAULT_TAB);
    expect(() => saveTab('army')).not.toThrow();
  });
});
