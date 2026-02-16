// @ts-check
'use strict';

const assert = require('assert');
const goCommand = require('../commands/go');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');

function createRoom(def = {}) {
  return {
    entityReference: def.entityReference || 'test:room',
    title: def.title || 'Room',
    description: def.description || 'Desc',
    items: def.items || new Set(),
    doors: def.doors || new Map(),
    getDoor(fromRoom) {
      if (!fromRoom) {
        return null;
      }
      return this.doors.get(fromRoom.entityReference) || null;
    },
  };
}

function createPlayer(def = {}) {
  return {
    room: def.room || null,
  };
}

describe('bundle-rantamuta go command', function () {
  it('declares direct entity-resolution rule metadata using room.exits scope', function () {
    assert.ok(goCommand.metadata);
    assert.ok(goCommand.metadata.entityResolution);
    assert.deepStrictEqual(goCommand.metadata.entityResolution.rules, {
      direct: {
        scopeProfile: {
          direct: ['room.exits'],
        },
      },
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution rule is not direct', function () {
    const execute = goCommand.command({});
    const player = createPlayer({ room: createRoom() });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns GO_NO_ROOM when player has no room', function () {
    const execute = goCommand.command({});
    const player = createPlayer();

    const result = execute('', player, null, {
      entityResolution: {
        ruleKey: 'direct',
        directTarget: { direction: 'east', roomId: 'test:next' },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'GO_NO_ROOM', details: undefined },
    });
  });

  it('returns GO_DESTINATION_MISSING when destination room cannot be resolved', function () {
    const execute = goCommand.command({
      RoomManager: { getRoom: () => null },
    });
    const player = createPlayer({ room: createRoom() });

    const result = execute('', player, null, {
      entityResolution: {
        ruleKey: 'direct',
        directTarget: { direction: 'east', roomId: 'test:missing' },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'GO_DESTINATION_MISSING', details: undefined },
    });
  });

  it('returns GO_EXIT_LOCKED when destination door is locked', function () {
    const currentRoom = createRoom({ entityReference: 'test:current' });
    const destination = createRoom({
      entityReference: 'test:destination',
      doors: new Map([[currentRoom.entityReference, { locked: true, closed: true }]]),
    });
    const execute = goCommand.command({
      RoomManager: {
        getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
      },
    });
    const player = createPlayer({ room: currentRoom });

    const result = execute('', player, null, {
      entityResolution: {
        ruleKey: 'direct',
        directTarget: { direction: 'east', roomId: destination.entityReference },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'GO_EXIT_LOCKED', details: undefined },
    });
  });

  it('returns GO_EXIT_CLOSED when destination door is closed', function () {
    const currentRoom = createRoom({ entityReference: 'test:current' });
    const destination = createRoom({
      entityReference: 'test:destination',
      doors: new Map([[currentRoom.entityReference, { locked: false, closed: true }]]),
    });
    const execute = goCommand.command({
      RoomManager: {
        getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
      },
    });
    const player = createPlayer({ room: currentRoom });

    const result = execute('', player, null, {
      entityResolution: {
        ruleKey: 'direct',
        directTarget: { direction: 'east', roomId: destination.entityReference },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'GO_EXIT_CLOSED', details: undefined },
    });
  });

  it('returns movePlayer plan and destination room render lines on success', function () {
    const currentRoom = createRoom({ entityReference: 'test:current' });
    const destination = createRoom({
      entityReference: 'test:destination',
      title: 'Destination',
      description: 'You have arrived.',
    });
    const execute = goCommand.command({
      RoomManager: {
        getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
      },
    });
    const player = createPlayer({ room: currentRoom });

    const result = execute('', player, null, {
      entityResolution: {
        ruleKey: 'direct',
        directTarget: { direction: 'east', roomId: destination.entityReference },
      },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
            direction: 'east',
          },
        ],
      },
      render: {
        messages: ['<bold>Destination</bold>', 'You have arrived.'],
      },
    });
  });

  it('entity-resolution rejects intransitive go form for direct-only declaration', function () {
    const player = createPlayer({ room: createRoom() });
    const result = EntityResolution.resolveEntityContext({}, goCommand, player, parseInput('go'));

    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.strictEqual(result.error.code, 'FORM_MISSING_DIRECT');
  });
});
