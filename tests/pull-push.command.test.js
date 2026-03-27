// @ts-check
'use strict';

const assert = require('assert');

const pullCommand = require('../commands/pull');
const pushCommand = require('../commands/push');

function executeVerb(commandDef, directTarget) {
  const execute = commandDef.command({});
  return execute('', { room: {}, socket: { writable: false } }, null, {
    entityResolution: {
      ruleKey: 'direct',
      directTarget,
    },
  });
}

describe('bundle-rantamuta pull/push command surfaces', function () {
  it('declares single-entity syntax rules for pull and push', function () {
    assert.deepStrictEqual(pullCommand.metadata.syntaxRules, ['ENTITY']);
    assert.deepStrictEqual(pushCommand.metadata.syntaxRules, ['ENTITY']);
    assert.ok(Array.isArray(pullCommand.metadata.compiledRules));
    assert.ok(Array.isArray(pushCommand.metadata.compiledRules));
  });

  it('allows pull when metadata.verbs.pull is true', function () {
    const result = executeVerb(pullCommand, {
      name: 'bell rope',
      metadata: {
        verbs: {
          pull: true,
        },
      },
    });

    assert.strictEqual(result.ok, true);
  });

  it('returns PULL_NOT_PULLABLE when metadata.verbs.pull is false', function () {
    const result = executeVerb(pullCommand, {
      name: 'bell rope',
      metadata: {
        verbs: {
          pull: false,
        },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PULL_NOT_PULLABLE', details: undefined },
    });
  });

  it('ignores legacy metadata.pullable for pull', function () {
    const result = executeVerb(pullCommand, {
      name: 'bell rope',
      metadata: {
        pullable: true,
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PULL_NOT_PULLABLE', details: undefined },
    });
  });

  it('allows push when metadata.verbs.push is true', function () {
    const result = executeVerb(pushCommand, {
      name: 'stone slab',
      metadata: {
        verbs: {
          push: true,
        },
      },
    });

    assert.strictEqual(result.ok, true);
  });

  it('returns PUSH_NOT_PUSHABLE when metadata.verbs.push is false', function () {
    const result = executeVerb(pushCommand, {
      name: 'stone slab',
      metadata: {
        verbs: {
          push: false,
        },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUSH_NOT_PUSHABLE', details: undefined },
    });
  });

  it('ignores legacy metadata.pushable for push', function () {
    const result = executeVerb(pushCommand, {
      name: 'stone slab',
      metadata: {
        pushable: true,
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUSH_NOT_PUSHABLE', details: undefined },
    });
  });
});
