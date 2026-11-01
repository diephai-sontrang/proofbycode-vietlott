import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  COMBINATION_COUNT,
  combinationFromRank,
  combinationRank,
  createSimulation,
} from '../src/simulation.js';

const TARGET = [1, 2, 3, 4, 5, 6];
const OTHER_TARGET = [40, 41, 42, 43, 44, 45];

const HISTORY_DATA = JSON.parse(
  await readFile(new URL('../data/mega-6-45.json', import.meta.url), 'utf8'),
);

function config(overrides = {}) {
  return {
    target: TARGET,
    setsPerPlayer: 1,
    stopAfterWinners: 1,
    maxPlayers: 1,
    seed: 'test-seed',
    ...overrides,
  };
}

function sequenceSource(values) {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error('Test random source was exhausted');
    }

    return values[index++];
  };
}

function runToCompletion(simulation, batchSize = 10) {
  let snapshot = simulation.getSnapshot();
  while (snapshot.status !== 'completed') {
    snapshot = simulation.advance({ maxCandidateGenerations: batchSize });
  }
  return snapshot;
}

test('rejects invalid configuration and repeated target numbers', () => {
  assert.throws(
    () => createSimulation(config({ target: [1, 1, 2, 3, 4, 5] })),
    /sorted and distinct/,
  );
  assert.throws(
    () => createSimulation(config({ target: [1, 2, 3, 4, 5] })),
    /exactly 6/,
  );
  assert.throws(
    () => createSimulation(config({ setsPerPlayer: COMBINATION_COUNT + 1 })),
    /setsPerPlayer/,
  );
  assert.throws(
    () => createSimulation(config({ setsPerPlayer: 2, maxPlayers: Number.MAX_SAFE_INTEGER })),
    /safe JavaScript Number/,
  );
  assert.throws(
    () => createSimulation(config({ seed: 123 })),
    /explicit string/,
  );
});

test('generated combinations are valid and rank/unrank is consistent', () => {
  for (const rank of [0, 1, 12_345, COMBINATION_COUNT - 1]) {
    const combination = combinationFromRank(rank);
    assert.equal(combination.length, 6);
    assert.equal(new Set(combination).size, 6);
    assert.ok(combination.every((number) => Number.isInteger(number) && number >= 1 && number <= 45));
    assert.ok(combination.every((number, index) => index === 0 || combination[index - 1] < number));
    assert.equal(combinationRank(combination), rank);
  }
});

test('target comparison ignores order', () => {
  const simulation = createSimulation(config({
    target: [6, 5, 4, 3, 2, 1],
    randomUint32: sequenceSource([0]),
  }));

  const snapshot = simulation.advance({ maxCandidateGenerations: 1 });
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.stopReason, 'winners_reached');
  assert.deepEqual(snapshot.winnerEvents, [{
    playerIndex: 1,
    matchedSetIndex: 1,
    totalSetsChecked: 1,
  }]);
});

test('matches every downloaded Mega 6/45 draw fixture', () => {
  assert.equal(HISTORY_DATA.draws.length, 1_582);

  for (const [index, draw] of HISTORY_DATA.draws.entries()) {
    assert.equal(draw.id, String(index + 1).padStart(5, '0'));
    const simulation = createSimulation(config({
      target: [...draw.result].reverse(),
      seed: `fixture-${draw.id}`,
      randomUint32: sequenceSource([combinationRank(draw.result)]),
    }));

    const snapshot = simulation.advance({ maxCandidateGenerations: 1 });
    assert.equal(snapshot.status, 'completed', draw.id);
    assert.equal(snapshot.stopReason, 'winners_reached', draw.id);
    assert.deepEqual(snapshot.winnerEvents, [{
      playerIndex: 1,
      matchedSetIndex: 1,
      totalSetsChecked: 1,
    }], draw.id);
  }
});

test('duplicate combinations are rejected within a player', () => {
  const simulation = createSimulation(config({
    target: OTHER_TARGET,
    setsPerPlayer: 2,
    randomUint32: sequenceSource([0, 0, 1]),
  }));

  const snapshot = runToCompletion(simulation, 3);
  assert.equal(snapshot.stopReason, 'max_players_reached');
  assert.equal(snapshot.candidateGenerations, 3);
  assert.equal(snapshot.totalSetsChecked, 2);
  assert.equal(snapshot.totalSetsPurchased, 2);
});

test('the same combination is allowed across different players', () => {
  const simulation = createSimulation(config({
    target: OTHER_TARGET,
    maxPlayers: 2,
    randomUint32: sequenceSource([0, 0]),
  }));

  const snapshot = runToCompletion(simulation, 2);
  assert.equal(snapshot.stopReason, 'max_players_reached');
  assert.equal(snapshot.playersCompleted, 2);
  assert.equal(snapshot.totalSetsChecked, 2);
  assert.equal(snapshot.candidateGenerations, 2);
});

test('the winning attempt is included in checked counters', () => {
  const simulation = createSimulation(config({
    randomUint32: sequenceSource([0]),
  }));

  const snapshot = simulation.advance({ maxCandidateGenerations: 1 });
  assert.equal(snapshot.totalSetsChecked, 1);
  assert.equal(snapshot.candidateGenerations, 1);
  assert.equal(snapshot.winnerEvents[0].totalSetsChecked, 1);
});

test('supports multiple sets and multiple winning players', () => {
  const simulation = createSimulation(config({
    setsPerPlayer: 2,
    stopAfterWinners: 2,
    maxPlayers: 3,
    randomUint32: sequenceSource([1, 2, 0, 0]),
  }));

  const snapshot = runToCompletion(simulation, 10);
  assert.equal(snapshot.stopReason, 'winners_reached');
  assert.equal(snapshot.winnersCount, 2);
  assert.equal(snapshot.playersStarted, 3);
  assert.equal(snapshot.playersCompleted, 3);
  assert.equal(snapshot.totalSetsPurchased, 6);
  assert.equal(snapshot.totalSetsChecked, 4);
  assert.equal(snapshot.candidateGenerations, 4);
  assert.deepEqual(snapshot.winnerEvents, [
    { playerIndex: 2, matchedSetIndex: 1, totalSetsChecked: 3 },
    { playerIndex: 3, matchedSetIndex: 1, totalSetsChecked: 4 },
  ]);
});

test('winning player skips remaining sets but is charged for all purchased sets', () => {
  const simulation = createSimulation(config({
    setsPerPlayer: 3,
    randomUint32: sequenceSource([0]),
  }));

  const snapshot = simulation.advance({ maxCandidateGenerations: 1 });
  assert.equal(snapshot.totalSetsPurchased, 3);
  assert.equal(snapshot.totalSetsChecked, 1);
  assert.equal(snapshot.candidateGenerations, 1);
  assert.equal(snapshot.playersCompleted, 1);
});

test('stops at maxPlayers when the winner target is not reached', () => {
  const simulation = createSimulation(config({
    target: OTHER_TARGET,
    maxPlayers: 3,
    randomUint32: sequenceSource([0, 1, 2]),
  }));

  const snapshot = runToCompletion(simulation, 3);
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.stopReason, 'max_players_reached');
  assert.equal(snapshot.playersStarted, 3);
  assert.equal(snapshot.playersCompleted, 3);
  assert.equal(snapshot.totalSetsPurchased, 3);
});

test('preserves partial-player state when a batch ends mid-player', () => {
  const simulation = createSimulation(config({
    target: OTHER_TARGET,
    setsPerPlayer: 3,
    randomUint32: sequenceSource([0, 1, 2]),
  }));

  const partial = simulation.advance({ maxCandidateGenerations: 2 });
  assert.equal(partial.status, 'running');
  assert.equal(partial.playersStarted, 1);
  assert.equal(partial.playersCompleted, 0);
  assert.equal(partial.totalSetsPurchased, 0);
  assert.equal(partial.totalSetsChecked, 2);
  assert.deepEqual(partial.currentPlayer, { playerIndex: 1, setsAccepted: 2 });

  const completed = simulation.advance({ maxCandidateGenerations: 1 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentPlayer, null);
  assert.equal(completed.totalSetsPurchased, 3);
});

test('same seed produces the same result across batch sizes', () => {
  const first = createSimulation(config({
    target: OTHER_TARGET,
    setsPerPlayer: 2,
    maxPlayers: 5,
    seed: 'batch-independent',
  }));
  const second = createSimulation(config({
    target: OTHER_TARGET,
    setsPerPlayer: 2,
    maxPlayers: 5,
    seed: 'batch-independent',
  }));

  const firstResult = runToCompletion(first, 1);
  const secondResult = runToCompletion(second, 7);
  assert.deepEqual(firstResult, secondResult);
});

test('completed simulations do not mutate after further advance calls', () => {
  const simulation = createSimulation(config({ randomUint32: sequenceSource([0]) }));
  const completed = simulation.advance({ maxCandidateGenerations: 1 });
  const before = simulation.getSnapshot();

  simulation.advance({ maxCandidateGenerations: 100 });
  const after = simulation.getSnapshot();

  assert.deepEqual(after, before);
  assert.deepEqual(completed, before);
});

test('zero-sized advances are no-ops', () => {
  const simulation = createSimulation(config());
  assert.deepEqual(simulation.advance({ maxCandidateGenerations: 0 }), simulation.getSnapshot());
  assert.equal(simulation.getSnapshot().status, 'ready');
});
