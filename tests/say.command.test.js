// @ts-check
'use strict';

const assert = require('assert');
const sayCommand = require('../commands/say');

function createPlayer(def = {}) {
  return {
    room: def.room || null,
  };
}

describe('bundle-rantamuta say command', function () {
  it('uses legacy entity-resolution path (no explicit declaration)', function () {
    assert.ok(sayCommand.metadata);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(sayCommand.metadata, 'entityResolution'),
      false
    );
  });

  it('returns SAY_EMPTY veto for empty normalized speech', function () {
    assert.ok(Array.isArray(sayCommand.metadata.captureChecks));
    const check = sayCommand.metadata.captureChecks[0];
    assert.strictEqual(typeof check, 'function');

    const result = check({
      parsedInput: {
        normalizedInput: 'say      ',
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      code: 'SAY_EMPTY',
    });
  });

  it('returns SAY_TOO_LONG veto when normalized speech exceeds 256 chars', function () {
    const check = sayCommand.metadata.captureChecks[0];
    const overLimit = `${'x'.repeat(257)}`;
    const result = check({
      parsedInput: {
        normalizedInput: `say ${overLimit}`,
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      code: 'SAY_TOO_LONG',
    });
  });

  it('sanitizes whitespace and returns semanticEvent success envelope with noop plan', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('   hello\n\n   there\tfriend   ', player, null, {
      entityResolution: { ruleKey: 'legacy' },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.you} {verb:say}, "{object.direct}"',
            audiencePolicy: 'self_and_others',
            participants: {
              actor: { selector: 'currentActor' },
            },
            objectText: {
              direct: 'hello there friend',
            },
          },
        ],
      },
    });
  });
});
