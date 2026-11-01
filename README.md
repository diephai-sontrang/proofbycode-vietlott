# proofbycode-vietlott

Minimal Mega 6/45 simulation engine. The current feature simulates players until a configured number of players win against one fixed target, or until the maximum player count is reached.

## Local setup

The project uses plain JavaScript ES modules and Node.js built-in tests. No package installation is required.

```text
node --version
npm test
```

Node.js 18 or newer is supported.

## CLI

```text
node scripts/simulate.js \
  --target 1,2,3,4,5,6 \
  --sets-per-player 1 \
  --stop-after-winners 1 \
  --seed demo-001
```

Use `node scripts/simulate.js --help` for the full option list. The CLI prints the configuration, throttled progress, winner events, elapsed time, throughput and a final summary. It stops when `stopAfterWinners` is reached or after 10 seconds, whichever comes first. `Ctrl+C` prints the current snapshot as interrupted rather than completed. The core API still requires `maxPlayers`; the CLI supplies an internal safe ceiling because its practical limit is the 10-second timeout.

## Engine API

```js
import { createSimulation } from './src/simulation.js';

const simulation = createSimulation({
  target: [1, 2, 3, 4, 5, 6],
  setsPerPlayer: 1,
  stopAfterWinners: 1,
  maxPlayers: 20_000_000,
  seed: 'demo-001',
});

while (simulation.getSnapshot().status !== 'completed') {
  simulation.advance({ maxCandidateGenerations: 50_000 });
}

console.log(simulation.getSnapshot());
```

`advance` accepts a non-negative safe integer. A zero-sized advance is a no-op. Every candidate generation, including a rejected duplicate, consumes one unit of the supplied budget. The engine preserves the current player's accepted combination set between calls, so a snapshot with `playersStarted > playersCompleted` represents a partial player. `currentPlayer` reports that player's 1-based index and number of accepted distinct sets without exposing the combinations.

The engine stops immediately after the winning combination that reaches `stopAfterWinners`. If the same player also reaches `maxPlayers`, the stop reason is `winners_reached`.

## Simulation assumptions and counters

- `target` must be exactly six distinct integers in `[1, 45]`; order is ignored.
- Each player purchases `setsPerPlayer` distinct combinations. Different players may purchase the same combination.
- A player can win at most once. After a win, remaining combinations are not generated, but the player is treated as having purchased all configured sets.
- All players represent participants in the **same draw** against the fixed target.
- The target may later be supplied by a selected historical draw date; historical-data retrieval is outside the current scope.
- One run is an observed waiting count. It is not a guaranteed population threshold and is not a probability estimate.

Snapshot counters:

- `totalSetsPurchased`: purchases for completed players only; a winning player contributes all `setsPerPlayer` sets.
- `totalSetsChecked`: distinct purchased combinations actually generated and compared, including the winning combination.
- `candidateGenerations`: every generated candidate, including candidates rejected because the current player already had that combination.
- `winnerEvents`: each event contains the 1-based player index, the 1-based accepted-set index that matched, and `totalSetsChecked` immediately after that match.

The seeded PRNG uses an explicit UTF-8 string seed, FNV-1a hashing, xorshift32 output and unbiased rejection sampling for bounded integers. It is deterministic for the same seed, configuration and engine version, but it is not cryptographically secure. The optional `randomUint32` configuration function is a small test seam for rare-event tests and is not used by the CLI.

The test suite loads the downloaded `data/mega-6-45.json` corpus containing all 1,582 draw records through draw `#01582` (2026-10-30). The corpus was crawled from the [XoXoSo Mega 6/45 history](https://xoxoso.net/vietlott/mega-6-45/) on 2026-11-01. Tests use the local file and do not depend on a live network.

## Known performance limits

The engine generates actual combinations and rejects duplicates within a player. It does not use probability formulas to sample winners or waiting times. As `setsPerPlayer` approaches all `8,145,060` possible combinations, rejection sampling becomes increasingly expensive: late accepted sets may require many duplicate candidates. The current player's accepted combination ranks also require memory proportional to `setsPerPlayer`. The valid mathematical range is not silently restricted; large configurations may simply be impractical to run locally.
