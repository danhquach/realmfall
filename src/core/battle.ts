/** Battles against rivals and raids on the capital (docs/design.md §7). */
import { chance, createRng, pick, type Rng } from './rng.ts';
import { armyPower, capitalDefence, weaponsLost } from './army.ts';
import { chronicle, fell } from './chronicle.ts';
import { endChallenge } from './goals.ts';
import { type Realm } from './model.ts';
import { ringRival, RIVAL, updateRival, withPower } from './rivals.ts';
import { addStore, safeAmounts } from './stores.ts';
import { gainTrait } from './traits.ts';

/** Battle and annexation numbers (docs/design.md §7). */
export const BATTLE = {
  winLossBase: 0.1,
  winLossRisk: 0.3,
  defeatLoss: 0.5,
  defeatRivalGrowth: 0.1,
  annexHousing: 10,
  annexPeoplePer: 8,
} as const;

/**
 * Win chance P² / (P² + E²) (§7), written as 1 / (1 + (E/P)²) so huge powers
 * don't overflow. No army never wins; a powerless defender always loses.
 */
export function winChance(p: number, e: number): number {
  if (!(p > 0)) return 0;
  if (!(e > 0)) return 1;
  return 1 / (1 + (e / p) ** 2);
}

/**
 * Sends the field army against rival `index`, rolling the win chance on `rng` (§7).
 * Win: lose ⌈soldiers × (0.1 + 0.3 × (1 − chance))⌉ soldiers and annex the
 * rival: +10 housing, +⌊E / 8⌋ idle people, +E gold (up to the cap) and its
 * trait; a new rival appears on the next ring out (ringRival).
 * Loss: lose ⌈50%⌉ of soldiers; the rival gains +10% power, up to its
 * ceiling, and turns hostile.
 * Nothing changes if there is no such rival or no soldiers.
 */
export function attack(realm: Realm, index: number, rng: Rng): Realm {
  const rival = realm.rivals[index];
  if (!rival || realm.soldiers === 0) return realm;
  const odds = winChance(armyPower(realm), rival.power);
  if (!chance(rng, odds)) {
    const lost = Math.ceil(realm.soldiers * BATTLE.defeatLoss);
    const next = updateRival(withLosses(realm, lost), index, (r) => ({
      ...withPower(r, r.power * (1 + BATTLE.defeatRivalGrowth)),
      hostile: true,
    }));
    return chronicle(next, 'battles', `Lost a battle against ${rival.name}: ${fell(lost)}.`);
  }
  const share = BATTLE.winLossBase + BATTLE.winLossRisk * (1 - odds);
  // The epsilon keeps float noise from rounding an exact whole loss up by one.
  const lost = Math.min(realm.soldiers, Math.ceil(realm.soldiers * share - 1e-9));
  const rest = realm.rivals.filter((_, i) => i !== index);
  const taken = new Set([rival.name, ...rest.map((r) => r.name)]);
  const ring = Math.min(rival.ring + 1, RIVAL.maxRing);
  const fresh = ringRival(rng, ring, taken);
  const after = withLosses(realm, lost);
  const annexed: Realm = {
    ...after,
    battlesWon: realm.battlesWon + 1,
    idle: realm.idle + Math.floor(rival.power / BATTLE.annexPeoplePer),
    annexedHousing: realm.annexedHousing + BATTLE.annexHousing,
    stores: { ...after.stores, gold: addStore(after, 'gold', rival.power) },
    rivals: [...rest, fresh],
  };
  const won = chronicle(
    annexed,
    'battles',
    `Conquered ${rival.name}: ${fell(lost)}; ${fresh.name} appears beyond it.`,
  );
  return gainTrait(won, rival.trait);
}

/** The realm after losing `lost` soldiers in battle, with their weapons (§6). */
function withLosses(realm: Realm, lost: number): Realm {
  const weapons = realm.stores.weapons - weaponsLost(realm, lost);
  return { ...realm, soldiers: realm.soldiers - lost, stores: { ...realm.stores, weapons } };
}

/** Raid timing, strength range, loss, grace period and early cap (docs/design.md §7). */
export const RAID = {
  every: 45,
  minStrength: 0.4,
  maxStrength: 0.8,
  loss: 0.25,
  /** No raid before this year. */
  graceYear: 10,
  /** From this year raids come with or without a finished Barracks. */
  graceEndYear: 30,
  /** Until the first conquest, strength is at most max(capArmy × field army power, capMin). */
  capArmy: 1.5,
  capMin: 10,
} as const;

/** Rivals annexed so far: each conquest adds exactly BATTLE.annexHousing housing (§7). */
export function conquests(realm: Realm): number {
  return realm.annexedHousing / BATTLE.annexHousing;
}

/**
 * Whether raids can come yet (§7): never before year 10; from year 10 once a
 * Barracks is finished (one still in the queue doesn't count); from year 30
 * regardless, so skipping the Barracks doesn't buy peace.
 */
export function raidGraceOver(realm: Realm): boolean {
  if (realm.year < RAID.graceYear) return false;
  return realm.year >= RAID.graceEndYear || realm.buildings.barracks > 0;
}

/**
 * The most a raid can strike with (§7): max(1.5 × field army power, 10) until
 * the first conquest, then no cap. An empty army still loses to a capped raid.
 */
export function raidCap(realm: Realm): number {
  if (conquests(realm) > 0) return Infinity;
  return Math.max(RAID.capArmy * armyPower(realm), RAID.capMin);
}

/** The stores a raid on the capital takes from (§7). */
const RAIDED = ['food', 'wood'] as const;

/**
 * The rng for raid number `n` (the one at n × 45 s), from its own stream
 * derived from the run's seed, so offline catch-up replays the same raids.
 */
export function raidRng(seed: number, n: number): Rng {
  return createRng((seed ^ 0x52414944 ^ Math.imul(n, 0x9e3779b9)) >>> 0);
}

/**
 * One raid on the capital (§7): a random hostile rival attacks with strength
 * E × (0.4–0.8), capped by raidCap(). If capitalDefence() ≥ strength it is
 * repelled; otherwise the realm loses 25% of the food and wood above the
 * Storehouse's safe amount. Nothing happens during the grace period
 * (raidGraceOver) or while no rival is hostile.
 */
export function raid(realm: Realm, rng: Rng): Realm {
  const hostile = realm.rivals.filter((r) => r.hostile);
  if (hostile.length === 0 || !raidGraceOver(realm)) return realm;
  const rival = pick(rng, hostile);
  const rolled = rival.power * (RAID.minStrength + (RAID.maxStrength - RAID.minStrength) * rng());
  const strength = Math.min(rolled, raidCap(realm));
  // "Repel the next raid" (§9) ends with this raid, met or failed.
  const end = (next: Realm, met: boolean) =>
    realm.challenge?.kind === 'raid' ? endChallenge(next, met) : next;
  if (capitalDefence(realm) >= strength) {
    const next = { ...realm, raidsRepelled: realm.raidsRepelled + 1 };
    return end(chronicle(next, 'raids', `Repelled a raid from ${rival.name}.`), true);
  }
  const safe = safeAmounts(realm);
  const stores = { ...realm.stores };
  for (const k of RAIDED) stores[k] -= Math.max(0, stores[k] - safe[k]) * RAID.loss;
  const lost = RAIDED.map((k) => Math.floor(realm.stores[k] - stores[k]));
  const text = lost.some((n) => n > 0)
    ? `${rival.name} raided the capital: lost ${lost[0]} food and ${lost[1]} wood.`
    : `${rival.name} raided the capital but found nothing to take.`;
  return end(chronicle({ ...realm, stores }, 'raids', text), false);
}
