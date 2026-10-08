# Realmfall — Design

Status: draft. Every number below comes from the first playable prototype and
is a starting point for balancing, not a final value. World map numbers (§8)
haven't been prototyped yet.

## 1. Vision

A text-based idle kingdom builder. You start with a handful of peasants and a
thin granary, grow a realm, and conquer the kingdoms and lands around you. Each
conquest absorbs the rival's trait, so every realm grows into something
different. Rulers age and die; their heirs inherit what survives.

### Pillars

1. **Every gain has a cost.** Every resource is both produced and consumed.
   More soldiers means fewer workers, more food eaten, more gold spent.
2. **Conquest changes you.** Beating a rival is a permanent change to how your
   kingdom plays, not just a bigger number.
3. **The world pushes back.** Rivals grow while you idle, raid you when you're
   weak, and compete for the same land.
4. **The story writes itself.** The Chronicle turns the simulation into a
   history of your dynasty.
5. **Text first.** Numbers, buttons and prose. The world map is a simple graph
   of named places and roads, not a tile grid.

## 2. Core loop

```
peasants ─► jobs ─► food / wood / iron / gold ─► buildings + soldiers
    ▲                                                    │
    │                                                    ▼
    └── annexed people, sites, traits ◄── claim sites / conquer rivals on the map
```

Over a ruler's life: grow → arm → expand across the map → ruler dies → heir
inherits a weakened realm with a legacy bonus → repeat, stronger.

## 3. Resources

| Resource | Produced by | Consumed by |
|---|---|---|
| Food | Farmers (1.5/s each), Fertile plains | Every civilian (0.5/s), every soldier (1/s; cavalry 1.5/s) |
| Wood | Woodcutters (0.8/s each), Forests | Buildings, archers |
| Iron | Miners (0.4/s each), Iron mines | Spearmen, cavalry, Forge |
| Gold | Tax (0.25/s per employed worker), Markets (+1/s each), Gold veins, loot | Soldier upkeep (0.5/s each; cavalry 1/s), training soldiers, buildings, scouting, tribute |

The legacy multiplier (§10) applies to all production, tax included.

### Starting state

| | |
|---|---|
| Stores | 80 food, 40 wood, 10 iron, 40 gold |
| People | 4 idle, 4 farmers, 2 woodcutters, 0 miners, 0 soldiers |
| Housing cap | 15 |
| Ruler | age 45 |
| Map | Your capital only, nearby places visible |

The opening food balance is +1.0/s on purpose: the first decision is how many
more farmers you need before anything else.

## 4. People

- **Growth:** +1 idle peasant every 4 s while food > 5 and population < cap.
- **Jobs:** idle peasants are assigned to Farmer, Woodcutter or Miner and can be
  moved back at any time. Idle peasants eat but pay no tax.
- **Starvation:** while food is at 0 and still falling, one person dies every 2 s
  (idle first, then workers, then soldiers).
- **Housing cap:** raised by Huts (+5), conquest (+10) and the Stone halls trait.

## 5. Buildings

Each building's cost grows with how many you already own (n = number built).

| Building | Cost | Effect |
|---|---|---|
| Hut | 25 × 1.3ⁿ wood | +5 housing |
| Market | 40 × 1.5ⁿ wood, 30 × 1.5ⁿ gold | +1 gold/s |
| Forge | 60 × 2ⁿ wood, 20 × 2ⁿ iron | +50% army power |

## 6. Army

### Unit types

Three unit types counter each other in a cycle:

```
Spearmen ──beat──► Cavalry ──beat──► Archers ──beat──► Spearmen
```

| Unit | Train cost | Upkeep | Base power | Special |
|---|---|---|---|---|
| Spearmen | 1 peasant, 5 iron, 10 gold | 1 food/s, 0.5 gold/s | 2 | — |
| Archers | 1 peasant, 8 wood, 10 gold | 1 food/s, 0.5 gold/s | 2 | +25% when defending (capital or garrison) |
| Cavalry | 1 peasant, 5 iron, 20 gold | 1.5 food/s, 1 gold/s | 3 | Needs a Horse pasture (§8); all-cavalry armies march faster |

Each type costs a different resource, so the counter you want depends on what
your economy produces. Cavalry is the strongest but needs held land to train.

### Counters

Against the enemy type it beats, a unit fights at ×1.5. Against the type that
beats it, ×0.67. Against its own type, ×1.

A unit's **effective power** is its base power × its average multiplier,
weighted by the enemy army's mix. For example, a spearman facing an army that
is half cavalry, half archers fights at 2 × (0.5 × 1.5 + 0.5 × 0.67) ≈ 2.2.

**Army power** = Σ effective power of every field unit × (1 + 0.5 × forges) ×
(1 + bonuses from traits). Units in garrisons don't count.

Example: 20 Spearmen (base 40) against 20 Cavalry (base 60). Raw power says you
lose (31%). With counters, your spearmen fight at 40 × 1.5 = 60 and their
cavalry at 60 × 0.67 = 40, so you win 69% of the time.

### Rules

- **Scouting reveals the mix.** A scouted rival shows how many of each unit it
  has, so you can build the counter before you march.
- **Rival armies reflect their trait.** Horse lords field mostly cavalry, Poison
  archers mostly archers; others are mixed.
- **Bandits** are mostly spearmen.
- **Desertion:** while gold is at 0, one unit deserts every 2 s (most expensive
  upkeep first).
- **Disband:** the unit goes back to being an idle peasant. Its training cost is
  not refunded.

## 7. Rivals

### Generation

Each rival is a settlement on the map (§8) with a name, a ruler (King/Queen +
name), one trait (§9), a power value, a stance (hostile / at peace) and whether
you've scouted it.

- Starting rivals: power 20, 45 and 90, placed in the first two rings of the map.
- Each rival has a 60% chance to start hostile.
- Further rivals come from new map rings (§8), each ring 1.5× stronger than the
  last. The supply of rivals is endless.
- Every rival gains +4% power per year.

### Actions

You can act on a rival once its settlement is next to your territory on the map.

| Action | Cost | Effect |
|---|---|---|
| Scout | 15 gold | Reveals ruler, power, trait and your win chance |
| Tribute | 30 gold | A hostile rival becomes at peace (until an event changes it) |
| Attack | — (risks the army) | Battle, see below |

### Battle

Win chance = P² / (P² + E²), where P is your army power and E the defender's
power, both after counters (§6). Squaring the powers favours the stronger side: twice the enemy's power
gives an 80% win chance. The same formula is used against rival capitals,
garrisons and bandits.

- **Win against a capital:** lose ⌈soldiers × (0.1 + 0.3 × (1 − win chance))⌉
  soldiers. Annex the rival: +10 housing, +⌊E / 8⌋ people, +E gold, its trait
  permanently, and every site it held (§8).
- **Loss:** lose ⌈50%⌉ of soldiers. The rival gains +10% power and turns hostile.

### Raids

Every 45 s a random hostile rival raids with strength E × (0.4–0.8). It targets
your weakest garrisoned site next to its land, or your capital if none is.

- **Raid on the capital:** if field army power ≥ raid strength, the raid is
  repelled. Otherwise you lose 25% of your food and wood.
- **Raid on a site:** if the garrison's power ≥ raid strength, it holds.
  Otherwise the garrison is lost and the rival takes the site.

## 8. World map

The world is a graph of named places joined by roads, not a tile grid. It's
drawn as a simple node map: settlements are squares, resource sites are
circles, ownership is shown by colour, and unexplored places are marked "?".
Clicking a place shows its details and actions. Everything that happens on the
map is also written to the Chronicle.

### Places

- **Settlements:** your capital and rival capitals.
- **Resource sites:** land that gives a bonus while you hold it.

| Site | Bonus while held (richness 1) |
|---|---|
| Fertile plain | +3 food/s |
| Forest | +2 wood/s |
| Iron mine | +1 iron/s |
| Gold vein | +1.5 gold/s |
| Horse pasture | Allows cavalry: supports 10 cavalry |
| Stone quarry | Building costs −10% |
| Shrine | Ruler lives +5 years |

Each site has a richness of 1–3 that multiplies its bonus. Sites farther from
your starting capital are richer.

### Visibility

You can see every place within one road of something you hold. Places further
out show as "?" until you scout them (15 gold) or claim a neighbouring place.

### Claiming and holding sites

- **Adjacency:** you can only claim or attack places that share a road with
  your territory.
- **Unclaimed site:** claim it by stationing a garrison of at least 2 soldiers.
- **Bandits:** some unclaimed sites are guarded by bandits (a power value).
  Clear them with a battle first, then station a garrison.
- **Rival-held site:** attack its garrison (battle, §7). If you win, the site is
  yours and you must station a garrison.
- **Garrisons cost you.** Garrisoned soldiers still eat and get paid but don't
  fight in your field army. Holding more land makes your capital weaker; that's
  the central trade-off of the map.
- **Withdraw:** pull the garrison back into the field army; the site becomes
  unclaimed.
- **Annexed sites:** when you conquer a rival capital, its sites come with a
  militia garrison of 2 drawn from the annexed people.

### Marching

Every attack starts at your capital and has to travel to the target and back.

**Road length.** Each road has a fixed length in years, set by the terrain it
crosses when the map is generated:

| Terrain | Years per road |
|---|---|
| Plain, river | 1 |
| Forest | 1.5 |
| Hills, marsh | 2 |

Roads between two places you hold count half: your own land has good roads and
supply.

**March time** = (shortest path length from capital to target) × army size
factor × speed bonuses

- **Army size factor:** 1 + 0.1 per 20 field soldiers. Bigger armies are slower.
- **Speed:** an army marches at the pace of its slowest unit. An all-cavalry
  army marches 40% faster. The Horse lords trait cuts another 25% (minimum 50%
  of base).
- **Return:** the army walks home the same way, taking the same time again.

Example: Ashford → Gold vein (plain, 1) → Marsh of Veyl (marsh, 2) = 3 years.
With 30 mixed soldiers (factor 1.1): 3 × 1.1 ≈ 3.3 years there, 3.3 back. With
30 cavalry (−40%): 3 × 1.1 × 0.6 ≈ 2 years each way.

**While marching:**

- The army doesn't defend the capital, so raids on the capital face only the
  soldiers left at home.
- Marching soldiers eat 1.5× food (supply lines).
- The target keeps growing (+4% power per year), so the win chance shown when
  you send the army is projected to the arrival year.
- You can recall the army at any point. It turns back and takes as long to
  return as it has already marched.

**Why it matters:** holding sites along the way halves those roads, so a chain
of garrisons makes far targets reachable. That gives land a second purpose
beyond its resource bonus.

### Rivals on the map

- Each rival starts with its capital and 1–2 nearby sites.
- Every few years a rival tries to claim an unclaimed site next to its land.
- Rivals compete with you for the same sites.

### Endless map

The map grows in rings around your starting capital. When you hold a place on
the outermost ring, a new ring is generated beyond it, with more rivals (power
1.5× the previous ring) and richer sites.

## 9. Traits

A conquered rival's trait is added to your kingdom permanently. Traits stack.

| Trait | Effect |
|---|---|
| Poison archers | Archers +50% power |
| Horse lords | Cavalry +50% power, march −25% |
| Dwarven smiths | Miner output +100% |
| Fertile valleys | Farmer output +50% |
| Timber clans | Woodcutter output +75% |
| Merchant guilds | Tax +50% |
| Stone halls | +10 housing |

The trait pool is the main source of variety and needs to grow (see §13).

## 10. Time and succession

- **Year:** 8 s of game time.
- **Ruler death:** at age 70 (plus any Shrine bonus). The prototype's first
  ruler starts at 45.
- **Succession (the prestige reset):**
  - Food, wood, iron and gold are halved.
  - Field soldiers are halved. Garrisons are kept.
  - Buildings, people, traits, sites and conquered land are kept.
  - Legacy +1, which adds +10% to all production.
  - The new ruler starts at age 20–29.

## 11. Events

One random event every 25 s, written to the Chronicle:

| Event | Effect |
|---|---|
| Bountiful harvest | +50 + 3 × population food |
| Plague | −2 people (only if population > 6) |
| Envoy's gifts | +40 gold |
| Rich vein | +15 iron |
| Change of heart | A random rival flips between hostile and at peace |

## 12. Chronicle

Every meaningful change is written as one line, tagged with the year:
accessions, buildings raised, scouting reports, sites claimed and lost,
battles, raids, events, deaths and successions. It's the game's main feedback
channel and its story.

## 13. Known issues from the prototype

1. **Succession is weak.** +10% production per heir isn't worth losing half
   your stores. It needs heir traits, dynasty perks, or a choice of heir.
2. **Tribute is too cheap.** A one-time 30 gold buys peace until a random
   event flips it. Tribute should be ongoing (gold per year).
3. **Too few traits.** Seven traits repeat within a few conquests.
4. **Time runs too fast.** An 8 s year makes a reign last about 3 minutes at 1×.
   That's good for testing, too fast for an idle game.
5. **No offline progress.** Idle games need it; see §14.
6. **No late-game sink.** Gold and food pile up once the economy is stable.
7. **The map is untested.** Garrison sizes, site yields, march time and rival
   expansion rate need a prototype before they can be trusted.

## 14. Next systems

Ordered by how much they add to the endless loop:

1. **Save and offline progress.** Autosave to localStorage. On return,
   simulate the time away (capped, e.g. 8 h) and write a Chronicle summary.
2. **Bigger trait pool and trait synergies.** Some pairs of traits combine into
   a stronger effect (e.g. Dwarven smiths + Horse lords → Ironclad cavalry).
3. **Dynasty perks.** Spend legacy on permanent perks between reigns instead of
   a flat +10%.
4. **Research.** Scholars produce research points that unlock techs
   (agriculture, warfare, civic).
5. **Citizen tiers.** Peasants → Artisans → Scholars, each needing more goods
   and unlocking better jobs.
6. **Diplomacy.** Alliances, marriages to merge realms, spies.
7. **Rival behaviour.** Rivals fight each other, ally against you, and have
   personalities (greedy, cautious, zealous).

## 15. First build scope

A playable web build containing §3–§12 (including the world map, with the
first two rings) plus save and offline progress.

## 16. Tech

- Vite + TypeScript, plain DOM. The world map is a small SVG; no canvas or game
  engine.
- Simulation separate from UI: a pure `tick(state, dt)` function, so balance
  can be tested and offline time simulated without rendering.
- Unit tests on the simulation (Vitest), following the Crimson Onslaught setup.
