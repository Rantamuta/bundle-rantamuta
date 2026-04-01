// @ts-check
'use strict';

const assert = require('assert');

const { transposeAuthoredEffects } = require('../lib/runtime/authored-effects');
const {
  createHarnessScope,
  runHarnessCase,
} = require('./helpers/authored-effects-harness');

describe('authored effects transposer', function () {
  it('returns a canonical empty success envelope for an empty authored-effects array', function () {
    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [],
      expectSuccess: {
        operations: [],
        renderMessages: [],
      },
    });
  });

  it('returns one structured failure when authored effects fail shared validation', function () {
    const result = runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        { transferItem: { from: 'inventory', to: 'player' } },
      ],
      scope: createHarnessScope(),
      expectFailure: {
        code: 'AUTHORED_EFFECTS_INVALID',
      },
    });

    assert.ok(result.details);
    assert.ok(Array.isArray(result.details.errors));
    assert.deepStrictEqual(result.details.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });

  it('lowers authored transferItem effects through explicit scope resolution', function () {
    const widget = { entityReference: 'test:widget' };
    const inventory = {
      addItem() {},
      removeItem() {},
    };
    const player = {
      addItem() {},
      removeItem() {},
    };

    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
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
        refs: { widget },
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

  it('lowers movePlayer with implicit player and current-area-relative room expansion', function () {
    const destinationRoom = { entityReference: 'test:start' };
    const scope = createHarnessScope({
      state: {
        RoomManager: {
          getRoom(ref) {
            return ref === 'test:start' ? destinationRoom : null;
          },
        },
      },
    });

    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        {
          movePlayer: {
            toRoom: 'start',
          },
        },
      ],
      scope,
      expectSuccess: {
        operations: [
          {
            type: 'movePlayer',
            player: scope.player,
            toRoom: destinationRoom,
          },
        ],
        renderMessages: [],
      },
    });
  });

  it('lowers authored door effects with implicit actor and explicit targeting fields', function () {
    const scope = createHarnessScope();

    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        {
          operateDoor: {
            mutation: 'open',
            direction: 'north',
          },
        },
        {
          openDoor: {
            roomRef: 'start',
          },
        },
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
            type: 'operateDoor',
            actor: scope.actor,
            mutation: 'open',
            direction: 'north',
          },
          {
            type: 'openDoor',
            actor: scope.actor,
            roomRef: 'test:start',
          },
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

  it('fails when a door effect uses an unresolved current-area-relative roomRef', function () {
    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        {
          openDoor: {
            roomRef: 'missing',
          },
        },
      ],
      scope: createHarnessScope(),
      expectFailure: {
        code: 'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      },
    });
  });

  it('lowers authored metadata effects with implicit local targets and explicit overrides', function () {
    const scope = createHarnessScope();

    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        {
          setPlayerMetadata: {
            key: 'story.phase',
            value: 2,
          },
        },
        {
          setRoomMetadata: {
            roomRef: 'start',
            key: 'bells.rung',
            value: true,
          },
        },
        {
          setAreaMetadata: {
            key: 'story.phase',
            value: 2,
          },
        },
        {
          setWorldMetadata: {
            key: 'world.phase',
            value: 2,
          },
        },
        {
          deleteRoomMetadata: {
            key: 'bells.rung',
            force: true,
          },
        },
        {
          deleteAreaMetadata: {
            key: 'story.phase',
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
            type: 'setPlayerMetadata',
            player: scope.player,
            key: 'story.phase',
            value: 2,
          },
          {
            type: 'setRoomMetadata',
            actor: { room: scope.room },
            key: 'bells.rung',
            value: true,
          },
          {
            type: 'setAreaMetadata',
            actor: scope.actor,
            key: 'story.phase',
            value: 2,
          },
          {
            type: 'setWorldMetadata',
            key: 'world.phase',
            value: 2,
          },
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

  it('lowers authored render effects through the live broadcast and semanticEvent contracts', function () {
    const scope = createHarnessScope();

    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
        {
          broadcast: {
            audience: 'areaExceptTargets',
            message: 'Hello.',
            targetSelector: 'roomByRef',
            targetRoomRef: 'start',
            exceptSelector: 'targetsByRoomRef',
            exceptRoomRef: 'start',
          },
        },
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
      scope,
      expectSuccess: {
        operations: [],
        renderMessages: [
          {
            type: 'broadcast',
            audience: 'areaExceptTargets',
            message: 'Hello.',
            targetSelector: 'roomByRef',
            targetRoomRef: 'test:start',
            exceptSelector: 'targetsByRoomRef',
            exceptRoomRef: 'test:start',
          },
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

  it('fails when broadcast room-target selectors reference an unresolved room', function () {
    runHarnessCase({
      adapter: transposeAuthoredEffects,
      effects: [
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
        code: 'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      },
    });
  });
});
