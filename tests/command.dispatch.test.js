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
 * Test-only helper: cast a lightweight player stub to the Player type
 * expected by handleCommand/session typing.
 *
 * @param {*} value
 * @returns {Player}
 */
function asPlayer(value) {
  return /** @type {Player} */ (value);
}

/**
 * Test-only helper: build a minimal GameState stub that includes
 * PlayerManager.getPlayer(...) so command-dispatch active-player checks can
 * run without constructing a full engine GameState.
 *
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
    assert.deepStrictEqual(args[3] && args[3].parsedInput, {
      actorInput: 'look',
      normalizedInput: 'look',
      intentToken: 'look',
    });
    assert.strictEqual(args[3] && args[3].rawInput, 'look');
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

  it('stops at capture veto using bound entity-resolution context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const messages = [];
    let executeCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const coin = { uuid: 'coin-1', name: 'coin', keywords: ['coin'] };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[coin.uuid, coin]]),
        room: { items: new Set() },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              direct: {
                scopeProfile: {
                  direct: ['player.inventory'],
                },
              },
            },
          },
          errorMessages: {
            FORBIDDEN_BLOCKED: 'Blocked.',
          },
          captureChecks: [
            (context) => {
              assert.strictEqual(context.entityResolution.directTarget, coin);
              return { ok: false, vetoInfo: { code: 'FORBIDDEN_BLOCKED' } };
            },
          ],
        },
        execute: async () => {
          executeCalled = true;
          return undefined;
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect coin');

      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('Blocked.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('merges bubble operations into commit plan', async function () {
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        socket: { writable: false },
      });

      const command = {
        metadata: {
          bubbleReactions: [
            () => ({ type: 'noop' }),
          ],
        },
        execute: async () => ({
          ok: true,
          plan: {
            operations: [{ type: 'noop' }],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(committedPlan);
      assert.deepStrictEqual(committedPlan.operations, [{ type: 'noop' }, { type: 'noop' }]);
    } finally {
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs put through entity-resolution and commits transfer plan', async function () {
    const putDef = require('../commands/put');
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const sword = { uuid: 'sword-1', name: 'rusty sword', keywords: ['rusty', 'sword'] };
      const chest = {
        uuid: 'chest-1',
        name: 'old chest',
        keywords: ['old', 'chest'],
        type: 'CONTAINER',
        maxItems: 2,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[sword.uuid, sword]]),
        room: { items: new Set([chest]) },
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });

      const command = {
        metadata: putDef.metadata,
        execute: putDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put rusty sword into old chest');

      assert.ok(committedPlan);
      assert.deepStrictEqual(committedPlan.operations, [{
        type: 'transferItem',
        item: sword,
        from: player,
        to: chest,
      }]);
    } finally {
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });
});
