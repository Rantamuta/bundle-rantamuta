// @ts-check
'use strict';

const assert = require('assert');
const { buildRoomViewLines } = require('../lib/helpers/room-view-helper');

function makeRoom(def = {}) {
  return {
    title: def.title || 'Untitled Room',
    description: def.description || 'No description.',
    exits: def.exits || [],
    items: def.items || new Set(),
    npcs: def.npcs || new Set(),
    getExits: def.getExits,
  };
}

describe('room view baseline behavior', function () {
  it('renders title, description, room items, then exits in stable order', function () {
    const room = makeRoom({
      title: 'Baseline Chamber',
      description: 'A deterministic chamber for baseline tests.',
      exits: [{ direction: 'north' }, { direction: 'west' }],
      items: new Set([
        { roomDesc: 'A brass lantern hangs from a hook.' },
        { name: 'plain crate' },
      ]),
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Baseline Chamber</bold>',
      'A deterministic chamber for baseline tests.',
      'A brass lantern hangs from a hook.',
      'You see plain crate here.',
      'Exits: north, west',
    ]);
  });

  it('omits exits line when there are no exits', function () {
    const room = makeRoom({
      title: 'Sealed Room',
      description: 'There are no visible exits.',
      exits: [],
      items: new Set(),
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Sealed Room</bold>',
      'There are no visible exits.',
    ]);
  });

  it('uses getExits when provided', function () {
    const room = makeRoom({
      title: 'API Room',
      description: 'Exits are provided by room API.',
      getExits: () => [{ direction: 'east' }, { direction: 'south' }],
      exits: [{ direction: 'north' }],
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>API Room</bold>',
      'Exits are provided by room API.',
      'Exits: east, south',
    ]);
  });

  it('omits exits with metadata.showInExits false from exits line', function () {
    const room = makeRoom({
      title: 'Hidden Exit Room',
      description: 'One route is hidden from room-view exits.',
      exits: [
        { direction: 'north' },
        { direction: 'south', metadata: { showInExits: false } },
        { direction: 'west' },
      ],
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Hidden Exit Room</bold>',
      'One route is hidden from room-view exits.',
      'Exits: north, west',
    ]);
  });

  it('keeps exits visible by default when metadata.showInExits is absent', function () {
    const room = makeRoom({
      title: 'Default Visible Room',
      description: 'Exits are visible unless explicitly hidden.',
      exits: [
        { direction: 'north' },
        { direction: 'south', metadata: {} },
      ],
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Default Visible Room</bold>',
      'Exits are visible unless explicitly hidden.',
      'Exits: north, south',
    ]);
  });

  it('keeps exits visible when metadata.showInExits is non-boolean', function () {
    const room = makeRoom({
      title: 'Invalid Flag Room',
      description: 'Only boolean false hides exits.',
      exits: [
        { direction: 'north', metadata: { showInExits: 'no' } },
        { direction: 'south', metadata: { showInExits: 0 } },
      ],
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Invalid Flag Room</bold>',
      'Only boolean false hides exits.',
      'Exits: north, south',
    ]);
  });

  it('renders room NPC lines after item lines and before exits', function () {
    const room = makeRoom({
      title: 'Courtyard',
      description: 'A weathered open space.',
      exits: [{ direction: 'north' }],
      items: new Set([
        { roomDesc: 'A lantern hangs from a hook.' },
      ]),
      npcs: new Set([
        { roomDesc: 'Tomo waits near the bell tower archway.' },
        { name: 'Bell Keeper Tomo' },
      ]),
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Courtyard</bold>',
      'A weathered open space.',
      'A lantern hangs from a hook.',
      'Tomo waits near the bell tower archway.',
      'You see Bell Keeper Tomo here.',
      'Exits: north',
    ]);
  });
});
