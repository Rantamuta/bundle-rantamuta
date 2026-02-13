'use strict';

const assert = require('assert');
const { handleCommand } = require('../lib/session/command-dispatch');

describe('bundle-rantamuta command-dispatch', function () {
  it('executes command when CommandManager.find returns { command, alias }', async function () {
    let executeArgs = null;
    const command = {
      execute: async (...args) => {
        executeArgs = args;
      },
    };

    const state = {
      CommandManager: {
        find: () => ({ command, alias: 'l' }),
      },
    };

    const player = {
      __pruned: false,
      socket: { writable: false },
    };

    await handleCommand(state, { player }, 'look');

    assert.ok(executeArgs);
    assert.strictEqual(executeArgs[0], '');
    assert.strictEqual(executeArgs[1], player);
    assert.strictEqual(executeArgs[2], 'l');
  });

  it('executes command when CommandManager.find returns a direct command', async function () {
    let executeArgs = null;
    const command = {
      execute: async (...args) => {
        executeArgs = args;
      },
    };

    const state = {
      CommandManager: {
        find: () => command,
      },
    };

    const player = {
      __pruned: false,
      socket: { writable: false },
    };

    await handleCommand(state, { player }, 'look');

    assert.ok(executeArgs);
    assert.strictEqual(executeArgs[0], '');
    assert.strictEqual(executeArgs[1], player);
    assert.strictEqual(executeArgs[2], null);
  });
});
