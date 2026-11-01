import { createAttemptSimulation } from './attempt-simulation.js';

const BATCH_SIZE = 10_000;
const PROGRESS_INTERVAL_MS = 150;

let activeRunId = null;
let simulation = null;
let scheduledTimer = null;
let lastProgressAt = 0;

function post(type, runId, snapshot) {
  self.postMessage({ type, runId, snapshot });
}

function clearScheduledBatch() {
  if (scheduledTimer !== null) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

function isActive(runId) {
  return runId === activeRunId && simulation !== null;
}

function finish(runId, type, snapshot) {
  if (!isActive(runId)) {
    return;
  }

  clearScheduledBatch();
  post(type, runId, snapshot);
  simulation = null;
  activeRunId = null;
}

function scheduleBatch(runId) {
  clearScheduledBatch();
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    runBatch(runId);
  }, 0);
}

function runBatch(runId) {
  if (!isActive(runId)) {
    return;
  }

  const snapshot = simulation.advance({ maxCandidateGenerations: BATCH_SIZE });
  const now = Date.now();

  if (snapshot.status === 'matched') {
    finish(runId, 'matched', snapshot);
    return;
  }

  if (snapshot.status === 'error') {
    finish(runId, 'error', snapshot);
    return;
  }

  if (snapshot.status === 'stopped') {
    finish(runId, 'stopped', snapshot);
    return;
  }

  if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
    lastProgressAt = now;
    post(snapshot.status === 'paused' ? 'paused' : 'progress', runId, snapshot);
  }

  if (snapshot.status !== 'paused') {
    scheduleBatch(runId);
  }
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  const { type, runId } = message;

  try {
    if (type === 'start') {
      clearScheduledBatch();
      simulation = createAttemptSimulation({
        target: message.target,
        seed: message.seed,
      });
      activeRunId = runId;
      lastProgressAt = Date.now();
      post('started', runId, simulation.getSnapshot());
      scheduleBatch(runId);
      return;
    }

    if (!isActive(runId)) {
      return;
    }

    if (type === 'pause') {
      const snapshot = simulation.pause();
      clearScheduledBatch();
      post('paused', runId, snapshot);
      return;
    }

    if (type === 'resume') {
      const snapshot = simulation.resume();
      post('resumed', runId, snapshot);
      scheduleBatch(runId);
      return;
    }

    if (type === 'stop') {
      const snapshot = simulation.stop();
      finish(runId, 'stopped', snapshot);
    }
  } catch (error) {
    const snapshot = simulation === null
      ? { status: 'error', error: error.message }
      : { ...simulation.getSnapshot(), status: 'error', error: error.message };
    finish(runId, 'error', snapshot);
  }
};
