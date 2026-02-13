'use strict';

const assert = require('assert');
const path = require('path');
const { handleCommand } = require('../lib/session/command-dispatch');

/** @typedef {import('ranvier/types/GameState')} GameState */
/** @typedef {import('ranvier/types/Player')} Player */

/**
 * @param {*} value
 * @returns {GameState}
 */
function asGameState(value) {
  return /** @type {GameState} */ (value);
}

/**
 * @param {*} value
 * @returns {Player}
 */
function asPlayer(value) {
  return /** @type {Player} */ (value);
}

/**
 * @param {*} value
 * @param {Player} player
 * @returns {GameState}
 */
function withPlayerManager(value, player) {
  const base = value && typeof value === 'object' ? value : {};
  return asGameState({
    ...base,
    PlayerManager: {
      getPlayer: () => player,
    },
  });
}

describe('bundle-rantamuta command-dispatch', function () {
  it('executes command when CommandManager.find returns { command, alias }', async function () {
    let executeArgs = null;
    const command = {
      execute: async (...args) => {
        executeArgs = args;
      },
    };

    const player = asPlayer({
      __pruned: false,
      socket: { writable: false },
    });

    const state = withPlayerManager({
      CommandManager: {
        find: () => ({ command, alias: 'l' }),
      },
    }, player);

    await handleCommand(state, { player }, 'look');

    assert.ok(executeArgs);
    const args = /** @type {Array<*>} */ (executeArgs);
    assert.strictEqual(args[0], '');
    assert.strictEqual(args[1], player);
    assert.strictEqual(args[2], 'l');
  });

  it('executes command when CommandManager.find returns a direct command', async function () {
    let executeArgs = null;
    const command = {
      execute: async (...args) => {
        executeArgs = args;
      },
    };

    const player = asPlayer({
      __pruned: false,
      socket: { writable: false },
    });

    const state = withPlayerManager({
      CommandManager: {
        find: () => command,
      },
    }, player);

    await handleCommand(state, { player }, 'look');

    assert.ok(executeArgs);
    const args = /** @type {Array<*>} */ (executeArgs);
    assert.strictEqual(args[0], '');
    assert.strictEqual(args[1], player);
    assert.strictEqual(args[2], null);
  });

  it('preserves legacy behavior when command returns undefined', async function () {
    let called = false;
    const command = {
      execute: async () => {
        called = true;
        return undefined;
      },
    };

    const player = asPlayer({
      __pruned: false,
      socket: { writable: false },
    });

    const state = withPlayerManager({
      CommandManager: {
        find: () => ({ command, alias: 'look' }),
      },
    }, player);

    await handleCommand(state, { player }, 'look');
    assert.strictEqual(called, true);
  });

  it('applies mutation plan when command returns { ok: true, plan }', async function () {
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    /** @type {{ stateArg: GameState, planArg: * } | null} */
    let applied = null;

    mutator.applyMutationPlan = (stateArg, planArg) => {
      applied = { stateArg, planArg };
    };

    try {
      const plan = { operations: [{ type: 'noop' }] };
      const command = {
        execute: async () => ({ ok: true, plan }),
      };

      const player = asPlayer({
        __pruned: false,
        socket: { writable: false },
      });

      const state = withPlayerManager({
        CommandManager: {
          find: () => ({ command, alias: 'look' }),
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(applied);
      const appliedValue = /** @type {{ stateArg: GameState, planArg: * }} */ (applied);
      assert.strictEqual(appliedValue.stateArg, state);
      assert.strictEqual(appliedValue.planArg, plan);
    } finally {
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders failure message when command returns { ok: false, error }', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    /** @type {{ target: *, message: * }[]} */
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push({ target, message });
    };

    try {
      const command = {
        execute: async () => ({ ok: false, error: { message: 'Nope.' } }),
      };

      const player = asPlayer({
        __pruned: false,
        socket: { writable: false },
      });

      const state = withPlayerManager({
        CommandManager: {
          find: () => ({ command, alias: 'look' }),
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(messages.find(entry => entry.message === 'Nope.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
    }
  });

  it('ignores invalid non-envelope command return values', async function () {
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let mutatorCalled = false;

    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const command = {
        execute: async () => 'not-a-command-result-envelope',
      };

      const player = asPlayer({
        __pruned: false,
        socket: { writable: false },
      });

      const state = withPlayerManager({
        CommandManager: {
          find: () => ({ command, alias: 'look' }),
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(mutatorCalled, false);
    } finally {
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });
});
