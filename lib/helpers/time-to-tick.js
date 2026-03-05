//@ts-check
'use strict';

const DEFAULT_ENTITY_TICK_FREQUENCY_MS = 100;
const DEFAULT_PLAYER_TICK_FREQUENCY_MS = 100;

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveTickFrequencyMs(value, fallback) {
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number(value) : NaN);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(numeric));
}

/**
 * @param {*} state
 * @returns {(key: string, fallback: number) => *}
 */
function getConfigGetter(state) {
  if (state && state.Config && typeof state.Config.get === 'function') {
    return state.Config.get.bind(state.Config);
  }

  return (_key, fallback) => fallback;
}

/**
 * @param {*} cadence
 * @returns {'entity' | 'player'}
 */
function normalizeCadence(cadence) {
  const value = cadence === undefined ? 'entity' : cadence;

  if (value !== 'entity' && value !== 'player') {
    throw new TypeError('cadence must be either "entity" or "player".');
  }

  return value;
}

/**
 * @param {*} state
 * @param {'entity' | 'player'} [cadence='entity']
 * @returns {number}
 */
function getTickFrequencyMs(state, cadence = 'entity') {
  const normalizedCadence = normalizeCadence(cadence);
  const get = getConfigGetter(state);

  if (normalizedCadence === 'entity') {
    return toPositiveTickFrequencyMs(
      get('entityTickFrequency', DEFAULT_ENTITY_TICK_FREQUENCY_MS),
      DEFAULT_ENTITY_TICK_FREQUENCY_MS
    );
  }

  return toPositiveTickFrequencyMs(
    get('playerTickFrequency', DEFAULT_PLAYER_TICK_FREQUENCY_MS),
    DEFAULT_PLAYER_TICK_FREQUENCY_MS
  );
}

/**
 * @param {*} seconds
 */
function assertValidSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new TypeError('seconds must be a finite number.');
  }

  if (seconds < 0) {
    throw new RangeError('seconds must be greater than or equal to 0.');
  }
}

/**
 * @param {*} ticks
 */
function assertValidTicks(ticks) {
  if (typeof ticks !== 'number' || !Number.isFinite(ticks)) {
    throw new TypeError('ticks must be a finite number.');
  }

  if (ticks < 0) {
    throw new RangeError('ticks must be greater than or equal to 0.');
  }
}

/**
 * @param {*} state
 * @param {number} seconds
 * @param {'entity' | 'player'} [cadence='entity']
 * @returns {number}
 */
function secondsToTicks(state, seconds, cadence = 'entity') {
  assertValidSeconds(seconds);

  if (seconds === 0) {
    return 0;
  }

  const frequencyMs = getTickFrequencyMs(state, cadence);
  return Math.ceil((seconds * 1000) / frequencyMs);
}

/**
 * @param {*} state
 * @param {number} ticks
 * @param {'entity' | 'player'} [cadence='entity']
 * @returns {number}
 */
function ticksToSeconds(state, ticks, cadence = 'entity') {
  assertValidTicks(ticks);

  const frequencyMs = getTickFrequencyMs(state, cadence);
  return (ticks * frequencyMs) / 1000;
}

module.exports = {
  getTickFrequencyMs,
  secondsToTicks,
  ticksToSeconds,
};
