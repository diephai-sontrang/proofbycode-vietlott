#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  HistoricalDataValidationError,
  normalizeMega645Data,
} from '../src/history-data.js';
import { analyzeHistory } from '../src/history-analysis.js';

const DEFAULT_DATA_PATH = new URL('../data/mega-6-45.json', import.meta.url);

const HELP = `Usage:
  node scripts/analyze-history.js --mode contains-selected --numbers 3,12,27
  node scripts/analyze-history.js --mode jackpot-coverage \
    --numbers 1,5,9,14,22,30,37,45 --from 2020-01-01 --to 2026-10-31

Options:
  --mode <mode>       contains-selected or jackpot-coverage.
  --numbers <list>    Comma-separated selected numbers.
  --from <date>       Inclusive start date, YYYY-MM-DD.
  --to <date>         Inclusive end date, YYYY-MM-DD.
  --data <path>       Raw JSON dataset path (default: data/mega-6-45.json).
  --json              Print the complete machine-readable result.
  --help              Show this help.
`;

function parseNumbers(value) {
  if (value.length === 0) {
    throw new Error('--numbers must not be empty');
  }

  return value.split(',').map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error('--numbers must contain comma-separated decimal integers');
    }

    const number = Number(part);
    if (!Number.isSafeInteger(number)) {
      throw new Error('--numbers contains an unsafe integer');
    }
    return number;
  });
}

function parseArguments(argv) {
  const values = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];

    if (option === '--help') {
      return { help: true };
    }

    if (option === '--json') {
      values.json = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${option}`);
    }
    index += 1;

    switch (option) {
      case '--mode':
        values.mode = value;
        break;
      case '--numbers':
        values.selectedNumbers = parseNumbers(value);
        break;
      case '--from':
        values.from = value;
        break;
      case '--to':
        values.to = value;
        break;
      case '--data':
        values.dataPath = value;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }

  if (values.mode === undefined) {
    throw new Error('Missing required option: --mode');
  }
  if (values.selectedNumbers === undefined) {
    throw new Error('Missing required option: --numbers');
  }

  return values;
}

async function loadData(dataPath) {
  const source = dataPath === undefined ? DEFAULT_DATA_PATH : resolve(process.cwd(), dataPath);
  let rawText;

  try {
    rawText = await readFile(source, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read data file ${source}: ${error.message}`);
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid JSON in data file ${source}: ${error.message}`);
  }
}

function formatRate(rate) {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(4)}%`;
}

function formatDraw(draw) {
  const id = draw.drawId === null ? '(no id)' : `#${draw.drawId}`;
  return `${id} ${draw.drawDate} [${draw.winningNumbers.join(', ')}] `
    + `intersection=${draw.intersectionCount} position=${draw.position}`;
}

function printMatchedDraws(result) {
  const draws = result.matchedDraws;
  if (draws.length === 0) {
    console.log('Matched draws: none');
    return;
  }

  console.log(`Matched draws: ${draws.length}`);
  const visible = draws.length <= 20
    ? draws
    : [...draws.slice(0, 5), ...draws.slice(-5)];

  visible.forEach((draw, index) => {
    if (draws.length > 20 && index === 5) {
      console.log(`  ... ${draws.length - 10} more; use --json for all matches`);
    }
    console.log(`  ${formatDraw(draw)}`);
  });
}

function printGapSummary(result) {
  const gaps = result.waitingGaps;
  if (gaps.noMatchWindow !== null) {
    console.log(
      `No-match observation window: ${gaps.noMatchWindow.nonmatchingDraws} draws, `
        + `${gaps.noMatchWindow.calendarDays} calendar days`,
    );
    return;
  }

  if (gaps.completedGapStatistics === null) {
    console.log('Completed gaps: none (fewer than two matches)');
  } else {
    console.log(
      `Completed gaps: ${gaps.completedGapStatistics.count}; `
        + `average ${gaps.completedGapStatistics.averageDrawTransitionsBetween.toFixed(2)} draw transitions, `
        + `${gaps.completedGapStatistics.averageNonmatchingDrawsBetween.toFixed(2)} nonmatching draws, `
        + `${gaps.completedGapStatistics.averageElapsedCalendarDays.toFixed(2)} calendar days`,
    );
  }

  if (gaps.beforeFirstMatch !== null) {
    console.log(
      `Before first match: ${gaps.beforeFirstMatch.nonmatchingDraws} draws, `
        + `${gaps.beforeFirstMatch.calendarDays} calendar days (observation-window boundary)`,
    );
  }
  if (gaps.afterLastMatch !== null) {
    console.log(
      `After last match: ${gaps.afterLastMatch.nonmatchingDraws} draws, `
        + `${gaps.afterLastMatch.calendarDays} calendar days (observation-window boundary)`,
    );
  }
}

function printHumanSummary(result) {
  console.log(`Mode: ${result.mode}`);
  console.log(`Selected numbers: ${result.selectedNumbers.join(', ')} (${result.selectedCount})`);
  console.log(`Requested range: ${result.requestedDateRange.from ?? 'start'} to ${result.requestedDateRange.to ?? 'end'}`);
  console.log(
    `Actual range: ${result.actualDateRange === null
      ? 'none'
      : `${result.actualDateRange.from} to ${result.actualDateRange.to}`}`,
  );
  console.log(`Draws analyzed: ${result.totalDrawsAnalyzed}`);
  console.log(`Matches: ${result.matchedDrawCount} (${formatRate(result.historicalMatchRate)})`);
  console.log(`Intersection histogram [0..6]: ${result.matchCountHistogram.join(', ')}`);
  console.log(
    `Theoretical probability: ${result.theoreticalProbability.exact.numerator}/`
      + `${result.theoreticalProbability.exact.denominator} `
      + `(${result.theoreticalProbability.decimal})`,
  );
  console.log(`Theoretical mean waiting draws: ${result.theoreticalProbability.theoreticalMeanWaitingDraws}`);
  console.log(
    `Data coverage: ${result.dataCoverage?.coverageStatus ?? 'unknown'}`
      + ` (${result.dataCoverage?.coverageReason ?? 'not provided'})`,
  );
  printGapSummary(result);
  printMatchedDraws(result);
}

async function main() {
  const argumentsResult = parseArguments(process.argv.slice(2));
  if (argumentsResult.help) {
    console.log(HELP);
    return;
  }

  const rawData = await loadData(argumentsResult.dataPath);
  const normalizedData = normalizeMega645Data(rawData);
  const result = analyzeHistory({
    mode: argumentsResult.mode,
    selectedNumbers: argumentsResult.selectedNumbers,
    from: argumentsResult.from,
    to: argumentsResult.to,
  }, normalizedData);

  if (argumentsResult.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanSummary(result);
  }
}

main().catch((error) => {
  if (error instanceof HistoricalDataValidationError) {
    console.error(error.message);
    for (const problem of error.issues) {
      console.error(`- ${problem.path} [${problem.code}]: ${problem.message}`);
    }
  } else {
    console.error(`Error: ${error.message}`);
  }
  process.exitCode = 1;
});
