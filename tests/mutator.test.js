'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ranvier = require('ranvier');
const { createPredicateRuntime } = require('../lib/helpers/predicate-runtime');
const {
  applyMutationInstruction,
  applyMutationPlan,
} = require('../lib/session/mutator');

/**
 * @param {string} root
 * @param {string} bundle
 * @param {string} area
 * @param {string} source
 */
function writePredicates(root, bundle, area, source) {
  const areaPath = path.join(root, bundle, 'areas', area);
  fs.mkdirSync(areaPath, { recursive: true });
  fs.writeFileSync(path.join(areaPath, 'predicates.js'), source, 'utf8');
}

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

  it('applies setRoomMetadata and returns inverse operation', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    const undo = applyMutationInstruction({}, {
      type: 'setRoomMetadata',
      actor,
      key: 'buttonPushed',
      value: true,
    });

    assert.deepStrictEqual(room.metadata, {
      values: {
        buttonPushed: true,
      },
    });

    undo();
    assert.deepStrictEqual(room.metadata, {});
  });

  it('does not write setRoomMetadata values into metadata.flags', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    applyMutationInstruction({}, {
      type: 'setRoomMetadata',
      actor,
      key: 'legacyButtonFlag',
      value: true,
    });

    assert.strictEqual(Object.prototype.hasOwnProperty.call(room.metadata, 'flags'), false);
    assert.strictEqual(room.metadata.values.legacyButtonFlag, true);
  });

  it('rolls back setRoomMetadata when a later operation fails', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          {
            type: 'setRoomMetadata',
            actor,
            key: 'buttonPushed',
            value: true,
          },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(room.metadata, {});
  });

  it('rejects setRoomMetadata for non-object values root', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {
        flags: 42,
        values: 'legacy',
      },
    };
    const actor = { room };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setRoomMetadata',
        actor,
        key: 'buttonPushed',
        value: true,
      }));
    }, /setRoomMetadata\.path/);

    assert.deepStrictEqual(room.metadata, {
      flags: 42,
      values: 'legacy',
    });
  });

  it('does not clobber later setRoomMetadata writes when undoing an earlier op', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    const undoA = applyMutationInstruction({}, {
      type: 'setRoomMetadata',
      actor,
      key: 'flagA',
      value: true,
    });

    const undoB = applyMutationInstruction({}, {
      type: 'setRoomMetadata',
      actor,
      key: 'flagB',
      value: true,
    });

    undoA();

    assert.deepStrictEqual(room.metadata, {
      values: {
        flagB: true,
      },
    });

    undoB();
    assert.deepStrictEqual(room.metadata, {
      values: {},
    });
  });

  it('preserves preexisting empty parent objects on setRoomMetadata undo', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {
        values: {
          puzzle: {},
        },
      },
    };
    const actor = { room };

    const undo = applyMutationInstruction({}, /** @type {*} */ ({
      type: 'setRoomMetadata',
      actor,
      key: 'puzzle.phase',
      value: 2,
    }));

    assert.deepStrictEqual(room.metadata.values, {
      puzzle: {
        phase: 2,
      },
    });

    undo();
    assert.deepStrictEqual(room.metadata.values, {
      puzzle: {},
    });
  });

  it('rejects setRoomMetadata for invalid inputs', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setRoomMetadata',
        actor: null,
        key: 'buttonPushed',
        value: true,
      }));
    }, /setRoomMetadata\.actor/);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setRoomMetadata',
        actor,
        key: 'bad-key',
        value: true,
      }));
    }, /setRoomMetadata\.key/);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setRoomMetadata',
        actor,
        key: 'buttonPushed',
        value: undefined,
      }));
    }, /setRoomMetadata\.value/);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setRoomMetadata',
        actor,
        key: 'buttonPushed',
        value: () => true,
      }));
    }, /setRoomMetadata\.value/);
  });

  it('applies setAreaMetadata and returns inverse operation', function () {
    const area = { name: 'test', metadata: {} };
    const actor = { room: { area } };

    const undo = applyMutationInstruction({}, {
      type: 'setAreaMetadata',
      actor,
      key: 'questProgress.stage1',
      value: 12,
    });

    assert.deepStrictEqual(area.metadata, {
      values: {
        questProgress: {
          stage1: 12,
        },
      },
    });

    undo();
    assert.deepStrictEqual(area.metadata, {});
  });

  it('rolls back setAreaMetadata when a later operation fails', function () {
    const area = { name: 'test', metadata: {} };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          {
            type: 'setAreaMetadata',
            actor,
            key: 'questProgress.stage1',
            value: 12,
          },
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(area.metadata, {});
  });

  it('rejects setAreaMetadata for missing actor room area context', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor: null,
        key: 'questProgress.stage1',
        value: 12,
      }));
    }, /setAreaMetadata\.actor/);
  });

  it('rejects setAreaMetadata for invalid key syntax', function () {
    const area = { name: 'test', metadata: {} };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress.bad-key',
        value: 12,
      }));
    }, /setAreaMetadata\.key/);

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress.bad key',
        value: 12,
      }));
    }, /setAreaMetadata\.key/);
  });

  it('rejects setAreaMetadata for non-object values root', function () {
    const area = {
      name: 'test',
      metadata: {
        values: 42,
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress.stage1',
        value: 12,
      }));
    }, /setAreaMetadata\.path/);
  });

  it('rejects setAreaMetadata subtree overwrite conflicts', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          questProgress: {
            stage1: 12,
          },
        },
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress',
        value: 9,
      }));
    }, /setAreaMetadata\.path/);
  });

  it('rejects setAreaMetadata undefined values and allows null values', function () {
    const area = { name: 'test', metadata: {} };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress.stage1',
        value: undefined,
      }));
    }, /setAreaMetadata\.value/);

    assert.doesNotThrow(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'setAreaMetadata',
        actor,
        key: 'questProgress.stage1',
        value: null,
      }));
    });
  });

  it('stores cloned object values for setAreaMetadata', function () {
    const area = { name: 'test', metadata: {} };
    const actor = { room: { area } };
    const payload = {
      count: 1,
      nested: { done: false },
    };

    applyMutationInstruction({}, /** @type {*} */ ({
      type: 'setAreaMetadata',
      actor,
      key: 'questProgress.snapshot',
      value: payload,
    }));

    payload.count = 99;
    payload.nested.done = true;

    assert.deepStrictEqual(area.metadata.values.questProgress.snapshot, {
      count: 1,
      nested: { done: false },
    });
  });

  it('applies setWorldMetadata and returns inverse operation', function () {
    const state = {};

    const undo = applyMutationInstruction(state, /** @type {*} */ ({
      type: 'setWorldMetadata',
      key: 'story.phase',
      value: 2,
    }));

    assert.deepStrictEqual(state.metadata.values, {
      story: {
        phase: 2,
      },
    });

    undo();

    assert.deepStrictEqual(state, {});
  });

  it('rolls back setWorldMetadata when a later operation fails', function () {
    const state = {};

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          /** @type {*} */ ({
            type: 'setWorldMetadata',
            key: 'story.phase',
            value: 2,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(state, {});
  });

  it('restores world metadata root shape when setWorldMetadata rollback runs', function () {
    const state = {};

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          /** @type {*} */ ({
            type: 'setWorldMetadata',
            key: 'story.phase',
            value: 2,
          }),
          /** @type {*} */ ({
            type: 'setWorldMetadata',
            key: 'story.history.chapter',
            value: 3,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(state, {});
  });

  it('rejects setWorldMetadata invalid key syntax', function () {
    const state = {};

    assert.throws(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'setWorldMetadata',
        key: 'story.bad-key',
        value: 2,
      }));
    }, /setWorldMetadata\.key/);

    assert.throws(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'setWorldMetadata',
        key: 'story.bad key',
        value: 2,
      }));
    }, /setWorldMetadata\.key/);
  });

  it('rejects setWorldMetadata undefined values and allows null values', function () {
    const state = {};

    assert.throws(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'setWorldMetadata',
        key: 'story.phase',
        value: undefined,
      }));
    }, /setWorldMetadata\.value/);

    assert.doesNotThrow(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'setWorldMetadata',
        key: 'story.phase',
        value: null,
      }));
    });
  });

  it('coerces setWorldMetadata non-object root values and stores cloned object values', function () {
    const state = {
      metadata: {
        values: 42,
      },
    };
    const payload = {
      count: 1,
      nested: {
        done: false,
      },
    };

    applyMutationInstruction(state, /** @type {*} */ ({
      type: 'setWorldMetadata',
      key: 'story.snapshot',
      value: payload,
    }));

    payload.count = 9;
    payload.nested.done = true;

    assert.deepStrictEqual(state.metadata.values.story.snapshot, {
      count: 1,
      nested: {
        done: false,
      },
    });
  });

  it('rejects setWorldMetadata subtree overwrite conflicts', function () {
    const state = {
      metadata: {
        values: {
          story: {
            phase: 2,
          },
        },
      },
    };

    assert.throws(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'setWorldMetadata',
        key: 'story',
        value: 5,
      }));
    }, /setWorldMetadata\.path/);
  });

  it('restores setWorldMetadata leaf when later rollback recreates ancestor path', function () {
    const state = {
      metadata: {
        values: {
          story: {
            phase: 1,
          },
        },
      },
    };

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          /** @type {*} */ ({
            type: 'setWorldMetadata',
            key: 'story.phase',
            value: 2,
          }),
          /** @type {*} */ ({
            type: 'deleteWorldMetadata',
            key: 'story',
            force: true,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(state.metadata.values, {
      story: {
        phase: 1,
      },
    });
  });

  it('applies deleteRoomMetadata leaf delete without parent pruning and restores on undo', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {
        values: {
          puzzle: {
            phase: 2,
          },
          keep: true,
        },
      },
    };
    const actor = { room };

    const undo = applyMutationInstruction({}, /** @type {*} */ ({
      type: 'deleteRoomMetadata',
      actor,
      key: 'puzzle.phase',
    }));

    assert.deepStrictEqual(room.metadata.values, {
      puzzle: {},
      keep: true,
    });

    undo();

    assert.deepStrictEqual(room.metadata.values, {
      puzzle: {
        phase: 2,
      },
      keep: true,
    });
  });

  it('treats missing deleteAreaMetadata path as idempotent no-op', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          existing: 1,
        },
      },
    };
    const actor = { room: { area } };
    const before = JSON.parse(JSON.stringify(area.metadata));

    const undo = applyMutationInstruction({}, /** @type {*} */ ({
      type: 'deleteAreaMetadata',
      actor,
      key: 'missing.path',
    }));

    assert.deepStrictEqual(area.metadata, before);
    undo();
    assert.deepStrictEqual(area.metadata, before);
  });

  it('rejects deleteAreaMetadata non-leaf deletes unless force is true', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          storyArc: {
            chapterOne: 1,
          },
        },
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'deleteAreaMetadata',
        actor,
        key: 'storyArc',
      }));
    }, /deleteAreaMetadata/);
  });

  it('allows deleteAreaMetadata non-leaf deletes with force true and restores on undo', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          storyArc: {
            chapterOne: 1,
          },
          keep: true,
        },
      },
    };
    const actor = { room: { area } };

    const undo = applyMutationInstruction({}, /** @type {*} */ ({
      type: 'deleteAreaMetadata',
      actor,
      key: 'storyArc',
      force: true,
    }));

    assert.deepStrictEqual(area.metadata.values, {
      keep: true,
    });

    undo();

    assert.deepStrictEqual(area.metadata.values, {
      storyArc: {
        chapterOne: 1,
      },
      keep: true,
    });
  });

  it('rejects deleteAreaMetadata force when provided as non-boolean', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          storyArc: {
            chapterOne: 1,
          },
        },
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'deleteAreaMetadata',
        actor,
        key: 'storyArc',
        force: 'true',
      }));
    }, /deleteAreaMetadata\.force/);
  });

  it('restores deleteAreaMetadata leaf when later op overwrites ancestor path', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {
          a: {
            b: 1,
          },
        },
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          /** @type {*} */ ({
            type: 'deleteAreaMetadata',
            actor,
            key: 'a.b',
          }),
          /** @type {*} */ ({
            type: 'setAreaMetadata',
            actor,
            key: 'a',
            value: 2,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(area.metadata.values, {
      a: {
        b: 1,
      },
    });
  });

  it('rolls back setAreaMetadata when a later deleteAreaMetadata removes its ancestor path', function () {
    const area = {
      name: 'test',
      metadata: {
        values: {},
      },
    };
    const actor = { room: { area } };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          /** @type {*} */ ({
            type: 'setAreaMetadata',
            actor,
            key: 'a.b',
            value: 1,
          }),
          /** @type {*} */ ({
            type: 'deleteAreaMetadata',
            actor,
            key: 'a',
            force: true,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(area.metadata.values, {});
  });

  it('rolls back deleteRoomMetadata when a later operation fails', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {
        values: {
          puzzle: {
            phase: 2,
          },
        },
      },
    };
    const actor = { room };

    assert.throws(() => {
      applyMutationPlan({}, {
        operations: [
          /** @type {*} */ ({
            type: 'deleteRoomMetadata',
            actor,
            key: 'puzzle.phase',
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(room.metadata.values, {
      puzzle: {
        phase: 2,
      },
    });
  });

  it('rejects deleteRoomMetadata for missing actor room context', function () {
    assert.throws(() => {
      applyMutationInstruction({}, /** @type {*} */ ({
        type: 'deleteRoomMetadata',
        actor: null,
        key: 'puzzle.phase',
      }));
    }, /deleteRoomMetadata\.actor/);
  });

  it('deletes digit-leading room metadata keys that setRoomMetadata accepts', function () {
    const room = {
      entityReference: 'test:inlineTags',
      metadata: {},
    };
    const actor = { room };

    applyMutationInstruction({}, /** @type {*} */ ({
      type: 'setRoomMetadata',
      actor,
      key: '1phase',
      value: true,
    }));
    assert.strictEqual(room.metadata.values['1phase'], true);

    const undo = applyMutationInstruction({}, /** @type {*} */ ({
      type: 'deleteRoomMetadata',
      actor,
      key: '1phase',
    }));

    assert.strictEqual(Object.prototype.hasOwnProperty.call(room.metadata.values, '1phase'), false);

    undo();
    assert.strictEqual(room.metadata.values['1phase'], true);
  });

  it('treats missing deleteWorldMetadata root/path as idempotent no-op', function () {
    const state = {};

    const undo = applyMutationInstruction(state, /** @type {*} */ ({
      type: 'deleteWorldMetadata',
      key: 'story.phase',
    }));

    assert.deepStrictEqual(state, {});
    undo();
    assert.deepStrictEqual(state, {});
  });

  it('applies deleteWorldMetadata leaf delete without parent pruning and restores on undo', function () {
    const state = {
      metadata: {
        values: {
          story: {
            phase: 2,
          },
          keep: true,
        },
      },
    };

    const undo = applyMutationInstruction(state, /** @type {*} */ ({
      type: 'deleteWorldMetadata',
      key: 'story.phase',
    }));

    assert.deepStrictEqual(state.metadata.values, {
      story: {},
      keep: true,
    });

    undo();

    assert.deepStrictEqual(state.metadata.values, {
      story: {
        phase: 2,
      },
      keep: true,
    });
  });

  it('rejects deleteWorldMetadata non-leaf deletes unless force is true', function () {
    const state = {
      metadata: {
        values: {
          story: {
            phase: 2,
          },
        },
      },
    };

    assert.throws(() => {
      applyMutationInstruction(state, /** @type {*} */ ({
        type: 'deleteWorldMetadata',
        key: 'story',
      }));
    }, /deleteWorldMetadata/);
  });

  it('rolls back deleteWorldMetadata when a later operation fails', function () {
    const state = {
      metadata: {
        values: {
          story: {
            phase: 2,
          },
          keep: true,
        },
      },
    };

    assert.throws(() => {
      applyMutationPlan(state, {
        operations: [
          /** @type {*} */ ({
            type: 'deleteWorldMetadata',
            key: 'story',
            force: true,
          }),
          /** @type {*} */ ({ type: 'unsupported' }),
        ],
      });
    }, /Unsupported mutation instruction type/);

    assert.deepStrictEqual(state.metadata.values, {
      story: {
        phase: 2,
      },
      keep: true,
    });
  });

  it('integrates setRoomMetadata with q.getRoomMetadata without q.roomFlag helper', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutator-integration-'));
    try {
      writePredicates(
        tempRoot,
        'bundle-test',
        'integration',
        `module.exports = {
          setRoomMetadataInterop: ({ q }) => (
            typeof q.roomFlag === 'undefined'
            && q.getRoomMetadata('integration:crypt', 'buttonPushed') === true
          ),
        };`
      );

      const runtime = createPredicateRuntime({
        bundlesRootPath: tempRoot,
        logger: {
          warn: () => {},
          error: () => {},
        },
      });

      const area = {
        bundle: 'bundle-test',
        name: 'integration',
        metadata: {},
      };
      const room = {
        entityReference: 'integration:crypt',
        area,
        metadata: {},
        items: [],
      };
      const world = {
        RoomManager: {
          getRoom: roomRef => roomRef === 'integration:crypt' ? room : null,
        },
        AreaManager: {
          getAreaByReference: areaRef => areaRef === 'integration' ? area : null,
          getArea: name => name === 'integration' ? area : null,
        },
        ItemManager: {
          items: new Set(),
        },
      };
      const state = {
        RoomManager: world.RoomManager,
      };
      const actor = { room };

      applyMutationInstruction(state, {
        type: 'setRoomMetadata',
        actor,
        key: 'buttonPushed',
        value: true,
      });

      assert.strictEqual(runtime.evaluate('setRoomMetadataInterop', {
        actor: null,
        room,
        area,
        world,
        source: 'room.description',
      }), true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
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
