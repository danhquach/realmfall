import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealm } from '../core/realm.ts';
import { serialize } from '../core/save.ts';
import { loadSave, saveRealm } from './autosave.ts';

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
  vi.useRealTimers();
});

describe('loadSave and saveRealm', () => {
  it('loads what was saved, stamped with when', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const realm = createRealm(99);
    saveRealm(realm);
    expect(loadSave()).toEqual({ realm, savedAt: 1_800_000_000_000 });
  });

  it('loads nothing when there is no save', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadSave()).toBeNull();
  });

  it('loads nothing from a corrupt save', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('realmfall.save', serialize(createRealm(1)).replace('"year":1', '"year":-1'));
    expect(loadSave()).toBeNull();
  });

  it('plays on when storage is blocked or full', () => {
    vi.stubGlobal('localStorage', throwing());
    expect(loadSave()).toBeNull();
    expect(() => saveRealm(createRealm(1))).not.toThrow();
  });
});
