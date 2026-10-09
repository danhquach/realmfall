import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealm } from '../core/realm.ts';
import { serialize } from '../core/save.ts';
import { loadRealm, saveRealm } from './autosave.ts';

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

describe('loadRealm and saveRealm', () => {
  it('loads what was saved', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const realm = createRealm(99);
    saveRealm(realm);
    expect(loadRealm()).toEqual(realm);
  });

  it('loads nothing when there is no save', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(loadRealm()).toBeNull();
  });

  it('loads nothing from a corrupt save', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('realmfall.save', serialize(createRealm(1)).replace('"year":1', '"year":-1'));
    expect(loadRealm()).toBeNull();
  });

  it('plays on when storage is blocked or full', () => {
    vi.stubGlobal('localStorage', throwing());
    expect(loadRealm()).toBeNull();
    expect(() => saveRealm(createRealm(1))).not.toThrow();
  });
});
