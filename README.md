# Strata

An idle city builder for the browser where the city never finishes. Build on a
hex map, play building cards from your hand, and when you build over something,
the old city doesn't vanish — it becomes a buried layer that powers everything
above it.

## Status

Concept stage. No code yet.

## Core loop

- **Hex map, card hand.** The city is a top-down hex map. You build by playing
  cards from a hand of building cards.
- **Build** on an empty hex. Building pushes back the fog on neighbouring hexes,
  so the map grows outward forever.
- **Merge** by playing a card on a tile of the same type: the tile levels up.
- **Bury** by playing a card on a tile of a different type: the old building
  becomes a buried layer (a stratum) under the new one, and each layer
  permanently boosts the tile's output.
- **Adjacency.** Neighbouring tiles of the same type boost each other, so
  districts form naturally.

## Endless progression (planned)

- **Strata prestige.** Reset onto the ruins of your last city; the buried layer
  carries permanent modifiers, and the order you stack eras in matters.
- **Scale nesting.** A finished city collapses into a single hex of the next map
  up: district → city → region → continent → planet.
- **Merge-to-discover.** Combining building types yields new, generated types,
  so content keeps opening up without being hand-authored.

## Art direction

- Flat, top-down 2D. No pixel art, no 3D.
- Soft, muted palette; buildings drawn procedurally (roofs, trees, water, docks).
- Minimal UI: the map is the interface. A currency counter, the card hand, and
  contextual previews on hover.

## License

[MIT](LICENSE)
