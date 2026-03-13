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

/**
 * Test-only shim: normalize legacy command return payloads so dispatch tests can
 * remain strict (`render.messages` only) while command modules are migrated.
 *
 * @param {*} result
 * @returns {*}
 */
function normalizeLegacyRenderForTests(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const render = result.render;
  if (!render || typeof render !== 'object' || Array.isArray(render)) {
    return result;
  }

  const hasMessages = Array.isArray(render.messages);
  const hasLegacyLines = Array.isArray(render.lines);
  const hasLegacyInstructions = Array.isArray(render.instructions);

  if (hasMessages || (!hasLegacyLines && !hasLegacyInstructions)) {
    return result;
  }

  const messages = [];
  if (hasLegacyLines) {
    for (const line of render.lines) {
      messages.push(line);
    }
  }

  if (hasLegacyInstructions) {
    for (const instruction of render.instructions) {
      messages.push(instruction);
    }
  }

  return {
    ...result,
    render: {
      ...render,
      messages,
    },
  };
}

/**
 * Wrap a command execute handler so test fixtures can consume migrated
 * `render.messages` behavior without touching command implementations yet.
 *
 * @param {Function} execute
 * @returns {Function}
 */
function wrapLegacyRenderCommand(execute) {
  return async (...args) => {
    const result = await execute(...args);
    return normalizeLegacyRenderForTests(result);
  };
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
            render: { messages: ['wrapped-look-ok'] },
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
      assert.deepStrictEqual(appliedValue.planArg, plan);
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
        execute: wrapLegacyRenderCommand(lookDef.command({})),
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
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalLoggerWarn = ranvier.Logger.warn;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let mutatorCalled = false;

    ranvier.Logger.warn = () => { };
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
      ranvier.Logger.warn = originalLoggerWarn;
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
        execute: wrapLegacyRenderCommand(lookDef.command({})),
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
        execute: wrapLegacyRenderCommand(putDef.command({})),
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

  it('calls canDirect only for direct-role subjects and passes actor/verb/context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const messages = [];
    let executeCalled = false;
    let roomCanDirectCalls = 0;
    let indirectCanDirectCalls = 0;
    let indirectCanIndirectCalls = 0;
    let directCanDirectCalls = 0;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const apple = {
        uuid: 'apple-cd-role-1',
        name: 'apple',
        keywords: ['apple'],
        canDirect(actor, verbId, context) {
          directCanDirectCalls += 1;
          assert.strictEqual(actor && actor.name, 'Tester');
          assert.strictEqual(verbId, 'inspect');
          assert.strictEqual(context && context.entityResolution && context.entityResolution.directTarget, this);
          return undefined;
        },
      };
      const chest = {
        uuid: 'chest-cd-role-1',
        name: 'chest',
        keywords: ['chest'],
        canDirect() {
          indirectCanDirectCalls += 1;
          return undefined;
        },
        canIndirect(actor, verbId, relationTokenCanonical) {
          indirectCanIndirectCalls += 1;
          assert.strictEqual(actor && actor.name, 'Tester');
          assert.strictEqual(verbId, 'inspect');
          assert.strictEqual(relationTokenCanonical, 'in');
          return undefined;
        },
      };
      const room = {
        items: new Set([chest]),
        canDirect() {
          roomCanDirectCalls += 1;
          return undefined;
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room,
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
          return {
            ok: true,
            plan: { operations: [{ type: 'noop' }] },
            render: { messages: ['inspect-ok'] },
          };
        },
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect apple in chest');

      assert.strictEqual(executeCalled, true);
      assert.ok(messages.includes('inspect-ok'));
      assert.strictEqual(directCanDirectCalls, 1);
      assert.strictEqual(indirectCanDirectCalls, 0);
      assert.strictEqual(indirectCanIndirectCalls, 1);
      assert.strictEqual(roomCanDirectCalls, 0);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('treats canDirect undefined/null/allow/malformed outcomes as non-veto and continues', async function () {
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
      const cases = [
        { label: 'undefined', outcome: undefined },
        { label: 'null', outcome: null },
        { label: 'true', outcome: true },
        { label: 'allow-string', outcome: 'allow' },
        { label: 'ok-true', outcome: { ok: true } },
        { label: 'allow-true', outcome: { allow: true } },
        { label: 'number-malformed', outcome: 42 },
        { label: 'object-malformed', outcome: { nope: true } },
      ];

      for (const testCase of cases) {
        messages.length = 0;
        let executeCalled = false;
        const relic = {
          uuid: `relic-cd-${testCase.label}`,
          name: 'sealed relic',
          keywords: ['sealed', 'relic'],
          canDirect() {
            return testCase.outcome;
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
            return {
              ok: true,
              plan: { operations: [{ type: 'noop' }] },
              render: { messages: [`ok-${testCase.label}`] },
            };
          },
        };
        const state = withPlayerManager({
          CommandManager: { find: () => ({ command, alias: 'inspect' }) },
        }, player);

        await handleCommand(state, { player }, 'inspect relic');

        assert.strictEqual(executeCalled, true);
        assert.ok(messages.includes(`ok-${testCase.label}`));
      }
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('blocks on canDirect false and deny using FORBIDDEN_BLOCKED mapping', async function () {
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
      const cases = [
        { label: 'false', outcome: false },
        { label: 'deny', outcome: 'deny' },
      ];

      for (const testCase of cases) {
        messages.length = 0;
        let executeCalled = false;
        const relic = {
          uuid: `relic-cd-deny-${testCase.label}`,
          name: 'sealed relic',
          keywords: ['sealed', 'relic'],
          canDirect() {
            return testCase.outcome;
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
            errorMessages: {
              FORBIDDEN_BLOCKED: 'blocked-by-candirect',
            },
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
        assert.ok(messages.includes('blocked-by-candirect'));
      }
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('surfaces canDirect string veto text directly', async function () {
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
        uuid: 'relic-cd-string-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        canDirect() {
          return 'A ward blocks your hand.';
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
      assert.ok(messages.includes('A ward blocks your hand.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('uses canDirect structured veto object code/message', async function () {
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
      const relicByCode = {
        uuid: 'relic-cd-object-code',
        name: 'alpha relic',
        keywords: ['alpha', 'relic'],
        canDirect() {
          return { ok: false, code: 'WARD_LOCKED' };
        },
      };
      const relicByMessage = {
        uuid: 'relic-cd-object-message',
        name: 'beta relic',
        keywords: ['beta', 'relic'],
        canDirect() {
          return {
            allow: false,
            code: 'WARD_LOCKED',
            message: 'The relic hums and refuses your touch.',
            details: { source: 'test' },
          };
        },
      };

      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([
          [relicByCode.uuid, relicByCode],
          [relicByMessage.uuid, relicByMessage],
        ]),
        room: { items: new Set() },
        socket: { writable: false },
      });
      const command = {
        metadata: {
          errorMessages: {
            WARD_LOCKED: 'The relic remains locked.',
          },
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
        execute: async () => ({ ok: true, plan: { operations: [{ type: 'noop' }] } }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect alpha relic');
      assert.ok(messages.includes('The relic remains locked.'));

      messages.length = 0;
      await handleCommand(state, { player }, 'inspect beta relic');
      assert.ok(messages.includes('The relic hums and refuses your touch.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('applies canDirect before metadata.permissions for the same entity', async function () {
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
      const relicDeny = {
        uuid: 'relic-cd-precedence-deny',
        name: 'relic deny',
        keywords: ['relic', 'deny'],
        metadata: {
          permissions: {
            verbs: {
              inspect: true,
            },
          },
        },
        canDirect() {
          return 'Runtime direct policy veto.';
        },
      };
      const relicAllow = {
        uuid: 'relic-cd-precedence-allow',
        name: 'relic allow',
        keywords: ['relic', 'allow'],
        metadata: {
          permissions: {
            verbs: {
              inspect: 'Metadata deny should not run after canDirect allow.',
            },
          },
        },
        canDirect() {
          return true;
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([
          [relicDeny.uuid, relicDeny],
          [relicAllow.uuid, relicAllow],
        ]),
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['inspect-ran'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic deny');
      assert.ok(messages.includes('Runtime direct policy veto.'));

      messages.length = 0;
      await handleCommand(state, { player }, 'inspect relic allow');
      assert.ok(messages.includes('inspect-ran'));
      assert.ok(!messages.includes('Metadata deny should not run after canDirect allow.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('stops target/reaction/commit when canDirect vetoes', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const events = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      events.push('commit');
    };

    try {
      const relic = {
        uuid: 'relic-cd-stop-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        canDirect() {
          return 'The relic refuses you.';
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
          reactions: () => [() => {
            events.push('reaction');
            return { render: { messages: ['reaction-line'] } };
          }],
        },
        execute: async () => {
          events.push('target');
          return {
            ok: true,
            plan: { operations: [{ type: 'noop' }] },
            render: { messages: ['target-line'] },
          };
        },
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.ok(messages.includes('The relic refuses you.'));
      assert.deepStrictEqual(events, []);
      assert.ok(!messages.includes('target-line'));
      assert.ok(!messages.includes('reaction-line'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('handles canDirect exceptions as command failure and skips execute/commit', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let executeCalled = false;
    let commitCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.error = () => { };
    mutator.applyMutationPlan = () => {
      commitCalled = true;
    };

    try {
      const relic = {
        uuid: 'relic-cd-throw-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        canDirect() {
          throw new Error('canDirect exploded');
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
      assert.strictEqual(commitCalled, false);
      assert.ok(messages.includes('Command failed.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('is deterministic for identical state/input with canDirect veto', async function () {
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
      const relic = {
        uuid: 'relic-cd-det-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        canDirect() {
          return 'The ward rejects your touch.';
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
        execute: async () => ({ ok: true, plan: { operations: [{ type: 'noop' }] } }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');
      await handleCommand(state, { player }, 'inspect relic');

      const vetoLines = messages.filter(line => line === 'The ward rejects your touch.');
      assert.strictEqual(vetoLines.length, 2);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('does not call planIndirect for a direct-only command', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let planIndirectCalled = 0;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const relic = {
        uuid: 'relic-ri-none-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planIndirect() {
          planIndirectCalled += 1;
          return null;
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['inspect-ok'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');
      assert.strictEqual(planIndirectCalled, 0);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('calls planDirect on the bound direct target with actor/verb/context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let planDirectCalled = 0;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const relic = {
        uuid: 'relic-rd-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect(actor, verbId, context) {
          planDirectCalled += 1;
          assert.strictEqual(actor && actor.name, 'Tester');
          assert.strictEqual(verbId, 'inspect');
          assert.strictEqual(context && context.entityResolution && context.entityResolution.directTarget, this);
          return null;
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['inspect-ok'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');
      assert.strictEqual(planDirectCalled, 1);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('calls planActor on the actor with actor/verb/context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let planActorCalled = 0;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        planActor(actor, verbId, context) {
          planActorCalled += 1;
          assert.strictEqual(actor, this);
          assert.strictEqual(verbId, 'sing');
          assert.strictEqual(context && context.player, this);
          return null;
        },
        room: { items: new Set() },
        socket: { writable: false },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['sing-ok'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'sing' }) },
      }, player);

      await handleCommand(state, { player }, 'sing');
      assert.strictEqual(planActorCalled, 1);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('calls planIndirect on the bound indirect target with canonical relation', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let planIndirectCalled = 0;

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => { };

    try {
      const apple = {
        uuid: 'apple-ri-1',
        name: 'apple',
        keywords: ['apple'],
      };
      const chest = {
        uuid: 'chest-ri-1',
        name: 'chest',
        keywords: ['chest'],
        type: 'CONTAINER',
        maxItems: 3,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
        planIndirect(actor, verbId, relationTokenCanonical, context) {
          planIndirectCalled += 1;
          assert.strictEqual(actor && actor.name, 'Tester');
          assert.strictEqual(verbId, 'put');
          assert.strictEqual(relationTokenCanonical, 'in');
          assert.strictEqual(context && context.entityResolution && context.entityResolution.indirectTarget, this);
          return null;
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'into'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['put-ok'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple into chest');
      assert.strictEqual(planIndirectCalled, 1);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders planDirect lines after target render lines', async function () {
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
      const relic = {
        uuid: 'relic-rd-msg-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          return {
            render: {
              messages: ['plan-direct-line'],
            },
          };
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      const targetIndex = messages.indexOf('target-line');
      const reactIndex = messages.indexOf('plan-direct-line');
      assert.ok(targetIndex >= 0);
      assert.ok(reactIndex > targetIndex);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('preserves target -> planDirect -> planIndirect render ordering', async function () {
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
      const apple = {
        uuid: 'apple-r-order-1',
        name: 'apple',
        keywords: ['apple'],
        planDirect() {
          return {
            render: {
              messages: ['direct-plan-line'],
            },
          };
        },
      };
      const chest = {
        uuid: 'chest-r-order-1',
        name: 'chest',
        keywords: ['chest'],
        type: 'CONTAINER',
        maxItems: 3,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
        planIndirect() {
          return {
            render: {
              messages: ['indirect-plan-line'],
            },
          };
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'into'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple into chest');

      const sequence = messages.filter(message =>
        message === 'target-line' ||
        message === 'direct-plan-line' ||
        message === 'indirect-plan-line'
      );
      assert.deepStrictEqual(sequence, [
        'target-line',
        'direct-plan-line',
        'indirect-plan-line',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('preserves target -> planActor -> planDirect -> planIndirect render ordering', async function () {
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
      const apple = {
        uuid: 'apple-r-order-actor-1',
        name: 'apple',
        keywords: ['apple'],
        planDirect() {
          return {
            render: {
              messages: ['direct-plan-line'],
            },
          };
        },
      };
      const chest = {
        uuid: 'chest-r-order-actor-1',
        name: 'chest',
        keywords: ['chest'],
        type: 'CONTAINER',
        maxItems: 3,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
        planIndirect() {
          return {
            render: {
              messages: ['indirect-plan-line'],
            },
          };
        },
      };
      const player = asPlayer({
        name: 'Tester',
        planActor() {
          return {
            render: {
              messages: ['actor-plan-line'],
            },
          };
        },
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'into'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple into chest');

      const sequence = messages.filter(message =>
        message === 'target-line' ||
        message === 'actor-plan-line' ||
        message === 'direct-plan-line' ||
        message === 'indirect-plan-line'
      );
      assert.deepStrictEqual(sequence, [
        'target-line',
        'actor-plan-line',
        'direct-plan-line',
        'indirect-plan-line',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('suppresses command success render when planDirect requests renderPolicy.replaceSuccess', async function () {
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
      const relic = {
        uuid: 'relic-replace-success-direct-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          return {
            renderPolicy: {
              replaceSuccess: true,
            },
            render: {
              messages: ['plan-direct-line'],
            },
          };
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      const sequence = messages.filter(message =>
        message === 'target-line' ||
        message === 'plan-direct-line'
      );
      assert.deepStrictEqual(sequence, ['plan-direct-line']);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('suppresses command success render once when both planDirect and planIndirect request replacement', async function () {
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
      const apple = {
        uuid: 'apple-replace-both-1',
        name: 'apple',
        keywords: ['apple'],
        planDirect() {
          return {
            renderPolicy: {
              replaceSuccess: true,
            },
            render: {
              messages: ['direct-plan-line'],
            },
          };
        },
      };
      const chest = {
        uuid: 'chest-replace-both-1',
        name: 'chest',
        keywords: ['chest'],
        type: 'CONTAINER',
        maxItems: 3,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
        planIndirect() {
          return {
            renderPolicy: {
              replaceSuccess: true,
            },
            render: {
              messages: ['indirect-plan-line'],
            },
          };
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'into'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple into chest');

      const sequence = messages.filter(message =>
        message === 'target-line' ||
        message === 'direct-plan-line' ||
        message === 'indirect-plan-line'
      );
      assert.deepStrictEqual(sequence, [
        'direct-plan-line',
        'indirect-plan-line',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('warns and falls back to command success render when replaceSuccess is requested without plan render messages', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerWarn = ranvier.Logger.warn;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const warnings = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.warn = message => {
      warnings.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const relic = {
        uuid: 'relic-replace-empty-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          return {
            renderPolicy: {
              replaceSuccess: true,
            },
          };
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.ok(messages.includes('target-line'));
      assert.ok(warnings.some(message => message.includes('RENDER_POLICY_REPLACE_EMPTY')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.warn = originalLoggerWarn;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('treats explicit empty-string plan render messages as valid replacement output', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerWarn = ranvier.Logger.warn;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const warnings = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.warn = message => {
      warnings.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const relic = {
        uuid: 'relic-replace-empty-string-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          return {
            renderPolicy: {
              replaceSuccess: true,
            },
            render: {
              messages: [''],
            },
          };
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.ok(messages.includes(''));
      assert.ok(!messages.includes('target-line'));
      assert.ok(!warnings.some(message => message.includes('RENDER_POLICY_REPLACE_EMPTY')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.warn = originalLoggerWarn;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('ignores invalid planDirect plan.operations and continues with render + base commit plan', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    /** @type {* | null} */
    let committedPlan = null;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.error = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const relic = {
        uuid: 'relic-pd-invalid-plan-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          return {
            plan: { operations: 'nope-not-an-array' },
            render: { messages: ['plan-direct-render-ok'] },
          };
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.deepStrictEqual(committedPlan, { operations: [{ type: 'noop' }] });
      const ordered = messages.filter(line => line === 'target-line' || line === 'plan-direct-render-ok');
      assert.deepStrictEqual(ordered, ['target-line', 'plan-direct-render-ok']);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('ignores reaction renderPolicy.replaceSuccess and keeps command success render', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: { items: new Set() },
        socket: { writable: false },
      });
      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
          reactions: [
            () => ({
              renderPolicy: {
                replaceSuccess: true,
              },
              render: {
                messages: ['reaction-line'],
              },
            }),
          ],
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'sing' }) },
      }, player);

      await handleCommand(state, { player }, 'sing');

      const sequence = messages.filter(message =>
        message === 'target-line' ||
        message === 'reaction-line'
      );
      assert.deepStrictEqual(sequence, ['target-line', 'reaction-line']);
      assert.ok(errors.some(message => message.includes('renderPolicy.replaceSuccess')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('maps planIndirect failure code through command errorMessages and skips commit/render success', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let commitCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      commitCalled = true;
    };

    try {
      const apple = {
        uuid: 'apple-pi-fail-1',
        name: 'apple',
        keywords: ['apple'],
      };
      const chest = {
        uuid: 'chest-pi-fail-1',
        name: 'chest',
        keywords: ['chest'],
        type: 'CONTAINER',
        maxItems: 3,
        inventory: new Map(),
        addItem() { },
        removeItem() { },
        planIndirect() {
          return {
            ok: false,
            error: {
              code: 'PLAN_INDIRECT_DENIED',
            },
          };
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[apple.uuid, apple]]),
        room: { items: new Set([chest]) },
        socket: { writable: false },
        addItem() { },
        removeItem() { },
      });
      const command = {
        metadata: {
          errorMessages: {
            PLAN_INDIRECT_DENIED: 'The target refuses this arrangement.',
          },
          entityResolution: {
            rules: {
              directIndirect: {
                acceptedRelations: ['in', 'into'],
                scopeProfile: {
                  direct: ['player.inventory'],
                  indirect: ['room.items'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line-should-not-render'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'put' }) },
      }, player);

      await handleCommand(state, { player }, 'put apple into chest');

      assert.strictEqual(commitCalled, false);
      assert.ok(messages.includes('The target refuses this arrangement.'));
      assert.ok(!messages.includes('target-line-should-not-render'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('handles planDirect exceptions as command failure and skips commit', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let commitCalled = false;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    ranvier.Logger.error = () => { };
    mutator.applyMutationPlan = () => {
      commitCalled = true;
    };

    try {
      const relic = {
        uuid: 'relic-pd-throw-1',
        name: 'sealed relic',
        keywords: ['sealed', 'relic'],
        planDirect() {
          throw new Error('planDirect exploded');
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
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['target-line-should-not-render'] },
        }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'inspect' }) },
      }, player);

      await handleCommand(state, { player }, 'inspect relic');

      assert.strictEqual(commitCalled, false);
      assert.ok(messages.includes('Command failed.'));
      assert.ok(!messages.includes('target-line-should-not-render'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
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
            render: { messages: ['inspect-ok'] },
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
        execute: wrapLegacyRenderCommand(lookDef.command({})),
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

  it('rejects reaction operations and continues success path', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    let bubbleInvoked = false;
    const events = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, {
        operations: [{ type: 'noop' }],
      });
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'React Room',
          description: 'React description',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
            (context) => {
              bubbleInvoked = true;
              assert.strictEqual(context.entityResolution.ruleKey, 'intransitive');
              return { operations: [{ type: 'noop' }, { type: 'noop' }] };
            },
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(bubbleInvoked, true);
      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>React Room</bold>',
        'render:React description',
      ]);
      assert.ok(errors.some(message => message.includes('React contribution attempted to enqueue mutation operations')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders reaction-added lines after target render when commit succeeds', async function () {
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
          title: 'React Render Room',
          description: 'Target render line',
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
            () => ({ render: { messages: ['React line one', 'React line two'] } }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>React Render Room</bold>',
        'render:Target render line',
        'render:React line one',
        'render:React line two',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('rejects mixed reaction payload operations but keeps render additions', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      events.push(`render:${String(message)}`);
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      events.push('commit');
      assert.deepStrictEqual(planArg, {
        operations: [{ type: 'noop' }],
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
          reactions: [
            () => ({
              operations: [{ type: 'noop' }],
              render: { messages: ['Mixed reaction line'] },
            }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'render:<bold>Mixed Room</bold>',
        'render:Mixed target line',
        'render:Mixed reaction line',
      ]);
      assert.ok(errors.some(message => message.includes('React contribution attempted to enqueue mutation operations')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('rejects reaction transferItem operations and keeps world state unchanged', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const messages = [];
    const errors = [];
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
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };

    try {
      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
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
                messages: ['The spike hums.'],
              },
            }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.strictEqual(inventory.has(item), true);
      assert.strictEqual(roomItems.has(item), false);
      assert.deepStrictEqual(messages, [
        '<bold>Sanctum</bold>',
        'A quiet sanctum.',
        'The spike hums.',
      ]);
      assert.ok(errors.some(message => message.includes('React contribution attempted to enqueue mutation operations')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
    }
  });

  it('suppresses reaction render lines when commit fails', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = () => { };
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
          reactions: [
            () => ({ render: { messages: ['React line should not render'] } }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(!messages.includes('React line should not render'));
      assert.ok(messages.includes('Command failed.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders reaction-added lines in deterministic reaction order', async function () {
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
          reactions: [
            () => ({ render: { messages: ['reaction-a'] } }),
            () => ({ render: { messages: ['reaction-b'] } }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        '<bold>Order Room</bold>',
        'Order target line',
        'reaction-a',
        'reaction-b',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('executes render broadcast selectors after commit with render phase counters', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalSayAtExcept = ranvier.Broadcast.sayAtExcept;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const events = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      events.push(`sayAt:${String(message)}`);
    };
    ranvier.Broadcast.sayAtExcept = (_target, message, exceptTargets) => {
      events.push(`sayAtExcept:${String(message)}:${Array.isArray(exceptTargets) ? exceptTargets.length : 0}`);
    };
    mutator.applyMutationPlan = () => {
      events.push('commit');
    };

    try {
      const roomTargets = [{ name: 'Tester' }, { name: 'Other' }];
      const excludedRoomTargets = [{ name: 'Observer' }];
      const excludedRoom = {
        getBroadcastTargets: () => excludedRoomTargets,
      };
      const room = {
        title: 'Selector Room',
        description: 'Selector description',
        area: {
          getBroadcastTargets: () => roomTargets,
        },
        getBroadcastTargets: () => roomTargets,
      };

      const player = asPlayer({
        name: 'Tester',
        room,
        socket: { writable: false },
      });

      const command = {
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              'target render',
              { type: 'broadcast', audience: 'player', message: 'pc-player' },
              { type: 'broadcast', audience: 'room', message: 'pc-room' },
              { type: 'broadcast', audience: 'area', message: 'pc-area' },
              { type: 'broadcast', audience: 'areaExceptTargets', message: 'pc-area-ex', exceptSelector: 'currentRoomTargets' },
              { type: 'broadcast', audience: 'room', message: 'pc-room-by-ref', targetSelector: 'roomByRef', targetRoomRef: 'test:excluded-room' },
              { type: 'broadcast', audience: 'areaExceptTargets', message: 'pc-area-ex-by-ref', exceptSelector: 'targetsByRoomRef', exceptRoomRef: 'test:excluded-room' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
        RoomManager: {
          getRoom: (roomRef) => roomRef === 'test:excluded-room' ? excludedRoom : null,
        },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(events, [
        'commit',
        'sayAt:target render',
        'sayAt:pc-player',
        'sayAt:pc-room',
        'sayAt:pc-area',
        'sayAtExcept:pc-area-ex:2',
        'sayAt:pc-room-by-ref',
        'sayAtExcept:pc-area-ex-by-ref:1',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.sayAtExcept = originalSayAtExcept;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('dispatches target render instructions before reaction render instructions', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Queue Room',
          description: 'Queue description',
          area: {},
          getBroadcastTargets: () => [],
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
            () => ({
              render: {
                messages: [
                  { type: 'broadcast', audience: 'player', message: 'reaction-1' },
                  { type: 'broadcast', audience: 'player', message: 'reaction-2' },
                ],
              },
            }),
          ],
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              'target render',
              { type: 'broadcast', audience: 'player', message: 'target-post' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        'target render',
        'target-post',
        'reaction-1',
        'reaction-2',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('preserves target/reaction message chronology across lines and instructions', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const observer = { name: 'Observer', isNpc: true };
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Chronology Room',
          description: 'Chronology description',
          area: {},
          getBroadcastTargets: () => [player, observer],
        },
        socket: { writable: false },
      });
      player.room.getBroadcastTargets = () => [player, observer];

      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
            () => ({
              render: {
                messages: [
                  'reaction-line',
                  { type: 'broadcast', audience: 'player', message: 'reaction-broadcast' },
                ],
              },
            }),
          ],
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:haul} down on the rope and the bell rings clear and loud.',
                audiencePolicy: 'self',
                participants: {
                  actor: { selector: 'currentPlayer' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        'You haul down on the rope and the bell rings clear and loud.',
        'reaction-line',
        'reaction-broadcast',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('executes semanticEvent render instructions after commit', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const observer = { name: 'Observer', isNpc: true };
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Semantic Room',
          description: 'Semantic description',
          area: {},
          getBroadcastTargets: () => [player, observer],
        },
        socket: { writable: false },
      });
      player.room.getBroadcastTargets = () => [player, observer];

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              'target render',
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentPlayer' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        'target render',
        'You wave.',
        'Tester waves.',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('executes semanticEvent with currentActor selector for player actor context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const observer = { name: 'Observer', isNpc: true };
      const player = asPlayer({
        name: 'Tester',
        isNpc: false,
        room: {
          title: 'Semantic Room',
          description: 'Semantic description',
          area: {},
          getBroadcastTargets: () => [player, observer],
        },
        socket: { writable: false },
      });
      player.room.getBroadcastTargets = () => [player, observer];

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, [
        'You wave.',
        'Tester waves.',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('executes semanticEvent with currentActor selector for NPC actor context', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const bystander = { name: 'Watcher', isNpc: false };
      const npc = asPlayer({
        name: 'Tomo',
        isNpc: true,
        room: {
          title: 'Semantic Room',
          description: 'Semantic description',
          area: {},
          getBroadcastTargets: () => [npc, bystander],
        },
        socket: { writable: false },
      });
      npc.room.getBroadcastTargets = () => [npc, bystander];

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, npc);

      await handleCommand(state, { player: npc }, 'look');

      assert.deepStrictEqual(messages, [
        'You wave.',
        'Tomo waves.',
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('includes target recipient in others audience based on actor-room broadcast order', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    /** @type {{ targetName: string, message: string }[]} */
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
    };
    mutator.applyMutationPlan = () => { };

    try {
      const target = {
        uuid: 'semantic-target-1',
        name: 'Rival',
        keywords: ['rival'],
        isNpc: true,
        socket: { writable: false },
      };
      const observer = {
        uuid: 'semantic-observer-1',
        name: 'Observer',
        keywords: ['observer'],
        isNpc: true,
        socket: { writable: false },
      };
      const room = {
        area: {},
        npcs: new Set([target]),
        getBroadcastTargets: () => [player, target, observer],
      };
      const player = asPlayer({
        uuid: 'semantic-actor-1',
        name: 'Tester',
        keywords: ['tester'],
        room,
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              direct: {
                scopeProfile: {
                  direct: ['room.npcs'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave} at {target.you}.',
                audiencePolicy: 'others',
                participants: {
                  actor: { selector: 'currentActor' },
                  target: { selector: 'entityByContextRole', role: 'directTarget' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look rival');

      assert.deepStrictEqual(messages, [
        { targetName: 'Rival', message: 'Tester waves at you.' },
        { targetName: 'Observer', message: 'Tester waves at Rival.' },
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('de-duplicates actor and target partitions when target resolves to actor identity', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    /** @type {{ targetName: string, message: string }[]} */
    const messages = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
    };
    mutator.applyMutationPlan = () => { };

    try {
      const observer = {
        uuid: 'semantic-observer-2',
        name: 'Observer',
        keywords: ['observer'],
        isNpc: true,
        socket: { writable: false },
      };
      const room = {
        area: {},
        npcs: new Set(),
        getBroadcastTargets: () => [player, observer],
      };
      const player = asPlayer({
        uuid: 'semantic-actor-2',
        name: 'Tester',
        keywords: ['tester'],
        room,
        socket: { writable: false },
      });
      room.npcs.add(player);

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              direct: {
                scopeProfile: {
                  direct: ['room.npcs'],
                },
              },
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                audiencePolicy: 'self_target_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                  target: { selector: 'entityByContextRole', role: 'directTarget' },
                },
              },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look tester');

      assert.deepStrictEqual(messages, [
        { targetName: 'Tester', message: 'You wave.' },
        { targetName: 'Observer', message: 'Tester waves.' },
      ]);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('avoids partial semantic delivery and continues remaining instructions when others render fails', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const observer = {
        uuid: 'semantic-observer-3',
        name: 'Observer',
        isNpc: true,
        socket: { writable: false },
      };
      const room = {
        area: {},
        getBroadcastTargets: () => [player, observer],
      };
      const player = asPlayer({
        uuid: 'semantic-actor-3',
        name: 'Tester',
        room,
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                templates: {
                  others: '{unknown.slot}',
                },
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                },
              },
              { type: 'broadcast', audience: 'player', message: 'fallback' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, ['fallback']);
      assert.ok(errors.some(message => message.includes('render.semanticEvent others render failed')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('rejects invalid semanticEvent render instructions and continues remaining instructions', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: { area: {}, getBroadcastTargets: () => [] },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: '{actor.you} {verb:wave}.',
                audiencePolicy: 'self_and_others',
                participants: {},
              },
              { type: 'broadcast', audience: 'player', message: 'fallback' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, ['fallback']);
      assert.ok(errors.some(message => message.includes('RENDER_DISPATCH: render.semanticEvent actor render failed (SEMANTIC_PARTICIPANT_MISSING)')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('rejects unknown render instruction types and continues remaining instructions', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: { area: {}, getBroadcastTargets: () => [] },
        socket: { writable: false },
      });

      const command = {
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              { type: 'mystery', audience: 'player', message: 'bad' },
              { type: 'broadcast', audience: 'player', message: 'good' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.deepStrictEqual(messages, ['good']);
      assert.ok(errors.some(message => message.includes('RENDER_DISPATCH: Unsupported render instruction type')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('rejects unknown reaction render instruction types and continues remaining instructions', async function () {
    const lookDef = require('../commands/look');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    const errors = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = message => {
      errors.push(String(message));
    };
    mutator.applyMutationPlan = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'React Render',
          description: 'Room line',
          area: {},
          getBroadcastTargets: () => [],
        },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          ...lookDef.metadata,
          reactions: [
            () => ({
              render: {
                messages: [
                  { type: 'mystery', audience: 'player', message: 'bad' },
                  { type: 'broadcast', audience: 'player', message: 'reaction-good' },
                ],
              },
            }),
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');

      assert.ok(messages.includes('reaction-good'));
      assert.ok(errors.some(message => message.includes('RENDER_DISPATCH: Unsupported render instruction type')));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('does not execute render instructions when commit fails', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalLoggerError = ranvier.Logger.error;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Logger.error = () => { };
    mutator.applyMutationPlan = () => {
      throw new Error('commit failed');
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: { area: {}, getBroadcastTargets: () => [] },
        socket: { writable: false },
      });

      const command = {
        execute: async () => ({
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: {
            messages: [
              { type: 'broadcast', audience: 'player', message: 'should not emit' },
            ],
          },
        }),
      };

      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      await handleCommand(state, { player }, 'look');
      assert.ok(!messages.includes('should not emit'));
      assert.ok(messages.includes('Command failed.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Logger.error = originalLoggerError;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('ignores non-operation reaction return values', async function () {
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
          reactions: [
            () => null,
            () => undefined,
          ],
        },
        execute: wrapLegacyRenderCommand(lookDef.command({})),
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

  it('ignores legacy single-operation reaction shape and keeps target plan unchanged', async function () {
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
          reactions: [
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
      assert.deepStrictEqual(committedPlan.operations, [{ type: 'noop' }]);
    } finally {
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs put through entity-resolution, commits transfer plan, and emits social put messaging', async function () {
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
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
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
      const observer = { name: 'Observer', isNpc: true };
      const room = {
        items: new Set([chest]),
        getBroadcastTargets() {
          return [player, observer];
        },
      };
      const player = asPlayer({
        name: 'Tester',
        inventory: new Map([[sword.uuid, sword]]),
        room,
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });

      const command = {
        metadata: putDef.metadata,
        execute: wrapLegacyRenderCommand(putDef.command({})),
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
      assert.ok(messages.some(entry => entry.targetName === 'Tester' && entry.message === 'You put the rusty sword in the old chest.'));
      assert.ok(messages.some(entry => entry.targetName === 'Observer' && entry.message === 'Tester puts the rusty sword in the old chest.'));
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
        execute: wrapLegacyRenderCommand(putDef.command({})),
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
        execute: wrapLegacyRenderCommand(putDef.command({})),
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
        execute: wrapLegacyRenderCommand(putDef.command({})),
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
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
        execute: wrapLegacyRenderCommand(inventoryDef.command({})),
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
        execute: wrapLegacyRenderCommand(inventoryDef.command({})),
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

  it('runs say through pipeline and renders actor and bystander lines', async function () {
    const sayDef = require('../commands/say');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const deliveries = [];
    let committedPlan = null;

    ranvier.Broadcast.sayAt = (target, message) => {
      deliveries.push({ target, message: String(message) });
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const observer = { name: 'Observer', isNpc: true };
      const player = asPlayer({
        name: 'Tester',
        isNpc: false,
        room: {
          title: 'Speech Room',
          description: 'A room for speech tests.',
          area: {},
          getBroadcastTargets: () => [player, observer],
        },
        socket: { writable: false },
      });
      player.room.getBroadcastTargets = () => [player, observer];

      const command = {
        metadata: sayDef.metadata,
        execute: wrapLegacyRenderCommand(sayDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'say' }) },
      }, player);

      await handleCommand(state, { player }, 'say hello');

      assert.deepStrictEqual(committedPlan, {
        operations: [{ type: 'noop' }],
      });
      const actorMessages = deliveries
        .filter(entry => entry.target === player)
        .map(entry => entry.message);
      const observerMessages = deliveries
        .filter(entry => entry.target === observer)
        .map(entry => entry.message);

      assert.deepStrictEqual(actorMessages, ['You say, "hello"']);
      assert.deepStrictEqual(observerMessages, ['Tester says, "hello"']);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('runs say through pipeline for NPC actor context', async function () {
    const sayDef = require('../commands/say');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const deliveries = [];

    ranvier.Broadcast.sayAt = (target, message) => {
      deliveries.push({ target, message: String(message) });
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const bystander = { name: 'Witness', isNpc: false, socket: { writable: false } };
      const npc = asPlayer({
        name: 'Tomo',
        isNpc: true,
        room: {
          title: 'Speech Room',
          description: 'A room for speech tests.',
          area: {},
          getBroadcastTargets: () => [npc, bystander],
        },
        socket: { writable: false },
      });
      npc.room.getBroadcastTargets = () => [npc, bystander];

      const command = {
        metadata: sayDef.metadata,
        execute: wrapLegacyRenderCommand(sayDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'say' }) },
      }, npc);

      await handleCommand(state, { player: npc }, 'say hello');

      const bystanderMessages = deliveries
        .filter(entry => entry.target === bystander)
        .map(entry => entry.message);
      assert.deepStrictEqual(bystanderMessages, ['Tomo says, "hello"']);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('applies say empty capture veto and prevents commit', async function () {
    const sayDef = require('../commands/say');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let mutatorCalled = false;

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      mutatorCalled = true;
    };

    try {
      const player = asPlayer({
        name: 'Tester',
        isNpc: false,
        room: {
          title: 'Speech Room',
          description: 'A room for speech tests.',
          area: {},
          getBroadcastTargets: () => [player],
        },
        socket: { writable: false },
      });
      player.room.getBroadcastTargets = () => [player];

      const command = {
        metadata: sayDef.metadata,
        execute: wrapLegacyRenderCommand(sayDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'say' }) },
      }, player);

      await handleCommand(state, { player }, 'say     ');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('Say what?'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
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
        execute: wrapLegacyRenderCommand(goDef.command({ RoomManager: { getRoom: () => null } })),
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
        execute: wrapLegacyRenderCommand(goDef.command({ RoomManager: { getRoom: () => null } })),
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
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
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
            direction: 'north',
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
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
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
            direction: 'east',
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
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
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
            direction: 'north',
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
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
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
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
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
        execute: wrapLegacyRenderCommand(lookDef.command({})),
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

  it('canonicalizes x <thing> to look <thing> and resolves direct look target', async function () {
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
      const chest = {
        uuid: 'lab-chest-1',
        name: 'practice chest',
        keywords: ['practice', 'chest'],
        description: 'A lightweight chest meant for put/take testing.',
      };

      const player = asPlayer({
        name: 'Tester',
        room: {
          title: 'Render Room',
          description: 'Render description',
          items: new Set([chest]),
        },
        socket: { writable: false },
      });

      const command = {
        metadata: lookDef.metadata,
        execute: wrapLegacyRenderCommand(lookDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: {
          commands: new Map([['look', command]]),
          get: key => key === 'look' ? command : null,
        },
      }, player);

      await handleCommand(state, { player }, 'x chest');

      assert.ok(messages.includes('A lightweight chest meant for put/take testing.'));
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

  it('renders go locked failure and auto-opens closed exits', async function () {
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
        doors: new Map([[currentRoom.entityReference, { locked: true, closed: true }]]),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: true, closed: true }
          : null,
      };
      const closedDestination = {
        entityReference: 'test:closed',
        title: 'Closed',
        description: 'Closed room',
        items: new Set(),
        doors: new Map([[currentRoom.entityReference, { locked: false, closed: true }]]),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: false, closed: true }
          : null,
      };

      const playerRoom = {
        ...currentRoom,
        getExits: () => [
          { direction: 'north', roomId: lockedDestination.entityReference },
          { direction: 'south', roomId: closedDestination.entityReference },
        ],
      };

      const player = asPlayer({
        name: 'Tester',
        room: playerRoom,
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => {
              if (roomId === playerRoom.entityReference) {
                return playerRoom;
              }
              if (roomId === lockedDestination.entityReference) {
                return lockedDestination;
              }
              if (roomId === closedDestination.entityReference) {
                return closedDestination;
              }
              return null;
            },
          },
        })),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go north');
      await handleCommand(state, { player }, 'go south');

      assert.ok(messages.includes('The way is locked.'));
      assert.ok(!messages.includes('The way is closed.'));
      assert.ok(messages.includes('<bold>Closed</bold>'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });

  it('auto-unlocks and opens locked exit on go when actor carries matching key', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let committedPlan = null;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const currentRoom = { entityReference: 'test:lab' };
      const destination = {
        entityReference: 'test:lockedEast',
        title: 'Locked East',
        description: 'An ironbound threshold to the east.',
        items: new Set(),
        doors: new Map([[
          currentRoom.entityReference,
          { locked: true, closed: true, lockedBy: 'test:bronze_key' },
        ]]),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: true, closed: true, lockedBy: 'test:bronze_key' }
          : null,
      };

      const playerRoom = {
        ...currentRoom,
        getExits: () => [{ direction: 'east', roomId: destination.entityReference }],
      };

      const player = asPlayer({
        name: 'Tester',
        room: playerRoom,
        inventory: new Map([
          ['k1', { entityReference: 'test:bronze_key' }],
        ]),
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => {
              if (roomId === playerRoom.entityReference) {
                return playerRoom;
              }
              if (roomId === destination.entityReference) {
                return destination;
              }
              return null;
            },
          },
        })),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go east');

      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'doorMutation',
            mutation: 'unlockAndOpen',
            actor: player,
            direction: 'east',
          },
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
            direction: 'east',
            suppressRoomBroadcast: true,
          },
        ],
      });
      assert.ok(messages.includes('<bold>Locked East</bold>'));
      assert.ok(messages.includes('An ironbound threshold to the east.'));
      assert.ok(!messages.includes('The way is locked.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('invokes authored exit planDirect during go and still performs movement fallback', async function () {
    const goDef = require('../commands/go');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];
    let committedPlan = null;
    let authoredPlanDirectCalls = 0;

    ranvier.Broadcast.sayAt = (target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = (stateArg, planArg) => {
      committedPlan = planArg;
    };

    try {
      const destination = {
        entityReference: 'test:eastRoom',
        title: 'East Room',
        description: 'A narrow room to the east.',
        items: new Set(),
        getDoor: () => null,
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          entityReference: 'test:lab',
          getExits: () => [{
            direction: 'east',
            roomId: destination.entityReference,
            planDirect() {
              authoredPlanDirectCalls += 1;
              return null;
            },
          }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go east');

      assert.strictEqual(authoredPlanDirectCalls, 1);
      assert.deepStrictEqual(committedPlan, {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
            direction: 'east',
          },
        ],
      });
      assert.ok(messages.includes('<bold>East Room</bold>'));
      assert.ok(messages.includes('A narrow room to the east.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('replaces generic go door flavor when authored exit planDirect requests replaceSuccess', async function () {
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
      const destination = {
        entityReference: 'test:foyer',
        title: 'Foyer',
        description: 'A vaulted observatory foyer.',
        items: new Set(),
        getDoor: (fromRoom) => fromRoom && fromRoom.entityReference === currentRoom.entityReference
          ? { locked: false, closed: true }
          : null,
      };
      const player = asPlayer({
        name: 'Tester',
        room: {
          ...currentRoom,
          getExits: () => [{
            direction: 'north',
            roomId: destination.entityReference,
            planDirect() {
              return {
                renderPolicy: {
                  replaceSuccess: true,
                },
                render: {
                  messages: [
                    {
                      type: 'line',
                      text: 'You turn the brass iris and pass through in silence.',
                    },
                  ],
                },
              };
            },
          }],
        },
        moveTo: () => { },
        socket: { writable: false },
      });

      const command = {
        metadata: goDef.metadata,
        execute: wrapLegacyRenderCommand(goDef.command({
          RoomManager: {
            getRoom: (roomId) => roomId === destination.entityReference ? destination : null,
          },
        })),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'go' }) },
      }, player);

      await handleCommand(state, { player }, 'go north');

      assert.ok(messages.includes('You turn the brass iris and pass through in silence.'));
      assert.ok(messages.includes('<bold>Foyer</bold>'));
      assert.ok(messages.includes('A vaulted observatory foyer.'));
      assert.ok(!messages.includes('You open the north door and leave.'));
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
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

  it('runs take through entity-resolution, commits transfer plan, and emits social take messaging', async function () {
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
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const observer = { name: 'Observer', isNpc: true };
      const room = {
        items: new Set(),
        getBroadcastTargets() {
          return [player, observer];
        },
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
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
      assert.ok(messages.some(entry => entry.targetName === 'Tester' && entry.message === 'You take the coin.'));
      assert.ok(messages.some(entry => entry.targetName === 'Observer' && entry.message === 'Tester takes the coin.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('does not send semantic others line back to actor via same-socket proxy targets', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    mutator.applyMutationPlan = () => { };
    ranvier.Broadcast.sayAt = (target, message) => {
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const sharedSocket = { writable: false };
      const observer = { name: 'Observer', isNpc: true, socket: { writable: false } };
      const actorProxy = { socket: sharedSocket };
      const room = {
        items: new Set(),
        getBroadcastTargets() {
          return [player, observer, actorProxy];
        },
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
      const coin = { uuid: 'coin-201', name: 'gold coin', keywords: ['gold', 'coin'], room, carriedBy: null };
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
        socket: sharedSocket,
      });

      const command = {
        metadata: takeDef.metadata,
        execute: wrapLegacyRenderCommand(takeDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take coin');

      const actorLineCount = messages.filter(entry => entry.targetName === 'Tester' && entry.message === 'You take the coin.').length;
      const observerLineCount = messages.filter(entry => entry.targetName === 'Observer' && entry.message === 'Tester takes the coin.').length;
      const echoedOtherCount = messages.filter(entry => entry.targetName === '<unknown>' && entry.message === 'Tester takes the coin.').length;

      assert.strictEqual(actorLineCount, 1);
      assert.strictEqual(observerLineCount, 1);
      assert.strictEqual(echoedOtherCount, 0);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('does not treat room broadcast source as an "other" semantic recipient', async function () {
    const takeDef = require('../commands/take');
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const originalApplyMutationPlan = mutator.applyMutationPlan;
    const messages = [];

    mutator.applyMutationPlan = () => { };
    ranvier.Broadcast.sayAt = (target, message) => {
      const targetName = target && typeof target === 'object' && typeof target.name === 'string'
        ? target.name
        : '<unknown>';
      messages.push({ targetName, message: String(message) });
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const observer = { name: 'Observer', isNpc: true, socket: { writable: false } };
      const room = {
        items: new Set(),
        getBroadcastTargets() {
          return [room, player, observer];
        },
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
      const coin = { uuid: 'coin-202', name: 'gold coin', keywords: ['gold', 'coin'], room, carriedBy: null };
      room.items.add(coin);

      const player = asPlayer({
        name: 'Rendall',
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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take coin');

      const actorSelfLineCount = messages.filter(entry => entry.targetName === 'Rendall' && entry.message === 'You take the coin.').length;
      const actorOtherLineCount = messages.filter(entry => entry.targetName === 'Rendall' && entry.message === 'Rendall takes the coin.').length;
      const observerOtherLineCount = messages.filter(entry => entry.targetName === 'Observer' && entry.message === 'Rendall takes the coin.').length;

      assert.strictEqual(actorSelfLineCount, 1);
      assert.strictEqual(actorOtherLineCount, 0);
      assert.strictEqual(observerOtherLineCount, 1);
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('renders already-have message when take resolves to player inventory target', async function () {
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
      const coin = { uuid: 'coin-held-1', name: 'gold coin', keywords: ['gold', 'coin'] };
      const room = {
        items: new Set(),
        metadata: { details: [] },
        addItem() { },
        removeItem() { },
      };
      const inventory = new Map([[coin.uuid, coin]]);
      const player = asPlayer({
        name: 'Tester',
        inventory,
        room,
        isInventoryFull: () => true,
        addItem() { },
        removeItem() { },
        socket: { writable: false },
      });
      coin.carriedBy = player;

      const command = {
        metadata: takeDef.metadata,
        execute: wrapLegacyRenderCommand(takeDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take coin');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('You already have that.'));
      assert.ok(!messages.includes('You are carrying too much.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('denies non-look action on room detail with detail verb override message', async function () {
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
      const room = {
        items: new Set(),
        metadata: {
          details: [
            {
              id: 'flagstones',
              name: 'flagstones',
              keywords: ['flagstones', 'stones'],
              description: 'Worn stones line the courtyard floor.',
              verbs: {
                take: 'The flagstones are fixed in place.',
              },
            },
          ],
        },
        entityReference: 'test:detail_room',
        addItem() { },
        removeItem() { },
      };

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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take flagstones');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('The flagstones are fixed in place.'));
      assert.ok(!messages.includes('You can\'t do that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('denies non-look action on room detail with default denial message', async function () {
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
      const room = {
        items: new Set(),
        metadata: {
          details: [
            {
              id: 'statue',
              name: 'statue',
              keywords: ['statue'],
              description: 'An ancient statue watches silently.',
            },
          ],
        },
        entityReference: 'test:detail_room_default',
        addItem() { },
        removeItem() { },
      };

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
        execute: wrapLegacyRenderCommand(takeDef.command({})),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'take' }) },
      }, player);

      await handleCommand(state, { player }, 'take statue');

      assert.strictEqual(mutatorCalled, false);
      assert.ok(messages.includes('You can\'t do that.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
      mutator.applyMutationPlan = originalApplyMutationPlan;
    }
  });

  it('returns undefined for command execution and relies on player-facing output', async function () {
    const ranvierPath = require.resolve('ranvier');
    const ranvier = require(ranvierPath);
    const originalSayAt = ranvier.Broadcast.sayAt;
    const originalPrompt = ranvier.Broadcast.prompt;
    const messages = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      messages.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    try {
      const player = asPlayer({
        name: 'Tester',
        room: { title: 'Room', description: 'Room desc' },
        socket: { writable: false },
      });

      const command = {
        metadata: {
          entityResolution: {
            rules: {
              intransitive: {},
            },
          },
        },
        execute: async () => ({ ok: false, error: { message: 'Nope.' } }),
      };
      const state = withPlayerManager({
        CommandManager: { find: () => ({ command, alias: 'look' }) },
      }, player);

      const result = await handleCommand(state, { player }, 'look');
      assert.strictEqual(result, undefined);
      assert.ok(messages.includes('Nope.'));
    } finally {
      ranvier.Broadcast.sayAt = originalSayAt;
      ranvier.Broadcast.prompt = originalPrompt;
    }
  });
});
