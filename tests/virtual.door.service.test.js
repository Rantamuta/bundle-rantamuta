const assert = require('assert');
const { Logger } = require('ranvier');

const { _scanVirtualDoorPairs } = require('../lib/doors/virtual-door-service');

function createRoom(def) {
  const exits = Array.isArray(def.exits) ? def.exits : [];
  const doors = def.doors instanceof Map ? def.doors : new Map(Object.entries(def.doors || {}));

  return {
    entityReference: def.entityReference,
    doors,
    getExits() {
      return exits;
    },
  };
}

function createState(rooms) {
  return {
    RoomManager: {
      rooms: new Map(rooms.map(room => [room.entityReference, room])),
    },
  };
}

describe('virtual-door-service pairing scan', function () {
  let originalWarn;
  let warnings;

  beforeEach(function () {
    warnings = [];
    originalWarn = Logger.warn;
    Logger.warn = message => warnings.push(String(message));
  });

  afterEach(function () {
    Logger.warn = originalWarn;
  });

  it('finds an eligible reciprocal pair', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: true } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));

    assert.strictEqual(result.pairByRoomRefs.size, 1);
    assert.strictEqual(result.pairByEdgeKey.size, 2);
    assert.ok(result.pairByEdgeKey.has('test:a->test:b'));
    assert.ok(result.pairByEdgeKey.has('test:b->test:a'));
    const pair = result.pairByEdgeKey.get('test:a->test:b');
    assert.strictEqual(pair.lockedBy, null);
  });

  it('skips pairing when reciprocal exit is missing', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: true } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    assert.strictEqual(result.pairByRoomRefs.size, 0);
  });

  it('skips pairing when either side has multiple exits to counterpart', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [
        { direction: 'north', roomId: 'test:b' },
        { direction: 'east', roomId: 'test:b' },
      ],
      doors: { 'test:b': { closed: true, locked: true } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    assert.strictEqual(result.pairByRoomRefs.size, 0);
  });

  it('skips pairing when either side opts out with virtualDoor: false', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b', virtualDoor: false }],
      doors: { 'test:b': { closed: true, locked: true } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    assert.strictEqual(result.pairByRoomRefs.size, 0);
  });

  it('skips pairing when reciprocal door records are missing', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: {},
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    assert.strictEqual(result.pairByRoomRefs.size, 0);
  });

  it('resolves lockedBy when both sides define the same key', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: true, lockedBy: 'test:goldKey' } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true, lockedBy: 'test:goldKey' } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    const pair = result.pairByEdgeKey.get('test:a->test:b');

    assert.ok(pair);
    assert.strictEqual(pair.lockedBy, 'test:goldkey');
  });

  it('resolves lockedBy when only one side defines a key', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: true, lockedBy: 'test:goldKey' } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    const pair = result.pairByEdgeKey.get('test:a->test:b');

    assert.ok(pair);
    assert.strictEqual(pair.lockedBy, 'test:goldkey');
  });

  it('disables virtualization and warns when lockedBy conflicts', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: true, lockedBy: 'test:goldKey' } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true, lockedBy: 'test:ironKey' } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    assert.strictEqual(result.pairByRoomRefs.size, 0);
    assert.ok(warnings.some(message => message.includes('conflicting lockedBy values')));
  });
});
