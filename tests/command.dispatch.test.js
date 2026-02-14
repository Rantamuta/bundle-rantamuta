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
  it('executes canonicalized shorthand through exact-key command lookup', async function () {
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
        commands: new Map([['look', command]]),
        get: key => key === 'look' ? command : null,
      },
    }, player);

    await handleCommand(state, { player }, 'l');

    assert.ok(executeArgs);
    const args = /** @type {Array<*>} */ (executeArgs);
    assert.strictEqual(args[0], '');
    assert.strictEqual(args[1], player);
    assert.strictEqual(args[2], null);
    assert.deepStrictEqual(args[3] && args[3].parsedInput, {
      actorInput: 'l',
      canonicalInput: 'look',
      normalizedInput: 'look',
      intentToken: 'look',
    });
    assert.strictEqual(args[3] && args[3].rawInput, 'l');
  });

  it('does not execute command when CommandManager.find cannot prove exact-key match', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    let executeArgs = null;
    const command = {
      execute: async (...args) => {
        executeArgs = args;
      },
    };

    const player = asPlayer({
      __pruned: false,
      socket: {
        writable: true,
        write: () => { },
      },
      interpolatePrompt: () => '> ',
    });

    const state = withPlayerManager({
      CommandManager: {
        find: () => command,
      },
    }, player);

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    try {
      await handleCommand(state, { player }, 'look');
      assert.strictEqual(executeArgs, null);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('passes phase context through ranvier command wrappers', async function () {
    const { Command } = require('ranvier');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let sawContext = false;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const wrapped = new Command('bundle-rantamuta', 'look', {
        aliases: ['l'],
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        command: (args, player, alias, context) => {
          sawContext = !!(context && context.entityResolution && context.entityResolution.ruleKey === 'intransitive');
          return {
            ok: true,
            plan: { operations: [{ type: 'noop' }] },
            render: { lines: ['wrapped-look-ok'] },
          };
        },
      }, 'commands/look.js');

      const player = asPlayer({
        name: 'Tester',
        socket: { writable: false },
      });

      const state = withPlayerManager({
        CommandManager: {
          find: () => ({ command: wrapped, alias: 'look' }),
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(sawContext, true);
      assert.ok(messages.includes('wrapped-look-ok'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
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

  it('renders success payload only after commit', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, { operations: [{ type: 'noop' }] });
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Render Room',
          description: 'Render description',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: lookDef.metadata,
        execute: lookDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: {
          find: () => ({ command, alias: 'look' }),
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Render Room</bold>',
        'render:Render description',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
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

  it('stops look at capture veto before target execution', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Blocked Room',
          description: 'You should not see this.',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          errorMessages: {
            ...lookDef.metadata.errorMessages,
            FORBIDDEN_BLOCKED: 'A mysterious force prevents you from looking.',
          },
          captureChecks: [
            (context) => {
              assert.strictEqual(context.entityResolution.ruleKey, 'intransitive');
              return { ok: false, vetoInfo: { code: 'FORBIDDEN_BLOCKED' } };
            },
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('A mysterious force prevents you from looking.'));
      assert.ok(!messages.includes('<bold>Blocked Room</bold>'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('uses metadata.permissions string veto message for indirect target capture policy', async function () {
    const putDef = require('../commands/put');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const apple = { uuid: 'apple-p-1', name: 'practice apple', keywords: ['practice', 'apple'] };
      const chest = {
        uuid: 'chest-p-1',
        name: 'practice chest',
        keywords: ['practice', 'chest'],
        type: 'CONTAINER',
        maxItems: 4,
        inventory: new Map(),
        metadata: {
          permissions: {
            verbs: {
              put: {
                indirect: 'The chest is extremely heavy and attached to the floor.',
              },
            },
          },
        },
        addItem() { },
        removeItem() { },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
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

      await handleCommand(state, { player }, 'put apple in chest');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('The chest is extremely heavy and attached to the floor.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('uses entity allowAction hook veto before target execution', async function () {
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
      const relic = {
        uuid: 'relic-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        allowAction(action) {
          if (action && action.verbId === 'inspect' && action.role === 'direct') {
            return 'You sense a ward and leave it untouched.';
          }
          return true;
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[relic.uuid, relic]]),
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
        },
        execute: async () => {
          executeCalled = true;
          return { ok: true, plan: { operations: [{ type: 'noop' }] } };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('You sense a ward and leave it untouched.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('prioritizes runtime allowAction over metadata.permissions for capture policy', async function () {
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
      const relic = {
        uuid: 'relic-rh-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        metadata: {
          permissions: {
            verbs: {
              inspect: true,
            },
          },
        },
        allowAction(action) {
          if (action && action.verbId === 'inspect' && action.role === 'direct') {
            return 'The ward rejects your touch.';
          }
          return true;
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[relic.uuid, relic]]),
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
        },
        execute: async () => {
          executeCalled = true;
          return { ok: true, plan: { operations: [{ type: 'noop' }] } };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('The ward rejects your touch.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('uses metadata.permissions role+relation policy with canonical relation token', async function () {
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
      const apple = { uuid: 'apple-pr-1', name: 'practice apple', keywords: ['practice', 'apple'] };
      const chest = {
        uuid: 'chest-pr-1',
        name: 'practice chest',
        keywords: ['practice', 'chest'],
        metadata: {
          permissions: {
            verbs: {
              store: {
                indirect: {
                  relations: {
                    in: 'You cannot store anything in that.',
                  },
                  default: true,
                },
              },
            },
          },
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => {
          executeCalled = true;
          return { ok: true, plan: { operations: [{ type: 'noop' }] } };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'store' }) },
      }, player);

      await handleCommand(state, { player }, 'store apple into chest');

      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('You cannot store anything in that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('falls back to role default, then verb default, in metadata.permissions', async function () {
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
      const apple = { uuid: 'apple-df-1', name: 'practice apple', keywords: ['practice', 'apple'] };
      const chest = {
        uuid: 'chest-df-1',
        name: 'practice chest',
        keywords: ['practice', 'chest'],
        metadata: {
          permissions: {
            verbs: {
              stash: {
                indirect: {
                  relations: {
                    on: 'You cannot stash anything on that.',
                  },
                  default: 'You cannot stash anything there.',
                },
                default: 'Stashing is disabled here.',
              },
            },
          },
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'on'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => {
          executeCalled = true;
          return { ok: true, plan: { operations: [{ type: 'noop' }] } };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'stash' }) },
      }, player);

      await handleCommand(state, { player }, 'stash apple in chest');
      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('You cannot stash anything there.'));

      messages.length = 0;
      chest.metadata.permissions.verbs.stash.indirect = {
        relations: {
          on: 'You cannot stash anything on that.',
        },
      };

      await handleCommand(state, { player }, 'stash apple in chest');
      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('Stashing is disabled here.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('uses metadata.permissions.default when verb-specific policy is absent', async function () {
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
      const relic = {
        uuid: 'relic-md-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        metadata: {
          permissions: {
            default: 'Nothing can be taken from this place.',
          },
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[relic.uuid, relic]]),
        room: { items: new Set() },
        socket: { writable: false },
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
        },
        execute: async () => {
          executeCalled = true;
          return { ok: true, plan: { operations: [{ type: 'noop' }] } };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.strictEqual(executeCalled, false);
      assert.ok(messages.includes('Nothing can be taken from this place.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('implicitly allows action when neither runtime hook nor metadata policy objects', async function () {
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
      const relic = {
        uuid: 'relic-ia-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[relic.uuid, relic]]),
        room: { items: new Set() },
        socket: { writable: false },
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
        },
        execute: async () => {
          executeCalled = true;
          return {
            ok: true,
            plan: { operations: [{ type: 'noop' }] },
            render: { lines: ['inspect-ok'] },
          };
        },
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.strictEqual(executeCalled, true);
      assert.ok(messages.includes('inspect-ok'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('allows look through capture when checks pass', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];
    let captureInvoked = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, { operations: [{ type: 'noop' }] });
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Allowed Room',
          description: 'You can see this.',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          captureChecks: [
            (context) => {
              captureInvoked = true;
              assert.strictEqual(context.entityResolution.ruleKey, 'intransitive');
              return { ok: true };
            },
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(captureInvoked, true);
      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Allowed Room</bold>',
        'render:You can see this.',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('applies look bubble additions to the committed plan', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let bubbleInvoked = false;
    const events = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, {
        operations: [{ type: 'noop' }, { type: 'noop' }, { type: 'noop' }],
      });
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Bubble Room',
          description: 'Bubble description',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            (context) => {
              bubbleInvoked = true;
              assert.strictEqual(context.entityResolution.ruleKey, 'intransitive');
              return [{ type: 'noop' }, { type: 'noop' }];
            },
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(bubbleInvoked, true);
      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Bubble Room</bold>',
        'render:Bubble description',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders bubble-added lines after target render when commit succeeds', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    mutator.applyMutationPlan = () => {
      events.push('commit');
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Bubble Render Room',
          description: 'Target render line',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => ({ render: { lines: ['Bubble line one', 'Bubble line two'] } }),
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Bubble Render Room</bold>',
        'render:Target render line',
        'render:Bubble line one',
        'render:Bubble line two',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('supports mixed bubble payload with operations and render lines', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, {
        operations: [{ type: 'noop' }, { type: 'noop' }],
      });
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Mixed Room',
          description: 'Mixed target line',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => ({
              operations: [{ type: 'noop' }],
              render: { lines: ['Mixed bubble line'] },
            }),
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Mixed Room</bold>',
        'render:Mixed target line',
        'render:Mixed bubble line',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('supports mixed bubble payload with transferItem and render lines', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const messages = [];
    const inventory = new Set();
    const roomItems = new Set();
    const item = { uuid: 'spike-1', name: 'spike of heroism' };

    const player = asPlayer({
      name: 'Tester',
      room: {
        title: 'Sanctum',
        description: 'A quiet sanctum.',
        addItem(added) {
          roomItems.add(added);
        },
        removeItem(removed) {
          roomItems.delete(removed);
        },
      },
      addItem(added) {
        inventory.add(added);
      },
      removeItem(removed) {
        inventory.delete(removed);
      },
      socket: { writable: false },
    });

    inventory.add(item);

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };

    try {
      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => ({
              operations: [
                {
                  type: 'transferItem',
                  item,
                  from: player,
                  to: player.room,
                },
              ],
              render: {
                lines: ['The spike hums.'],
              },
            }),
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(inventory.has(item), false);
      assert.strictEqual(roomItems.has(item), true);
      assert.deepStrictEqual(messages, [
        '<bold>Sanctum</bold>',
        'A quiet sanctum.',
        'The spike hums.',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
    }
  });

  it('suppresses bubble render lines when commit fails', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => {
      throw new Error('commit failed');
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Failure Room',
          description: 'Failure target line',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => ({ render: { lines: ['Bubble line should not render'] } }),
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(!messages.includes('Bubble line should not render'));
      assert.ok(messages.includes('Command failed.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders bubble-added lines in deterministic reaction order', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Order Room',
          description: 'Order target line',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => ({ render: { lines: ['bubble-a'] } }),
            () => ({ render: { lines: ['bubble-b'] } }),
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        '<bold>Order Room</bold>',
        'Order target line',
        'bubble-a',
        'bubble-b',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('ignores non-operation bubble return values', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;

    ranvier.Broadcast.sayAt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Room',
          description: 'Desc',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          bubbleReactions: [
            () => null,
            () => undefined,
          ],
        },
        execute: lookDef.command({}),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(committedPlan, { operations: [{ type: 'noop' }] });
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
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
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };
    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

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
      assert.ok(messages.includes('You put the rusty sword in the old chest.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs put through entity-resolution when indirect container is in player inventory', async function () {
    const putDef = require('../commands/put');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };
    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const apple = { uuid: 'apple-i-1', name: 'practice apple', keywords: ['practice', 'apple'] };
      const chest = {
        uuid: 'chest-i-1',
        name: 'practice chest',
        keywords: ['practice', 'chest'],
        type: 'CONTAINER',
        maxItems: 4,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([
          [apple.uuid, apple],
          [chest.uuid, chest],
        ]),
        room: { items: new Set() },
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

      await handleCommand(state, { player }, 'put apple in chest');

      assert.ok(committedPlan);
      assert.deepStrictEqual(committedPlan.operations, [{
        type: 'transferItem',
        item: apple,
        from: player,
        to: chest,
      }]);
      assert.ok(messages.includes('You put the apple in the chest.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs direct put through entity-resolution and commits room-drop plan', async function () {
    const putDef = require('../commands/put');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };
    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const roomItems = new Set();
      const room = {
        items: roomItems,
        addItem(item) {
          roomItems.add(item);
          item.room = this;
          item.carriedBy = null;
        },
        removeItem(item) {
          roomItems.delete(item);
          if (item.room === this) {
            item.room = null;
          }
        },
      };
      const apple = { uuid: 'apple-1', name: 'practice apple', keywords: ['practice', 'apple'] };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room,
        addItem(item) {
          this.inventory.set(item.uuid, item);
          item.carriedBy = this;
          item.room = null;
        },
        removeItem(item) {
          this.inventory.delete(item.uuid);
          if (item.carriedBy === this) {
            item.carriedBy = null;
          }
        },
        socket: { writable: false },
      });

      const command = {
        metadata: putDef.metadata,
        execute: putDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple');

      assert.ok(committedPlan);
      assert.deepStrictEqual(committedPlan.operations, [{
        type: 'transferItem',
        item: apple,
        from: player,
        to: room,
      }]);
      assert.ok(messages.includes('You put the apple down.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('vetoes wrong ritual offering at capture for put indirect target policy', async function () {
    const putDef = require('../commands/put');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const wrongItem = {
        uuid: 'wax-1',
        entityReference: 'rantamuta:waxSeal',
        name: 'wax seal',
        keywords: ['wax', 'seal'],
      };
      const bell = {
        uuid: 'bell-1',
        entityReference: 'rantamuta:crackedBell',
        name: 'cracked bell',
        keywords: ['cracked', 'bell'],
        type: 'CONTAINER',
        maxItems: 1,
        inventory: new Map(),
        metadata: {
          puzzle: {
            putPolicy: {
              acceptedItemRef: 'rantamuta:bronzeClapper',
              rejectMessage: 'That does not belong in the bell.',
              successRender: 'The cracked bell hums with a low resonance.',
            },
          },
        },
        addItem() { },
        removeItem() { },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[wrongItem.uuid, wrongItem]]),
        room: { items: new Set([bell]) },
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

      await handleCommand(state, { player }, 'put wax seal in cracked bell');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('That does not belong in the bell.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders ritual flavor line from put bubble reaction on correct offering', async function () {
    const putDef = require('../commands/put');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const clapper = {
        uuid: 'clapper-1',
        entityReference: 'rantamuta:bronzeClapper',
        name: 'bronze clapper',
        keywords: ['bronze', 'clapper'],
      };
      const bell = {
        uuid: 'bell-2',
        entityReference: 'rantamuta:crackedBell',
        name: 'cracked bell',
        keywords: ['cracked', 'bell'],
        type: 'CONTAINER',
        maxItems: 1,
        inventory: new Map(),
        metadata: {
          puzzle: {
            putPolicy: {
              acceptedItemRef: 'rantamuta:bronzeClapper',
              rejectMessage: 'That does not belong in the bell.',
              successRender: 'The cracked bell hums with a low resonance.',
            },
          },
        },
        addItem() { },
        removeItem() { },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[clapper.uuid, clapper]]),
        room: { items: new Set([bell]) },
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

      await handleCommand(state, { player }, 'put bronze clapper in cracked bell');

      assert.ok(messages.includes('You put the bronze clapper in the cracked bell.'));
      assert.ok(messages.includes('The cracked bell hums with a low resonance.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders put-specific missing-direct prompt for bare put input', async function () {
    const putDef = require('../commands/put');
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
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room: { items: new Set() },
        socket: { writable: false },
      });

      const command = {
        metadata: putDef.metadata,
        execute: putDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put');

      assert.ok(messages.includes('Put what?'));
      assert.ok(!messages.includes('You can\'t do that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('renders take-specific missing-direct prompt for bare take input', async function () {
    const takeDef = require('../commands/take');
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
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room: { items: new Set() },
        isInventoryFull: () => false,
        socket: { writable: false },
      });

      const command = {
        metadata: takeDef.metadata,
        execute: takeDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take');

      assert.ok(messages.includes('Take what?'));
      assert.ok(!messages.includes('You can\'t do that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('runs inventory through entity-resolution and renders empty inventory message', async function () {
    const inventoryDef = require('../commands/inventory');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };
    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        socket: { writable: false },
      });

      const command = {
        metadata: inventoryDef.metadata,
        execute: inventoryDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inventory' }) },
      }, player);

      await handleCommand(state, { player }, 'inventory');

      assert.deepStrictEqual(committedPlan, { operations: [{ type: 'noop' }] });
      assert.ok(messages.includes('You have nothing.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs inventory alias "i" through entity-resolution and renders inventory lines', async function () {
    const inventoryDef = require('../commands/inventory');
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
      const apple = { uuid: 'apple-300', name: 'apple', keywords: ['apple'] };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        socket: { writable: false },
      });

      const command = {
        metadata: inventoryDef.metadata,
        execute: inventoryDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'i' }) },
      }, player);

      await handleCommand(state, { player }, 'i');

      assert.ok(messages.includes('You are carrying:'));
      assert.ok(messages.includes('- apple'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('renders go-specific missing-direct prompt for bare go input', async function () {
    const goDef = require('../commands/go');
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
      const player = asPlayer({
        name: 'Tester',
        room: { getExits: () => [] },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({ RoomManager: { getRoom: () => null } }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go');

      assert.ok(messages.includes('Go where?'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('renders go-specific no-exit message for unresolved direction', async function () {
    const goDef = require('../commands/go');
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
      const player = asPlayer({
        name: 'Tester',
        room: { getExits: () => [{ direction: 'north', roomId: 'test:elsewhere' }] },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({ RoomManager: { getRoom: () => null } }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go east');

      assert.ok(messages.includes('You can\'t go that way.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('canonicalizes n and executes go north through full dispatch pipeline', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const destination = {
        entityReference: 'test:labNorth',
        title: 'Lab North Walk',
        description: 'A narrow corridor north of the test lab.',
        items: new Set(),
        getDoor: () => null,
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{ direction: 'north', roomId: destination.entityReference }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['go', command]]),
          get: key => key === 'go' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'n');

      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
          },
        ],
      });
      assert.ok(messages.includes('<bold>Lab North Walk</bold>'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('canonicalizes east and executes go east', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const destination = {
        entityReference: 'test:labEast',
        title: 'Lab East Walk',
        description: 'A narrow corridor east of the test lab.',
        items: new Set(),
        getDoor: () => null,
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{ direction: 'east', roomId: destination.entityReference }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['go', command]]),
          get: key => key === 'go' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'east');

      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
          },
        ],
      });
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs go through entity-resolution and commits movePlayer plan', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const destination = {
        entityReference: 'test:labNorth',
        title: 'Lab North Walk',
        description: 'A narrow corridor north of the test lab.',
        items: new Set(),
        getDoor: () => null,
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{ direction: 'north', roomId: destination.entityReference }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go north');

      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
          },
        ],
      });
      assert.ok(messages.includes('<bold>Lab North Walk</bold>'));
      assert.ok(messages.includes('A narrow corridor north of the test lab.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('stops go at capture veto using exit metadata.permissions message', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const destination = {
        entityReference: 'test:gate',
        title: 'Gate Room',
        description: 'A blocked gate.',
        items: new Set(),
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{
            direction: 'east',
            roomId: destination.entityReference,
            metadata: {
              permissions: {
                verbs: {
                  go: 'The portcullis is down.',
                },
              },
            },
          }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go east');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('The portcullis is down.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('applies go capture veto message for east shorthand canonicalization', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const destination = {
        entityReference: 'test:gate',
        title: 'Gate Room',
        description: 'A blocked gate.',
        items: new Set(),
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{
            direction: 'east',
            roomId: destination.entityReference,
            metadata: {
              permissions: {
                verbs: {
                  go: 'The portcullis is down.',
                },
              },
            },
          }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['go', command]]),
          get: key => key === 'go' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'east');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('The portcullis is down.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('blocks go down via bell crypt room script until required placements exist', async function () {
    const goDef = require('../commands/go');
    const bellCryptGateScript = require('../areas/rantamuta/scripts/rooms/bellCryptGate');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const destination = {
        entityReference: 'rantamuta:resonance_chamber',
        title: 'Resonance Chamber',
        description: 'A hidden chamber.',
        items: new Set(),
        getDoor: () => null,
      };
      const room = {
        entityReference: 'rantamuta:bell_crypt',
        getExits: () => [{
          direction: 'down',
          roomId: destination.entityReference,
          metadata: {
            gate: {
              denyMessage: 'A dull stone slab blocks the descent.',
              requiredPlacements: [
                { containerRef: 'rantamuta:crackedBell', itemRef: 'rantamuta:bronzeClapper' },
              ],
            },
          },
        }],
      };
      const crackedBell = {
        entityReference: 'rantamuta:crackedBell',
        inventory: new Map(),
      };
      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
        ItemManager: { items: new Set([crackedBell]) },
      }, null);
      bellCryptGateScript.listeners.spawn(state).call(room);

      const player = asPlayer({
        name: 'Tester',
        room,
        moveTo: () => { },
        socket: { writable: false },
      });
      state.PlayerManager.getPlayer = () => player;

      await handleCommand(state, { player }, 'go down');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('A dull stone slab blocks the descent.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('allows go down via bell crypt room script when required placements are satisfied', async function () {
    const goDef = require('../commands/go');
    const bellCryptGateScript = require('../areas/rantamuta/scripts/rooms/bellCryptGate');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const destination = {
        entityReference: 'rantamuta:resonance_chamber',
        title: 'Resonance Chamber',
        description: 'A hidden chamber.',
        items: new Set(),
        getDoor: () => null,
      };
      const clapper = { entityReference: 'rantamuta:bronzeClapper' };
      const crackedBell = {
        entityReference: 'rantamuta:crackedBell',
        inventory: new Map([['clapper-1', clapper]]),
      };
      const room = {
        entityReference: 'rantamuta:bell_crypt',
        getExits: () => [{
          direction: 'down',
          roomId: destination.entityReference,
          metadata: {
            gate: {
              denyMessage: 'A dull stone slab blocks the descent.',
              requiredPlacements: [
                { containerRef: 'rantamuta:crackedBell', itemRef: 'rantamuta:bronzeClapper' },
              ],
            },
          },
        }],
      };
      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
        ItemManager: { items: new Set([crackedBell, clapper]) },
      }, null);
      bellCryptGateScript.listeners.spawn(state).call(room);

      const player = asPlayer({
        name: 'Tester',
        room,
        moveTo: () => { },
        socket: { writable: false },
      });
      state.PlayerManager.getPlayer = () => player;

      await handleCommand(state, { player }, 'go down');

      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
          },
        ],
      });
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('canonicalizes l to look and renders room output', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Render Room',
          description: 'Render description',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: lookDef.metadata,
        execute: lookDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['look', command]]),
          get: key => key === 'look' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'l');

      assert.ok(messages.includes('<bold>Render Room</bold>'));
      assert.ok(messages.includes('Render description'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('canonicalizes x <thing> to look at <thing> and returns look form failure', async function () {
    const lookDef = require('../commands/look');
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
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Render Room',
          description: 'Render description',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: lookDef.metadata,
        execute: lookDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['look', command]]),
          get: key => key === 'look' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'x chest');

      assert.ok(messages.includes('You can\'t do that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('keeps unknown behavior for non-canonicalized input', async function () {
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
      const player = asPlayer({
        name: 'Tester',
        socket: { writable: false },
      });

      const state = withPlayerManager({
        CommandManager: {
          commands: new Map(),
          get: () => null,
        },
      }, player);

      await handleCommand(state, { player }, 'eastward');

      assert.ok(messages.includes('What?'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('renders go door-state failures for locked and closed exits', async function () {
    const goDef = require('../commands/go');
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
      const currentRoom = { entityReference: 'test:lab' };
      const lockedDestination = {
        entityReference: 'test:locked',
        title: 'Locked',
        description: 'Locked room',
        items: new Set(),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: true, closed: true }
          : null,
      };
      const closedDestination = {
        entityReference: 'test:closed',
        title: 'Closed',
        description: 'Closed room',
        items: new Set(),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: false, closed: true }
          : null,
      };

      const player = asPlayer({
        name: 'Tester',
        room: {
          ...currentRoom,
          getExits: () => [
            { direction: 'north', roomId: lockedDestination.entityReference },
            { direction: 'south', roomId: closedDestination.entityReference },
          ],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: goDef.command({
          RoomManager: {
            getRoom: (roomId) => {
              if (roomId === lockedDestination.entityReference) {
                return lockedDestination;
              }
              if (roomId === closedDestination.entityReference) {
                return closedDestination;
              }
              return null;
            },
          },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go north');
      await handleCommand(state, { player }, 'go south');

      assert.ok(messages.includes('The way is locked.'));
      assert.ok(messages.includes('The way is closed.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('blocks take in capture when inventory is full', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const coin = { uuid: 'coin-100', name: 'coin', keywords: ['coin'] };
      const room = {
        items: new Set([coin]),
        addItem() { },
        removeItem() { },
      };
      coin.room = room;
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room,
        isInventoryFull: () => true,
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });

      const command = {
        metadata: takeDef.metadata,
        execute: takeDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take coin');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('You are carrying too much.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('blocks take for non-takeable container targets by default', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const chest = {
        uuid: 'chest-nt-1',
        name: 'old chest',
        keywords: ['old', 'chest'],
        type: 'CONTAINER',
        room: null,
        carriedBy: null,
      };
      const room = {
        items: new Set([chest]),
        addItem() { },
        removeItem() { },
      };
      chest.room = room;

      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room,
        isInventoryFull: () => false,
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });

      const command = {
        metadata: takeDef.metadata,
        execute: takeDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take chest');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('You can\'t take that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('uses metadata.permissions string veto message for take on direct target', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const chest = {
        uuid: 'chest-nt-2',
        name: 'old chest',
        keywords: ['old', 'chest'],
        type: 'CONTAINER',
        metadata: {
          permissions: {
            verbs: {
              take: 'The chest is extremely heavy and attached to the floor.',
            },
          },
        },
        room: null,
        carriedBy: null,
      };
      const room = {
        items: new Set([chest]),
        addItem() { },
        removeItem() { },
      };
      chest.room = room;

      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room,
        isInventoryFull: () => false,
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });

      const command = {
        metadata: takeDef.metadata,
        execute: takeDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take chest');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('The chest is extremely heavy and attached to the floor.'));
      assert.ok(!messages.includes('You can\'t take that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs take through entity-resolution and commits transfer plan', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let committedPlan = null;
    const messages = [];

    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };
    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const room = {
        items: new Set(),
        addItem(item) {
          this.items.add(item);
          item.room = this;
          item.carriedBy = null;
        },
        removeItem(item) {
          this.items.delete(item);
          item.room = null;
        },
      };
      const coin = { uuid: 'coin-200', name: 'gold coin', keywords: ['gold', 'coin'], room, carriedBy: null };
      room.items.add(coin);

      const player = asPlayer({
        name: 'Tester',
        inventory: new Map(),
        room,
        isInventoryFull: () => false,
        addItem(item) {
          this.inventory.set(item.uuid, item);
          item.carriedBy = this;
          item.room = null;
        },
        removeItem(item) {
          this.inventory.delete(item.uuid);
        },
        socket: { writable: false },
      });

      const command = {
        metadata: takeDef.metadata,
        execute: takeDef.command({}),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take coin');

      assert.ok(committedPlan);
      assert.deepStrictEqual(committedPlan.operations, [{
        type: 'transferItem',
        item: coin,
        from: room,
        to: player,
      }]);
      assert.ok(messages.includes('You take the coin.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });
});
