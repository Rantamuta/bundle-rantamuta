// @ts-check
'use strict';

const assert = require('assert');

const { transposeAuthoredInstructions } = require('../lib/runtime/authored-instructions');
const {
  createHarnessScope,
  runHarnessCase,
} = require('./helpers/authored-instructions-harness');

function createRoom(entityReference) {
  const [areaRef] = String(entityReference).split(':');
  return {
    entityReference,
    area: {
      name: `${areaRef} Area`,
      entityReference: areaRef,
    },
  };
}

function createItem(entityReference, overrides = {}) {
  const itemId = String(entityReference).split(':').pop();
  return {
    entityReference,
    name: itemId,
    keywords: [itemId],
    ...overrides,
  };
}

function createContainer(name, items = []) {
  const inventory = new Set(items);
  return {
    name,
    inventory,
    addItem() { },
    removeItem() { },
  };
}

function createScopeWithRooms(roomRefs, overrides = {}) {
  const scope = createHarnessScope(overrides);
  /** @type {Record<string, *>} */
  const rooms = {
    [scope.room.entityReference]: scope.room,
  };

  for (const roomRef of roomRefs) {
    rooms[roomRef] = createRoom(roomRef);
  }

  scope.state = {
    RoomManager: {
      getRoom(ref) {
        return Object.prototype.hasOwnProperty.call(rooms, ref) ? rooms[ref] : null;
      },
    },
  };

  return { scope, rooms };
}

describe('authored instructions transposer', function () {
  it('returns a canonical empty success envelope for an empty authored-instructions array', function () {
    runHarnessCase({
      adapter: transposeAuthoredInstructions,
      instructions: [],
      expectSuccess: {
        operations: [],
        renderMessages: [],
      },
    });
  });

  it('returns one structured failure when authored instructions fail shared validation', function () {
    const result = runHarnessCase({
      adapter: transposeAuthoredInstructions,
      instructions: [
        { transferItem: { from: 'inventory', to: 'player' } },
      ],
      scope: createHarnessScope(),
      expectFailure: {
        code: 'AUTHORED_INSTRUCTIONS_INVALID',
      },
    });

    assert.ok(result.details);
    assert.ok(Array.isArray(result.details.errors));
    assert.deepStrictEqual(result.details.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  describe('transferItem', function () {
    it('lowers a happy-path transferItem effect through explicit scope resolution', function () {
      const widget = createItem('test:widget');
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            transferItem: {
              item: 'widget',
              from: 'inventory',
              to: 'player',
            },
          },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
        expectSuccess: {
          operations: [
            {
              type: 'transferItem',
              item: widget,
              from: inventory,
              to: player,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('resolves transferItem.item by current-area-relative item ref within from', function () {
      const widget = createItem('test:widget', { name: 'Iron Widget' });
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            transferItem: {
              item: 'widget',
              from: 'inventory',
              to: 'player',
            },
          },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
        expectSuccess: {
          operations: [
            {
              type: 'transferItem',
              item: widget,
              from: inventory,
              to: player,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('resolves transferItem.item by fully qualified item ref within from', function () {
      const widget = createItem('codex:widget', { name: 'Iron Widget' });
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            transferItem: {
              item: 'codex:widget',
              from: 'inventory',
              to: 'player',
            },
          },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
        expectSuccess: {
          operations: [
            {
              type: 'transferItem',
              item: widget,
              from: inventory,
              to: player,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('takes the first matching transferItem.item from the from container', function () {
      const firstWidget = createItem('test:widgetOne', {
        name: 'iron widget',
        keywords: ['widget'],
      });
      const secondWidget = createItem('test:widgetTwo', {
        name: 'iron widget',
        keywords: ['widget'],
      });
      const inventory = createContainer('inventory', [firstWidget, secondWidget]);
      const player = createContainer('player');

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            transferItem: {
              item: 'widget',
              from: 'inventory',
              to: 'player',
            },
          },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
        expectSuccess: {
          operations: [
            {
              type: 'transferItem',
              item: firstWidget,
              from: inventory,
              to: player,
            },
          ],
          renderMessages: [],
        },
      });
    });

    for (const field of ['item', 'from', 'to']) {
      it(`fails when transferItem.${field} is unresolved`, function () {
        const widget = createItem('test:widget');
        runHarnessCase({
          adapter: transposeAuthoredInstructions,
          instructions: [
            {
              transferItem: {
                item: field === 'item' ? 'missing' : 'widget',
                from: field === 'from' ? 'missing' : 'inventory',
                to: field === 'to' ? 'missing' : 'player',
              },
            },
          ],
          scope: createHarnessScope({
            inventory: createContainer('inventory', field === 'item' ? [] : [widget]),
            player: createContainer('player'),
          }),
          expectFailure: {
            code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
          },
        });
      });
    }
  });

  describe('movePlayer', function () {
    it('lowers movePlayer with implicit current player', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'forge',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: scope.player,
              toRoom: rooms['test:forge'],
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers movePlayer with an explicit player reference when provided', function () {
      const explicitPlayer = {
        name: 'Explicit Tester',
        moveTo() { },
      };
      const { scope, rooms } = createScopeWithRooms(['test:forge'], {
        refs: { explicitPlayer },
      });

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              player: 'explicitPlayer',
              toRoom: 'forge',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: explicitPlayer,
              toRoom: rooms['test:forge'],
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('resolves current-area-relative toRoom references', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'forge',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: scope.player,
              toRoom: rooms['test:forge'],
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('resolves fully qualified toRoom references', function () {
      const { scope, rooms } = createScopeWithRooms(['codex:start']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'codex:start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: scope.player,
              toRoom: rooms['codex:start'],
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('fails when movePlayer.toRoom cannot be resolved', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'missing',
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });

    it('preserves optional movePlayer.direction', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'forge',
              direction: 'north',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: scope.player,
              toRoom: rooms['test:forge'],
              direction: 'north',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('preserves optional movePlayer.suppressRoomBroadcast', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            movePlayer: {
              toRoom: 'forge',
              suppressRoomBroadcast: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'movePlayer',
              player: scope.player,
              toRoom: rooms['test:forge'],
              suppressRoomBroadcast: true,
            },
          ],
          renderMessages: [],
        },
      });
    });
  });

  describe('door ops', function () {
    it('lowers operateDoor targeted by direction', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            operateDoor: {
              mutation: 'open',
              direction: 'north',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'operateDoor',
              actor: scope.actor,
              mutation: 'open',
              direction: 'north',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers operateDoor targeted by roomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            operateDoor: {
              mutation: 'close',
              roomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'operateDoor',
              actor: scope.actor,
              mutation: 'close',
              roomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('preserves operateDoor.fromRoomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            operateDoor: {
              mutation: 'unlock',
              roomRef: 'start',
              fromRoomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'operateDoor',
              actor: scope.actor,
              mutation: 'unlock',
              roomRef: 'test:start',
              fromRoomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers openDoor targeted by direction', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            openDoor: {
              direction: 'north',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'openDoor',
              actor: scope.actor,
              direction: 'north',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers openDoor targeted by roomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            openDoor: {
              roomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'openDoor',
              actor: scope.actor,
              roomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('preserves openDoor.fromRoomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            openDoor: {
              roomRef: 'start',
              fromRoomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'openDoor',
              actor: scope.actor,
              roomRef: 'test:start',
              fromRoomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers closeAndLockDoor targeted by direction', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            closeAndLockDoor: {
              direction: 'east',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'closeAndLockDoor',
              actor: scope.actor,
              direction: 'east',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers closeAndLockDoor targeted by roomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            closeAndLockDoor: {
              roomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'closeAndLockDoor',
              actor: scope.actor,
              roomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('preserves closeAndLockDoor.fromRoomRef', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            closeAndLockDoor: {
              roomRef: 'start',
              fromRoomRef: 'start',
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'closeAndLockDoor',
              actor: scope.actor,
              roomRef: 'test:start',
              fromRoomRef: 'test:start',
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('fails when a door effect uses an unresolved current-area-relative roomRef', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            openDoor: {
              roomRef: 'missing',
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });

    it('fails when a door effect uses an unresolved fromRoomRef', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            operateDoor: {
              mutation: 'open',
              roomRef: 'start',
              fromRoomRef: 'missing',
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });
  });

  describe('metadata ops', function () {
    it('lowers setPlayerMetadata with implicit current player', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setPlayerMetadata: {
              key: 'story.phase',
              value: 2,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setPlayerMetadata',
              player: scope.player,
              key: 'story.phase',
              value: 2,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setPlayerMetadata with explicit player', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setPlayerMetadata: {
              player: 'player',
              key: 'story.phase',
              value: 2,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setPlayerMetadata',
              player: scope.player,
              key: 'story.phase',
              value: 2,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setRoomMetadata with implicit current room', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setRoomMetadata: {
              key: 'bells.rung',
              value: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setRoomMetadata',
              actor: scope.actor,
              key: 'bells.rung',
              value: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setRoomMetadata with explicit actor', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setRoomMetadata: {
              actor: 'npc',
              key: 'bells.rung',
              value: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setRoomMetadata',
              actor: scope.npc,
              key: 'bells.rung',
              value: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setRoomMetadata with explicit roomRef', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setRoomMetadata: {
              roomRef: 'forge',
              key: 'bells.rung',
              value: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setRoomMetadata',
              actor: { room: rooms['test:forge'] },
              key: 'bells.rung',
              value: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setAreaMetadata with implicit current area', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setAreaMetadata: {
              key: 'story.phase',
              value: 2,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setAreaMetadata',
              actor: scope.actor,
              key: 'story.phase',
              value: 2,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setAreaMetadata with explicit actor', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setAreaMetadata: {
              actor: 'npc',
              key: 'story.phase',
              value: 2,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'setAreaMetadata',
              actor: scope.npc,
              key: 'story.phase',
              value: 2,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers setWorldMetadata', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setWorldMetadata: {
              key: 'world.phase',
              value: 2,
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [
            {
              type: 'setWorldMetadata',
              key: 'world.phase',
              value: 2,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('preserves force across metadata delete ops', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            deleteRoomMetadata: {
              key: 'bells.rung',
              force: true,
            },
          },
          {
            deleteAreaMetadata: {
              key: 'story.phase',
              force: true,
            },
          },
          {
            deleteWorldMetadata: {
              key: 'world.phase',
              force: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'deleteRoomMetadata',
              actor: scope.actor,
              key: 'bells.rung',
              force: true,
            },
            {
              type: 'deleteAreaMetadata',
              actor: scope.actor,
              key: 'story.phase',
              force: true,
            },
            {
              type: 'deleteWorldMetadata',
              key: 'world.phase',
              force: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers deleteRoomMetadata with explicit actor', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            deleteRoomMetadata: {
              actor: 'npc',
              key: 'bells.rung',
              force: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'deleteRoomMetadata',
              actor: scope.npc,
              key: 'bells.rung',
              force: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers deleteRoomMetadata with explicit roomRef', function () {
      const { scope, rooms } = createScopeWithRooms(['test:forge']);

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            deleteRoomMetadata: {
              roomRef: 'forge',
              key: 'bells.rung',
              force: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'deleteRoomMetadata',
              actor: { room: rooms['test:forge'] },
              key: 'bells.rung',
              force: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('lowers deleteAreaMetadata with explicit actor', function () {
      const scope = createHarnessScope();

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            deleteAreaMetadata: {
              actor: 'npc',
              key: 'story.phase',
              force: true,
            },
          },
        ],
        scope,
        expectSuccess: {
          operations: [
            {
              type: 'deleteAreaMetadata',
              actor: scope.npc,
              key: 'story.phase',
              force: true,
            },
          ],
          renderMessages: [],
        },
      });
    });

    it('fails when an explicit metadata room target cannot be resolved', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setRoomMetadata: {
              roomRef: 'missing',
              key: 'bells.rung',
              value: true,
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });

    it('fails with AUTHORED_INSTRUCTIONS_INVALID for unsupported metadata targeting', function () {
      const result = runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            setRoomMetadata: {
              player: 'player',
              key: 'bells.rung',
              value: true,
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTIONS_INVALID',
          message: 'Authored instructions failed validation.',
        },
      });

      assert.deepStrictEqual(result.details, {
        errors: [
          {
            code: 'AUTHORED_INSTRUCTION_FIELD_UNSUPPORTED',
            message: 'setRoomMetadata.player is not supported for this instruction.',
            details: {
              instructionName: 'setRoomMetadata',
              field: 'player',
              value: 'player',
              supportedFields: ['actor', 'roomRef'],
            },
          },
        ],
      });
    });

    it('does not emit lowered output for unsupported metadata targeting', function () {
      const result = transposeAuthoredInstructions({
        instructions: [
          {
            setRoomMetadata: {
              player: 'player',
              key: 'bells.rung',
              value: true,
            },
          },
          {
            broadcast: {
              audience: 'room',
              message: 'Should not be reached.',
            },
          },
        ],
        scope: createHarnessScope(),
      });

      assert.deepStrictEqual(result, {
        ok: false,
        code: 'AUTHORED_INSTRUCTIONS_INVALID',
        message: 'Authored instructions failed validation.',
        details: {
          errors: [
            {
              code: 'AUTHORED_INSTRUCTION_FIELD_UNSUPPORTED',
              message: 'setRoomMetadata.player is not supported for this instruction.',
              details: {
                instructionName: 'setRoomMetadata',
                field: 'player',
                value: 'player',
                supportedFields: ['actor', 'roomRef'],
              },
            },
          ],
        },
      });
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'operations'));
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'renderMessages'));
    });
  });

  describe('broadcast', function () {
    it('lowers a plain room broadcast', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            broadcast: {
              audience: 'room',
              message: 'Hello.',
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'broadcast',
              audience: 'room',
              message: 'Hello.',
            },
          ],
        },
      });
    });

    it('lowers each currently supported broadcast audience', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          { broadcast: { audience: 'player', message: 'To player.' } },
          { broadcast: { audience: 'room', message: 'To room.' } },
          { broadcast: { audience: 'area', message: 'To area.' } },
          { broadcast: { audience: 'areaExceptTargets', message: 'To area except targets.' } },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            { type: 'broadcast', audience: 'player', message: 'To player.' },
            { type: 'broadcast', audience: 'room', message: 'To room.' },
            { type: 'broadcast', audience: 'area', message: 'To area.' },
            { type: 'broadcast', audience: 'areaExceptTargets', message: 'To area except targets.' },
          ],
        },
      });
    });

    it('preserves optional broadcast targeting fields', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            broadcast: {
              audience: 'areaExceptTargets',
              message: 'Hello.',
              targetSelector: 'roomByRef',
              targetRoomRef: 'start',
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'broadcast',
              audience: 'areaExceptTargets',
              message: 'Hello.',
              targetSelector: 'roomByRef',
              targetRoomRef: 'test:start',
            },
          ],
        },
      });
    });

    it('preserves optional broadcast exclusion fields', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            broadcast: {
              audience: 'areaExceptTargets',
              message: 'Hello.',
              exceptSelector: 'targetsByRoomRef',
              exceptRoomRef: 'start',
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'broadcast',
              audience: 'areaExceptTargets',
              message: 'Hello.',
              exceptSelector: 'targetsByRoomRef',
              exceptRoomRef: 'test:start',
            },
          ],
        },
      });
    });

    it('fails when broadcast room-target selectors reference an unresolved targetRoomRef', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            broadcast: {
              audience: 'room',
              message: 'Hello.',
              targetSelector: 'roomByRef',
              targetRoomRef: 'missing',
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });

    it('fails when broadcast room-target selectors reference an unresolved exceptRoomRef', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            broadcast: {
              audience: 'areaExceptTargets',
              message: 'Hello.',
              exceptSelector: 'targetsByRoomRef',
              exceptRoomRef: 'missing',
            },
          },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });
    });
  });

  describe('semanticEvent', function () {
    it('lowers a minimal valid semanticEvent unchanged', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            semanticEvent: {
              template: '{actor.You} nod{verb}.',
              audiencePolicy: 'self',
              participants: {
                actor: {
                  selector: 'currentActor',
                },
              },
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'semanticEvent',
              template: '{actor.You} nod{verb}.',
              audiencePolicy: 'self',
              participants: {
                actor: {
                  selector: 'currentActor',
                },
              },
            },
          ],
        },
      });
    });

    it('lowers semanticEvent payloads with additional participants unchanged', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            semanticEvent: {
              template: '{actor.You} hand{verb} {object.direct} to {target.you}.',
              audiencePolicy: 'self_target_and_others',
              participants: {
                actor: { selector: 'currentActor' },
                target: { selector: 'entityByContextRole', role: 'indirectTarget' },
                direct: { selector: 'entityByContextRole', role: 'directTarget' },
                indirect: { selector: 'entityByContextRole', role: 'indirectTarget' },
              },
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'semanticEvent',
              template: '{actor.You} hand{verb} {object.direct} to {target.you}.',
              audiencePolicy: 'self_target_and_others',
              participants: {
                actor: { selector: 'currentActor' },
                target: { selector: 'entityByContextRole', role: 'indirectTarget' },
                direct: { selector: 'entityByContextRole', role: 'directTarget' },
                indirect: { selector: 'entityByContextRole', role: 'indirectTarget' },
              },
            },
          ],
        },
      });
    });

    it('lowers semanticEvent payloads with objectText unchanged', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            semanticEvent: {
              template: '{actor.You} hand{verb} {object.direct}.',
              audiencePolicy: 'self_and_others',
              participants: {
                actor: { selector: 'currentActor' },
              },
              objectText: {
                direct: 'the widget',
              },
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'semanticEvent',
              template: '{actor.You} hand{verb} {object.direct}.',
              audiencePolicy: 'self_and_others',
              participants: {
                actor: { selector: 'currentActor' },
              },
              objectText: {
                direct: 'the widget',
              },
            },
          ],
        },
      });
    });

    it('lowers semanticEvent payloads with alternate audience policies unchanged', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          {
            semanticEvent: {
              template: '{actor.You} glance{verb} at {target.you}.',
              audiencePolicy: 'target_and_others',
              participants: {
                actor: { selector: 'currentActor' },
                target: { selector: 'entityByContextRole', role: 'indirectTarget' },
              },
            },
          },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            {
              type: 'semanticEvent',
              template: '{actor.You} glance{verb} at {target.you}.',
              audiencePolicy: 'target_and_others',
              participants: {
                actor: { selector: 'currentActor' },
                target: { selector: 'entityByContextRole', role: 'indirectTarget' },
              },
            },
          ],
        },
      });
    });
  });

  describe('mixed ordering', function () {
    it('preserves authored order within operation and render buckets', function () {
      const widget = createItem('test:widget');
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');
      const scope = createHarnessScope({
        inventory,
        player,
      });

      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          { setWorldMetadata: { key: 'phase', value: 1 } },
          { deleteWorldMetadata: { key: 'phase', force: true } },
          { broadcast: { audience: 'room', message: 'First render.' } },
          {
            semanticEvent: {
              template: '{actor.You} nod{verb}.',
              audiencePolicy: 'self',
              participants: {
                actor: { selector: 'currentActor' },
              },
            },
          },
          { transferItem: { item: 'widget', from: 'inventory', to: 'player' } },
        ],
        scope,
        expectSuccess: {
          operations: [
            { type: 'setWorldMetadata', key: 'phase', value: 1 },
            { type: 'deleteWorldMetadata', key: 'phase', force: true },
            { type: 'transferItem', item: widget, from: inventory, to: player },
          ],
          renderMessages: [
            { type: 'broadcast', audience: 'room', message: 'First render.' },
            {
              type: 'semanticEvent',
              template: '{actor.You} nod{verb}.',
              audiencePolicy: 'self',
              participants: {
                actor: { selector: 'currentActor' },
              },
            },
          ],
        },
      });
    });

    it('does not reorder several effects within the same output bucket', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          { broadcast: { audience: 'room', message: 'One.' } },
          { broadcast: { audience: 'area', message: 'Two.' } },
          { broadcast: { audience: 'player', message: 'Three.' } },
        ],
        scope: createHarnessScope(),
        expectSuccess: {
          operations: [],
          renderMessages: [
            { type: 'broadcast', audience: 'room', message: 'One.' },
            { type: 'broadcast', audience: 'area', message: 'Two.' },
            { type: 'broadcast', audience: 'player', message: 'Three.' },
          ],
        },
      });
    });
  });

  describe('failure behavior', function () {
    it('returns the first structured failure when a later effect is bad', function () {
      const widget = createItem('test:widget');
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');

      const result = runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          { transferItem: { item: 'widget', from: 'inventory', to: 'player' } },
          { movePlayer: { toRoom: 'missing' } },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED',
        },
      });

      assert.strictEqual(result.ok, false);
      assert.deepStrictEqual(result.details, {
        effectName: 'movePlayer',
        field: 'toRoom',
        value: 'missing',
      });
    });

    it('does not emit partial lowered output after a failure', function () {
      const widget = createItem('test:widget');
      const inventory = createContainer('inventory', [widget]);
      const player = createContainer('player');

      const result = transposeAuthoredInstructions({
        instructions: [
          { transferItem: { item: 'widget', from: 'inventory', to: 'player' } },
          { movePlayer: { toRoom: 'missing' } },
        ],
        scope: createHarnessScope({
          inventory,
          player,
        }),
      });

      assert.strictEqual(result.ok, false);
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'operations'));
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'renderMessages'));
    });

    it('does not return successful output when required fields are omitted', function () {
      runHarnessCase({
        adapter: transposeAuthoredInstructions,
        instructions: [
          { transferItem: { item: 'widget', from: 'inventory' } },
        ],
        scope: createHarnessScope(),
        expectFailure: {
          code: 'AUTHORED_INSTRUCTIONS_INVALID',
        },
      });
    });
  });
});
