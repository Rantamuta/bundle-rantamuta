'use strict';

const assert = require('assert');
const { enterGame } = require('../lib/session/player-lifecycle');

describe('bundle-rantamuta player-lifecycle', function () {
  it('renders full room view on enterGame arrival', async function () {
    const player = {
      name: 'Rendall',
      room: {
        title: 'Test Lab',
        description: 'A practice room for manually testing item pickup and placement.',
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
    ]);

    assert.strictEqual(promptedPlayer, player);
    assert.strictEqual(session.player, player);
    assert.strictEqual(session.state, 'inGame');
    assert.strictEqual(player.socket, session.socket);
  });
});
