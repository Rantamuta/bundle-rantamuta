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
  it('declares literal and literalIndirect entity-resolution rules', function () {
    assert.ok(sayCommand.metadata);
    assert.deepStrictEqual(sayCommand.metadata.entityResolution, {
      rules: {
        literal: {},
        literalIndirect: {
          acceptedRelations: ['to'],
          allowUnresolvedIndirect: true,
          scopeProfile: {
            indirect: ['room.players', 'room.npcs'],
          },
        },
      },
    });
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

  it('renders directed public speech when literalIndirect resolves an addressee', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('who are you to demon', player, null, {
      entityResolution: {
        ruleKey: 'literalIndirect',
        directSpan: ['who', 'are', 'you'],
        indirectSpan: ['demon'],
        relationTokenRaw: 'to',
        relationTokenCanonical: 'to',
        indirectTarget: { name: 'demon', uuid: 'npc-demon' },
      },
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
            template: '{actor.you} {verb:say}, "{object.direct}" to {target.you}',
            audiencePolicy: 'self_target_and_others',
            participants: {
              actor: { selector: 'currentActor' },
              target: { selector: 'entityByContextRole', role: 'indirectTarget' },
            },
            objectText: {
              direct: 'who are you',
            },
          },
        ],
      },
    });
  });

  it('reconstructs literal public speech when literalIndirect does not resolve an addressee', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('who are you to demon', player, null, {
      entityResolution: {
        ruleKey: 'literalIndirect',
        directSpan: ['who', 'are', 'you'],
        indirectSpan: ['demon'],
        relationTokenRaw: 'to',
        relationTokenCanonical: 'to',
        indirectResolutionError: { code: 'TARGET_NOT_FOUND' },
      },
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
              direct: 'who are you to demon',
            },
          },
        ],
      },
    });
  });

  it('defines a dedicated player-facing message for quoted secondary spans', function () {
    assert.strictEqual(
      sayCommand.metadata.errorMessages.FORM_QUOTED_SECONDARY_UNSUPPORTED,
      'You cannot put the addressee in quotes.'
    );
  });
});
