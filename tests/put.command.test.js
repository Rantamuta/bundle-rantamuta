'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');

const { parseInput, SEMANTIC_ERROR_CODE } = require('../lib/parse-input');

function runScenario(args) {
  return spawnSync(process.execPath, ['util/scenario-runner.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

describe('bundle-rantamuta put command guardrails', function () {
  it('parses relation-form put input into intent and target spans', function () {
    const parsedInput = parseInput('put rusty sword in old chest');

    assert.strictEqual(parsedInput.intentToken, 'put');
    assert.deepStrictEqual(parsedInput.primaryTargetSpan, ['rusty', 'sword']);
    assert.strictEqual(parsedInput.relationToken, 'in');
    assert.deepStrictEqual(parsedInput.secondaryTargetSpan, ['old', 'chest']);
    assert.strictEqual(parsedInput.classification, 'success');
    assert.strictEqual(parsedInput.errorEnvelope, null);
  });

  it('classifies missing secondary target span as semantic error', function () {
    const parsedInput = parseInput('put rusty sword in');

    assert.strictEqual(parsedInput.classification, 'semantic error');
    assert.deepStrictEqual(parsedInput.errorEnvelope, {
      class: 'semantic error',
      code: SEMANTIC_ERROR_CODE,
      details: {
        intentToken: 'put',
        relationToken: 'in',
        missingSpan: 'secondaryTargetSpan',
      },
    });
  });

  it('routes valid put syntax to the put command stub', function () {
    const result = runScenario([
      '--throughInput',
      '--room', 'rantamuta:start',
      '--command', 'put rusty sword in old chest',
      '--failOnUnknown',
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[run\] 1\/1: put rusty sword in old chest/);
    assert.match(result.stdout, /Put is not implemented yet\./);
    assert.match(result.stdout, /\[info\] scenario complete \(commands=1, unknown=0, failed=0\)/);
  });
});
