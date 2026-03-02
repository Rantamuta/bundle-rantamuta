'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const { getOrCreateWorldMetadataValuesRoot } = require('../lib/session/world-metadata-service');

describe('bundle-rantamuta world metadata service', function () {
  it('creates missing world metadata roots for write access', function () {
    const state = {};

    const valuesRoot = getOrCreateWorldMetadataValuesRoot(state);

    assert.strictEqual(valuesRoot, state.metadata.values);
    assert.deepStrictEqual(state, {
      metadata: {
        values: {},
      },
    });
  });

  it('coerces non-object world metadata roots and emits warning prefixes', function () {
    const warnings = [];
    const originalWarn = ranvier.Logger.warn;
    ranvier.Logger.warn = message => warnings.push(String(message));

    try {
      const state = {
        metadata: {
          values: 42,
        },
      };

      const valuesRoot = getOrCreateWorldMetadataValuesRoot(state);

      assert.strictEqual(valuesRoot, state.metadata.values);
      assert.deepStrictEqual(state.metadata, {
        values: {},
      });
      assert.ok(
        warnings.some(message => message.includes('WORLDMETA_COERCE_VALUES_ROOT:')),
        'Expected WORLDMETA_COERCE_VALUES_ROOT warning.'
      );
    } finally {
      ranvier.Logger.warn = originalWarn;
    }
  });
});
