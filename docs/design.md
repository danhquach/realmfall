# Realmfall — Design

Status: draft. Every number below comes from the first playable prototype and
is a starting point for balancing, not a final value. World map numbers (§8)
haven't been prototyped yet.

## 1. Vision

A text-based idle kingdom builder. You start with a handful of peasants and a
thin granary, grow a realm, and conquer the kingdoms and lands around you. Conquest,
milestones, challenges and the market earn traits, and you choose three to run,
so every realm grows into something different.

### Pillars

1. **Every gain has a cost.** Every resource is both produced and consumed.
   More soldiers means fewer workers, more food eaten, more gold spent.
2. **Conquest changes you.** Beating a rival is a permanent change to how your
   kingdom plays, not just a bigger number.
3. **The world pushes back.** Rivals grow while you idle, raid you when you're
   weak, and compete for the same land.
4. **The story writes itself.** The Chronicle turns the simulation into a
   history of your realm.
5. **Text first.** Numbers, buttons and prose. The world map is a simple graph
   of named places and roads, not a tile grid.

## 2. Core loop

```
peasants ─► jobs ─► food / wood / iron / gold ─► buildings + soldiers
    ▲                                                    │
    │                                                    ▼
    └── annexed people, sites, traits ◄── claim sites / conquer rivals on the map
```

Grow → arm → expand across the map → absorb rivals' traits → push into
stronger rings, endlessly.

## 3. Resources

| Resource | Produced by | Consumed by |
|---|---|---|
| Food | Farmers (1.5/s each), Fertile plains, loot | Every civilian (0.5/s), every soldier (1/s; cavalry 1.5/s), wagons (0.5/s) |
| Wood | Woodcutters (0.8/s each), Forests, loot | Buildings, archers, wagons |
| Iron | Miners (0.4/s each), Iron mines, loot | Spearmen, cavalry, Forge, Wall |
| Gold | Tax (0.25/s per employed worker), Markets (+1/s each), Gold veins, loot | Soldier upkeep (0.5/s each; cavalry 1/s; wagons 0.25/s), training units, buildings, scouting, tribute |

Every store has a cap set by the Storehouse level (§5). A store stops filling at
its cap and anything over it is lost, whatever the source (production, loot,
events, offline time). A cost larger than the cap can't be paid until the
Storehouse is upgraded.

### Starting state

| | |
|---|---|
| Stores | 80 food, 40 wood, 10 iron, 40 gold |
| People | 3 idle, 4 farmers, 2 woodcutters, 0 miners, 1 builder, 0 soldiers |
| Housing cap | 15 |
| Store caps | 200 food, 200 wood, 50 iron, 150 gold (Storehouse level 0) |
| Realm | Hearthmoor |
| Map | Your capital only, nearby places and every rival capital visible |

The opening food balance is +1.0/s on purpose: the first decision is how many
more farmers you need before anything else.

## 4. People

- **Growth:** +1 idle peasant every 4 s while food > 5 and population < cap.
- **Jobs:** idle peasants are assigned to Farmer, Woodcutter, Miner or Builder
  (§5) and can be moved back at any time. Idle peasants eat but pay no tax.
- **Starvation:** see below.
- **Housing cap:** raised by Huts (+5) and conquest (+10). Soldiers live in
  the same housing as everyone else; training one moves a peasant into the army
  without changing the population.

### Starvation

Hunger is gradual, so a realm hit by a raid has time to rebuild its food before
it empties.

- **Shortfall:** while food is at 0, shortfall s = (food eaten − food produced)
  ÷ food eaten, per second. If production covers consumption, s = 0 and no one
  is hungry.
- **People leave:** hunger builds at s per second; each 4 points of hunger, one
  person leaves. At s = 1 (no food at all) that is one person every 4 s; at
  s = 0.1, one every 40 s. Hunger resets to 0 once food is above 0 again.
- **Who leaves first:** idle peasants, then builders, miners, woodcutters and
  farmers (in that order, so farmers stay longest), then recruits in training
  (§6), then soldiers and wagons. A recruit who leaves takes their paid train
  cost with them.
- **Penalty:** while s > 0, wood, iron, tax and build work are multiplied by (1 − s), and
  the realm does not grow. Food output is not reduced, so starvation can't feed
  on itself.

## 5. Buildings

Each building's cost and build work grow with how many you already own
(n = number built plus number already queued), rounded up to a whole number.
Buildings with a level (Storehouse, Wall, Defence tower) are built once and then
upgraded; for them n is the level being ordered, minus 1, and each level can be
queued only after the one below it is built or queued.

| Building | Cost | Build work | Needs | Effect |
|---|---|---|---|---|
| Hut | 25 × 1.3ⁿ wood | 20 × 1.2ⁿ | — | +5 housing |
| Market | 40 × 1.5ⁿ wood, 30 × 1.5ⁿ gold | 40 × 1.2ⁿ | Storehouse level 1 | +1 gold/s |
| Barracks | 50 wood, 20 gold | 40 | 15 people | Trains Spearmen (§6) |
| Archery range | 60 wood, 30 gold | 50 | Barracks | Trains Archers |
| Stable | 80 wood, 10 iron, 40 gold | 60 | Barracks, a Horse pasture held (§8) | Trains Cavalry |
| Forge | 60 × 2ⁿ wood, 20 × 2ⁿ iron | 60 × 1.2ⁿ | Barracks | +50% army power |
| Wall (levels 1–5) | 50 × 2ⁿ wood, 15 × 2ⁿ iron | 40 × 2ⁿ | Barracks | Capital defence +20% per level (§7) |
| Defence tower (levels 1–3) | 40 × 2ⁿ wood, 20 × 2ⁿ gold | 40 × 2ⁿ | Wall level 1 | Each level allows one more scout level (§7) |

Barracks, Archery range and Stable are built once each.

### Builders and construction

Nothing is built instantly. Builders do the work.

- **Builders** are peasants given the Builder job (§4). Like any worker they
  pay tax and can be moved back at any time.
- **Ordering:** the cost is paid when you order a building, and the order joins
  the construction queue (up to 5 orders). The cost and build work are fixed at
  that moment.
- **Build work** is measured in builder-seconds. All builders work on the first
  order in the queue, so it advances by (number of builders) per second. A Hut
  (20) takes 20 s with one builder and 5 s with four.
- **Done:** when its work is complete the building takes effect and the next
  order starts.
- **No builders:** the queue waits.
- **Cancel:** any order can be cancelled; the refund is exactly what was paid.
  A refund over the store cap is lost (§3). Cancelling a level also cancels any
  higher level of the same building queued after it.
- **Requirements** are checked when you order and must be built, not just
  queued. "People" counts the whole population: workers, idle, builders,
  recruits and soldiers. Locked buildings stay in the
  build list, greyed out, with what they still need ("Needs: Barracks"). A
  building whose requirement is later lost keeps working, except the Stable
  without a Horse pasture (§6).
- **Stone quarry** (§8) lowers costs, not build work.

The build panel shows the queue with each order's progress and time left at the
current number of builders. Orders started, finished and cancelled go to the
Chronicle.

### Storehouse

The capital has one Storehouse, upgraded level by level. Each level raises the
cap on every store and protects a fixed amount of each from raids (§7). Caps
differ by resource because a realm needs far more wood than iron.

| Level | Food cap / safe | Wood cap / safe | Iron cap / safe | Gold cap / safe | Upgrade cost |
|---|---|---|---|---|---|
| 0 (start) | 200 / 0 | 200 / 0 | 50 / 0 | 150 / 0 | — |
| 1 | 500 / 50 | 600 / 60 | 120 / 12 | 400 / 40 | 60 wood |
| 2 | 1,500 / 200 | 2,000 / 250 | 400 / 50 | 1,200 / 150 | 200 wood, 30 iron |
| 3 | 5,000 / 750 | 6,000 / 900 | 1,200 / 180 | 4,000 / 600 | 600 wood, 120 iron, 100 gold |

Each level past 3 multiplies the previous level's caps, safe amounts and
upgrade cost by 3.

Each upgrade is a construction order with build work 30 × 2ⁿ (30, 60, 120…).
The new caps apply when it is done.

The safe amount is a number, not a percentage: at level 1 with 120 food, 50 is
safe and a raid can only take from the other 70. Holding less than the safe
amount means all of it is safe.

## 6. Army

### Unit types

Three unit types counter each other in a cycle:

```
Spearmen ──beat──► Cavalry ──beat──► Archers ──beat──► Spearmen
```

| Unit | Trained at | Train cost | Upkeep | Base power | Carry | Special |
|---|---|---|---|---|---|---|
| Spearmen | Barracks | 1 peasant, 5 iron, 10 gold | 1 food/s, 0.5 gold/s | 2 | 10 | — |
| Archers | Archery range | 1 peasant, 8 wood, 10 gold | 1 food/s, 0.5 gold/s | 2 | 10 | +25% when defending (capital or garrison) |
| Cavalry | Stable | 1 peasant, 5 iron, 20 gold | 1.5 food/s, 1 gold/s | 3 | 25 | Needs a Horse pasture (§8); all-cavalry armies march faster |
| Wagon | Barracks | 1 peasant, 30 wood, 10 gold | 0.5 food/s, 0.25 gold/s | 0 | 100 | Doesn't fight; slows the march (§8) |

Each type costs a different resource, so the counter you want depends on what
your economy produces. A unit type can't be trained until its building is done
(§5), so the army grows in steps: Spearmen first, then Archers, then Cavalry,
which also needs held land.

### Training

Training takes time.

| Unit | Train time |
|---|---|
| Spearmen | 5 s |
| Archers | 6 s |
| Cavalry | 10 s |
| Wagon | 8 s |

- **Ordering:** the train cost is paid and an idle peasant is taken when you
  order a unit. Each building has its own training queue (up to 10 units) and
  trains one unit at a time, so a Barracks and an Archery range train in
  parallel.
- **In training:** a recruit eats like a soldier but doesn't fight, pay tax or
  draw upkeep until it's done.
- **Cancel:** any queued unit can be cancelled for a full refund; the recruit
  goes back to idle.
- **Stable and pastures:** each held Horse pasture supports 10 cavalry (§8).
  Cavalry (existing plus queued) can't be ordered past that cap, and while you hold no pasture or are
  over the cap, the Stable's queue pauses (paid costs stay paid). Cavalry you
  already have stays.
- Recruits don't desert (§6 Rules): they draw no upkeep yet.
- Finished units join the field army. Training isn't written to the Chronicle,
  one line per unit would drown it.

### Carrying loot

When you send an attack you choose how many of each unit type march, wagons
included; the rest stays home. The marching army's **carry capacity** is the
sum of each unit's Carry above.

- **Loot** from a won battle against a rival capital (Attack or Plunder, §7) is
  the rival's stores, up to the army's capacity. When the stores are bigger
  than the capacity, each resource is taken in proportion to how much of it the
  rival holds; the rest is left behind.
- Only units that survive the battle carry: capacity is counted after losses.
  Soldier losses are spread across soldier types (not wagons) in proportion to
  how many of each marched. Loot reaches your stores when the army gets home, and store
  caps apply then (§3).
- **Wagons** carry the most but have no power: they count toward the army's
  size (and so its march time) and make it slower (§8), and they can be lost
  like soldiers. Wagons aren't soldiers in the battle-loss formulas (§7): a
  won battle doesn't cost wagons, and a lost one loses ⌈50%⌉ of them along
  with the soldiers.
- Wagons can't be garrisoned and don't count toward a garrison's minimum (§8);
  they stay in the field army.
- Wagons stay out of the counter maths (§6 Counters) and the win chance: an
  army of only wagons can't attack.

Example: 20 Spearmen (200) and 2 Wagons (200) can bring home 400. Against a
rival holding 600 food, 400 wood, 100 iron and 200 gold (1,300 in all), they
take 400 / 1,300 ≈ 31% of each, rounded down: 184 food, 123 wood, 30 iron and
61 gold.

### Counters

Against the enemy type it beats, a unit fights at ×1.5. Against the type that
beats it, ×0.67. Against its own type, ×1.

A unit's **effective power** is its base power × its average multiplier,
weighted by the enemy army's mix. For example, a spearman facing an army that
is half cavalry, half archers fights at 2 × (0.5 × 1.5 + 0.5 × 0.67) ≈ 2.2.

**Army power** = Σ effective power of every field unit × its slotted trait
modifiers (§9) × (1 + 0.5 × forges). Units in garrisons don't count.

Example: 20 Spearmen (base 40) against 20 Cavalry (base 60). Raw power says you
lose (31%). With counters, your spearmen fight at 40 × 1.5 = 60 and their
cavalry at 60 × 0.67 = 40, so you win 69% of the time.

### Rules

- **Scouting reveals the mix.** A rival's unit mix is a level 3 scouting fact
  (§7), so you can build the counter before you march.
- **Rival armies reflect their trait.** Horse lords field mostly cavalry, Poison
  archers mostly archers; others are mixed.
- **Bandits** are mostly spearmen.
- **Desertion:** while gold is at 0, one unit deserts every 2 s (most expensive
  upkeep first).
- **Disband:** the unit goes back to being an idle peasant. Its training cost is
  not refunded.

## 7. Rivals

### Generation

Each rival is a settlement on the map (§8) with a place name (never a person's
name), a level, one trait (§9), a power value, an army, stores, people, a
wall and a defence tower, a stance (hostile / at peace) and the facts you've
learned about it (see Scouting).

- **Stores and people** follow its power E: full stores are 3E food, 2E wood,
  E/2 iron and E gold, and it has ⌊E / 8⌋ people. Stores start full. Plundered
  stores refill by 2% of the current full value every year, up to full.

- Starting rivals: a Weak rival of power 20, an Average one of 45 and a Strong
  one of 90, placed in the first two rings of the map.
- Each rival has a 60% chance to start hostile.
- Further rivals come from new map rings (§8). Each new rival rolls its level
  by its ring (table below), and its starting power is the ring's base power ×
  its level factor (Weak 0.5, Average 1, Strong 2, Elite 3). Ring 1's base is
  45, and each ring's base is 1.5× the last. The supply of rivals is endless.
- Every rival gains +4% power per year.

### Levels

Rivals are not equal: each has a level, so you can pick a target your army can
beat. The level sets the rival's defences. Growth rate and power ceiling per
level are being tuned in #78.

| Ring | Weak | Average | Strong | Elite |
|---|---|---|---|---|
| 1 | 60% | 40% | — | — |
| 2 | 30% | 50% | 20% | — |
| 3 | 10% | 40% | 35% | 15% |
| 4+ | — | 25% | 45% | 30% |

| Level | Wall | Defence tower |
|---|---|---|
| Weak | 0 | 0 |
| Average | 0–1 | 0–1 |
| Strong | 1–2 | 1–2 |
| Elite | 2–3 | 2–3 |

Wall and tower levels are rolled within the range when the rival is created,
so two rivals of the same level can differ; only scouting tells them apart.

A rival's wall works like yours (§5): +20% defence per level when you attack
its capital, not its sites.

### Actions

You can attack, plunder or pay tribute to a rival once its settlement is next
to your territory on the map. You can scout any rival you can see. Attacking or
plundering a rival at peace is allowed and turns it hostile.

| Action | Cost | Effect |
|---|---|---|
| Scout | 15 × 2^(scout level − 1) gold (15, 30, 60, 120) | Reveals facts about it, see below |
| Tribute | 30 gold | A hostile rival becomes at peace (until an event changes it) |
| Attack | — (risks the army) | Battle; a win annexes the rival, see below |
| Plunder | — (risks the army) | Battle; a win takes loot but leaves the rival standing, see below |

### Scouting

Scouting is how you learn about a rival. You pick the scout level when you
send the scout. Level 1 is always available; each Defence tower level (§5)
allows one more, up to level 4.

**Facts.** Everything about a rival is a fact, and each fact needs a minimum
scout level. Deeper levels give the same subject in more detail; learning a
more detailed fact replaces the rougher one and takes the rougher one out of
the pool still to be revealed.

| Subject | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| Level and trait | Level | Trait | | |
| Power | | Range | Exact | |
| Army | Size: small / medium / large | Exact count | Unit mix (§6) | |
| Resources | Wealth: poor / modest / rich | Which stores it holds most of | Each store (range) | Each store, exact |
| People | | | Range | Exact |
| Defences | | Wall level | | Defence tower level |
| Land | | Sites held | | |

- **Army size:** small under 10 units, medium 10–29, large 30 or more.
- **Wealth:** total stores against full (above): poor under 33%, modest
  33–66%, rich over 66%.
- **Which stores it holds most of:** the two largest.
- **Ranges** are 50% of the true value wide, placed at a random offset (from
  the run's seed) so the true value lies somewhere inside, not at the centre.

**Each scout** at level L:

- reveals 2 facts at random from those you don't know yet whose level is at
  most L. Scouting again at the same level reveals more, but never anything
  deeper than L; for that you need a higher level;
- refreshes every fact you already know at level L or below to its current
  value;
- reveals nothing new once every fact up to L is known (refresh only).

**Failure.** A rival's Defence tower is its scout counter. A scout fails with
chance 20% × (rival's tower level − scout level + 1), and never below 0%. A
Weak rival (tower 0) never stops a scout; against a tower of 3 a level 1 scout
fails 60% of the time and a level 4 scout never does. A failed
scout costs its gold, reveals and refreshes nothing, and turns the rival
hostile. Before you send the scout, the fail chance is shown exactly once the
rival's tower level is known, as a range once only its level is known
(Levels), and as "?" before that.

**Facts age.** Each fact shows the year it was learned ("year 42"). Rivals
keep growing, so old numbers understate them.

**Win chance** is shown once you know the rival's exact power, unit mix and
wall level, computed from those facts against your army now. Otherwise it's
"?".

Every scout, successful or failed, is written to the Chronicle with what it
revealed.

### Rivals tab

Rivals have their own tab. It lists every rival capital you can see on the
map: its name, stance, how far it is, and every fact you know about it with
the year it was learned. Unknown facts show as "?", so you can see at a glance
what's left to learn and which scout level it needs. Each rival has its
actions here: Scout (pick a level, with its cost and fail chance), Tribute,
Attack and Plunder.

### Battle

Win chance = P² / (P² + E²), where P is your army power and E the defender's
power, both after counters (§6). Squaring the powers favours the stronger side: twice the enemy's power
gives an 80% win chance. The same formula is used against rival capitals,
garrisons and bandits. At a rival capital, E is multiplied by its wall bonus
(1 + 0.2 × wall level).

- **Win against a capital:** lose ⌈soldiers × (0.1 + 0.3 × (1 − win chance))⌉
  soldiers. Annex the rival: +10 housing, its people, its trait (§9), every
  site it held (§8), and as much of its stores as the army can carry (§6). The
  rest is lost in the sack.
- **Plunder win:** lose ⌈soldiers × (0.05 + 0.15 × (1 − win chance))⌉
  soldiers and take loot up to the army's carry capacity (§6). The rival keeps
  its capital, power and sites, loses the stores taken, and turns hostile.
  Plundering the same rival again within 20 years of the last plunder takes
  only half as much loot.
- **Loss:** lose ⌈50%⌉ of soldiers. The rival gains +10% power and turns hostile.

### Raids

Every 45 s a random hostile rival raids with strength E × (0.4–0.8). It targets
your weakest garrisoned site next to its land, or your capital if none is.

- **Grace period:** there are no raids until year 10 and your first Barracks
  is built, whichever comes later, and never past year 30, so skipping the
  Barracks doesn't buy peace.
- **Until your first conquest,** a raid's strength is at most
  max(1.5 × your field army power, 10), so an early realm faces raids it can
  answer. An empty army still loses to them.

- **Raid on the capital:** if field army power × (1 + 0.2 × your wall level)
  ≥ raid strength, the raid is repelled. Otherwise the raiders take 25% of the
  food and wood above the Storehouse's safe amount (§5), but no more than they
  can carry: raid strength × 10 in total, split between food and wood in
  proportion to what's exposed.
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

Each site has a richness of 1–3 that multiplies its bonus. Sites farther from
your starting capital are richer.

### Visibility

You can see every place within one road of something you hold. Places further
out show as "?" until you scout them (15 gold) or claim a neighbouring place.
Scouting a place is separate from scouting a rival (§7).
Rival capitals are the exception: every one is shown by name and owner colour
from the start, but what's inside is known only from scouting (§7).

### Claiming and holding sites

- **Adjacency:** you can only claim, attack or plunder places that share a
  road with your territory.
- **Unclaimed site:** claim it by stationing a garrison of at least 2 soldiers.
- **Bandits:** some unclaimed sites are guarded by bandits (a power value).
  Clear them with a battle first, then station a garrison. A bandit camp holds
  loot worth 2× its power in total (40% food, 30% wood, 10% iron, 20% gold,
  rounded down), taken up to the army's carry capacity (§6). Cleared camps
  don't come back, so they are the early practice target.
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
factor × speed bonuses × wagon factor

- **Army size factor:** 1 + 0.1 per 20 marching units, wagons included. Bigger
  armies are slower.
- **Speed:** an army marches at the pace of its slowest unit. An all-cavalry
  army marches 40% faster. The Horse lords trait cuts another 25% (minimum 50%
  of base).
- **Wagon factor:** 1.25 if any wagon marches, otherwise 1. It's applied
  after the speed bonuses and their 50% floor, and an army with a wagon doesn't
  count as all-cavalry. Bring wagons for the loot, not the speed.
- **Return:** the army walks home the same way, taking the same time again.

Example: Ashford → Gold vein (plain, 1) → Marsh of Veyl (marsh, 2) = 3 years.
With 30 mixed soldiers (factor 1.1): 3 × 1.1 ≈ 3.3 years there, 3.3 back. With
30 cavalry (−40%): 3 × 1.1 × 0.6 ≈ 2 years each way.

**While marching:**

- The army doesn't defend the capital, so raids on the capital face only the
  soldiers left at home.
- Marching units eat 1.5× food (supply lines).
- The target keeps growing (+4% power per year), so the win chance shown when
  you send the army (known only once scouting has revealed enough, §7) is
  projected to the arrival year.
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
the outermost ring, a new ring is generated beyond it, with more rivals (ring
base power 1.5× the previous ring, §7) and richer sites.

## 9. Traits

Traits are realm-wide passive effects. Every trait has an upside and a
downside. You can own many traits, but only the ones in your **3 trait slots**
take effect, so earning more traits gives you more options, not more power.

### Tiers

Each trait has a tier. The tier sets its trader price, sell price, how often it
is rolled, and how far out rivals start to hold it.

| Tier | Colour (light / dark) | Traits | Trader price | Sell price | Roll odds | Rivals from ring |
|---|---|---|---|---|---|---|
| Common | grey `#5f5a52` / `#c9c2b6` | Fertile valleys, Timber clans | 150–250 gold | 40 gold | 45% | 1 |
| Fine | green `#276b2b` / `#81c784` | Dwarven smiths, Merchant guilds | 300–500 | 75 | 30% | 2 |
| Noble | blue `#1f5fa8` / `#7fb3f0` | Poison archers, Horse lords | 600–1,000 | 150 | 15% | 3 |
| Royal | purple `#7b3fa0` / `#c39be0` | Warrior creed | 1,200–1,800 | 300 | 7% | 4 |
| Mythic | gold `#9a5b06` / `#f0b44c` | Golden age | 2,500–4,000 | 600 | 3% | 6 |

A trait's name is shown in its tier colour wherever it appears (trait panel,
trader, offers, Chronicle), always with the tier name next to it: colour alone
isn't enough for colour-blind players. Every colour meets 4.5:1 contrast on its
theme's background.

Royal and Mythic hold one trait each until the pool grows (§13, §14).

### Effects

| Trait | Tier | Upside (level 1) | Downside |
|---|---|---|---|
| Fertile valleys | Common | Farmer output +50% | Miner output −25% |
| Timber clans | Common | Woodcutter output +75% | Farmer output −20% |
| Dwarven smiths | Fine | Miner output +100% | Woodcutter output −25% |
| Merchant guilds | Fine | Tax +50% | Soldier gold upkeep +25% |
| Poison archers | Noble | Archers +50% power | Spearmen −20% power |
| Horse lords | Noble | Cavalry +50% power, march −25% | Cavalry upkeep +50% |
| Warrior creed | Royal | Army power +30% | No population growth while at peace with every rival |
| Golden age | Mythic | All production and tax +25% | Rivals gain +6% power per year instead of +4% |

- A unit-type bonus applies to that unit type's power only.
- Modifiers on the same stat add up: +50% and −20% make +30%.

### Slots

- Effects and downsides apply only while a trait is slotted. Owned traits
  that aren't slotted do nothing.
- Filling an empty slot is free.
- Swapping a slotted trait for another owned one costs 5 × population gold,
  and that slot then has a 5-year cooldown.

### Duplicates and upgrades

Gaining a trait you already own gives you a **duplicate**.

- **Upgrade:** spend duplicates to raise a trait's level, up to level 5.
  Level n → n + 1 costs 2ⁿ⁻¹ duplicates (1, 2, 4, 8; 15 in total for
  level 5). Each level adds +25% of the level-1 upside, so level 5 has 2× the
  upside. The downside stays fixed.
- **Sell:** a duplicate sells for its tier's sell price at any time.
- Every sell price is below the lowest trader price for that tier, so buying
  to resell always loses gold.

Slots and the level cap bound the total: at most three traits, each at most
2× its base upside.

### Earning traits

| Source | How | Reward |
|---|---|---|
| Conquest | Annex a rival capital (§7) | Its trait |
| Milestones | One-off goals: 50 people · hold 5 sites · win 10 battles · Storehouse level 3 · repel 5 raids | Pick 1 of 3 rolled traits |
| Challenges | While none is active, one is offered every 15 years with a deadline in years (e.g. stockpile 500 food in 3 years, claim a site in 4 years, repel the next raid). Failing costs nothing. | Pick 1 of 2 rolled traits |
| Market trader | Needs at least one Market. Every 10 years the trader offers 3 rolled traits, each at a random price within its tier's range. | Buy any of them |

- A **rolled** trait picks its tier by the roll odds above, then a trait of
  that tier at random. It can be one you already own, which gives a duplicate.
- A rival's trait is drawn only from tiers unlocked at its ring, so farther
  conquests give better traits.
- Trader prices count against the gold cap (§3): a Mythic trait needs the gold
  cap of Storehouse level 3.
- **Milestones** are checked as the realm changes; "hold 5 sites" joins them
  once sites exist (§8). Several reached at once each pay out.
- **Challenges:** the first can come in year 16, and each later one 15 years
  after the last ended. Only a challenge that can be met is offered: stockpile
  500 food in 3 years needs a food cap of 500 or more and less than 500 in store, and repel the next raid
  (6 years) needs a hostile rival and the raid grace period (§7) to be over. Claim a site in 4 years joins them once
  sites exist (§8). The raid challenge ends with the next raid on the capital:
  repelled meets it, anything else fails it.
- **Offers** wait until the player picks. At most 10 are kept; past that the
  oldest is dropped. The choices of one offer are rolled separately, so two
  can be the same trait.
- **Trader:** opens with fresh stock as soon as the first Market stands, then
  restocks 10 years after each restock. A restock replaces unsold stock.
- Every gain, offer, pick, purchase, challenge result, slot, swap, upgrade and
  sale is written to the Chronicle.

## 10. Time

- **Year:** 8 s of game time. Yearly effects (rival growth) apply once per
  year passed.
- There are no rulers: ageing and succession are parked as a possible upgrade
  (§17).

## 11. Events

One random event every 25 s, written to the Chronicle:

| Event | Effect |
|---|---|
| Bountiful harvest | +50 + 3 × population food |
| Plague | −2 people (only if population > 6) |
| Envoy's gifts | +40 gold |
| Rich vein | +15 iron |
| Change of heart | A random rival flips between hostile and at peace |

Each event is equally likely. While Plague can't happen, the event is one of
the other four.

## 12. Chronicle

Every meaningful change is written as one line, tagged with the year:
buildings raised, scouting reports, sites claimed and lost, battles, raids
and events. It's the game's main feedback channel and its story.

Each line has one kind, and the panel has a toggle per kind (all on by
default) to hide or show its lines. Filtering only changes the view: hidden
lines stay in the Chronicle and count toward its 200-line cap.

| Kind      | Lines                                                         |
| --------- | ------------------------------------------------------------- |
| Events    | Random events (§11), except Change of heart                   |
| Raids     | Raids on the capital, repelled or not                         |
| Battles   | Battles won and lost                                          |
| Rivals    | Scouts (with what they revealed), failed scouts, tribute and Change of heart |
| Buildings | Construction orders started, finished and cancelled           |
| Traits    | Trait gains, duplicates, slots, swaps, upgrades and sales     |
| Away      | The offline progress summary (§14)                            |

## 13. Known issues from the prototype

1. **Tribute is too cheap.** A one-time 30 gold buys peace until a random
   event flips it. Tribute should be ongoing (gold per year).
2. **Too few traits.** Six traits repeat within a few conquests.
3. **Time runs too fast.** An 8 s year is good for testing, too fast for an
   idle game.
4. **No offline progress.** Idle games need it; see §14.
5. **No late-game sink.** Gold and food pile up once the economy is stable.
   Trait trader prices and swap costs (§9) soak up some gold, but not food.
6. **The map is untested.** Garrison sizes, site yields, march time and rival
   expansion rate need a prototype before they can be trusted.
7. **Construction, training and scouting are untested.** These need the
   balance runner: new building costs, build work and requirements, train
   times, wall bonus, carry capacities and wagon speed (§5, §6); rival level
   odds, power factors, wall and tower ranges, stores, people and refill rate,
   scout costs, fail chances and fact thresholds, the Plunder loss formula
   and repeat penalty, the raid grace period and caps, and bandit loot (§7,
   §8). Builders also take peasants from paid jobs, which adds to the army's
   gold squeeze (#78).
8. **Early attacks are blind.** The win chance needs exact power and unit mix
   (scout level 3, so Defence tower 2), so the first attacks are made without
   it. Intended, but worth checking in play.

## 14. Next systems

Ordered by how much they add to the endless loop:

1. **Save and offline progress.** Autosave to localStorage every 10 s, after
   each player action and when the page is hidden. The save is versioned; a
   save that is missing, of another version or fails validation starts a new
   game. On return, simulate the time away (capped, e.g. 8 h) in the same fixed
   0.25 s steps as live play, so store caps, growth and hunger behave exactly
   as they would online, and write a Chronicle summary: time away, the change
   in each store, people and soldiers. Absences under a minute (a reload) are
   replayed without a line. Construction and training (§5, §6) advance in the
   same steps, and the summary lists the buildings finished and units trained
   while away.
2. **Bigger trait pool and trait synergies.** More traits per tier, and some
   pairs of slotted traits combine into a stronger effect (e.g. Dwarven smiths
   + Horse lords → Ironclad cavalry).
3. **Research.** Scholars produce research points that unlock techs
   (agriculture, warfare, civic). Civic techs upgrade housing: Huts become
   Houses and then Stone houses, each holding more people, and techs such as
   Bunk beds and Insulation add room to every house.
4. **Citizen tiers.** Peasants → Artisans → Scholars, each needing more goods
   and unlocking better jobs.
5. **Diplomacy.** Alliances, marriages to merge realms, spies.
6. **Rival behaviour.** Rivals fight each other, ally against you, and have
   personalities (greedy, cautious, zealous).

## 15. First build scope

A playable web build containing §3–§12 (including the world map, with the
first two rings) plus save and offline progress.

## 16. Tech

- Vite + TypeScript, plain DOM. The world map is a small SVG; no canvas or game
  engine.
- Simulation separate from UI: a pure `tick(state, dt)` function, so balance
  can be tested and offline time simulated without rendering.
- Unit tests on the simulation (Vitest).
- `npm run sim` plays a run headless with a simple scripted strategy and prints
  stores, population, army and conquests per year (`--years N`, `--seed N`;
  default 100 years on seed 1), to compare balance changes run against run.

## 17. Future upgrades (not planned)

Parked ideas, kept for reference. Not on the roadmap and not in the first
build; picking one up means designing it here first.

### Ruler ageing and succession (#58)

The prototype's prestige reset:

- The ruler starts at 45, ages one year per game year and dies at 70.
- Succession halves food, wood, iron, gold and field soldiers. Garrisons,
  buildings, people, traits, sites and conquered land are kept.
- Legacy +1 per succession adds +10% to all production, tax included.
- The heir starts at age 20–29.
- **Shrine** resource site: ruler lives +5 years. Left out of the site pool
  until this ships.
- Known issue: +10% production per heir isn't worth losing half your stores.
  It needs heir traits, dynasty perks (#37), or a choice of heir.
