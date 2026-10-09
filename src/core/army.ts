import { WALL_BONUS } from './buildings.ts';
import { type Cost, type Realm, type Resource } from './model.ts';
import { wholeCount } from './people.ts';
import { canAfford, pay, storeCaps } from './stores.ts';
import { traitModifiers } from './traits.ts';

/** Weapon making per Forge, and what a weapon adds (docs/design.md §5, §6). */
export const FORGE = {
  /** Seconds per weapon, per Forge. */
  every: 5,
  /** Iron used per weapon. */
  iron: 2,
  /** An armed soldier fights at × (1 + this × Forges level). */
  armedBonus: 0.5,
} as const;

/** Soldiers carrying a weapon: one per whole weapon in store, up to the soldiers (§6). */
export function armedSoldiers(realm: Realm): number {
  return Math.min(realm.soldiers, Math.floor(realm.stores.weapons));
}

/** The power multiplier of an armed soldier at the Forges level (§6). */
export function weaponBonus(realm: Realm): number {
  return 1 + FORGE.armedBonus * realm.buildings.forgeLevel;
}

/**
 * Weapons the Forges make in `dt` seconds (§5): each makes one per FORGE.every
 * seconds from FORGE.iron iron, while there is iron and room under the cap.
 */
export function forged(realm: Realm, stores: Record<Resource, number>, dt: number): number {
  const room = storeCaps(realm).weapons - stores.weapons;
  const made = (realm.buildings.forge * dt) / FORGE.every;
  return Math.max(0, Math.min(made, stores.iron / FORGE.iron, room));
}

/** Weapons lost with `lost` of the realm's soldiers: their share of the armed ones (§6). */
export function weaponsLost(realm: Realm, lost: number): number {
  if (realm.soldiers === 0) return 0;
  return Math.min(realm.stores.weapons, Math.round((lost * armedSoldiers(realm)) / realm.soldiers));
}

/** Spearmen, the one Phase 1 unit (docs/design.md §6): 1 peasant + this cost each. */
export const SOLDIER: { readonly cost: Cost; readonly power: number } = {
  cost: { iron: 5, gold: 10 },
  power: 2,
};

/**
 * Field army power (§6): base power of every soldier, × weaponBonus() for each
 * armed one, × slotted trait modifiers (spearmen and army bonuses add up).
 */
export function armyPower(realm: Realm): number {
  const m = traitModifiers(realm);
  const armed = armedSoldiers(realm);
  const soldiers = realm.soldiers - armed + armed * weaponBonus(realm);
  return soldiers * SOLDIER.power * (1 + m.spearmen + m.army);
}

/** What a raid on the capital must beat (§7): field army power × (1 + 0.2 × Wall level). */
export function capitalDefence(realm: Realm): number {
  return armyPower(realm) * (1 + WALL_BONUS * realm.buildings.wall);
}

/**
 * Trains up to `count` soldiers, each taking one idle peasant and paying
 * SOLDIER.cost; stops at the first one the idle pool or stores can't cover.
 * Nothing is trained until a Barracks is finished (§6).
 */
export function train(realm: Realm, count = 1): Realm {
  if (realm.buildings.barracks === 0) return realm;
  let next = realm;
  for (let i = wholeCount(count); i > 0 && next.idle > 0 && canAfford(next, SOLDIER.cost); i--) {
    next = { ...pay(next, SOLDIER.cost), idle: next.idle - 1, soldiers: next.soldiers + 1 };
  }
  return next;
}

/** Sends up to `count` soldiers back to idle; the training cost is not refunded (§6). */
export function disband(realm: Realm, count = 1): Realm {
  const n = Math.min(wholeCount(count), realm.soldiers);
  if (n === 0) return realm;
  return { ...realm, idle: realm.idle + n, soldiers: realm.soldiers - n };
}
