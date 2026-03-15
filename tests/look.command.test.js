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
  it('declares intransitive + direct entity-resolution rule metadata', function () {
    assert.ok(lookCommand.metadata);
    assert.deepStrictEqual(lookCommand.metadata.syntaxRules, ['(empty)', 'ENTITY']);
    assert.ok(Array.isArray(lookCommand.metadata.compiledRules));
    assert.ok(lookCommand.metadata.entityResolution);
    assert.deepStrictEqual(lookCommand.metadata.entityResolution.rules, {
      intransitive: {},
      direct: {
        scopeProfile: {
          direct: ['room.items', 'room.npcs', 'room.details', 'player.inventory'],
        },
      },
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution rule is not supported', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'indirect' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('entity-resolution resolves direct-object look form using look scope policy', function () {
    const chest = {
      uuid: 'room-chest',
      name: 'practice chest',
      keywords: ['practice', 'chest'],
      description: 'A lightweight chest meant for put/take testing.',
    };
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc', items: new Set([chest]) },
      inventory: new Map(),
    });

    const result = EntityResolution.resolveEntityContext({}, lookCommand, player, parseInput('look chest'));

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'direct');
    assert.strictEqual(result.value.directTarget, chest);
  });

  it('entity-resolution resolves direct-object look form against room NPCs', function () {
    const tomo = {
      uuid: 'npc-tomo',
      name: 'Bell Keeper Tomo',
      keywords: ['tomo', 'keeper', 'bell', 'caretaker'],
      description: 'A weathered caretaker with chalk on his sleeves and a calm, listening gaze.',
      isNpc: true,
    };
    const player = createPlayer({
      room: {
        title: 'Room',
        description: 'Desc',
        items: new Set(),
        npcs: new Set([tomo]),
      },
      inventory: new Map(),
    });

    const result = EntityResolution.resolveEntityContext({}, lookCommand, player, parseInput('look tomo'));

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.ruleKey, 'direct');
    assert.strictEqual(result.value.directTarget, tomo);
  });

  it('returns TARGET_NOT_FOUND when direct rule has no bound target', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct', directTarget: null },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TARGET_NOT_FOUND', details: { role: 'direct' } },
    });
  });

  it('renders direct look target description when present', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const chest = {
      name: 'practice chest',
      description: 'A lightweight chest meant for put/take testing.',
    };

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct', directTarget: chest },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: ['A lightweight chest meant for put/take testing.'],
      },
    });
  });

  it('renders direct look fallback when target has no description', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const target = {
      name: 'mysterious thing',
      keywords: ['mysterious', 'thing'],
    };

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct', directTarget: target },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: ['You see nothing special.'],
      },
    });
  });

  it('resolves inline tags in direct look target description', function () {
    const execute = lookCommand.command({
      PredicateRuntime: {
        evaluate: (name) => name === 'is_open',
      },
    });
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc', area: { name: 'test-area' } },
    });
    const target = {
      entityReference: 'test:lantern',
      name: 'lantern',
      description: 'The lantern is [is_open:open|closed].',
    };

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct', directTarget: target },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: ['The lantern is open.'],
      },
    });
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
        messages: ['<bold>Test Chamber</bold>', 'A deterministic room used for testing.'],
      },
    });
  });

  it('includes room item descriptions in render lines', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: {
        title: 'Item Room',
        description: 'Room with items.',
        exits: [
          { direction: 'north' },
          { direction: 'east' },
        ],
        items: new Set([
          { roomDesc: 'A brass key glints here.' },
          { name: 'plain box' },
        ]),
        npcs: new Set([
          { roomDesc: 'Tomo stands by the broken flagstones.' },
          { name: 'Bell Keeper Tomo' },
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
        messages: [
          '<bold>Item Room</bold>',
          'Room with items.',
          'A brass key glints here.',
          'You see plain box here.',
          'Tomo stands by the broken flagstones.',
          'You see Bell Keeper Tomo here.',
          'Exits: north, east',
        ],
      },
    });
  });

  it('omits exit line when room has no exits', function () {
    const execute = lookCommand.command({});
    const player = createPlayer({
      room: {
        title: 'Quiet Room',
        description: 'No exits here.',
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
        messages: ['<bold>Quiet Room</bold>', 'No exits here.'],
      },
    });
  });
});
