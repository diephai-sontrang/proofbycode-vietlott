# proofbycode-vietlott

Minimal Mega 6/45 simulation engine. The current feature simulates players until a configured number of players win against one fixed target, or until the maximum player count is reached.

## Local setup

The project uses plain JavaScript ES modules and Node.js built-in tests. No package installation is required.

```text
node --version
npm test
```

Node.js 18 or newer is supported.

## Browser UI

The repository also contains a buildless static browser UI with two tabs: `Mô phỏng` and `Tra lịch sử`. It uses the same validated historical dataset and a browser Web Worker for the single-attempt simulation. The UI is deliberately separate from the multi-player Node CLI: it represents one participant generating one six-number combination per attempt until the first match.

Start a local HTTP preview from the repository root:

```text
npm run serve
```

Then open `http://localhost:4173/`. Opening `index.html` directly from `file://` is not supported because modules, Workers and the JSON dataset require HTTP fetch semantics. All browser URLs are relative so the same static files work under the GitHub Pages path `/proofbycode-vietlott/`. The workflow in `.github/workflows/pages.yml` prepares a static Pages deployment; it is not run or published by local development.

The simulation tab supports a custom target of 2–6 numbers or a target selected from an actual historical draw, explicit reproducible seeds, pause/resume/stop, active elapsed time, copy/export, and a 9:16 presentation mode. It also displays the mathematical coverage size and the estimated cost per attempt at 10,000 VND per six-number set. For `k` selected numbers, one attempt covers `C(45-k, 6-k)` sets. This is a mathematical coverage model and does not claim that every 2–4 number selection is an official Vietlott retail product. The historical tab currently exposes a unified `contains-selected` control limited to 1–6 selected numbers; the `jackpot-coverage` mode remains available in the core and CLI for later UI re-enablement. It defaults the date inputs to the dataset's first and last draw and shows the number of draws currently inside the selected range. It intentionally does not expose the numeric-range helper as a UI control.

The single-attempt browser core is available to browser/Worker modules as:

```js
import { createAttemptSimulation } from './src/attempt-simulation.js';

const simulation = createAttemptSimulation({
  target: [3, 12, 27],
  seed: 'demo-001',
});

simulation.advance({ maxCandidateGenerations: 10_000 });
console.log(simulation.getSnapshot());
```

It generates actual combinations, matches when all selected target numbers are present, returns the full matching combination and does not impose an arbitrary total-attempt cap. Its status supports `ready`, `running`, `paused`, `matched`, `stopped` and `error`. The existing `createSimulation()` multi-player API below is unchanged.

For the browser cost display, the six-number set price is fixed at 10,000 VND. The coverage model is: 6 selected numbers = 1 set and 10,000 VND; 5 = 40 sets and 400,000 VND; 4 = 820 sets and 8,200,000 VND; 3 = 11,480 sets and 114,800,000 VND; 2 = 123,410 sets and 1,234,100,000 VND. The estimated total is the number of attempted bundles multiplied by the cost per attempt, including the matching attempt. It is an observed simulation cost under this model, not a forecast or a statement about an official retail ticket configuration.

## CLI

```text
node scripts/simulate.js \
  --target 1,2,3,4,5,6 \
  --sets-per-player 1 \
  --stop-after-winners 1 \
  --seed demo-001
```

The Node CLI remains independent of the browser Worker and supports the existing multi-player simulation semantics.

Use `node scripts/simulate.js --help` for the full option list. The CLI prints the configuration, throttled progress, winner events, elapsed time, throughput and a final summary. It stops when `stopAfterWinners` is reached or after 10 seconds, whichever comes first. `Ctrl+C` prints the current snapshot as interrupted rather than completed. The core API still requires `maxPlayers`; the CLI supplies an internal safe ceiling because its practical limit is the 10-second timeout.

## Historical fixed-number analysis

The historical analysis uses the local `data/mega-6-45.json` file. Its current envelope is:

```json
{
  "source": "...",
  "retrievedAt": "YYYY-MM-DD",
  "draws": [{ "id": "00001", "date": "YYYY-MM-DD", "result": [1, 2, 3, 4, 5, 6] }]
}
```

The adapter normalizes this to `drawId`, `drawDate` and sorted `numbers`. It validates date-only values without timezone conversion, six distinct numbers in `[1, 45]`, duplicate IDs, conflicting records and numeric-ID chronology. Invalid data fails the analysis; records are not silently discarded. The current file's ID range is internally contiguous, but external full-history completeness remains reported as `unknown`.

Two explicit modes are available:

- `contains-selected`: select 1–6 numbers; a draw matches when it contains all selected numbers. Selecting six numbers is an exact Jackpot comparison, but fewer than six numbers must not be described as a Jackpot win.
- `jackpot-coverage`: select 6–45 numbers and mathematically assume every `C(selectedCount, 6)` combination from that set is purchased. A draw matches when all six winning numbers belong to the selected set. This is a coverage model, not a claim that every selected-set size is an official retail bet product.

Examples:

```text
node scripts/analyze-history.js --mode contains-selected --numbers 3,12,27
node scripts/analyze-history.js --mode jackpot-coverage --numbers 1,5,9,14,22,30,37,45 --from 2020-01-01 --to 2026-10-31
node scripts/analyze-history.js --mode jackpot-coverage --numbers 1,2,3,4,5,6,7,8 --json
```

The result reports inclusive date filtering, actual analyzed coverage, match rate, an intersection histogram from 0 through 6, matched draws and waiting gaps. Draw transitions and calendar days are separate counters. Leading/trailing spans are observation-window boundaries, not completed waiting times.

For a numeric-range query independent of the analysis modes, the core also exports `filterDrawsByNumberRange(normalizedData, { from, to })`. It returns `matchedDrawCount` and the matching draws where all six numbers are within the inclusive `[from, to]` range; bounds must be integers from 1 through 45.

Theoretical probability is reported separately from historical frequency. For `M = C(45, 6) = 8,145,060`, `contains-selected` uses `C(45-k, 6-k) / M`; `jackpot-coverage` uses `C(k, 6) / M`. The theoretical mean `1 / p` is not a guaranteed threshold and does not predict the future. Choosing numbers after inspecting history introduces selection bias and is not evidence of predictive advantage.

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
