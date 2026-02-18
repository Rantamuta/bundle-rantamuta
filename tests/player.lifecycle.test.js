'use strict';

const assert = require('assert');
const { enterGame, quitGame } = require('../lib/session/player-lifecycle');

describe('bundle-rantamuta player-lifecycle', function () {
  it('renders full room view on enterGame arrival', async function () {
    const player = {
      name: 'Rendall',
      room: {
        title: 'Test Lab',
        description: 'A practice room for manually testing item pickup and placement.',
        exits: [
          { direction: 'north' },
          { direction: 'west' },
        ],
        items: new Set([
          { roomDesc: 'A practice apple rests here.' },
          { name: 'practice chest' },
        ]),
      },
      hydrate: () => { },
    };

    const state = {
      PlayerManager: {
        exists: () => true,
        loadPlayer: async () => player,
      },
    };

    const session = {
      account: { username: 'Rendall' },
      username: 'Rendall',
      socket: { writable: false },
      state: 'getPassword',
    };

    const writes = [];
    const io = {
      writeLine: (nextSession, line) => writes.push([nextSession, line]),
    };

    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const roomLines = [];
    let promptedPlayer = null;

    ranvier.Broadcast.sayAt = (target, line) => {
      roomLines.push([target, line]);
    };
    ranvier.Broadcast.prompt = target => {
      promptedPlayer = target;
    };

    try {
      await enterGame(state, session, io);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }

    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0][0], session);
    assert.strictEqual(writes[0][1], 'Welcome, Rendall.');

    assert.deepStrictEqual(roomLines, [
      [player, '<bold>Test Lab</bold>'],
      [player, 'A practice room for manually testing item pickup and placement.'],
      [player, 'A practice apple rests here.'],
      [player, 'You see practice chest here.'],
      [player, 'Exits: north, west'],
    ]);

    assert.strictEqual(promptedPlayer, player);
    assert.strictEqual(session.player, player);
    assert.strictEqual(session.state, 'inGame');
    assert.strictEqual(player.socket, session.socket);
  });

  it('broadcasts room login message to others when room is broadcastable', async function () {
    const player = {
      name: 'Rendall',
      room: {
        title: 'Test Lab',
        description: 'A practice room.',
        exits: [],
        items: new Set(),
        getBroadcastTargets: () => [player],
      },
      hydrate: () => { },
    };

    const state = {
      PlayerManager: {
        exists: () => true,
        loadPlayer: async () => player,
      },
    };

    const session = {
      account: { username: 'Rendall' },
      username: 'Rendall',
      socket: { writable: false },
      state: 'getPassword',
    };

    const io = {
      writeLine: () => { },
    };

    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;
    const originalPrompt = ranvier.Broadcast.prompt;
    const broadcasts = [];

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.sayAtExcept = (target, message, exceptTargets) => {
      broadcasts.push({ target, message: String(message), exceptTargets });
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      await enterGame(state, session, io);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
      ranvier.Broadcast.prompt = originalPrompt;
    }

    assert.deepStrictEqual(broadcasts, [
      {
        target: player.room,
        message: 'Rendall suddenly materializes!',
        exceptTargets: [player],
      },
    ]);
  });

  it('quitGame broadcasts departure to others, saves, and removes player', async function () {
    const player = {
      name: 'Rendall',
      room: {
        title: 'Test Lab',
        getBroadcastTargets: () => [player],
      },
    };

    let savedPlayer = null;
    let removedPlayer = null;
    let removeSaveFlag = null;
    const state = {
      PlayerManager: {
        save: async (candidate) => {
          savedPlayer = candidate;
        },
        removePlayer: (candidate, saveFlag) => {
          removedPlayer = candidate;
          removeSaveFlag = saveFlag;
        },
      },
    };
    const session = { player };

    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;
    const messages = [];
    const broadcasts = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push({ target, message: String(message) });
    };
    ranvier.Broadcast.sayAtExcept = (target, message, exceptTargets) => {
      broadcasts.push({ target, message: String(message), exceptTargets });
    };

    try {
      await quitGame(state, session);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
    }

    assert.deepStrictEqual(broadcasts, [
      {
        target: player.room,
        message: 'Rendall suddenly winks out of existence!',
        exceptTargets: [player],
      },
    ]);
    assert.deepStrictEqual(messages, [
      { target: player, message: 'Goodbye.' },
    ]);
    assert.strictEqual(savedPlayer, player);
    assert.strictEqual(removedPlayer, player);
    assert.strictEqual(removeSaveFlag, true);
  });
});
