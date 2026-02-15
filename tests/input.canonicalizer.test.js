// @ts-check
'use strict';

const assert = require('assert');
const { canonicalizeInput } = require('../lib/input-canonicalizer');

describe('bundle-rantamuta input-canonicalizer', function () {
  it('canonicalizes n to go north', function () {
    assert.strictEqual(canonicalizeInput('n'), 'go north');
  });

  it('canonicalizes east to go east', function () {
    assert.strictEqual(canonicalizeInput('east'), 'go east');
  });

  it('canonicalizes l to look', function () {
    assert.strictEqual(canonicalizeInput('l'), 'look');
  });

  it('canonicalizes look at <thing> to look <thing>', function () {
    assert.strictEqual(canonicalizeInput('look at lantern'), 'look lantern');
    assert.strictEqual(canonicalizeInput('  LOOK   AT   rusty sword  '), 'look rusty sword');
  });

  it('canonicalizes look at with no target to intransitive look', function () {
    assert.strictEqual(canonicalizeInput('look at'), 'look');
  });

  it('canonicalizes x <thing> to look <thing>', function () {
    assert.strictEqual(canonicalizeInput('x lantern'), 'look lantern');
    assert.strictEqual(canonicalizeInput('  x   rusty sword  '), 'look rusty sword');
  });

  it('canonicalizes examine <thing> to look <thing>', function () {
    assert.strictEqual(canonicalizeInput('examine lantern'), 'look lantern');
  });

  it('leaves unknown input unchanged', function () {
    assert.strictEqual(canonicalizeInput('xyzzy'), 'xyzzy');
  });

  it('is side-effect free', function () {
    const original = 'n';
    const snapshot = String(original);
    canonicalizeInput(original);
    assert.strictEqual(original, snapshot);
  });

  it('supports deterministic first-match behavior', function () {
    assert.strictEqual(canonicalizeInput('  EAST  '), 'go east');
  });
});
