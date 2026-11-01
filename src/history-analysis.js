import { COMBINATION_COUNT } from './simulation.js';
import { dateOnlyToDayIndex } from './history-data.js';

const MAX_NUMBER = 45;
const COMBINATION_SIZE = 6;
const MODES = new Set(['contains-selected', 'jackpot-coverage']);

function choose(n, k) {
  if (k < 0 || k > n) {
    return 0;
  }

  const reducedK = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= reducedK; index += 1) {
    result = (result * (n - reducedK + index)) / index;
  }
  return result;
}

function validateSelectedNumbers(mode, selectedNumbers) {
  if (!MODES.has(mode)) {
    throw new TypeError('mode must be contains-selected or jackpot-coverage');
  }

  if (!Array.isArray(selectedNumbers)) {
    throw new TypeError('selectedNumbers must be an array');
  }

  const minimum = mode === 'contains-selected' ? 1 : COMBINATION_SIZE;
  if (selectedNumbers.length < minimum || selectedNumbers.length > MAX_NUMBER) {
    throw new RangeError(
      `${mode} requires between ${minimum} and ${MAX_NUMBER} selected numbers`,
    );
  }

  if (selectedNumbers.some((number) => !Number.isSafeInteger(number) || number < 1 || number > MAX_NUMBER)) {
    throw new RangeError('selectedNumbers must contain distinct integers in [1, 45]');
  }

  const sortedNumbers = [...selectedNumbers].sort((left, right) => left - right);
  if (new Set(sortedNumbers).size !== sortedNumbers.length) {
    throw new RangeError('selectedNumbers must contain distinct integers');
  }

  return sortedNumbers;
}

function normalizeDateOption(value, name) {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    dateOnlyToDayIndex(value);
  } catch (error) {
    throw new RangeError(`${name}: ${error.message}`);
  }

  return value;
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('analysis config must be an object');
  }

  const { mode, selectedNumbers } = config;
  const sortedNumbers = validateSelectedNumbers(mode, selectedNumbers);
  const from = normalizeDateOption(config.from, 'from');
  const to = normalizeDateOption(config.to, 'to');

  if (from !== null && to !== null && from > to) {
    throw new RangeError('from must be on or before to');
  }

  return { mode, selectedNumbers: sortedNumbers, from, to };
}

function validateNormalizedData(normalizedData) {
  if (normalizedData === null || typeof normalizedData !== 'object' || !Array.isArray(normalizedData.draws)) {
    throw new TypeError('normalizedData must contain a draws array');
  }
}

function validateNumberRange(range) {
  if (range === null || typeof range !== 'object' || Array.isArray(range)) {
    throw new TypeError('number range must be an object with from and to');
  }

  const { from, to } = range;
  if (
    !Number.isSafeInteger(from)
      || !Number.isSafeInteger(to)
      || from < 1
      || from > MAX_NUMBER
      || to < 1
      || to > MAX_NUMBER
  ) {
    throw new RangeError('number range bounds must be integers in [1, 45]');
  }
  if (from > to) {
    throw new RangeError('number range from must be on or before to');
  }

  return { from, to };
}

function copyCoverage(coverage) {
  if (coverage === null || typeof coverage !== 'object') {
    return null;
  }

  return {
    ...coverage,
    idRange: coverage.idRange === null ? null : { ...coverage.idRange },
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateTheoreticalProbability(mode, selectedCount) {
  const numerator = mode === 'contains-selected'
    ? choose(MAX_NUMBER - selectedCount, COMBINATION_SIZE - selectedCount)
    : choose(selectedCount, COMBINATION_SIZE);

  return {
    exact: {
      numerator,
      denominator: COMBINATION_COUNT,
    },
    decimal: numerator / COMBINATION_COUNT,
    theoreticalMeanWaitingDraws: COMBINATION_COUNT / numerator,
  };
}

function buildGapReport(draws, matchedDraws) {
  if (draws.length === 0) {
    return {
      completedGaps: [],
      completedGapStatistics: null,
      beforeFirstMatch: null,
      afterLastMatch: null,
      noMatchWindow: null,
    };
  }

  if (matchedDraws.length === 0) {
    const firstDayIndex = dateOnlyToDayIndex(draws[0].drawDate);
    const lastDayIndex = dateOnlyToDayIndex(draws.at(-1).drawDate);

    return {
      completedGaps: [],
      completedGapStatistics: null,
      beforeFirstMatch: null,
      afterLastMatch: null,
      noMatchWindow: {
        nonmatchingDraws: draws.length,
        calendarDays: lastDayIndex - firstDayIndex,
        observationWindowBoundary: 'entire-analyzed-window',
      },
    };
  }

  const completedGaps = [];
  for (let index = 1; index < matchedDraws.length; index += 1) {
    const previous = matchedDraws[index - 1];
    const current = matchedDraws[index];
    const drawTransitionsBetween = current.position - previous.position;

    completedGaps.push({
      fromPosition: previous.position,
      toPosition: current.position,
      drawTransitionsBetween,
      nonmatchingDrawsBetween: drawTransitionsBetween - 1,
      elapsedCalendarDays: current.dayIndex - previous.dayIndex,
    });
  }

  const firstMatch = matchedDraws[0];
  const lastMatch = matchedDraws.at(-1);
  const firstDayIndex = dateOnlyToDayIndex(draws[0].drawDate);
  const lastDayIndex = dateOnlyToDayIndex(draws.at(-1).drawDate);
  const completedGapStatistics = completedGaps.length === 0
    ? null
    : {
        count: completedGaps.length,
        averageDrawTransitionsBetween: average(completedGaps.map((gap) => gap.drawTransitionsBetween)),
        averageNonmatchingDrawsBetween: average(completedGaps.map((gap) => gap.nonmatchingDrawsBetween)),
        averageElapsedCalendarDays: average(completedGaps.map((gap) => gap.elapsedCalendarDays)),
      };

  return {
    completedGaps,
    completedGapStatistics,
    beforeFirstMatch: {
      nonmatchingDraws: firstMatch.position - 1,
      calendarDays: firstMatch.dayIndex - firstDayIndex,
      observationWindowBoundary: 'start',
    },
    afterLastMatch: {
      nonmatchingDraws: draws.length - lastMatch.position,
      calendarDays: lastDayIndex - lastMatch.dayIndex,
      observationWindowBoundary: 'end',
    },
    noMatchWindow: null,
  };
}

/**
 * Return historical draws whose complete six-number result is within [from, to].
 * The range is numeric and inclusive; it is independent of the date range used
 * by analyzeHistory().
 */
export function filterDrawsByNumberRange(normalizedData, range) {
  validateNormalizedData(normalizedData);
  const { from, to } = validateNumberRange(range);
  const matchedDraws = normalizedData.draws
    .map((draw, index) => ({ draw, position: index + 1 }))
    .filter(({ draw }) => draw.numbers.every((number) => number >= from && number <= to))
    .map(({ draw, position }) => ({
      drawId: draw.drawId,
      drawDate: draw.drawDate,
      winningNumbers: [...draw.numbers],
      position,
    }));

  return {
    from,
    to,
    totalDrawsAnalyzed: normalizedData.draws.length,
    matchedDrawCount: matchedDraws.length,
    matchedDraws,
  };
}

export function analyzeHistory(config, normalizedData) {
  validateNormalizedData(normalizedData);
  const validatedConfig = validateConfig(config);
  const fromDayIndex = validatedConfig.from === null ? null : dateOnlyToDayIndex(validatedConfig.from);
  const toDayIndex = validatedConfig.to === null ? null : dateOnlyToDayIndex(validatedConfig.to);
  const selectedSet = new Set(validatedConfig.selectedNumbers);

  const analyzedDraws = normalizedData.draws.filter((draw) => (
    (fromDayIndex === null || draw.drawDate >= validatedConfig.from)
      && (toDayIndex === null || draw.drawDate <= validatedConfig.to)
  ));

  const matchCountHistogram = Array.from({ length: COMBINATION_SIZE + 1 }, () => 0);
  const matchedDraws = [];

  analyzedDraws.forEach((draw, index) => {
    const intersectionCount = draw.numbers.reduce(
      (count, number) => count + (selectedSet.has(number) ? 1 : 0),
      0,
    );
    matchCountHistogram[intersectionCount] += 1;

    const isMatch = validatedConfig.mode === 'contains-selected'
      ? intersectionCount === validatedConfig.selectedNumbers.length
      : intersectionCount === COMBINATION_SIZE;

    if (isMatch) {
      matchedDraws.push({
        drawId: draw.drawId,
        drawDate: draw.drawDate,
        winningNumbers: [...draw.numbers],
        intersectionCount,
        position: index + 1,
        dayIndex: dateOnlyToDayIndex(draw.drawDate),
      });
    }
  });

  const hasDraws = analyzedDraws.length > 0;
  const publicMatchedDraws = matchedDraws.map(({ dayIndex, ...draw }) => draw);

  return {
    mode: validatedConfig.mode,
    selectedNumbers: validatedConfig.selectedNumbers,
    selectedCount: validatedConfig.selectedNumbers.length,
    requestedDateRange: {
      from: validatedConfig.from,
      to: validatedConfig.to,
    },
    actualDateRange: hasDraws
      ? { from: analyzedDraws[0].drawDate, to: analyzedDraws.at(-1).drawDate }
      : null,
    totalDrawsAnalyzed: analyzedDraws.length,
    matchedDrawCount: matchedDraws.length,
    historicalMatchRate: hasDraws ? matchedDraws.length / analyzedDraws.length : null,
    matchCountHistogram,
    matchedDraws: publicMatchedDraws,
    waitingGaps: buildGapReport(analyzedDraws, matchedDraws),
    theoreticalProbability: calculateTheoreticalProbability(
      validatedConfig.mode,
      validatedConfig.selectedNumbers.length,
    ),
    dataCoverage: copyCoverage(normalizedData.coverage),
  };
}
