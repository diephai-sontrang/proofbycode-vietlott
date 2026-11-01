import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMBINATION_COUNT,
  combinationRank,
} from '../src/simulation.js';
import {
  BASE_TICKET_PRICE_VND,
  calculateCoverageCost,
  createAttemptSimulation,
} from '../src/attempt-simulation.js';

const JACKPOT = [1, 2, 3, 4, 5, 6];
const OTHER_TARGET = [40, 41, 42, 43, 44, 45];

function sequenceSource(values) {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error('Test random source was exhausted');
    }

    return values[index++];
  };
}

function runToCompletion(simulation, batchSize) {
  let snapshot = simulation.getSnapshot();
  while (snapshot.status !== 'matched' && snapshot.status !== 'stopped' && snapshot.status !== 'error') {
    snapshot = simulation.advance({ maxCandidateGenerations: batchSize });
  }
  return snapshot;
}

test('validates subset targets and explicit seed', () => {
  assert.throws(
    () => createAttemptSimulation({ target: [1], seed: 'test' }),
    /between 2 and 6/,
  );
  assert.throws(
    () => createAttemptSimulation({ target: [1, 1, 2], seed: 'test' }),
    /distinct/,
  );
  assert.throws(
    () => createAttemptSimulation({ target: [1, 2, 3], seed: 123 }),
    /explicit string/,
  );
});

test('matches targets with 2, 3, 4, 5 and 6 selected numbers', () => {
  for (const target of [
    [2, 1],
    [6, 5, 4],
    [4, 3, 2, 1],
    [5, 4, 3, 2, 1],
    [...JACKPOT].reverse(),
  ]) {
    const simulation = createAttemptSimulation({
      target,
      seed: 'test',
      randomUint32: sequenceSource([0]),
    });
    const snapshot = simulation.advance({ maxCandidateGenerations: 1 });

    assert.equal(snapshot.status, 'matched');
    assert.equal(snapshot.attempts, 1);
    assert.deepEqual(snapshot.matchedCombination, JACKPOT);
  }
});

test('calculates mathematical coverage costs for 2 through 6 selected numbers', () => {
  assert.deepEqual(
    [2, 3, 4, 5, 6].map((selectedCount) => calculateCoverageCost(selectedCount)),
    [
      { selectedCount: 2, coveredSetsPerAttempt: 123_410, costPerAttemptVnd: 1_234_100_000 },
      { selectedCount: 3, coveredSetsPerAttempt: 11_480, costPerAttemptVnd: 114_800_000 },
      { selectedCount: 4, coveredSetsPerAttempt: 820, costPerAttemptVnd: 8_200_000 },
      { selectedCount: 5, coveredSetsPerAttempt: 40, costPerAttemptVnd: 400_000 },
      { selectedCount: 6, coveredSetsPerAttempt: 1, costPerAttemptVnd: BASE_TICKET_PRICE_VND },
    ],
  );
  assert.throws(() => calculateCoverageCost(1), /\[2, 6\]/);
});

test('includes the winning attempt and returns a complete generated combination', () => {
  const winningRank = combinationRank(OTHER_TARGET);
  const simulation = createAttemptSimulation({
    target: OTHER_TARGET,
    seed: 'test',
    randomUint32: sequenceSource([0, winningRank]),
  });

  const snapshot = simulation.advance({ maxCandidateGenerations: 2 });
  assert.equal(snapshot.status, 'matched');
  assert.equal(snapshot.attempts, 2);
  assert.deepEqual(snapshot.matchedCombination, OTHER_TARGET);
});

test('estimated cost includes the matching attempt and stays exact as a bigint', () => {
  const simulation = createAttemptSimulation({
    target: [1, 2],
    seed: 'test',
    randomUint32: sequenceSource([0]),
  });

  const snapshot = simulation.advance({ maxCandidateGenerations: 1 });
  const pricing = calculateCoverageCost(snapshot.target.length);

  assert.equal(snapshot.status, 'matched');
  assert.equal(
    BigInt(snapshot.attempts) * BigInt(pricing.costPerAttemptVnd),
    1_234_100_000n,
  );
});

test('allows repeated combinations across attempts', () => {
  const simulation = createAttemptSimulation({
    target: OTHER_TARGET,
    seed: 'test',
    randomUint32: sequenceSource([0, 0, combinationRank(OTHER_TARGET)]),
  });

  const snapshot = simulation.advance({ maxCandidateGenerations: 3 });
  assert.equal(snapshot.status, 'matched');
  assert.equal(snapshot.attempts, 3);
});

test('pause, resume and stop preserve exact progress', () => {
  const simulation = createAttemptSimulation({
    target: OTHER_TARGET,
    seed: 'test',
    randomUint32: sequenceSource([0, 1, 2]),
  });

  assert.equal(simulation.advance({ maxCandidateGenerations: 1 }).attempts, 1);
  assert.equal(simulation.pause().status, 'paused');
  assert.equal(simulation.advance({ maxCandidateGenerations: 10 }).attempts, 1);
  assert.equal(simulation.resume().status, 'running');
  assert.equal(simulation.stop().status, 'stopped');
  assert.equal(simulation.advance({ maxCandidateGenerations: 10 }).attempts, 1);
});

test('same seed is independent of processing batch size', () => {
  const first = createAttemptSimulation({ target: [1, 2, 3], seed: 'batch-independent' });
  const second = createAttemptSimulation({ target: [1, 2, 3], seed: 'batch-independent' });

  assert.deepEqual(
    runToCompletion(first, 1),
    runToCompletion(second, 7),
  );
});

test('zero-sized advances are no-ops and theoretical inputs stay bounded', () => {
  const simulation = createAttemptSimulation({
    target: [1, 2, 3],
    seed: 'test',
    randomUint32: sequenceSource([0]),
  });

  assert.equal(simulation.advance({ maxCandidateGenerations: 0 }).status, 'ready');
  assert.equal(COMBINATION_COUNT, 8_145_060);
});
