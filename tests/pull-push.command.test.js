// @ts-check
'use strict';

const assert = require('assert');

const pullCommand = require('../commands/pull');
const pushCommand = require('../commands/push');

describe('bundle-rantamuta pull/push command surfaces', function () {
  it('declares single-entity syntax rules for pull and push', function () {
    assert.deepStrictEqual(pullCommand.metadata.syntaxRules, ['ENTITY']);
    assert.deepStrictEqual(pushCommand.metadata.syntaxRules, ['ENTITY']);
    assert.ok(Array.isArray(pullCommand.metadata.compiledRules));
    assert.ok(Array.isArray(pushCommand.metadata.compiledRules));
  });
});
