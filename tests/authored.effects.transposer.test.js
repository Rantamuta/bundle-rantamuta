// @ts-check
'use strict';

const assert = require('assert');

const { transposeAuthoredEffects } = require('../lib/runtime/authored-effects');
const {
  createHarnessScope,
  runHarnessCase,
} = require('./helpers/authored-effects-harness');

describe('authored effects transposer', function () {
  it('returns a canonical empty success envelope for an empty authored-effects array', function () {
    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [],
      expectSuccess: {
        operations: [],
        renderMessages: [],
      },
    });
  });

  it('returns one structured failure when authored effects fail shared validation', function () {
    const result = runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        { transferItem: { from: 'inventory', to: 'player' } },
      ],
      scope: createHarnessScope(),
      expectFailure: {
        code: 'AUTHORED_EFFECTS_INVALID',
      },
    });

    assert.ok(result.details);
    assert.ok(Array.isArray(result.details.errors));
    assert.deepStrictEqual(result.details.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });
});
