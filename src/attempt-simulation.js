import {
  COMBINATION_SIZE,
  SIMULATION_ENGINE_VERSION,
  createCombinationSampler,
  createSeededUint32Source,
} from './simulation.js';

const MAX_NUMBER = 45;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export const BASE_TICKET_PRICE_VND = 10_000;

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

export function calculateCoverageCost(selectedCount) {
  if (!Number.isSafeInteger(selectedCount) || selectedCount < 2 || selectedCount > COMBINATION_SIZE) {
    throw new RangeError('selectedCount must be an integer in [2, 6]');
  }

  const coveredSetsPerAttempt = choose(MAX_NUMBER - selectedCount, COMBINATION_SIZE - selectedCount);
  return {
    selectedCount,
    coveredSetsPerAttempt,
    costPerAttemptVnd: coveredSetsPerAttempt * BASE_TICKET_PRICE_VND,
  };
}

function assertTarget(target) {
  if (!Array.isArray(target) || target.length < 2 || target.length > COMBINATION_SIZE) {
    throw new RangeError('target must contain between 2 and 6 numbers');
  }

  const normalizedTarget = [...target].sort((left, right) => left - right);
  if (normalizedTarget.some((number) => (
    !Number.isSafeInteger(number) || number < 1 || number > MAX_NUMBER
  ))) {
    throw new RangeError('target must contain distinct integers in [1, 45]');
  }

  if (new Set(normalizedTarget).size !== normalizedTarget.length) {
    throw new RangeError('target must contain distinct integers');
  }

  return normalizedTarget;
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('attempt simulation config must be an object');
  }

  const target = assertTarget(config.target);
  if (typeof config.seed !== 'string') {
    throw new TypeError('seed must be an explicit string');
  }

  if (config.randomUint32 !== undefined && typeof config.randomUint32 !== 'function') {
    throw new TypeError('randomUint32 must be a function when provided');
  }

  return {
    target,
    seed: config.seed,
    randomUint32: config.randomUint32,
  };
}

function validateAdvanceOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('advance options must be an object');
  }

  if (!Number.isSafeInteger(options.maxCandidateGenerations) || options.maxCandidateGenerations < 0) {
    throw new RangeError('maxCandidateGenerations must be a non-negative safe integer');
  }

  return options.maxCandidateGenerations;
}

export function createAttemptSimulation(config) {
  const normalizedConfig = validateConfig(config);
  const nextUint32 = normalizedConfig.randomUint32
    ?? createSeededUint32Source(normalizedConfig.seed);
  const sampleCombination = createCombinationSampler(nextUint32);
  let status = 'ready';
  let attempts = 0;
  let matchedCombination = null;
  let error = null;

  function getSnapshot() {
    return {
      status,
      attempts,
      target: [...normalizedConfig.target],
      seed: normalizedConfig.seed,
      matchedCombination: matchedCombination === null ? null : [...matchedCombination],
      engineVersion: SIMULATION_ENGINE_VERSION,
      error,
    };
  }

  function fail(message) {
    status = 'error';
    error = message;
    return getSnapshot();
  }

  function advance(options) {
    const maxCandidateGenerations = validateAdvanceOptions(options);

    if (status === 'matched' || status === 'stopped' || status === 'error') {
      return getSnapshot();
    }

    if (status === 'paused' || maxCandidateGenerations === 0) {
      return getSnapshot();
    }

    status = 'running';
    for (let index = 0; index < maxCandidateGenerations; index += 1) {
      if (attempts >= MAX_SAFE_INTEGER) {
        return fail('attempt counter exceeded the safe JavaScript Number range');
      }

      const combination = sampleCombination();
      attempts += 1;

      const combinationSet = new Set(combination);
      if (normalizedConfig.target.every((number) => combinationSet.has(number))) {
        matchedCombination = combination;
        status = 'matched';
        break;
      }
    }

    return getSnapshot();
  }

  function pause() {
    if (status === 'running') {
      status = 'paused';
    }
    return getSnapshot();
  }

  function resume() {
    if (status === 'paused') {
      status = 'running';
    }
    return getSnapshot();
  }

  function stop() {
    if (status === 'ready' || status === 'running' || status === 'paused') {
      status = 'stopped';
    }
    return getSnapshot();
  }

  return {
    advance,
    pause,
    resume,
    stop,
    getSnapshot,
  };
}
