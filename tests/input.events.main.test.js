'use strict';

const assert = require('assert');
const mainInputEvent = require('../input-events/main');

describe('bundle-rantamuta input-events main', function () {
  it('handles quit in-game without routing through command-dispatch', async function () {
    let savedCount = 0;
    let removedCount = 0;

    const player = {
      name: 'Rendall',
      room: {
        getBroadcastTargets: () => [player],
      },
    };

    const state = {
      PlayerManager: {
        save: async () => { savedCount += 1; },
        removePlayer: () => { removedCount += 1; },
      },
    };

    const session = {
      state: 'inGame',
      player,
      processing: false,
      socket: { writable: false },
    };

    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.sayAtExcept = () => { };

    try {
      await mainInputEvent.event(state)(session, 'quit');
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
    }

    assert.strictEqual(savedCount, 1);
    assert.strictEqual(removedCount, 1);
    assert.strictEqual(session.processing, false);
  });

  it('treats exit as quit in-game', async function () {
    let removedCount = 0;

    const player = {
      name: 'Rendall',
      room: {
        getBroadcastTargets: () => [player],
      },
    };

    const state = {
      PlayerManager: {
        save: async () => { },
        removePlayer: () => { removedCount += 1; },
      },
    };

    const session = {
      state: 'inGame',
      player,
      processing: false,
      socket: { writable: false },
    };

    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.sayAtExcept = () => { };

    try {
      await mainInputEvent.event(state)(session, 'exit');
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
    }

    assert.strictEqual(removedCount, 1);
    assert.strictEqual(session.processing, false);
  });
});
