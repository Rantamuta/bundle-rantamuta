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
});
