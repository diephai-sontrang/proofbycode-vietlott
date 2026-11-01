import { normalizeMega645Data } from './history-data.js';
import { calculateCoverageCost } from './attempt-simulation.js';
import {
  analyzeHistory,
  calculateTheoreticalProbability,
} from './history-analysis.js';

const DATA_URL = new URL('../data/mega-6-45.json', import.meta.url);
const MAX_NUMBER = 45;
const COMBINATION_SIZE = 6;
const HISTORY_PAGE_SIZE = 25;

const numberFormatter = new Intl.NumberFormat('vi-VN');
const percentFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'percent',
  maximumFractionDigits: 4,
});

const state = {
  historyData: null,
  historyDrawIndex: 0,
  simulationSource: 'custom',
  simulationSelected: new Set(),
  simulationRandomSelected: new Set(),
  historySelected: new Set(),
  historyResult: null,
  historyVisibleMatches: HISTORY_PAGE_SIZE,
  worker: null,
  runSequence: 0,
  activeRunId: null,
  currentRunConfig: null,
  lastRunConfig: null,
  simulationLocked: false,
  activeStartedAt: null,
  accumulatedActiveMs: 0,
  activeClockTimer: null,
  toastTimer: null,
};

function element(id) {
  return document.getElementById(id);
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

function formatTwoDigit(value) {
  return String(value).padStart(2, '0');
}

function formatNumbers(numbers) {
  return numbers.map(formatTwoDigit).join(', ');
}

function formatProbability(decimal) {
  return percentFormatter.format(decimal);
}

function formatMean(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${formatNumber(Math.round(value))} lượt`;
}

function formatVnd(value) {
  return `${value.toLocaleString('vi-VN')} VNĐ`;
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} giây`;
}

function createFreshSeed() {
  const values = new Uint32Array(3);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return `ui-${Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')}`;
  }

  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function randomBounded(bound) {
  if (!globalThis.crypto?.getRandomValues) {
    return Math.floor(Math.random() * bound);
  }

  const range = 0x1_0000_0000;
  const limit = range - (range % bound);
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % bound;
}

function getSimulationTarget() {
  if (state.simulationSource === 'history') {
    return state.historyData?.draws[state.historyDrawIndex]?.numbers ?? [];
  }

  return [...state.simulationSelected].sort((left, right) => left - right);
}

function getHistoryAnalysisMode() {
  return 'contains-selected';
}

function renderNumberGrid(container, selected, onToggle, randomSelected = new Set(), maxSelected = null) {
  container.replaceChildren();
  for (let number = 1; number <= MAX_NUMBER; number += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    const isSelected = selected.has(number);
    const isRandom = isSelected && randomSelected.has(number);
    button.className = `number-button ${isSelected && isRandom ? 'is-random' : isSelected ? 'is-manual' : ''}`;
    button.textContent = formatTwoDigit(number);
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    button.setAttribute('aria-label', isRandom
      ? `Số ${formatTwoDigit(number)}, chọn ngẫu nhiên`
      : isSelected
        ? `Số ${formatTwoDigit(number)}, chọn thủ công`
        : `Số ${formatTwoDigit(number)}`);
    button.disabled = maxSelected !== null && selected.size >= maxSelected && !isSelected;
    button.addEventListener('click', () => onToggle(number));
    container.append(button);
  }
}

function renderSimulationPicker() {
  renderNumberGrid(element('simulation-number-grid'), state.simulationSelected, (number) => {
    if (state.simulationLocked) {
      return;
    }
    if (state.simulationSelected.has(number)) {
      state.simulationSelected.delete(number);
      state.simulationRandomSelected.delete(number);
    } else if (state.simulationSelected.size < COMBINATION_SIZE) {
      state.simulationSelected.add(number);
      state.simulationRandomSelected.delete(number);
    }
    renderSimulationPicker();
    element('simulation-selection-count').textContent = `${state.simulationSelected.size}/6`;
    setText('simulation-validation', getSimulationTargetValidation());
    updateSimulationTargetAndTheory();
  }, state.simulationRandomSelected, COMBINATION_SIZE);

  element('simulation-selection-count').textContent = `${state.simulationSelected.size}/6`;
}

function renderHistoryPicker() {
  renderNumberGrid(element('history-number-grid'), state.historySelected, (number) => {
    if (state.historySelected.has(number)) {
      state.historySelected.delete(number);
    } else {
      state.historySelected.add(number);
    }
    renderHistoryPicker();
    clearHistoryResult();
    element('history-selection-count').textContent = formatNumber(state.historySelected.size);
    setText('history-validation', getHistorySelectionValidation());
    updateHistoryModeDescription();
  }, new Set(), COMBINATION_SIZE);
  element('history-selection-count').textContent = formatNumber(state.historySelected.size);
  updateHistoryModeDescription();
}

function setText(id, value) {
  element(id).textContent = value;
}

function getSimulationTargetValidation() {
  if (state.simulationSource === 'history') {
    return state.historyData === null ? 'Dữ liệu lịch sử chưa sẵn sàng.' : '';
  }

  const count = state.simulationSelected.size;
  return count >= 2 && count <= 6 ? '' : 'Hãy chọn từ 2 đến 6 số.';
}

function getHistorySelectionValidation() {
  const count = state.historySelected.size;
  if (count < 1 || count > COMBINATION_SIZE) {
    return 'Hãy chọn từ 1 đến 6 số.';
  }
  return '';
}

function updateHistoryModeDescription() {
  setText('history-mode-description', 'Đang tìm các kỳ quay chứa đầy đủ các số đã chọn. Có thể chọn từ 1 đến 6 số; với 6 số, đây là so khớp giải độc đắc không xét thứ tự.');
}

function renderChips(container, numbers, targetNumbers = new Set()) {
  container.replaceChildren();
  numbers.forEach((number) => {
    const chip = document.createElement('span');
    chip.className = `number-chip ${targetNumbers.has(number) ? 'target' : 'match-extra'}`;
    chip.textContent = formatTwoDigit(number);
    container.append(chip);
  });
}

function updateSimulationTargetAndTheory() {
  const target = getSimulationTarget();
  renderChips(element('simulation-target'), target, new Set(target));
  const probability = target.length >= 2 && target.length <= 6
    ? calculateTheoreticalProbability('contains-selected', target.length)
    : null;
  const pricing = probability === null ? null : calculateCoverageCost(target.length);

  setText('simulation-probability', probability === null
    ? '—'
    : `${formatNumber(probability.exact.numerator)} / ${formatNumber(probability.exact.denominator)}`);
  setText('simulation-mean', probability === null ? '—' : formatMean(probability.theoreticalMeanWaitingDraws));
  setText('simulation-covered-sets', pricing === null ? '—' : formatNumber(pricing.coveredSetsPerAttempt));
  setText('simulation-cost-per-attempt', pricing === null ? '—' : formatVnd(pricing.costPerAttemptVnd));
  const currentSnapshot = state.currentRunConfig?.snapshot;
  const sameTarget = currentSnapshot?.target?.length === target.length
    && currentSnapshot.target.every((number, index) => number === target[index]);
  const attempts = sameTarget ? currentSnapshot.attempts : 0;
  setText('simulation-total-cost', pricing === null
    ? '—'
    : formatVnd(BigInt(attempts) * BigInt(pricing.costPerAttemptVnd)));
  setText('simulation-theory-note', target.length >= 2 && target.length < 6
    ? 'Mô hình bao phủ toán học; khớp các số đã chọn không đồng nghĩa trúng giải độc đắc.'
    : 'Trung bình không phải mốc đảm bảo trúng.');
}

function setSimulationSource(source) {
  if (state.simulationLocked) {
    return;
  }
  state.simulationSource = source;
  document.querySelectorAll('[data-sim-source]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.simSource === source);
  });
  element('custom-source-panel').hidden = source !== 'custom';
  element('history-source-panel').hidden = source !== 'history';
  setText('simulation-validation', getSimulationTargetValidation());
  updateSimulationTargetAndTheory();
}

function populateHistoryDraws() {
  const select = element('history-draw-select');
  select.replaceChildren();
  state.historyData.draws.forEach((draw, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `#${draw.drawId ?? '—'} · ${draw.drawDate}`;
    select.append(option);
  });
  state.historyDrawIndex = Math.max(0, state.historyData.draws.length - 1);
  select.value = String(state.historyDrawIndex);
  renderHistorySourceDraw();
}

function renderHistorySourceDraw() {
  const draw = state.historyData?.draws[state.historyDrawIndex];
  setText('history-source-numbers', draw === undefined
    ? 'Chưa có kỳ quay hợp lệ.'
    : `Bộ số: ${formatNumbers(draw.numbers)} · #${draw.drawId}`);
  updateSimulationTargetAndTheory();
}

function renderHistoryDataSummary() {
  if (state.historyData === null) {
    setText('history-data-summary', 'Dữ liệu lịch sử chưa tải được.');
    return;
  }
  const { draws, coverage } = state.historyData;
  const first = draws[0]?.drawDate ?? '—';
  const last = draws.at(-1)?.drawDate ?? '—';
  setText('history-data-summary', `Dữ liệu: ${formatNumber(draws.length)} kỳ · ${first} – ${last}`);
  setText('history-coverage-status', `Mức độ bao phủ dữ liệu: ${coverage.coverageStatus === 'unknown' ? 'chưa xác định' : coverage.coverageStatus}`);
}

function setSimulationStatus(status, label = null) {
  const labels = {
    ready: 'Sẵn sàng',
    running: 'Đang chạy',
    paused: 'Đã tạm dừng',
    matched: 'Đã khớp',
    stopped: 'Đã kết thúc',
    error: 'Lỗi',
  };
  const statusElement = element('simulation-status');
  statusElement.className = `status-pill status-${status}`;
  statusElement.innerHTML = `<span class="status-dot"></span><span>${label ?? labels[status] ?? status}</span>`;
}

function setSimulationButtons({ ready, running, paused, terminal }) {
  element('start-button').hidden = !ready;
  element('new-run-button').hidden = !terminal;
  element('repeat-run-button').hidden = !terminal || state.lastRunConfig === null;
  element('pause-button').hidden = !running;
  element('resume-button').hidden = !paused;
  element('stop-button').hidden = !(running || paused);
  element('copy-result-button').hidden = state.currentRunConfig === null || state.currentRunConfig.snapshot?.status !== 'matched';
  element('download-result-button').hidden = state.currentRunConfig === null || state.currentRunConfig.snapshot?.status !== 'matched';
}

function setSimulationLocked(locked) {
  state.simulationLocked = locked;
  document.querySelectorAll('[data-sim-source], #random-count, #random-pick-button, #clear-simulation-button, #history-draw-select, #seed-input, #new-seed-button, #simulation-number-grid button').forEach((control) => {
    control.disabled = locked;
  });
}

function getActiveElapsedMs() {
  if (state.activeStartedAt === null) {
    return state.accumulatedActiveMs;
  }
  return state.accumulatedActiveMs + (performance.now() - state.activeStartedAt);
}

function updateActiveTime() {
  setText('active-time', `Thời gian hoạt động: ${formatDuration(getActiveElapsedMs())}`);
}

function startActiveClock() {
  state.accumulatedActiveMs = 0;
  state.activeStartedAt = performance.now();
  clearInterval(state.activeClockTimer);
  state.activeClockTimer = setInterval(updateActiveTime, 100);
  updateActiveTime();
}

function pauseActiveClock() {
  if (state.activeStartedAt !== null) {
    state.accumulatedActiveMs += performance.now() - state.activeStartedAt;
    state.activeStartedAt = null;
  }
  updateActiveTime();
}

function finishActiveClock() {
  pauseActiveClock();
  clearInterval(state.activeClockTimer);
  state.activeClockTimer = null;
}

function resetSimulationDisplay() {
  setText('attempt-count', '0');
  setText('attempt-label', 'lượt đã thử');
  setText('matched-combination-note', 'Chưa có bộ số khớp.');
  element('matched-combination').replaceChildren();
  setText('simulation-error', '');
  setText('active-time', 'Thời gian hoạt động: 0,0 giây');
  setSimulationStatus('ready');
  setSimulationButtons({ ready: true, running: false, paused: false, terminal: false });
  updateSimulationTargetAndTheory();
}

function renderAttemptSnapshot(snapshot) {
  state.currentRunConfig.snapshot = snapshot;
  setText('attempt-count', formatNumber(snapshot.attempts));
  const targetSet = new Set(snapshot.target);
  if (snapshot.matchedCombination !== null) {
    setText('attempt-label', 'lượt thử để khớp');
    setText('matched-combination-note', 'Đã sinh được bộ 6 số chứa toàn bộ bộ số mục tiêu.');
    renderChips(element('matched-combination'), snapshot.matchedCombination, targetSet);
    element('matched-combination').classList.add('matched-animation');
    window.setTimeout(() => element('matched-combination').classList.remove('matched-animation'), 900);
  } else if (snapshot.status === 'stopped') {
    setText('matched-combination-note', 'Đã kết thúc mà chưa có bộ số khớp.');
  }

  setSimulationStatus(snapshot.status);
  if (snapshot.error) {
    setText('simulation-error', snapshot.error);
  }
  updateSimulationTargetAndTheory();
  updateActiveTime();
}

function terminateWorker() {
  if (state.worker !== null) {
    state.worker.terminate();
    state.worker = null;
  }
}

function handleWorkerMessage(event) {
  const message = event.data ?? {};
  if (message.runId !== state.activeRunId || state.currentRunConfig === null) {
    return;
  }

  const snapshot = message.snapshot;
  if (snapshot) {
    renderAttemptSnapshot(snapshot);
  }

  if (message.type === 'started' || message.type === 'progress' || message.type === 'resumed') {
    setSimulationButtons({ ready: false, running: true, paused: false, terminal: false });
    setSimulationStatus('running');
    return;
  }

  if (message.type === 'paused') {
    pauseActiveClock();
    setSimulationButtons({ ready: false, running: false, paused: true, terminal: false });
    setSimulationStatus('paused');
    return;
  }

  if (message.type === 'matched' || message.type === 'stopped' || message.type === 'error') {
    finishActiveClock();
    state.lastRunConfig = { ...state.currentRunConfig, snapshot };
    setSimulationLocked(false);
    setSimulationButtons({ ready: false, running: false, paused: false, terminal: true });
    if (message.type === 'error') {
      setSimulationStatus('error');
    }
    terminateWorker();
  }
}

function handleWorkerFailure(event) {
  if (state.currentRunConfig === null) {
    return;
  }
  finishActiveClock();
  setSimulationLocked(false);
  setSimulationStatus('error');
  setText('simulation-error', event.message || 'Bộ xử lý nền mô phỏng gặp lỗi.');
  setSimulationButtons({ ready: false, running: false, paused: false, terminal: true });
  terminateWorker();
}

function startSimulation(target, seed, sourceLabel) {
  if (typeof Worker === 'undefined') {
    setSimulationStatus('error');
    setText('simulation-error', 'Trình duyệt không hỗ trợ bộ xử lý nền; không thể chạy mô phỏng an toàn.');
    return;
  }
  if (!Array.isArray(target) || target.length < 2 || target.length > 6) {
    setText('simulation-validation', 'Hãy chọn từ 2 đến 6 số hợp lệ trước khi bắt đầu.');
    return;
  }

  terminateWorker();
  state.runSequence += 1;
  state.activeRunId = `run-${state.runSequence}`;
  state.currentRunConfig = {
    target: [...target],
    seed,
    sourceLabel,
    sourceDraw: state.simulationSource === 'history'
      ? state.historyData?.draws[state.historyDrawIndex] ?? null
      : null,
    snapshot: null,
  };
  state.lastRunConfig = null;
  resetSimulationDisplay();
  renderChips(element('simulation-target'), target, new Set(target));
  setSimulationLocked(true);
  startActiveClock();
  setSimulationStatus('running');
  setSimulationButtons({ ready: false, running: true, paused: false, terminal: false });

  try {
    state.worker = new Worker(new URL('./simulation-worker.js', import.meta.url), { type: 'module' });
    state.worker.addEventListener('message', handleWorkerMessage);
    state.worker.addEventListener('error', handleWorkerFailure);
    state.worker.postMessage({
      type: 'start',
      runId: state.activeRunId,
      target: [...target],
      seed,
    });
  } catch (error) {
    handleWorkerFailure(error);
  }
}

function startFromForm() {
  const target = getSimulationTarget();
  const validation = getSimulationTargetValidation();
  if (validation) {
    setText('simulation-validation', validation);
    return;
  }

  const seedInput = element('seed-input');
  if (seedInput.value.length === 0) {
    seedInput.value = createFreshSeed();
  }
  startSimulation(target, seedInput.value, state.simulationSource === 'history' ? 'kỳ quay lịch sử' : 'bộ số tự chọn');
}

function resetToReady() {
  terminateWorker();
  state.runSequence += 1;
  state.activeRunId = null;
  state.currentRunConfig = null;
  state.lastRunConfig = null;
  finishActiveClock();
  setSimulationLocked(false);
  element('seed-input').value = createFreshSeed();
  resetSimulationDisplay();
}

function repeatLastRun() {
  if (state.lastRunConfig === null) {
    return;
  }
  const { target, seed, sourceLabel } = state.lastRunConfig;
  element('seed-input').value = seed;
  startSimulation([...target], seed, sourceLabel);
}

function buildSimulationExport() {
  const run = state.currentRunConfig;
  return {
    engineVersion: run.snapshot.engineVersion,
    target: [...run.target],
    targetSource: run.sourceLabel,
    sourceDraw: run.sourceDraw === null ? null : {
      drawId: run.sourceDraw.drawId,
      drawDate: run.sourceDraw.drawDate,
      numbers: [...run.sourceDraw.numbers],
    },
    seed: run.seed,
    attempts: run.snapshot.attempts,
    matchedCombination: [...run.snapshot.matchedCombination],
    activeElapsedMs: Math.round(getActiveElapsedMs()),
    status: run.snapshot.status,
  };
}

async function copySimulationResult() {
  if (state.currentRunConfig?.snapshot?.status !== 'matched') {
    return;
  }
  const result = buildSimulationExport();
  const text = [
    'Proofbycode / Vietlott Lab',
    `Bộ số mục tiêu: ${formatNumbers(result.target)}`,
    `Kết quả: ${formatNumbers(result.matchedCombination)}`,
    `Lượt thử: ${formatNumber(result.attempts)}`,
    `Mã khởi tạo: ${result.seed}`,
    `Phiên bản mô phỏng: ${result.engineVersion}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    showToast('Đã sao chép kết quả.');
  } catch {
    showToast('Không thể truy cập clipboard của trình duyệt.');
  }
}

function downloadSimulationResult() {
  if (state.currentRunConfig?.snapshot?.status !== 'matched') {
    return;
  }
  const result = buildSimulationExport();
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vietlott-simulation-result.json';
  link.click();
  URL.revokeObjectURL(url);
  showToast('Đã tải tệp kết quả.');
}

function togglePresentation() {
  document.body.classList.toggle('presentation-mode');
  const active = document.body.classList.contains('presentation-mode');
  element('presentation-button').textContent = active ? '× Thoát trình chiếu' : '▣ Trình chiếu';
}

function clearHistoryResult() {
  state.historyResult = null;
  setText('history-match-count', '—');
  setText('history-frequency', '—');
  setText('history-probability', '—');
  setText('history-actual-range', 'Chưa chạy phân tích.');
  element('history-details-content').replaceChildren(Object.assign(document.createElement('p'), {
    className: 'muted',
    textContent: 'Chưa có kết quả phân tích.',
  }));
  renderHistoryMatches();
}

function appendGapDetails(container, result) {
  const details = result.waitingGaps;
  const fragment = document.createDocumentFragment();
  const intro = document.createElement('p');
  intro.textContent = result.mode === 'jackpot-coverage'
    ? `Mô hình bao phủ mua C(${result.selectedCount}, 6) = ${formatNumber(result.theoreticalProbability.exact.numerator)} bộ sáu số cho mỗi kỳ.`
    : 'Mỗi lần khớp là một kỳ quay chứa đầy đủ các số đã chọn; đây không phải mô phỏng xác suất tương lai.';
  fragment.append(intro);

  const histogram = document.createElement('p');
  histogram.textContent = `Phân bố số giao nhau từ 0 đến 6: ${result.matchCountHistogram.map((count, index) => `${index}: ${formatNumber(count)}`).join(' · ')}`;
  fragment.append(histogram);

  if (details.completedGapStatistics === null) {
    const note = document.createElement('p');
    note.textContent = result.matchedDrawCount < 2
      ? 'Chưa đủ hai lần khớp để tính khoảng cách hoàn tất.'
      : 'Không có khoảng cách hoàn tất.';
    fragment.append(note);
  } else {
    const stats = document.createElement('p');
    const average = details.completedGapStatistics;
    stats.textContent = `Khoảng cách hoàn tất: ${formatNumber(average.count)} · trung bình ${average.averageDrawTransitionsBetween.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} lần chuyển kỳ, ${average.averageNonmatchingDrawsBetween.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kỳ không khớp, ${average.averageElapsedCalendarDays.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ngày lịch.`;
    fragment.append(stats);
  }

  if (details.beforeFirstMatch !== null) {
    const before = document.createElement('p');
    before.textContent = `Trước lần khớp đầu: ${formatNumber(details.beforeFirstMatch.nonmatchingDraws)} kỳ không khớp, ${formatNumber(details.beforeFirstMatch.calendarDays)} ngày lịch (biên đầu cửa sổ quan sát).`;
    fragment.append(before);
  }
  if (details.afterLastMatch !== null) {
    const after = document.createElement('p');
    after.textContent = `Sau lần khớp cuối: ${formatNumber(details.afterLastMatch.nonmatchingDraws)} kỳ không khớp, ${formatNumber(details.afterLastMatch.calendarDays)} ngày lịch (biên cuối cửa sổ quan sát).`;
    fragment.append(after);
  }
  if (details.noMatchWindow !== null) {
    const none = document.createElement('p');
    none.textContent = `Không có lần khớp trong toàn bộ khoảng quan sát: ${formatNumber(details.noMatchWindow.nonmatchingDraws)} kỳ, ${formatNumber(details.noMatchWindow.calendarDays)} ngày lịch.`;
    fragment.append(none);
  }
  container.replaceChildren(fragment);
}

function renderHistoryMatches() {
  const result = state.historyResult;
  const tableWrap = element('history-table-wrap');
  const empty = element('history-empty-state');
  const showMore = element('history-show-more');
  const body = element('history-matches-body');

  if (result === null) {
    tableWrap.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Chọn số và nhấn “Phân tích”.';
    showMore.hidden = true;
    return;
  }

  if (result.totalDrawsAnalyzed === 0) {
    tableWrap.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Không có kỳ quay trong khoảng ngày đã chọn.';
    showMore.hidden = true;
    return;
  }

  if (result.matchedDrawCount === 0) {
    tableWrap.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Có dữ liệu trong khoảng đã chọn nhưng không có kỳ nào khớp.';
    showMore.hidden = true;
    return;
  }

  tableWrap.hidden = false;
  empty.hidden = true;
  body.replaceChildren();
  const selected = new Set(result.selectedNumbers);
  result.matchedDraws.slice(0, state.historyVisibleMatches).forEach((draw) => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = draw.drawDate;
    const idCell = document.createElement('td');
    idCell.textContent = `#${draw.drawId ?? '—'}`;
    const numbersCell = document.createElement('td');
    const numbers = document.createElement('div');
    numbers.className = 'table-number-row';
    draw.winningNumbers.forEach((number) => {
      const chip = document.createElement('span');
      chip.className = `table-number ${selected.has(number) ? 'is-selected' : ''}`;
      chip.textContent = formatTwoDigit(number);
      numbers.append(chip);
    });
    numbersCell.append(numbers);
    row.append(dateCell, idCell, numbersCell);
    body.append(row);
  });
  showMore.hidden = state.historyVisibleMatches >= result.matchedDraws.length;
}

function renderHistoryResult(result) {
  state.historyResult = result;
  state.historyVisibleMatches = HISTORY_PAGE_SIZE;
  setText('history-match-count', formatNumber(result.matchedDrawCount));
  setText('history-frequency', result.historicalMatchRate === null ? '—' : formatProbability(result.historicalMatchRate));
  setText('history-probability', formatProbability(result.theoreticalProbability.decimal));
  setText('history-actual-range', result.actualDateRange === null
    ? 'Không có ngày thực tế trong cửa sổ đã chọn.'
    : `Đã phân tích ${formatNumber(result.totalDrawsAnalyzed)} kỳ · ${result.actualDateRange.from} – ${result.actualDateRange.to}`);
  appendGapDetails(element('history-details-content'), result);
  renderHistoryMatches();
}

function analyzeHistoryFromForm() {
  if (state.historyData === null) {
    setText('history-analysis-error', 'Dữ liệu lịch sử chưa tải xong.');
    return;
  }
  const validation = getHistorySelectionValidation();
  if (validation) {
    setText('history-validation', validation);
    return;
  }

  try {
    const result = analyzeHistory({
      mode: getHistoryAnalysisMode(),
      selectedNumbers: [...state.historySelected],
      from: element('history-from').value || undefined,
      to: element('history-to').value || undefined,
    }, state.historyData);
    setText('history-analysis-error', '');
    renderHistoryResult(result);
  } catch (error) {
    setText('history-analysis-error', error.message);
  }
}

function updateHistoryRangeCount() {
  if (state.historyData === null) {
    setText('history-range-count', 'Số kỳ trong khoảng ngày: đang tải…');
    return;
  }

  const firstDate = state.historyData.draws[0]?.drawDate;
  const lastDate = state.historyData.draws.at(-1)?.drawDate;
  const from = element('history-from').value || firstDate;
  const to = element('history-to').value || lastDate;

  if (from > to) {
    setText('history-range-count', 'Số kỳ trong khoảng ngày: khoảng ngày không hợp lệ.');
    return;
  }

  const count = state.historyData.draws.filter((draw) => draw.drawDate >= from && draw.drawDate <= to).length;
  setText('history-range-count', `Số kỳ trong khoảng ngày: ${formatNumber(count)}`);
}

function showToast(message) {
  const toast = element('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

async function loadHistoryData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Không thể tải dataset (${response.status}).`);
    }
    const rawData = await response.json();
    state.historyData = normalizeMega645Data(rawData);
    populateHistoryDraws();
    if (element('history-from').value === '') {
      element('history-from').value = state.historyData.draws[0]?.drawDate ?? '';
    }
    if (element('history-to').value === '') {
      element('history-to').value = state.historyData.draws.at(-1)?.drawDate ?? '';
    }
    renderHistoryDataSummary();
    updateHistoryRangeCount();
    setText('history-source-status', '');
    setText('history-analysis-error', '');
    element('history-draw-select').disabled = false;
  } catch (error) {
    const message = error.issues?.length
      ? `${error.message}: ${error.issues.slice(0, 2).map((issue) => issue.message).join('; ')}`
      : error.message;
    setText('history-source-status', message);
    setText('history-analysis-error', message);
    updateHistoryRangeCount();
    renderHistoryDataSummary();
    element('history-draw-select').disabled = true;
  }
}

function switchTab(tab) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  element('simulation-panel').hidden = tab !== 'simulation';
  element('history-panel').hidden = tab !== 'history';
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.querySelectorAll('[data-sim-source]').forEach((button) => button.addEventListener('click', () => setSimulationSource(button.dataset.simSource)));
  element('history-draw-select').addEventListener('change', (event) => {
    state.historyDrawIndex = Number(event.target.value);
    renderHistorySourceDraw();
  });
  element('random-pick-button').addEventListener('click', () => {
    const count = Number(element('random-count').value);
    const numbers = Array.from({ length: MAX_NUMBER }, (_, index) => index + 1);
    for (let index = numbers.length - 1; index > 0; index -= 1) {
      const random = randomBounded(index + 1);
      [numbers[index], numbers[random]] = [numbers[random], numbers[index]];
    }
    state.simulationSelected = new Set(numbers.slice(0, count));
    state.simulationRandomSelected = new Set(state.simulationSelected);
    renderSimulationPicker();
    setText('simulation-validation', '');
    updateSimulationTargetAndTheory();
  });
  element('clear-simulation-button').addEventListener('click', () => {
    state.simulationSelected.clear();
    state.simulationRandomSelected.clear();
    renderSimulationPicker();
    setText('simulation-validation', getSimulationTargetValidation());
    updateSimulationTargetAndTheory();
  });
  element('new-seed-button').addEventListener('click', () => { element('seed-input').value = createFreshSeed(); });
  element('start-button').addEventListener('click', startFromForm);
  element('new-run-button').addEventListener('click', resetToReady);
  element('repeat-run-button').addEventListener('click', repeatLastRun);
  element('pause-button').addEventListener('click', () => state.worker?.postMessage({ type: 'pause', runId: state.activeRunId }));
  element('resume-button').addEventListener('click', () => state.worker?.postMessage({ type: 'resume', runId: state.activeRunId }));
  element('stop-button').addEventListener('click', () => state.worker?.postMessage({ type: 'stop', runId: state.activeRunId }));
  element('copy-result-button').addEventListener('click', copySimulationResult);
  element('download-result-button').addEventListener('click', downloadSimulationResult);
  element('presentation-button').addEventListener('click', togglePresentation);
  element('analyze-history-button').addEventListener('click', analyzeHistoryFromForm);
  ['history-from', 'history-to'].forEach((id) => {
    ['input', 'change'].forEach((eventName) => element(id).addEventListener(eventName, () => {
      clearHistoryResult();
      updateHistoryRangeCount();
    }));
  });
  element('history-show-more').addEventListener('click', () => {
    state.historyVisibleMatches += HISTORY_PAGE_SIZE;
    renderHistoryMatches();
  });
}

function initialize() {
  element('seed-input').value = createFreshSeed();
  element('history-draw-select').replaceChildren(new Option('Đang tải dữ liệu…', ''));
  element('history-draw-select').disabled = true;
  renderSimulationPicker();
  renderHistoryPicker();
  renderHistorySourceDraw();
  updateSimulationTargetAndTheory();
  resetSimulationDisplay();
  updateHistoryModeDescription();
  updateHistoryRangeCount();
  bindEvents();
  loadHistoryData();
}

initialize();
