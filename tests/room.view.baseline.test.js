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
    getExits: def.getExits,
  };
}

describe('room view baseline behavior', function () {
  it('renders title, description, exits, then room items in stable order', function () {
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
      'Exits: north, west',
      'A brass lantern hangs from a hook.',
      'You see plain crate here.',
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
});
