const MAX_NUMBER = 45;
export const COMBINATION_SIZE = 6;
const UINT32_RANGE = 0x1_0000_0000;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const COMBINATION_COUNT = 8_145_060;
export const SIMULATION_ENGINE_VERSION = '1.0.0';

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

function assertValidCombination(combination) {
  if (!Array.isArray(combination) || combination.length !== COMBINATION_SIZE) {
    throw new TypeError(`A combination must contain exactly ${COMBINATION_SIZE} numbers`);
  }

  for (let index = 0; index < combination.length; index += 1) {
    const number = combination[index];
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_NUMBER) {
      throw new RangeError('Combination numbers must be distinct integers in [1, 45]');
    }

    if (index > 0 && combination[index - 1] >= number) {
      throw new RangeError('Combination numbers must be sorted and distinct');
    }
  }
}

export function combinationFromRank(rank) {
  if (!Number.isSafeInteger(rank) || rank < 0 || rank >= COMBINATION_COUNT) {
    throw new RangeError(`Combination rank must be an integer in [0, ${COMBINATION_COUNT - 1}]`);
  }

  const combination = [];
  let remainingRank = rank;
  let nextNumber = 1;

  for (let position = 0; position < COMBINATION_SIZE; position += 1) {
    const numbersRemaining = COMBINATION_SIZE - position - 1;
    const largestCandidate = MAX_NUMBER - numbersRemaining;

    for (let candidate = nextNumber; candidate <= largestCandidate; candidate += 1) {
      const combinationsWithCandidate = choose(MAX_NUMBER - candidate, numbersRemaining);

      if (remainingRank < combinationsWithCandidate) {
        combination.push(candidate);
        nextNumber = candidate + 1;
        break;
      }

      remainingRank -= combinationsWithCandidate;
    }
  }

  return combination;
}

export function combinationRank(combination) {
  assertValidCombination(combination);

  let rank = 0;
  let previousNumber = 0;

  for (let position = 0; position < COMBINATION_SIZE; position += 1) {
    const currentNumber = combination[position];
    const numbersRemaining = COMBINATION_SIZE - position - 1;

    for (let candidate = previousNumber + 1; candidate < currentNumber; candidate += 1) {
      rank += choose(MAX_NUMBER - candidate, numbersRemaining);
    }

    previousNumber = currentNumber;
  }

  return rank;
}

function hashSeed(seed) {
  const bytes = new TextEncoder().encode(seed);
  let hash = 2_166_136_261;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function createSeededUint32Source(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

export function createBoundedSampler(nextUint32) {
  return (bound) => {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
      throw new RangeError('bounded sampler bound must be a positive safe integer within uint32 range');
    }

    const limit = UINT32_RANGE - (UINT32_RANGE % bound);

    while (true) {
      const value = nextUint32();
      if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
        throw new RangeError('randomUint32 must return an unsigned 32-bit integer');
      }

      if (value < limit) {
        return value % bound;
      }
    }
  };
}

export function createCombinationSampler(nextUint32) {
  const sampleRank = createBoundedSampler(nextUint32);
  return () => combinationFromRank(sampleRank(COMBINATION_COUNT));
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Simulation config must be an object');
  }

  const { target, setsPerPlayer, stopAfterWinners, maxPlayers, seed, randomUint32 } = config;

  if (!Array.isArray(target) || target.length !== COMBINATION_SIZE) {
    throw new TypeError(`target must contain exactly ${COMBINATION_SIZE} numbers`);
  }

  const normalizedTarget = [...target].sort((left, right) => left - right);
  assertValidCombination(normalizedTarget);

  if (!Number.isSafeInteger(setsPerPlayer) || setsPerPlayer < 1 || setsPerPlayer > COMBINATION_COUNT) {
    throw new RangeError(`setsPerPlayer must be an integer in [1, ${COMBINATION_COUNT}]`);
  }

  if (!Number.isSafeInteger(stopAfterWinners) || stopAfterWinners < 1) {
    throw new RangeError('stopAfterWinners must be a positive safe integer');
  }

  if (!Number.isSafeInteger(maxPlayers) || maxPlayers < 1) {
    throw new RangeError('maxPlayers must be a positive safe integer');
  }

  if (typeof seed !== 'string') {
    throw new TypeError('seed must be an explicit string');
  }

  if (randomUint32 !== undefined && typeof randomUint32 !== 'function') {
    throw new TypeError('randomUint32 must be a function when provided');
  }

  const maximumPurchasedSets = setsPerPlayer * maxPlayers;
  if (!Number.isSafeInteger(maximumPurchasedSets)) {
    throw new RangeError('setsPerPlayer * maxPlayers must be representable as a safe JavaScript Number');
  }

  return {
    target: normalizedTarget,
    targetRank: combinationRank(normalizedTarget),
    setsPerPlayer,
    stopAfterWinners,
    maxPlayers,
    seed,
    randomUint32,
  };
}

function validateAdvanceOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('advance options must be an object');
  }

  const { maxCandidateGenerations } = options;
  if (!Number.isSafeInteger(maxCandidateGenerations) || maxCandidateGenerations < 0) {
    throw new RangeError('maxCandidateGenerations must be a non-negative safe integer');
  }

  return maxCandidateGenerations;
}

export function createSimulation(config) {
  const normalizedConfig = validateConfig(config);
  const nextUint32 = normalizedConfig.randomUint32 ?? createSeededUint32Source(normalizedConfig.seed);
  const sampleRank = createBoundedSampler(nextUint32);

  let status = 'ready';
  let stopReason = null;
  let playersStarted = 0;
  let playersCompleted = 0;
  let totalSetsPurchased = 0;
  let totalSetsChecked = 0;
  let candidateGenerations = 0;
  let winnersCount = 0;
  let winnerEvents = [];
  let currentPlayer = null;

  function incrementCandidateGenerations() {
    if (candidateGenerations >= MAX_SAFE_INTEGER) {
      throw new RangeError('candidateGenerations exceeded the safe JavaScript Number range');
    }

    candidateGenerations += 1;
  }

  function finish(reason) {
    status = 'completed';
    stopReason = reason;
    currentPlayer = null;
  }

  function startPlayer() {
    playersStarted += 1;
    currentPlayer = {
      playerIndex: playersStarted,
      sets: new Set(),
    };
  }

  function completeNonWinningPlayer() {
    playersCompleted += 1;
    totalSetsPurchased += normalizedConfig.setsPerPlayer;
    currentPlayer = null;

    if (playersCompleted >= normalizedConfig.maxPlayers) {
      finish('max_players_reached');
    }
  }

  function completeWinningPlayer() {
    winnersCount += 1;
    playersCompleted += 1;
    totalSetsPurchased += normalizedConfig.setsPerPlayer;

    winnerEvents.push({
      playerIndex: currentPlayer.playerIndex,
      matchedSetIndex: currentPlayer.sets.size,
      totalSetsChecked,
    });

    currentPlayer = null;

    if (winnersCount >= normalizedConfig.stopAfterWinners) {
      finish('winners_reached');
    } else if (playersCompleted >= normalizedConfig.maxPlayers) {
      finish('max_players_reached');
    }
  }

  function advance(options) {
    const maxCandidateGenerations = validateAdvanceOptions(options);

    if (status === 'completed' || maxCandidateGenerations === 0) {
      return getSnapshot();
    }

    status = 'running';
    let remaining = maxCandidateGenerations;

    while (remaining > 0 && status !== 'completed') {
      if (currentPlayer === null) {
        startPlayer();
      }

      const candidateRank = sampleRank(COMBINATION_COUNT);
      incrementCandidateGenerations();
      remaining -= 1;

      if (currentPlayer.sets.has(candidateRank)) {
        continue;
      }

      currentPlayer.sets.add(candidateRank);
      totalSetsChecked += 1;

      if (candidateRank === normalizedConfig.targetRank) {
        completeWinningPlayer();
        continue;
      }

      if (currentPlayer.sets.size >= normalizedConfig.setsPerPlayer) {
        completeNonWinningPlayer();
      }
    }

    return getSnapshot();
  }

  function getSnapshot() {
    return {
      status,
      stopReason,
      playersStarted,
      playersCompleted,
      totalSetsPurchased,
      totalSetsChecked,
      candidateGenerations,
      winnersCount,
      winnerEvents: winnerEvents.map((event) => ({ ...event })),
      currentPlayer: currentPlayer === null
        ? null
        : {
            playerIndex: currentPlayer.playerIndex,
            setsAccepted: currentPlayer.sets.size,
          },
    };
  }

  return { advance, getSnapshot };
}
