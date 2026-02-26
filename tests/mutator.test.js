'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const {
  applyMutationInstruction,
  applyMutationPlan,
} = require('../lib/session/mutator');

function createContainer(items = []) {
  const bag = [...items];
  return {
    bag,
    addItem(item) {
      bag.push(item);
    },
    removeItem(item) {
      const index = bag.indexOf(item);
      if (index < 0) {
        throw new Error('Item missing from container.');
      }
      bag.splice(index, 1);
    },
  };
}

function createRoom(name) {
  return {
    name,
    players: new Set(),
    addPlayer(player) {
      this.players.add(player);
    },
    removePlayer(player) {
      this.players.delete(player);
    },
  };
}

function createPlayerInRoom(room) {
  const player = {
    room,
    moveTo(nextRoom) {
      if (this.room && this.room !== nextRoom && typeof this.room.removePlayer === 'function') {
        this.room.removePlayer(this);
      }
      this.room = nextRoom;
      if (nextRoom && typeof nextRoom.addPlayer === 'function') {
        nextRoom.addPlayer(this);
      }
    },
  };

  if (room && typeof room.addPlayer === 'function') {
    room.addPlayer(player);
  }

  return player;
}

function createDoorDestinationRoom(entityReference, fromRoomRef, doorState = { locked: false, closed: true }) {
  const doors = new Map([[fromRoomRef, { ...doorState }]]);

  return {
    entityReference,
    doors,
    getDoor(fromRoom) {
      if (!fromRoom || typeof fromRoom !== 'object' || typeof fromRoom.entityReference !== 'string') {
        return null;
      }

      return doors.get(fromRoom.entityReference) || null;
    },
    openDoor(fromRoom) {
      const door = this.getDoor(fromRoom);
      if (!door) {
        return;
      }

      door.closed = false;
    },
    unlockDoor(fromRoom) {
      const door = this.getDoor(fromRoom);
      if (!door) {
        return;
      }

      door.locked = false;
    },
    closeDoor(fromRoom) {
      const door = this.getDoor(fromRoom);
      if (!door) {
        return;
      }

      door.closed = true;
    },
    lockDoor(fromRoom) {
      const door = this.getDoor(fromRoom);
      if (!door) {
        return;
      }

      door.closed = true;
      door.locked = true;
    },
  };
}

describe('bundle-rantamuta mutator', function () {
  it('applies transferItem instruction and returns inverse operation', function () {
    const item = { id: 'test:sword' };
    const from = createContainer([item]);
    const to = createContainer();

    const undo = applyMutationInstruction({}, {
      type: 'transferItem',
      item,
      from,
      to,
    });

    assert.deepStrictEqual(from.bag, []);
    assert.deepStrictEqual(to.bag, [item]);

    undo();

    assert.deepStrictEqual(from.bag, [item]);
    assert.deepStrictEqual(to.bag, []);
  });

  it('throws for unsupported instruction types', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({ type: 'unknown-op' }));
    }, /Unsupported mutation instruction type/);
  });

  it('rejects transferItem when endpoints are not reversible', function () {
    const item = { id: 'test:coin' };
    const from = {
      removeItem: () => {},
    };
    const to = {
      addItem: () => {},
      removeItem: () => {},
    };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to,
      }));
    }, /transferItem\.from must provide addItem\(item\) and removeItem\(item\)\./);
  });

  it('restores source container if transferItem add fails', function () {
    const item = { id: 'test:ruby' };
    const from = createContainer([item]);
    const to = {
      addItem: () => {
        throw new Error('Destination full.');
      },
      removeItem: () => {},
    };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to,
      }));
    }, /Destination full\./);

    assert.deepStrictEqual(from.bag, [item]);
  });

  it('rejects transferItem when source and destination are the same container', function () {
    const item = { id: 'test:ring' };
    const from = createContainer([item]);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to: from,
      }));
    }, /transferItem\.from and transferItem\.to must be different containers\./);
  });

  it('rejects transferItem when destination is the same object as item', function () {
    const from = createContainer();
    const item = createContainer();
    from.addItem(item);
    item.carriedBy = from;

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to: item,
      }));
    }, /transferItem cannot move an item into itself or one of its descendants\./);
  });

  it('rejects transferItem when destination is contained by the item', function () {
    const from = createContainer();
    const item = createContainer();
    const inner = createContainer();
    from.addItem(item);
    item.carriedBy = from;
    item.addItem(inner);
    inner.carriedBy = item;

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'transferItem',
        item,
        from,
        to: inner,
      }));
    }, /transferItem cannot move an item into itself or one of its descendants\./);
  });

  it('rolls back prior operations when a later plan operation fails', function () {
    const item = { id: 'test:apple' };
    const from = createContainer([item]);
    const to = createContainer();

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          { type: 'transferItem', item, from, to },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(from.bag, [item]);
    assert.deepStrictEqual(to.bag, []);
  });

  it('logs error severity when rollback itself fails', function () {
    const item = { id: 'test:emerald' };
    const from = createContainer([item]);
    const to = {
      addItem() {},
      removeItem() {
        throw new Error('Rollback remove failed.');
      },
    };

    const originalLoggerError = ranvier.Logger.error;
    /** @type {string[]} */
    const errors = [];
    ranvier.Logger.error = (message) => {
      errors.push(String(message));
    };

    try {
      assert.throws(() => {
        applyMutationPlan({}, {
          operations: [
            { type: 'transferItem', item, from, to },
            /** @type {*} */ ({ type: 'unsupported' }),
          ],
        });
      }, /Unsupported mutation instruction type/);
    } finally {
      ranvier.Logger.error = originalLoggerError;
    }

    assert.ok(errors.some(message => message.includes('MUTATOR ROLLBACK FAILURE')));
    assert.ok(errors.some(message => message.includes('operation 0')));
  });

  it('accepts noop instructions in plans', function () {
    assert.doesNotThrow(() => {
      applyMutationPlan({}, {
        operations: [{ type: 'noop' }],
      });
    });
  });

  it('applies setPlayerMetadata with autovivification and returns inverse operation', function () {
    const player = { name: 'Tester', metadata: {} };

    const undo = applyMutationInstruction({}, {
      type: 'setPlayerMetadata',
      player,
      key: 'tomo.progress.lastHintAt',
      value: 1234,
    });

    assert.deepStrictEqual(player.metadata, {
      tomo: {
        progress: {
          lastHintAt: 1234,
        },
      },
    });

    undo();

    assert.deepStrictEqual(player.metadata, {});
  });

  it('rolls back setPlayerMetadata when a later operation fails', function () {
    const player = { name: 'Tester', metadata: {} };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          {
            type: 'setPlayerMetadata',
            player,
            key: 'tomo.introShown',
            value: true,
          },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(player.metadata, {});
  });

  it('rejects setPlayerMetadata when target is not a player object with metadata', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setPlayerMetadata',
        player: null,
        key: 'tomo.introShown',
        value: true,
      }));
    }, /setPlayerMetadata\.player/);
  });

  it('rejects setPlayerMetadata for invalid or unsafe key segments', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setPlayerMetadata',
        player: { metadata: {} },
        key: 'foo..bar',
        value: true,
      }));
    }, /setPlayerMetadata\.key/);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setPlayerMetadata',
        player: { metadata: {} },
        key: 'foo.__proto__.bar',
        value: true,
      }));
    }, /setPlayerMetadata\.key/);
  });

  it('rejects setPlayerMetadata when an intermediate segment is non-object', function () {
    const player = {
      metadata: {
        tomo: true,
      },
    };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setPlayerMetadata',
        player,
        key: 'tomo.progress.lastHintAt',
        value: 1234,
      }));
    }, /setPlayerMetadata\.path/);
  });

  it('applies movePlayer instruction and returns inverse operation', function () {
    const start = createRoom('start');
    const destination = createRoom('destination');
    const player = createPlayerInRoom(start);

    const undo = applyMutationInstruction({}, {
      type: 'movePlayer',
      player,
      toRoom: destination,
    });

    assert.strictEqual(player.room, destination);
    assert.strictEqual(start.players.has(player), false);
    assert.strictEqual(destination.players.has(player), true);

    undo();

    assert.strictEqual(player.room, start);
    assert.strictEqual(start.players.has(player), true);
    assert.strictEqual(destination.players.has(player), false);
  });

  it('broadcasts leave before move and arrive after move for direction-aware movement', function () {
    const start = createRoom('start');
    const destination = createRoom('destination');
    const player = createPlayerInRoom(start);
    player.name = 'Tester';
    start.getBroadcastTargets = () => [player];
    destination.getBroadcastTargets = () => [player];

    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;
    const calls = [];

    ranvier.Broadcast.sayAtExcept = (target, message, exceptTargets) => {
      calls.push({ target, message: String(message), exceptTargets });
    };

    try {
      const undo = applyMutationInstruction({}, {
        type: 'movePlayer',
        player,
        toRoom: destination,
        direction: 'west',
      });

      assert.strictEqual(player.room, destination);
      assert.deepStrictEqual(calls.map(call => call.message), [
        'Tester leaves west.',
        'Tester arrives from the east.',
      ]);
      assert.strictEqual(calls[0].target, start);
      assert.strictEqual(calls[1].target, destination);
      assert.deepStrictEqual(calls[0].exceptTargets, [player]);
      assert.deepStrictEqual(calls[1].exceptTargets, [player]);

      undo();
    } finally {
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
    }
  });

  it('rolls back movePlayer when a later operation fails', function () {
    const start = createRoom('start');
    const destination = createRoom('destination');
    const player = createPlayerInRoom(start);

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          { type: 'movePlayer', player, toRoom: destination },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.strictEqual(player.room, start);
    assert.strictEqual(start.players.has(player), true);
    assert.strictEqual(destination.players.has(player), false);
  });

  it('suppresses leave/arrive room broadcasts for movePlayer when suppressRoomBroadcast is true', function () {
    const start = createRoom('start');
    const destination = createRoom('destination');
    const player = createPlayerInRoom(start);
    player.name = 'Tester';
    start.getBroadcastTargets = () => [player];
    destination.getBroadcastTargets = () => [player];

    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;
    const calls = [];
    ranvier.Broadcast.sayAtExcept = (target, message, exceptTargets) => {
      calls.push({ target, message: String(message), exceptTargets });
    };

    try {
      const undo = applyMutationInstruction({}, {
        type: 'movePlayer',
        player,
        toRoom: destination,
        direction: 'north',
        suppressRoomBroadcast: true,
      });

      assert.strictEqual(player.room, destination);
      assert.strictEqual(calls.length, 0);

      undo();
    } finally {
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
    }
  });

  it('applies openDoor instruction by roomRef and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: true,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'openDoor',
      actor,
      roomRef: destination.entityReference,
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, true);
  });

  it('applies openDoor instruction by direction and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
      getExits() {
        return [{ direction: 'north', roomId: 'test:destination' }];
      },
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'openDoor',
      actor,
      direction: 'north',
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);
  });

  it('warns and noops when openDoor roomRef is unavailable', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom() {
          return null;
        },
      },
    };

    const originalWarn = ranvier.Logger.warn;
    /** @type {string[]} */
    const warnings = [];
    ranvier.Logger.warn = (message) => {
      warnings.push(String(message));
    };

    try {
      assert.doesNotThrow(() => {
        const undo = applyMutationInstruction(state, {
          type: 'openDoor',
          actor,
          roomRef: 'test:missing',
        });
        undo();
      });
    } finally {
      ranvier.Logger.warn = originalWarn;
    }

    assert.ok(warnings.some(message => message.includes('openDoor: destination_missing')));
  });

  it('noops openDoor when actor is absent', function () {
    const state = {
      RoomManager: {
        getRoom() {
          return null;
        },
      },
    };

    assert.doesNotThrow(() => {
      const undo = applyMutationInstruction(state, {
        type: 'openDoor',
        roomRef: 'test:any',
      });
      undo();
    });
  });

  it('rolls back openDoor when a later operation fails', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          {
            type: 'openDoor',
            actor,
            roomRef: destination.entityReference,
          },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);
  });

  it('applies closeAndLockDoor instruction by roomRef and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: false,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'closeAndLockDoor',
      actor,
      roomRef: destination.entityReference,
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, true);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);
  });

  it('applies canonical doorMutation open instruction by roomRef and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: true,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'doorMutation',
      mutation: 'open',
      actor,
      roomRef: destination.entityReference,
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, true);
  });

  it('applies canonical doorMutation unlock instruction by roomRef and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: true,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'doorMutation',
      mutation: 'unlock',
      actor,
      roomRef: destination.entityReference,
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, true);
  });

  it('warns and noops when canonical doorMutation target cannot be resolved', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom() {
          return null;
        },
      },
    };

    const originalWarn = ranvier.Logger.warn;
    /** @type {string[]} */
    const warnings = [];
    ranvier.Logger.warn = message => warnings.push(String(message));

    try {
      assert.doesNotThrow(() => {
        const undo = applyMutationInstruction(state, {
          type: 'doorMutation',
          mutation: 'open',
          actor,
          roomRef: 'test:missing',
        });
        undo();
      });
    } finally {
      ranvier.Logger.warn = originalWarn;
    }

    assert.ok(warnings.some(message => message.includes('doorMutation(open): destination_missing')));
  });

  it('treats idempotent canonical doorMutation success as no-op without warnings', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: true,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const originalWarn = ranvier.Logger.warn;
    /** @type {string[]} */
    const warnings = [];
    ranvier.Logger.warn = message => warnings.push(String(message));

    try {
      const undo = applyMutationInstruction(state, {
        type: 'doorMutation',
        mutation: 'close',
        actor,
        roomRef: destination.entityReference,
      });

      assert.strictEqual(destination.getDoor(fromRoom).closed, true);
      assert.strictEqual(destination.getDoor(fromRoom).locked, false);
      undo();
      assert.strictEqual(destination.getDoor(fromRoom).closed, true);
      assert.strictEqual(destination.getDoor(fromRoom).locked, false);
    } finally {
      ranvier.Logger.warn = originalWarn;
    }

    assert.strictEqual(warnings.length, 0);
  });

  it('applies closeAndLockDoor instruction by direction and returns inverse operation', function () {
    const fromRoom = {
      entityReference: 'test:start',
      getExits() {
        return [{ direction: 'north', roomId: 'test:destination' }];
      },
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: false,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    const undo = applyMutationInstruction(state, {
      type: 'closeAndLockDoor',
      actor,
      direction: 'north',
    });

    assert.strictEqual(destination.getDoor(fromRoom).closed, true);
    assert.strictEqual(destination.getDoor(fromRoom).locked, true);

    undo();

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);
  });

  it('warns and noops when closeAndLockDoor roomRef is unavailable', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom() {
          return null;
        },
      },
    };

    const originalWarn = ranvier.Logger.warn;
    /** @type {string[]} */
    const warnings = [];
    ranvier.Logger.warn = (message) => {
      warnings.push(String(message));
    };

    try {
      assert.doesNotThrow(() => {
        const undo = applyMutationInstruction(state, {
          type: 'closeAndLockDoor',
          actor,
          roomRef: 'test:missing',
        });
        undo();
      });
    } finally {
      ranvier.Logger.warn = originalWarn;
    }

    assert.ok(warnings.some(message => message.includes('closeAndLockDoor: destination_missing')));
  });

  it('noops closeAndLockDoor when actor is absent', function () {
    const state = {
      RoomManager: {
        getRoom() {
          return null;
        },
      },
    };

    assert.doesNotThrow(() => {
      const undo = applyMutationInstruction(state, {
        type: 'closeAndLockDoor',
        roomRef: 'test:any',
      });
      undo();
    });
  });

  it('rolls back closeAndLockDoor when a later operation fails', function () {
    const fromRoom = {
      entityReference: 'test:start',
    };
    const destination = createDoorDestinationRoom('test:destination', fromRoom.entityReference, {
      locked: false,
      closed: false,
    });
    const actor = { room: fromRoom };
    const state = {
      RoomManager: {
        getRoom(roomRef) {
          return roomRef === destination.entityReference ? destination : null;
        },
      },
    };

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          {
            type: 'closeAndLockDoor',
            actor,
            roomRef: destination.entityReference,
          },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.strictEqual(destination.getDoor(fromRoom).closed, false);
    assert.strictEqual(destination.getDoor(fromRoom).locked, false);
  });

});
