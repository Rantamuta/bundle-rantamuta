const assert = require('assert');
const { Logger } = require('ranvier');

const {
  _scanVirtualDoorPairs,
  ensureVirtualDoorService,
  disposeVirtualDoorService,
} = require('../lib/doors/virtual-door-service');

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

  it('reconciles disagreement and immediately reflects effective state to both directional records', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: false, locked: false } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: false, locked: true } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    const pair = result.pairByEdgeKey.get('test:a->test:b');

    assert.ok(pair);
    assert.deepStrictEqual(pair.state, { closed: true, locked: true });
    assert.deepStrictEqual(roomA.doors.get('test:b'), { closed: true, locked: true });
    assert.deepStrictEqual(roomB.doors.get('test:a'), { closed: true, locked: true });
  });

  it('reconciles closed disagreement without introducing lock', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: true, locked: false } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: false, locked: false } },
    });

    const result = _scanVirtualDoorPairs(createState([roomA, roomB]));
    const pair = result.pairByEdgeKey.get('test:a->test:b');

    assert.ok(pair);
    assert.deepStrictEqual(pair.state, { closed: true, locked: false });
    assert.deepStrictEqual(roomA.doors.get('test:b'), { closed: true, locked: false });
    assert.deepStrictEqual(roomB.doors.get('test:a'), { closed: true, locked: false });
  });
});

describe('virtual-door-service mutateDoor', function () {
  let originalWarn;

  beforeEach(function () {
    originalWarn = Logger.warn;
    Logger.warn = () => {};
  });

  afterEach(function () {
    Logger.warn = originalWarn;
  });

  it('applies open mutation through virtual pair by explicit roomRef', function () {
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
    const state = createState([roomA, roomB]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    const result = service.mutateDoor({
      actor: { room: roomA },
      roomRef: 'test:b',
      mutation: 'open',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.virtual, true);
    assert.strictEqual(roomA.doors.get('test:b').closed, false);
    assert.strictEqual(roomA.doors.get('test:b').locked, false);
    assert.strictEqual(roomB.doors.get('test:a').closed, false);
    assert.strictEqual(roomB.doors.get('test:a').locked, false);

    disposeVirtualDoorService(state);
  });

  it('applies closeAndLock mutation by direction', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b' }],
      doors: { 'test:b': { closed: false, locked: false } },
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: false, locked: false } },
    });
    const state = createState([roomA, roomB]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    const result = service.mutateDoor({
      actor: { room: roomA },
      direction: 'north',
      mutation: 'closeAndLock',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.virtual, true);
    assert.strictEqual(roomA.doors.get('test:b').closed, true);
    assert.strictEqual(roomA.doors.get('test:b').locked, true);
    assert.strictEqual(roomB.doors.get('test:a').closed, true);
    assert.strictEqual(roomB.doors.get('test:a').locked, true);

    disposeVirtualDoorService(state);
  });

  it('falls back to directional-only mutation when edge is non-virtual', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b', virtualDoor: false }],
      doors: {},
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: true, locked: true } },
    });
    const state = createState([roomA, roomB]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    const result = service.mutateDoor({
      actor: { room: roomA },
      roomRef: 'test:b',
      mutation: 'unlock',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.virtual, false);
    assert.strictEqual(roomB.doors.get('test:a').closed, true);
    assert.strictEqual(roomB.doors.get('test:a').locked, false);

    disposeVirtualDoorService(state);
  });

  it('returns destination_missing when direction cannot be resolved', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [],
      doors: {},
    });
    const state = createState([roomA]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    const result = service.mutateDoor({
      actor: { room: roomA },
      direction: 'north',
      mutation: 'open',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'destination_missing');

    disposeVirtualDoorService(state);
  });

  it('throws on unsupported mutation verb', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [],
      doors: {},
    });
    const state = createState([roomA]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    assert.throws(() => service.mutateDoor({
      actor: { room: roomA },
      mutation: 'invalidVerb',
    }), /unsupported mutation/);

    disposeVirtualDoorService(state);
  });

  it('enforces locked implies closed when mutation preserves lock state', function () {
    const roomA = createRoom({
      entityReference: 'test:a',
      exits: [{ direction: 'north', roomId: 'test:b', virtualDoor: false }],
      doors: {},
    });
    const roomB = createRoom({
      entityReference: 'test:b',
      exits: [{ direction: 'south', roomId: 'test:a' }],
      doors: { 'test:a': { closed: false, locked: true } },
    });
    const state = createState([roomA, roomB]);
    state.RoomManager.getRoom = roomRef => state.RoomManager.rooms.get(roomRef) || null;

    const service = ensureVirtualDoorService(state);
    const result = service.mutateDoor({
      actor: { room: roomA },
      roomRef: 'test:b',
      mutation: 'close',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.virtual, false);
    assert.strictEqual(roomB.doors.get('test:a').locked, true);
    assert.strictEqual(roomB.doors.get('test:a').closed, true);

    disposeVirtualDoorService(state);
  });
});
