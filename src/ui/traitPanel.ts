import {
  CHALLENGE,
  CHALLENGE_INFO,
  TIER_INFO,
  TRADER,
  TRAIT_INFO,
  TRAIT_RULES,
  TRAITS,
  buyTrait,
  canAfford,
  pickOffer,
  sellDuplicate,
  slotTrait,
  storeCaps,
  swapCost,
  traitLabel,
  traitUpgradeCost,
  upgradeTrait,
  type Realm,
  type Trait,
} from '../core/realm.ts';
import { button, el, panel, setEnabled, setText, traitName } from './dom.ts';
import type { Act } from './realmPanels.ts';

const SLOTS = Array.from({ length: TRAIT_RULES.slots }, (_, i) => i);

/** "1 duplicate" or "n duplicates". */
function duplicates(n: number): string {
  return `${n} ${n === 1 ? 'duplicate' : 'duplicates'}`;
}

/** A list that keeps `list-style: none` from dropping its semantics in Safari. */
function list(className: string): HTMLUListElement {
  const ul = el('ul', className);
  ul.setAttribute('role', 'list');
  return ul;
}

interface OwnedRow {
  li: HTMLLIElement;
  info: HTMLSpanElement;
  slotBtns: HTMLButtonElement[];
  upgradeBtn: HTMLButtonElement;
  sellBtn: HTMLButtonElement;
}

/**
 * Builds the Traits panel (docs/design.md §9) inside `panels` once, and returns
 * the function that refreshes it from a realm: the three slots, owned traits
 * with slot, upgrade and sell actions, open offers, the active challenge and
 * the trader's stock. Every trait name is shown in its tier colour with the
 * tier name beside it. Owned-trait controls are built once, so they keep focus
 * through the per-frame redraw; offer and trader rows are rebuilt only when
 * the offers or stock change.
 */
export function mountTraitPanel(panels: HTMLElement, act: Act): (realm: Realm) => void {
  const section = panel('Traits');
  section.classList.add('traits');
  const heading = section.querySelector('h2')!;
  heading.tabIndex = -1;
  const note = el('p', 'note');

  const slotList = el('ol', 'slots');
  slotList.setAttribute('role', 'list');
  const slotRows = SLOTS.map(() => {
    const li = el('li');
    slotList.append(li);
    return li;
  });

  const none = el(
    'p',
    'note',
    'No traits yet: reach milestones, meet challenges or visit the trader.',
  );
  const ownedList = list('rows owned');
  // Rows for every trait are built up front and hidden until it is owned.
  const ownedRows = new Map<Trait, OwnedRow>();
  for (const trait of TRAITS) {
    const label = traitLabel(trait);
    const info = el('span', 'info');
    const slotBtns = SLOTS.map((i) => {
      const b = button(`Slot ${i + 1}`, () => act((r) => slotTrait(r, i, trait)));
      b.setAttribute('aria-label', `Slot ${i + 1}: ${label}`);
      return b;
    });
    const upgradeBtn = button('', () => act((r) => upgradeTrait(r, trait)));
    const sellText = `Sell (+${TIER_INFO[TRAIT_INFO[trait].tier].sellGold} gold)`;
    const sellBtn = button(sellText, () => act((r) => sellDuplicate(r, trait)));
    sellBtn.setAttribute('aria-label', `${sellText} a duplicate of ${label}`);
    const controls = el('span', 'controls');
    controls.append(...slotBtns, upgradeBtn, sellBtn);
    const li = el('li');
    li.append(traitName(trait), info, controls);
    li.hidden = true;
    ownedList.append(li);
    ownedRows.set(trait, { li, info, slotBtns, upgradeBtn, sellBtn });
  }

  const offersHeading = el('h3', undefined, 'Offers');
  const offerList = list('rows offers');
  const challengeLine = el('p');
  const traderNote = el('p', 'note');
  const traderList = list('rows trader');

  section.append(
    note,
    el('h3', undefined, 'Slots'),
    slotList,
    el('h3', undefined, 'Owned'),
    none,
    ownedList,
    offersHeading,
    offerList,
    el('h3', undefined, 'Challenge'),
    challengeLine,
    el('h3', undefined, 'Trader'),
    traderNote,
    traderList,
  );
  panels.append(section);

  let shownOffers: Realm['offers'] | null = null;
  let shownStock: Realm['trader'] | null = null;
  const buyBtns: { btn: HTMLButtonElement; trait: Trait; price: number }[] = [];

  /**
   * Replaces the children of `list` with `rows`. If a button in it had focus,
   * the button at the same place (or the last one) takes it, so a pick or a
   * purchase doesn't drop keyboard focus to the page.
   */
  const refill = (list: HTMLElement, rows: HTMLElement[]) => {
    const old = [...list.querySelectorAll('button')];
    const at = old.indexOf(document.activeElement as HTMLButtonElement);
    list.replaceChildren(...rows);
    const now = list.querySelectorAll('button');
    if (at < 0) return;
    // With no button left, the panel heading takes focus so the player keeps their place.
    (now[Math.min(at, now.length - 1)] ?? heading).focus();
  };

  const drawOffers = (offers: Realm['offers']) => {
    refill(
      offerList,
      offers.map((offer, i) => {
        const li = el('li');
        li.append(el('span', 'label', `From a ${offer.source}:`));
        const controls = el('span', 'controls');
        offer.choices.forEach((trait, c) => {
          const b = button('', () => act((r) => pickOffer(r, i, c)));
          b.append('Pick ', traitName(trait));
          controls.append(b);
        });
        li.append(controls);
        return li;
      }),
    );
    offersHeading.hidden = offerList.hidden = offers.length === 0;
  };

  const drawStock = (stock: Realm['trader']) => {
    buyBtns.length = 0;
    refill(
      traderList,
      stock.map((item, i) => {
        const btn = button('', () => act((r) => buyTrait(r, i)));
        buyBtns.push({ btn, trait: item.trait, price: item.price });
        const li = el('li');
        li.append(traitName(item.trait), btn);
        return li;
      }),
    );
  };

  return (realm) => {
    const swap = swapCost(realm).gold ?? 0;
    setText(
      note,
      `Only slotted traits take effect. Filling an empty slot is free; swapping costs ` +
        `${swap} gold and rests the slot ${TRAIT_RULES.swapCooldownYears} years.`,
    );

    SLOTS.forEach((i) => {
      const trait = realm.slots[i] ?? null;
      const li = slotRows[i]!;
      const rest =
        realm.year < realm.slotReadyYear[i]! ? ` · swap from year ${realm.slotReadyYear[i]}` : '';
      const level = trait ? ` · level ${realm.traits[trait]?.level ?? 1}` : '';
      const text = `${trait ? traitLabel(trait) : 'Empty'}${level}${rest}`;
      if (li.textContent === text) return;
      li.replaceChildren(...(trait ? [traitName(trait), level + rest] : [`Empty${rest}`]));
    });

    let owns = false;
    for (const [trait, row] of ownedRows) {
      const owned = realm.traits[trait];
      row.li.hidden = !owned;
      if (!owned) continue;
      owns = true;
      const slot = realm.slots.indexOf(trait);
      const where = slot >= 0 ? ` · in slot ${slot + 1}` : '';
      setText(row.info, `Level ${owned.level} · ${duplicates(owned.duplicates)}${where}`);
      row.slotBtns.forEach((b, i) => setEnabled(b, slotTrait(realm, i, trait) !== realm));
      const maxed = owned.level >= TRAIT_RULES.maxLevel;
      const cost = traitUpgradeCost(owned.level);
      setText(row.upgradeBtn, maxed ? 'Max level' : `Upgrade (${duplicates(cost)})`);
      row.upgradeBtn.setAttribute(
        'aria-label',
        maxed
          ? `${traitLabel(trait)} is at max level`
          : `Upgrade ${traitLabel(trait)} (${duplicates(cost)})`,
      );
      setEnabled(row.upgradeBtn, !maxed && owned.duplicates >= cost);
      setEnabled(row.sellBtn, owned.duplicates > 0);
    }
    none.hidden = owns;

    if (realm.offers !== shownOffers) {
      drawOffers(realm.offers);
      shownOffers = realm.offers;
    }

    const c = realm.challenge;
    const goal = c ? CHALLENGE_INFO[c.kind].goal : '';
    setText(
      challengeLine,
      c
        ? `${goal[0]!.toUpperCase()}${goal.slice(1)} by year ${c.deadline}. Failing costs nothing.`
        : realm.year < realm.challengeYear
          ? `None active. The next comes in year ${realm.challengeYear}.`
          : `None active. One comes once you can store ${CHALLENGE.food} food but hold less, or a rival is hostile.`,
    );

    if (realm.buildings.market === 0) setText(traderNote, 'Opens once you have a Market.');
    else setText(traderNote, `Restocks in year ${realm.traderYear + TRADER.every}.`);
    if (realm.trader !== shownStock) {
      drawStock(realm.trader);
      shownStock = realm.trader;
    }
    const cap = storeCaps(realm).gold;
    for (const { btn, trait, price } of buyBtns) {
      // A price above the gold cap can't be paid until the Storehouse grows (§9).
      const over = price > cap ? `${price} gold: over the cap of ${cap}` : '';
      setText(btn, over || `Buy (${price} gold)`);
      const label = `Buy ${traitLabel(trait)} for ${price} gold${over ? `, over the gold cap of ${cap}` : ''}`;
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
      setEnabled(btn, price <= cap && canAfford(realm, { gold: price }));
    }
  };
}
