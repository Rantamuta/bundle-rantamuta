// @ts-check
'use strict';

const assert = require('assert');

const {
  lexInput,
  parseInput,
} = require('../lib/parse-input');

describe('bundle-rantamuta parse-input', function () {
  it('lexInput trims whitespace and preserves token order', function () {
    const tokens = lexInput('  put   rusty  sword   in old   chest  ');
    assert.deepStrictEqual(tokens, ['put', 'rusty', 'sword', 'in', 'old', 'chest']);
  });

  it('parses intent-only input (look)', function () {
    const result = parseInput('look');

    assert.strictEqual(result.actorInput, 'look');
    assert.strictEqual(result.canonicalInput, 'look');
    assert.strictEqual(result.normalizedInput, 'look');
    assert.strictEqual(result.intentToken, 'look');
    assert.strictEqual(result.primaryTargetSpan, undefined);
    assert.strictEqual(result.relationToken, undefined);
    assert.strictEqual(result.secondaryTargetSpan, undefined);
  });

  it('parses relation-form input into primary/relation/secondary spans', function () {
    const result = parseInput('put rusty sword in old chest');

    assert.strictEqual(result.actorInput, 'put rusty sword in old chest');
    assert.strictEqual(result.canonicalInput, 'put rusty sword in old chest');
    assert.strictEqual(result.normalizedInput, 'put rusty sword in old chest');
    assert.strictEqual(result.intentToken, 'put');
    assert.deepStrictEqual(result.primaryTargetSpan, ['rusty', 'sword']);
    assert.strictEqual(result.relationToken, 'in');
    assert.deepStrictEqual(result.secondaryTargetSpan, ['old', 'chest']);
  });

  it('parses malformed relation form shape without semantic classification', function () {
    const result = parseInput('put in old chest');

    assert.strictEqual(result.canonicalInput, 'put in old chest');
    assert.strictEqual(result.intentToken, 'put');
    assert.deepStrictEqual(result.primaryTargetSpan, []);
    assert.strictEqual(result.relationToken, 'in');
    assert.deepStrictEqual(result.secondaryTargetSpan, ['old', 'chest']);
  });

  it('returns raw and normalized input for empty command text', function () {
    const result = parseInput('   ');

    assert.strictEqual(result.actorInput, '   ');
    assert.strictEqual(result.canonicalInput, '   ');
    assert.strictEqual(result.normalizedInput, '');
    assert.strictEqual(result.intentToken, undefined);
    assert.strictEqual(result.primaryTargetSpan, undefined);
    assert.strictEqual(result.relationToken, undefined);
    assert.strictEqual(result.secondaryTargetSpan, undefined);
  });

  it('canonicalizes movement shorthand before parsing', function () {
    const result = parseInput('n');

    assert.strictEqual(result.actorInput, 'n');
    assert.strictEqual(result.canonicalInput, 'go north');
    assert.strictEqual(result.normalizedInput, 'go north');
    assert.strictEqual(result.intentToken, 'go');
    assert.deepStrictEqual(result.primaryTargetSpan, ['north']);
  });

  it('canonicalizes look shorthand before parsing', function () {
    const result = parseInput('l');

    assert.strictEqual(result.actorInput, 'l');
    assert.strictEqual(result.canonicalInput, 'look');
    assert.strictEqual(result.normalizedInput, 'look');
    assert.strictEqual(result.intentToken, 'look');
    assert.strictEqual(result.primaryTargetSpan, undefined);
  });

  it('canonicalizes x <thing> shorthand before parsing', function () {
    const result = parseInput('x rusty sword');

    assert.strictEqual(result.actorInput, 'x rusty sword');
    assert.strictEqual(result.canonicalInput, 'look at rusty sword');
    assert.strictEqual(result.normalizedInput, 'look at rusty sword');
    assert.strictEqual(result.intentToken, 'look');
    assert.deepStrictEqual(result.primaryTargetSpan, ['at', 'rusty', 'sword']);
  });

  it('parses go down as direct movement text, not as relation form', function () {
    const result = parseInput('go down');

    assert.strictEqual(result.intentToken, 'go');
    assert.deepStrictEqual(result.primaryTargetSpan, ['down']);
    assert.strictEqual(result.relationToken, undefined);
    assert.strictEqual(result.secondaryTargetSpan, undefined);
  });
});
