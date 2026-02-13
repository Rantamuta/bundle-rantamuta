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
    assert.strictEqual(result.normalizedInput, 'look');
    assert.strictEqual(result.intentToken, 'look');
    assert.strictEqual(result.primaryTargetSpan, undefined);
    assert.strictEqual(result.relationToken, undefined);
    assert.strictEqual(result.secondaryTargetSpan, undefined);
  });

  it('parses relation-form input into primary/relation/secondary spans', function () {
    const result = parseInput('put rusty sword in old chest');

    assert.strictEqual(result.actorInput, 'put rusty sword in old chest');
    assert.strictEqual(result.normalizedInput, 'put rusty sword in old chest');
    assert.strictEqual(result.intentToken, 'put');
    assert.deepStrictEqual(result.primaryTargetSpan, ['rusty', 'sword']);
    assert.strictEqual(result.relationToken, 'in');
    assert.deepStrictEqual(result.secondaryTargetSpan, ['old', 'chest']);
  });

  it('parses malformed relation form shape without semantic classification', function () {
    const result = parseInput('put in old chest');

    assert.strictEqual(result.intentToken, 'put');
    assert.deepStrictEqual(result.primaryTargetSpan, []);
    assert.strictEqual(result.relationToken, 'in');
    assert.deepStrictEqual(result.secondaryTargetSpan, ['old', 'chest']);
  });

  it('returns raw and normalized input for empty command text', function () {
    const result = parseInput('   ');

    assert.strictEqual(result.actorInput, '   ');
    assert.strictEqual(result.normalizedInput, '');
    assert.strictEqual(result.intentToken, undefined);
    assert.strictEqual(result.primaryTargetSpan, undefined);
    assert.strictEqual(result.relationToken, undefined);
    assert.strictEqual(result.secondaryTargetSpan, undefined);
  });
});
