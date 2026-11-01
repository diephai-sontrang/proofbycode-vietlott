const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_ID_PATTERN = /^\d+$/;
const MAX_NUMBER = 45;
const COMBINATION_SIZE = 6;

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export class HistoricalDataValidationError extends Error {
  constructor(issues) {
    super(`Historical data validation failed with ${issues.length} issue(s)`);
    this.name = 'HistoricalDataValidationError';
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysBeforeYear(year) {
  const previousYear = year - 1;
  return (365 * previousYear)
    + Math.floor(previousYear / 4)
    - Math.floor(previousYear / 100)
    + Math.floor(previousYear / 400);
}

export function dateOnlyToDayIndex(value) {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (match === null) {
    throw new RangeError('Date must use YYYY-MM-DD format');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }

  return daysBeforeYear(year) + DAYS_BEFORE_MONTH[month - 1] + (month > 2 && isLeapYear(year) ? 1 : 0) + day - 1;
}

function issue(path, code, message) {
  return { path, code, message };
}

function normalizeDrawId(value, path, issues) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  issues.push(issue(path, 'invalid_draw_id', 'draw id must be a non-empty string or non-negative safe integer'));
  return null;
}

function normalizeDrawDate(value, path, issues) {
  try {
    const dayIndex = dateOnlyToDayIndex(value);
    return { drawDate: value, dayIndex };
  } catch (error) {
    issues.push(issue(path, 'invalid_date', error.message));
    return null;
  }
}

function normalizeNumbers(value, path, issues) {
  if (!Array.isArray(value) || value.length !== COMBINATION_SIZE) {
    issues.push(issue(path, 'invalid_numbers', `numbers must contain exactly ${COMBINATION_SIZE} values`));
    return null;
  }

  if (value.some((number) => !Number.isSafeInteger(number) || number < 1 || number > MAX_NUMBER)) {
    issues.push(issue(path, 'invalid_numbers', 'numbers must be distinct integers in [1, 45]'));
    return null;
  }

  const numbers = [...value].sort((left, right) => left - right);
  if (new Set(numbers).size !== COMBINATION_SIZE) {
    issues.push(issue(path, 'duplicate_numbers', 'numbers must be distinct'));
    return null;
  }

  return numbers;
}

function isMega645Marker(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return value.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('/', '')
    .replaceAll('-', '') === 'mega645';
}

function validateExplicitProductMarkers(rawData, issues) {
  const topLevelMarkers = ['product', 'game', 'productType']
    .filter((key) => Object.prototype.hasOwnProperty.call(rawData, key));

  for (const key of topLevelMarkers) {
    if (!isMega645Marker(rawData[key])) {
      issues.push(issue(key, 'unsupported_product', 'only Mega 6/45 data is supported'));
    }
  }

  if (!Array.isArray(rawData.draws)) {
    return;
  }

  rawData.draws.forEach((rawDraw, index) => {
    if (rawDraw === null || typeof rawDraw !== 'object' || Array.isArray(rawDraw)) {
      return;
    }

    for (const key of ['product', 'game', 'productType']) {
      if (Object.prototype.hasOwnProperty.call(rawDraw, key) && !isMega645Marker(rawDraw[key])) {
        issues.push(issue(`draws[${index}].${key}`, 'unsupported_product', 'only Mega 6/45 data is supported'));
      }
    }
  });
}

function numericId(value) {
  return value !== null && NUMERIC_ID_PATTERN.test(value) ? BigInt(value) : null;
}

function compareIds(left, right) {
  const leftNumeric = numericId(left);
  const rightNumeric = numericId(right);

  if (leftNumeric !== null && rightNumeric !== null) {
    return leftNumeric < rightNumeric ? -1 : leftNumeric > rightNumeric ? 1 : 0;
  }

  return left < right ? -1 : left > right ? 1 : 0;
}

function buildCoverage(draws) {
  const numericIds = draws
    .map((draw) => numericId(draw.drawId))
    .filter((id) => id !== null);

  if (numericIds.length !== draws.length || draws.length === 0) {
    return {
      coverageStatus: 'unknown',
      coverageReason: 'The dataset does not provide a complete numeric draw-ID range that can be checked internally.',
      idRange: null,
      idRangeContiguous: null,
    };
  }

  const firstId = numericIds.reduce((minimum, id) => (id < minimum ? id : minimum));
  const lastId = numericIds.reduce((maximum, id) => (id > maximum ? id : maximum));
  const expectedCount = lastId - firstId + 1n;
  const firstRecord = draws.find((draw) => numericId(draw.drawId) === firstId);
  const lastRecord = draws.find((draw) => numericId(draw.drawId) === lastId);

  return {
    coverageStatus: 'unknown',
    coverageReason: 'ID continuity is verified only within this file; external historical completeness has no official manifest.',
    idRange: {
      first: firstRecord.drawId,
      last: lastRecord.drawId,
    },
    idRangeContiguous: expectedCount === BigInt(draws.length),
  };
}

export function normalizeMega645Data(rawData) {
  const issues = [];

  if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new HistoricalDataValidationError([
      issue('$', 'invalid_root', 'data root must be an object'),
    ]);
  }

  validateExplicitProductMarkers(rawData, issues);

  if (!Array.isArray(rawData.draws)) {
    throw new HistoricalDataValidationError([
      issue('draws', 'invalid_draws', 'draws must be an array'),
    ]);
  }

  const normalized = [];
  const idIndex = new Map();

  rawData.draws.forEach((rawDraw, index) => {
    const path = `draws[${index}]`;
    if (rawDraw === null || typeof rawDraw !== 'object' || Array.isArray(rawDraw)) {
      issues.push(issue(path, 'invalid_draw', 'draw must be an object'));
      return;
    }

    const drawId = normalizeDrawId(rawDraw.id, `${path}.id`, issues);
    const date = normalizeDrawDate(rawDraw.date, `${path}.date`, issues);
    const numbers = normalizeNumbers(rawDraw.result, `${path}.result`, issues);

    if (date === null || numbers === null) {
      return;
    }

    const draw = {
      drawId,
      drawDate: date.drawDate,
      numbers,
      dayIndex: date.dayIndex,
      sourceIndex: index,
    };

    if (drawId !== null && idIndex.has(drawId)) {
      const previous = normalized[idIndex.get(drawId)];
      issues.push(issue(path, 'duplicate_draw_id', `draw id ${drawId} appears more than once`));
      if (previous.drawDate !== draw.drawDate || previous.numbers.join(',') !== draw.numbers.join(',')) {
        issues.push(issue(path, 'conflicting_draw_id', `draw id ${drawId} has conflicting date or numbers`));
      }
    } else if (drawId !== null) {
      idIndex.set(drawId, normalized.length);
    }

    normalized.push(draw);
  });

  normalized.sort((left, right) => {
    if (left.dayIndex !== right.dayIndex) {
      return left.dayIndex - right.dayIndex;
    }

    const idComparison = compareIds(left.drawId ?? '', right.drawId ?? '');
    return idComparison !== 0 ? idComparison : left.sourceIndex - right.sourceIndex;
  });

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    const previousId = numericId(previous.drawId);
    const currentId = numericId(current.drawId);

    if (previousId !== null && currentId !== null && currentId <= previousId) {
      issues.push(issue(`draws[${current.sourceIndex}].id`, 'chronology_conflict', 'numeric draw IDs must increase with draw dates'));
    }
  }

  if (issues.length > 0) {
    throw new HistoricalDataValidationError(issues);
  }

  return {
    draws: normalized.map(({ dayIndex, sourceIndex, ...draw }) => draw),
    coverage: buildCoverage(normalized),
  };
}
