// @ts-check
'use strict';

const assert = require('assert');
const lookCommand = require('../commands/look');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');

function createPlayer(def = {}) {
  return {
    room: def.room || null,
  };
}

describe('bundle-rantamuta look command', function () {
  it('declares intransitive entity-resolution rule metadata', function () {
    assert.ok(lookCommand.metadata);
    assert.ok(lookCommand.metadata.entityResolution);
    assert.deepStrictEqual(lookCommand.metadata.entityResolution.rules, {
      intransitive: {},
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution rule is not intransitive', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('entity-resolution rejects direct-object look form for intransitive-only declaration', function () {
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc', items: new Set() },
      inventory: new Map(),
    });

    const result = EntityResolution.resolveEntityContext({}, lookCommand, player, parseInput('look chest'));

    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.strictEqual(result.error.code, 'FORM_DIRECT_NOT_SUPPORTED');
  });

  it('returns LOOK_NO_ROOM when player has no room', function () {
    const execute = lookCommand.command({});
    const player = createPlayer();

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'LOOK_NO_ROOM', details: undefined },
    });
  });

  it('returns noop plan and render lines for room look', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: {
        title: 'Test Chamber',
        description: 'A deterministic room used for testing.',
      },
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines: ['<bold>Test Chamber</bold>', 'A deterministic room used for testing.'],
      },
    });
  });

  it('includes room item descriptions in render lines', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: {
        title: 'Item Room',
        description: 'Room with items.',
        items: new Set([
          { roomDesc: 'A brass key glints here.' },
          { name: 'plain box' },
        ]),
      },
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines: [
          '<bold>Item Room</bold>',
          'Room with items.',
          'A brass key glints here.',
          'You see plain box here.',
        ],
      },
    });
  });
});
