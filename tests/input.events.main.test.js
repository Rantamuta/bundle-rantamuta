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

  it('falls through to unknown handling for non-admin teleport', async function () {
    const player = {
      name: 'Rendall',
      role: 1,
      moveTo: () => {
        throw new Error('non-admin teleport should not move player');
      },
      socket: { writable: false },
    };

    const state = {
      CommandManager: {
        get: () => null,
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
    const originalPrompt = ranvier.Broadcast.prompt;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      await mainInputEvent.event(state)(session, 'teleport codex:square');
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }

    assert.ok(messages.includes('What?'));
    assert.strictEqual(session.processing, false);
  });

  it('moves admins to resolved destination for teleport', async function () {
    const destination = { entityReference: 'codex:square' };
    let movedTo = null;
    const player = {
      name: 'Rendall',
      role: 2,
      moveTo: room => {
        movedTo = room;
      },
      socket: { writable: false },
    };

    const state = {
      RoomManager: {
        getRoom: roomRef => roomRef === destination.entityReference ? destination : null,
      },
      CommandManager: {
        get: () => {
          throw new Error('teleport should bypass command dispatch');
        },
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
    const originalPrompt = ranvier.Broadcast.prompt;
    ranvier.Broadcast.prompt = () => { };

    try {
      await mainInputEvent.event(state)(session, 'teleport codex:square');
    } finally {
      ranvier.Broadcast.prompt = originalPrompt;
    }

    assert.strictEqual(movedTo, destination);
    assert.strictEqual(session.processing, false);
  });

  it('attempts moveTo even when teleport destination is unresolved', async function () {
    let moveCount = 0;
    let movedArg = 'not-set';
    const player = {
      name: 'Rendall',
      role: 2,
      moveTo: room => {
        moveCount += 1;
        movedArg = room;
      },
      socket: { writable: false },
    };

    const state = {
      RoomManager: {
        getRoom: () => undefined,
      },
      CommandManager: {
        get: () => {
          throw new Error('teleport should bypass command dispatch');
        },
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
    const originalPrompt = ranvier.Broadcast.prompt;
    const messages = [];
    ranvier.Broadcast.sayAt = (target, message) => messages.push(String(message));
    ranvier.Broadcast.prompt = () => { };

    try {
      await mainInputEvent.event(state)(session, 'teleport missing:room');
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }

    assert.strictEqual(moveCount, 1);
    assert.strictEqual(movedArg, undefined);
    assert.deepStrictEqual(messages, []);
    assert.strictEqual(session.processing, false);
  });
});
