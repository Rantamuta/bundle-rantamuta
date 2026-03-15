// @ts-check
'use strict';

const assert = require('assert');
const sayCommand = require('../commands/say');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');

function createPlayer(def = {}) {
  return {
    room: def.room || null,
  };
}

describe('bundle-rantamuta say command', function () {
  it('declares addressed and free-text syntax rules in declaration order', function () {
    assert.ok(sayCommand.metadata);
    assert.deepStrictEqual(sayCommand.metadata.syntaxRules, [
      'TEXT to LIVING',
      'TEXT',
    ]);
    assert.ok(Array.isArray(sayCommand.metadata.compiledRules));
  });

  it('entity-resolution binds addressed speech to an indirect living target', function () {
    const tomo = {
      uuid: 'npc-tomo',
      name: 'Bell Keeper Tomo',
      keywords: ['tomo', 'keeper'],
      isNpc: true,
    };
    const player = {
      room: { npcs: new Set([tomo]) },
      inventory: new Map(),
    };

    const result = EntityResolution.resolveEntityContext({}, sayCommand, player, parseInput('say hello there to tomo'));

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.matchedRuleText, 'TEXT to LIVING');
    assert.strictEqual(result.value.indirectTarget, tomo);
    assert.strictEqual(result.value.relationTokenCanonical, 'to');
    assert.strictEqual(result.value.slots[0].surface, 'hello there');
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

  it('uses the matched TEXT slot for addressed speech output', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const tomo = {
      uuid: 'npc-tomo',
      name: 'Bell Keeper Tomo',
      keywords: ['tomo', 'keeper'],
      isNpc: true,
    };

    const result = execute('hello there to tomo', player, null, {
      entityResolution: {
        ruleKey: 'indirect',
        indirectTarget: tomo,
        relationTokenCanonical: 'to',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 2,
            tokens: ['hello', 'there'],
            surface: 'hello there',
            status: 'resolved',
          },
          {
            kind: 'LIVING',
            role: 'indirect',
            start: 3,
            end: 4,
            tokens: ['tomo'],
            surface: 'tomo',
            status: 'resolved',
            selected: tomo,
            candidates: [tomo],
          },
        ],
      },
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.render.messages[0].objectText.direct, 'hello there');
  });

  it('sanitizes whitespace and returns semanticEvent success envelope with noop plan', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('   hello\n\n   there\tfriend   ', player, null, {
      entityResolution: {
        ruleKey: 'syntax',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 3,
            tokens: ['hello', 'there', 'friend'],
            surface: 'hello there friend',
            status: 'resolved',
          },
        ],
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
              direct: 'hello there friend',
            },
          },
        ],
      },
    });
  });
});
