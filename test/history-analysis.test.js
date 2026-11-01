import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  HistoricalDataValidationError,
  normalizeMega645Data,
} from '../src/history-data.js';
import {
  analyzeHistory,
  calculateTheoreticalProbability,
  filterDrawsByNumberRange,
} from '../src/history-analysis.js';

const COMBINATION_COUNT = 8_145_060;

const FIXTURE_RAW = {
  source: 'test-fixture',
  draws: [
    { id: '00001', date: '2020-02-28', result: [1, 2, 3, 4, 5, 7] },
    { id: '00002', date: '2020-03-01', result: [1, 2, 3, 4, 8, 9] },
    { id: '00003', date: '2020-03-04', result: [1, 2, 4, 8, 9, 10] },
    { id: '00004', date: '2020-03-06', result: [1, 2, 3, 10, 11, 12] },
    { id: '00005', date: '2020-03-08', result: [3, 4, 5, 6, 7, 8] },
    { id: '00006', date: '2020-03-10', result: [1, 2, 3, 4, 5, 6] },
  ],
};

const FIXTURE_DATA = normalizeMega645Data(FIXTURE_RAW);

function getValidationError(callback) {
  try {
    callback();
  } catch (error) {
    assert.ok(error instanceof HistoricalDataValidationError);
    return error;
  }

  assert.fail('Expected HistoricalDataValidationError');
}

test('normalizes the actual local dataset without claiming external completeness', async () => {
  const rawData = JSON.parse(
    await readFile(new URL('../data/mega-6-45.json', import.meta.url), 'utf8'),
  );
  const normalized = normalizeMega645Data(rawData);

  assert.equal(normalized.draws.length, 1_582);
  assert.equal(normalized.draws[0].drawId, '00001');
  assert.equal(normalized.draws.at(-1).drawId, '01582');
  assert.deepEqual(normalized.draws[0].numbers, [2, 17, 33, 37, 38, 45]);
  assert.equal(normalized.coverage.idRangeContiguous, true);
  assert.equal(normalized.coverage.coverageStatus, 'unknown');
});

test('contains-selected is order-independent and returns the full histogram', () => {
  const result = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [3, 1, 2],
  }, FIXTURE_DATA);

  assert.deepEqual(result.selectedNumbers, [1, 2, 3]);
  assert.equal(result.totalDrawsAnalyzed, 6);
  assert.equal(result.matchedDrawCount, 4);
  assert.equal(result.historicalMatchRate, 4 / 6);
  assert.deepEqual(result.matchCountHistogram, [0, 1, 1, 4, 0, 0, 0]);
  assert.deepEqual(result.matchedDraws.map((draw) => draw.position), [1, 2, 4, 6]);
});

test('both modes support six selected numbers with explicit mode', () => {
  const contains = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [6, 5, 4, 3, 2, 1],
  }, FIXTURE_DATA);
  const coverage = analyzeHistory({
    mode: 'jackpot-coverage',
    selectedNumbers: [6, 5, 4, 3, 2, 1],
  }, FIXTURE_DATA);

  assert.deepEqual(contains.matchedDraws.map((draw) => draw.drawId), ['00006']);
  assert.deepEqual(coverage.matchedDraws.map((draw) => draw.drawId), ['00006']);
  assert.equal(contains.theoreticalProbability.exact.numerator, 1);
  assert.equal(coverage.theoreticalProbability.exact.numerator, 1);
});

test('jackpot-coverage uses selected-set membership without enumerating combinations', () => {
  const result = analyzeHistory({
    mode: 'jackpot-coverage',
    selectedNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
  }, FIXTURE_DATA);

  assert.equal(result.matchedDrawCount, 3);
  assert.deepEqual(result.matchedDraws.map((draw) => draw.drawId), ['00001', '00005', '00006']);
  assert.equal(result.theoreticalProbability.exact.numerator, 28);
  assert.equal(result.theoreticalProbability.exact.denominator, COMBINATION_COUNT);
});

test('filters draws whose six numbers all fit an inclusive numeric range', () => {
  const result = filterDrawsByNumberRange(FIXTURE_DATA, { from: 2, to: 8 });

  assert.equal(result.totalDrawsAnalyzed, 6);
  assert.equal(result.matchedDrawCount, 1);
  assert.deepEqual(result.matchedDraws, [{
    drawId: '00005',
    drawDate: '2020-03-08',
    winningNumbers: [3, 4, 5, 6, 7, 8],
    position: 5,
  }]);
});

test('validates numeric filter range bounds', () => {
  assert.throws(
    () => filterDrawsByNumberRange(FIXTURE_DATA, { from: 0, to: 8 }),
    /bounds.*\[1, 45\]/,
  );
  assert.throws(
    () => filterDrawsByNumberRange(FIXTURE_DATA, { from: 8, to: 46 }),
    /bounds.*\[1, 45\]/,
  );
  assert.throws(
    () => filterDrawsByNumberRange(FIXTURE_DATA, { from: 9, to: 8 }),
    /on or before/,
  );
});

test('inclusive date filtering and leap-day calendar gaps are correct', () => {
  const result = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [1, 2, 3],
    from: '2020-03-01',
    to: '2020-03-06',
  }, FIXTURE_DATA);

  assert.deepEqual(result.requestedDateRange, { from: '2020-03-01', to: '2020-03-06' });
  assert.deepEqual(result.actualDateRange, { from: '2020-03-01', to: '2020-03-06' });
  assert.equal(result.totalDrawsAnalyzed, 3);
  assert.deepEqual(result.matchCountHistogram, [0, 0, 1, 2, 0, 0, 0]);
  assert.deepEqual(result.waitingGaps.completedGaps, [{
    fromPosition: 1,
    toPosition: 3,
    drawTransitionsBetween: 2,
    nonmatchingDrawsBetween: 1,
    elapsedCalendarDays: 5,
  }]);
});

test('reports adjacent matches, leading/trailing spans, and completed gap statistics', () => {
  const result = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [1, 2, 3],
  }, FIXTURE_DATA);

  assert.deepEqual(result.waitingGaps.beforeFirstMatch, {
    nonmatchingDraws: 0,
    calendarDays: 0,
    observationWindowBoundary: 'start',
  });
  assert.deepEqual(result.waitingGaps.afterLastMatch, {
    nonmatchingDraws: 0,
    calendarDays: 0,
    observationWindowBoundary: 'end',
  });
  assert.deepEqual(result.waitingGaps.completedGaps[0], {
    fromPosition: 1,
    toPosition: 2,
    drawTransitionsBetween: 1,
    nonmatchingDrawsBetween: 0,
    elapsedCalendarDays: 2,
  });
  assert.deepEqual(result.waitingGaps.completedGapStatistics, {
    count: 3,
    averageDrawTransitionsBetween: 5 / 3,
    averageNonmatchingDrawsBetween: 2 / 3,
    averageElapsedCalendarDays: 11 / 3,
  });
});

test('reports no-match and one-match windows without inventing completed gaps', () => {
  const noMatch = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [45],
  }, FIXTURE_DATA);
  const oneMatch = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [1, 2, 3, 4, 5, 6],
  }, FIXTURE_DATA);

  assert.equal(noMatch.matchedDrawCount, 0);
  assert.equal(noMatch.historicalMatchRate, 0);
  assert.deepEqual(noMatch.waitingGaps.noMatchWindow, {
    nonmatchingDraws: 6,
    calendarDays: 11,
    observationWindowBoundary: 'entire-analyzed-window',
  });
  assert.equal(noMatch.waitingGaps.completedGapStatistics, null);
  assert.equal(oneMatch.matchedDrawCount, 1);
  assert.equal(oneMatch.waitingGaps.completedGapStatistics, null);
  assert.equal(oneMatch.waitingGaps.beforeFirstMatch.nonmatchingDraws, 5);
  assert.equal(oneMatch.waitingGaps.afterLastMatch.nonmatchingDraws, 0);
});

test('returns null rates and actual dates for an empty date range', () => {
  const result = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [1],
    from: '2030-01-01',
    to: '2030-01-31',
  }, FIXTURE_DATA);

  assert.equal(result.totalDrawsAnalyzed, 0);
  assert.equal(result.matchedDrawCount, 0);
  assert.equal(result.historicalMatchRate, null);
  assert.equal(result.actualDateRange, null);
  assert.deepEqual(result.matchCountHistogram, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(result.waitingGaps.noMatchWindow, null);
});

test('validates selected numbers, mode and date ranges', () => {
  assert.throws(
    () => analyzeHistory({ mode: 'contains-selected', selectedNumbers: [1, 1] }, FIXTURE_DATA),
    /distinct/,
  );
  assert.throws(
    () => analyzeHistory({ mode: 'contains-selected', selectedNumbers: [0] }, FIXTURE_DATA),
    /\[1, 45\]/,
  );
  assert.throws(
    () => analyzeHistory({ mode: 'contains-selected', selectedNumbers: [] }, FIXTURE_DATA),
    /requires between 1 and 45/,
  );
  assert.throws(
    () => analyzeHistory({ mode: 'jackpot-coverage', selectedNumbers: [1, 2, 3, 4, 5] }, FIXTURE_DATA),
    /requires between 6 and 45/,
  );
  assert.throws(
    () => analyzeHistory({ mode: 'contains-selected', selectedNumbers: [1], from: '2020-02-30' }, FIXTURE_DATA),
    /Invalid calendar date/,
  );
  assert.throws(
    () => analyzeHistory({ mode: 'contains-selected', selectedNumbers: [1], from: '2021-01-02', to: '2021-01-01' }, FIXTURE_DATA),
    /on or before/,
  );
});

test('rejects malformed, duplicate and chronologically conflicting records', () => {
  const malformed = getValidationError(() => normalizeMega645Data({
    draws: [{ id: '00001', date: '2020-02-30', result: [1, 1, 2, 3, 4, 5] }],
  }));
  assert.deepEqual(
    new Set(malformed.issues.map((problem) => problem.code)),
    new Set(['invalid_date', 'duplicate_numbers']),
  );

  const duplicate = getValidationError(() => normalizeMega645Data({
    draws: [
      { id: '00001', date: '2020-01-01', result: [1, 2, 3, 4, 5, 6] },
      { id: '00001', date: '2020-01-02', result: [1, 2, 3, 4, 5, 7] },
    ],
  }));
  assert.ok(duplicate.issues.some((problem) => problem.code === 'duplicate_draw_id'));
  assert.ok(duplicate.issues.some((problem) => problem.code === 'conflicting_draw_id'));

  const chronology = getValidationError(() => normalizeMega645Data({
    draws: [
      { id: '00002', date: '2020-01-01', result: [1, 2, 3, 4, 5, 6] },
      { id: '00001', date: '2020-01-02', result: [1, 2, 3, 4, 5, 7] },
    ],
  }));
  assert.ok(chronology.issues.some((problem) => problem.code === 'chronology_conflict'));
});

test('probability formulas return exact counts for both modes', () => {
  const containsOne = analyzeHistory({ mode: 'contains-selected', selectedNumbers: [1] }, FIXTURE_DATA);
  const containsSix = analyzeHistory({
    mode: 'contains-selected',
    selectedNumbers: [1, 2, 3, 4, 5, 6],
  }, FIXTURE_DATA);
  const coverageEight = analyzeHistory({
    mode: 'jackpot-coverage',
    selectedNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
  }, FIXTURE_DATA);
  const coverageAll = analyzeHistory({
    mode: 'jackpot-coverage',
    selectedNumbers: Array.from({ length: 45 }, (_, index) => index + 1),
  }, FIXTURE_DATA);

  assert.equal(containsOne.theoreticalProbability.decimal, 6 / 45);
  assert.equal(containsSix.theoreticalProbability.exact.numerator, 1);
  assert.equal(containsSix.theoreticalProbability.exact.denominator, COMBINATION_COUNT);
  assert.equal(coverageEight.theoreticalProbability.exact.numerator, 28);
  assert.equal(coverageAll.theoreticalProbability.exact.numerator, COMBINATION_COUNT);
  assert.equal(coverageAll.theoreticalProbability.decimal, 1);
  assert.equal(coverageAll.theoreticalProbability.theoreticalMeanWaitingDraws, 1);
  assert.equal(coverageAll.matchedDrawCount, FIXTURE_DATA.draws.length);
});

test('shared theoretical probability utility supports simulation targets', () => {
  const threeNumbers = calculateTheoreticalProbability('contains-selected', 3);
  const sixNumbers = calculateTheoreticalProbability('contains-selected', 6);

  assert.equal(threeNumbers.exact.numerator, 11_480);
  assert.equal(threeNumbers.exact.denominator, COMBINATION_COUNT);
  assert.equal(sixNumbers.exact.numerator, 1);
  assert.equal(sixNumbers.theoreticalMeanWaitingDraws, COMBINATION_COUNT);
});

test('rejects explicit non-Mega product markers', () => {
  const error = getValidationError(() => normalizeMega645Data({
    product: 'power-6-55',
    draws: [],
  }));

  assert.ok(error.issues.some((problem) => problem.code === 'unsupported_product'));
});
