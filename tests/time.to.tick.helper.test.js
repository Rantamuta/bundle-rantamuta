'use strict';

const assert = require('assert');
const {
  getTickFrequencyMs,
  secondsToTicks,
  ticksToSeconds,
} = require('../lib/helpers/time-to-tick');

function makeState(config = {}) {
  return {
    Config: {
      get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : fallback;
      },
    },
  };
}

describe('bundle-rantamuta time-to-tick helper', function () {
  it('uses default 100ms frequencies when config keys are absent', function () {
    const state = makeState();

    assert.strictEqual(getTickFrequencyMs(state, 'entity'), 100);
    assert.strictEqual(getTickFrequencyMs(state, 'player'), 100);
  });

  it('uses configured cadence frequencies when present', function () {
    const state = makeState({
      entityTickFrequency: 80,
      playerTickFrequency: 125,
    });

    assert.strictEqual(getTickFrequencyMs(state, 'entity'), 80);
    assert.strictEqual(getTickFrequencyMs(state, 'player'), 125);
  });

  it('falls back to defaults when configured frequency values are invalid', function () {
    const state = makeState({
      entityTickFrequency: 0,
      playerTickFrequency: -5,
    });

    assert.strictEqual(getTickFrequencyMs(state, 'entity'), 100);
    assert.strictEqual(getTickFrequencyMs(state, 'player'), 100);
  });

  it('secondsToTicks uses ceil conversion and keeps zero at zero', function () {
    const state = makeState({ entityTickFrequency: 100 });

    assert.strictEqual(secondsToTicks(state, 0, 'entity'), 0);
    assert.strictEqual(secondsToTicks(state, 0.05, 'entity'), 1);
    assert.strictEqual(secondsToTicks(state, 1.01, 'entity'), 11);
  });

  it('ticksToSeconds converts using selected cadence', function () {
    const state = makeState({
      entityTickFrequency: 100,
      playerTickFrequency: 250,
    });

    assert.strictEqual(ticksToSeconds(state, 7, 'entity'), 0.7);
    assert.strictEqual(ticksToSeconds(state, 4, 'player'), 1);
  });

  it('throws for unsupported cadence keys', function () {
    const state = makeState();

    assert.throws(() => getTickFrequencyMs(state, 'room'), /cadence/i);
    assert.throws(() => secondsToTicks(state, 1, 'room'), /cadence/i);
    assert.throws(() => ticksToSeconds(state, 1, 'room'), /cadence/i);
  });

  it('throws for invalid seconds and ticks input values', function () {
    const state = makeState();

    assert.throws(() => secondsToTicks(state, -1), RangeError);
    assert.throws(() => secondsToTicks(state, Infinity), TypeError);
    assert.throws(() => secondsToTicks(state, '1'), TypeError);

    assert.throws(() => ticksToSeconds(state, -1), RangeError);
    assert.throws(() => ticksToSeconds(state, NaN), TypeError);
    assert.throws(() => ticksToSeconds(state, '2'), TypeError);
  });
});
