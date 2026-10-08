# Realmfall

A text-based idle kingdom builder for the browser. Grow a realm from a handful
of peasants, raise an army, and conquer the kingdoms around you. Every kingdom
you take changes how yours plays.

## Status

In development. The core simulation is in (jobs, growth, buildings, storehouses,
starvation, soldiers, rival generation), but the page only shows a resource
readout for now.

- **Test it:** <https://danhquach.github.io/realmfall/>, redeployed from `main`
  on every merge.
- **First playable build:** arrives with
  [RF-040 Realm panels (#18)](https://github.com/danhquach/realmfall/issues/18),
  where you can assign jobs, build and watch the rates change in the browser.
- **First full build** (world map, rivals, battles, save and offline progress;
  design §15) comes after the rest of the Phase 1 tickets.

## Core loop

- **People and jobs.** Assign peasants to farms, woodcutting and mines. Everyone
  eats food; workers pay tax.
- **Build.** Huts raise the population cap, markets earn gold, forges
  strengthen the army.
- **Army.** Soldiers come from your peasants, eat more food and cost gold
  upkeep. Every soldier is a worker you no longer have.
- **Rivals.** Neighbouring settlements are generated with a name and a trait.
  They grow stronger over time, raid you when you're weak, and can be scouted,
  paid tribute, or attacked.
- **World map.** A node map of settlements and resource sites joined by roads.
  Claim sites with garrisons for their bonuses; march times depend on distance.
- **Unit counters.** Spearmen, archers and cavalry counter each other in a cycle.
- **Conquest.** A won battle annexes the rival: land, people, gold, and its
  trait, which permanently changes your kingdom (e.g. Dwarven smiths double
  mining output).
- **Chronicle.** A running history of your realm: harvests, plagues, envoys,
  raids and battles.

## License

[MIT](LICENSE)
