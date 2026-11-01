#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { createSimulation } from '../src/simulation.js';

const BATCH_SIZE = 50_000;
const TIMEOUT_MS = 10_000;

const HELP = `Usage:
  node scripts/simulate.js --target 1,2,3,4,5,6 --sets-per-player 1 \
    --stop-after-winners 1 --seed demo-001

Options:
  --target <n,n,n,n,n,n>       Fixed Mega 6/45 target.
  --sets-per-player <integer>  Distinct combinations purchased by each player.
  --stop-after-winners <int>   Stop after this many winning players.
  --seed <string>              Explicit UTF-8 string seed.
                              The CLI stops after 10 seconds if no completion occurs.
  --help                       Show this help.
`;

function parseInteger(value, optionName) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be a non-negative decimal integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} must be a safe integer`);
  }

  return parsed;
}

function parseTarget(value) {
  const parts = value.split(',');
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error('--target must contain comma-separated decimal integers');
    }

    const number = Number(part);
    if (!Number.isSafeInteger(number)) {
      throw new Error('--target contains an unsafe integer');
    }

    return number;
  });
}

function parseArguments(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];

    if (option === '--help') {
      return { help: true };
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${option}`);
    }

    index += 1;

    switch (option) {
      case '--target':
        values.target = parseTarget(value);
        break;
      case '--sets-per-player':
        values.setsPerPlayer = parseInteger(value, option);
        break;
      case '--stop-after-winners':
        values.stopAfterWinners = parseInteger(value, option);
        break;
      case '--seed':
        values.seed = value;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  const requiredOptions = ['target', 'setsPerPlayer', 'stopAfterWinners', 'seed'];
  const missingOptions = requiredOptions.filter((name) => values[name] === undefined);
  if (missingOptions.length > 0) {
    throw new Error(`Missing required option(s): ${missingOptions.join(', ')}`);
  }

  return values;
}

function printProgress(snapshot, startedAt) {
  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1_000, Number.EPSILON);
  const throughput = snapshot.candidateGenerations / elapsedSeconds;
  const partial = snapshot.currentPlayer === null
    ? 'no partial player'
    : `player ${snapshot.currentPlayer.playerIndex}: ${snapshot.currentPlayer.setsAccepted} sets accepted`;

  console.log(
    `[progress] candidates=${snapshot.candidateGenerations.toLocaleString()} `
      + `checked=${snapshot.totalSetsChecked.toLocaleString()} `
      + `players=${snapshot.playersCompleted}/${snapshot.playersStarted} `
      + `winners=${snapshot.winnersCount} throughput=${throughput.toFixed(0)}/s (${partial})`,
  );
}

function printWinnerEvents(snapshot, printedWinnerCount) {
  for (const event of snapshot.winnerEvents.slice(printedWinnerCount)) {
    console.log(
      `[winner] player=${event.playerIndex} set=${event.matchedSetIndex} `
        + `totalSetsChecked=${event.totalSetsChecked}`,
    );
  }
}

function printSummary(label, snapshot, startedAt) {
  const elapsedMs = performance.now() - startedAt;
  const elapsedSeconds = Math.max(elapsedMs / 1_000, Number.EPSILON);

  console.log(label);
  console.log(JSON.stringify({
    ...snapshot,
    elapsedMs: Math.round(elapsedMs),
    candidateGenerationsPerSecond: snapshot.candidateGenerations / elapsedSeconds,
  }, null, 2));
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    console.log(HELP);
    return;
  }

  const config = {
    target: parsed.target,
    setsPerPlayer: parsed.setsPerPlayer,
    stopAfterWinners: parsed.stopAfterWinners,
    // The core still requires a safe player bound. The CLI's practical limit
    // is the ten-second timeout below.
    maxPlayers: Math.floor(Number.MAX_SAFE_INTEGER / parsed.setsPerPlayer),
    seed: parsed.seed,
  };
  const simulation = createSimulation(config);
  const startedAt = performance.now();

  console.log('Configuration:');
  console.log(JSON.stringify({
    target: config.target,
    setsPerPlayer: config.setsPerPlayer,
    stopAfterWinners: config.stopAfterWinners,
    seed: config.seed,
    timeoutSeconds: TIMEOUT_MS / 1_000,
  }, null, 2));

  let snapshot = simulation.getSnapshot();
  let printedWinnerCount = 0;
  let lastProgressAt = startedAt;
  let interrupted = false;

  const handleInterrupt = () => {
    interrupted = true;
  };
  process.once('SIGINT', handleInterrupt);

  try {
    while (
      snapshot.status !== 'completed'
      && !interrupted
      && performance.now() - startedAt < TIMEOUT_MS
    ) {
      snapshot = simulation.advance({ maxCandidateGenerations: BATCH_SIZE });
      printWinnerEvents(snapshot, printedWinnerCount);
      printedWinnerCount = snapshot.winnerEvents.length;

      const now = performance.now();
      if (now - lastProgressAt >= 1_000) {
        printProgress(snapshot, startedAt);
        lastProgressAt = now;
      }

      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    process.removeListener('SIGINT', handleInterrupt);
  }

  if (interrupted && snapshot.status !== 'completed') {
    printSummary('INTERRUPTED — not completed', snapshot, startedAt);
    process.exitCode = 130;
    return;
  }

  if (snapshot.status !== 'completed') {
    printSummary('TIMEOUT — not completed', snapshot, startedAt);
    return;
  }

  printSummary('Simulation completed', snapshot, startedAt);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  console.error('Use --help for usage.');
  process.exitCode = 1;
});
