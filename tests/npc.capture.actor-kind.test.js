// @ts-check
'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const { handleCommand, dispatchNpcIntent } = require('../lib/session/command-dispatch');

/**
 * @param {*} state
 * @param {*} actor
 * @returns {*}
 */
function withPlayerManager(state, actor) {
  return {
    ...(state && typeof state === 'object' ? state : {}),
    PlayerManager: {
      getPlayer: () => actor,
    },
  };
}

describe('bundle-rantamuta actor-kind capture gating', function () {
  let originalSayAt;
  let originalPrompt;

  beforeEach(function () {
    originalSayAt = ranvier.Broadcast.sayAt;
    originalPrompt = ranvier.Broadcast.prompt;
  });

  afterEach(function () {
    ranvier.Broadcast.sayAt = originalSayAt;
    ranvier.Broadcast.prompt = originalPrompt;
  });

  it('denies npc dispatch before entity policy hooks and planner', async function () {
    let canDirectCalls = 0;
    let executeCalled = false;
    const guardedRelic = {
      uuid: 'actor-kind-relic',
      name: 'guarded relic',
      keywords: ['guarded', 'relic'],
      canDirect() {
        canDirectCalls += 1;
        return null;
      },
    };
    const npc = {
      name: 'Tomo',
      isNpc: true,
      room: {
        items: new Set([guardedRelic]),
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc];

    const command = {
      metadata: {
        actorKindsAllowed: ['player'],
        entityResolution: {
          rules: {
            direct: {
              scopeProfile: {
                direct: ['room.items'],
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
          render: { messages: [] },
        };
      },
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, npc);

    const result = await dispatchNpcIntent(state, npc, {
      kind: 'text',
      input: 'inspect relic',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'ACTOR_KIND_FORBIDDEN',
        details: {
          actorKind: 'npc',
          allowedActorKinds: ['player'],
        },
      },
    });
    assert.strictEqual(canDirectCalls, 0);
    assert.strictEqual(executeCalled, false);
  });

  it('denies player dispatch with the same capture code and message mapping', async function () {
    let canDirectCalls = 0;
    let executeCalled = false;
    const outputs = [];
    ranvier.Broadcast.sayAt = (_target, message) => {
      outputs.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    const guardedRelic = {
      uuid: 'actor-kind-player-relic',
      name: 'guarded relic',
      keywords: ['guarded', 'relic'],
      canDirect() {
        canDirectCalls += 1;
        return null;
      },
    };
    const player = {
      name: 'Tester',
      isNpc: false,
      room: {
        items: new Set([guardedRelic]),
        area: {},
      },
      socket: { writable: false },
    };

    const command = {
      metadata: {
        actorKindsAllowed: ['npc'],
        entityResolution: {
          rules: {
            direct: {
              scopeProfile: {
                direct: ['room.items'],
              },
            },
          },
        },
        errorMessages: {
          ACTOR_KIND_FORBIDDEN: 'Only NPCs may perform that action.',
        },
      },
      execute: async () => {
        executeCalled = true;
        return {
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: [] },
        };
      },
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, player);

    await handleCommand(state, { player }, 'inspect relic');

    assert.strictEqual(canDirectCalls, 0);
    assert.strictEqual(executeCalled, false);
    assert.ok(outputs.includes('Only NPCs may perform that action.'));
  });

  it('lets canActor deny before metadata gate, entity policy, and planner', async function () {
    let canDirectCalls = 0;
    let executeCalled = false;
    const guardedRelic = {
      uuid: 'actor-can-actor-deny-relic',
      name: 'guarded relic',
      keywords: ['guarded', 'relic'],
      canDirect() {
        canDirectCalls += 1;
        return null;
      },
    };
    const npc = {
      name: 'Tomo',
      isNpc: true,
      canActor(actor, verbId, context) {
        assert.strictEqual(actor, npc);
        assert.strictEqual(verbId, 'inspect');
        assert.strictEqual(context.player, npc);
        return {
          allow: false,
          message: 'Actor gate refused.',
          details: { source: 'npc.canActor' },
        };
      },
      room: {
        items: new Set([guardedRelic]),
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc];

    const command = {
      metadata: {
        actorKindsAllowed: ['npc'],
        entityResolution: {
          rules: {
            direct: {
              scopeProfile: {
                direct: ['room.items'],
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
          render: { messages: [] },
        };
      },
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, npc);

    const result = await dispatchNpcIntent(state, npc, {
      kind: 'text',
      input: 'inspect relic',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'ACTOR_KIND_FORBIDDEN',
        message: 'Actor gate refused.',
        details: {
          actorKind: 'npc',
          source: 'npc.canActor',
          verbId: 'inspect',
        },
      },
    });
    assert.strictEqual(canDirectCalls, 0);
    assert.strictEqual(executeCalled, false);
  });

  it('lets explicit canActor allow bypass a denying actorKindsAllowed gate', async function () {
    let executeCalled = false;
    const outputs = [];
    ranvier.Broadcast.sayAt = (_target, message) => {
      outputs.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    const player = {
      name: 'Tester',
      isNpc: false,
      canActor(actor, verbId, context) {
        assert.strictEqual(actor, player);
        assert.strictEqual(verbId, 'inspect');
        assert.strictEqual(context.player, player);
        return true;
      },
      room: {
        area: {},
      },
      socket: { writable: false },
    };

    const command = {
      metadata: {
        actorKindsAllowed: ['npc'],
      },
      execute: async () => {
        executeCalled = true;
        return {
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['inspect-ran'] },
        };
      },
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, player);

    await handleCommand(state, { player }, 'inspect');

    assert.strictEqual(executeCalled, true);
    assert.ok(outputs.includes('inspect-ran'));
    assert.ok(!outputs.includes('You can\'t do that.'));
  });

  it('treats canActor no-decision as fallthrough to actorKindsAllowed', async function () {
    let executeCalled = false;
    const outputs = [];
    ranvier.Broadcast.sayAt = (_target, message) => {
      outputs.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    const player = {
      name: 'Tester',
      isNpc: false,
      canActor(actor, verbId, context) {
        assert.strictEqual(actor, player);
        assert.strictEqual(verbId, 'inspect');
        assert.strictEqual(context.player, player);
        return undefined;
      },
      room: {
        area: {},
      },
      socket: { writable: false },
    };

    const command = {
      metadata: {
        actorKindsAllowed: ['npc'],
        errorMessages: {
          ACTOR_KIND_FORBIDDEN: 'Only NPCs may perform that action.',
        },
      },
      execute: async () => {
        executeCalled = true;
        return {
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['inspect-ran'] },
        };
      },
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, player);

    await handleCommand(state, { player }, 'inspect');

    assert.strictEqual(executeCalled, false);
    assert.ok(outputs.includes('Only NPCs may perform that action.'));
    assert.ok(!outputs.includes('inspect-ran'));
  });

  it('is deterministic for identical state/input with canActor deny', async function () {
    const npc = {
      name: 'Tomo',
      isNpc: true,
      canActor() {
        return 'Actor gate refused.';
      },
      room: {
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc];

    const command = {
      metadata: {
        actorKindsAllowed: ['npc'],
      },
      execute: async () => ({
        ok: true,
        plan: { operations: [{ type: 'noop' }] },
        render: { messages: [] },
      }),
    };

    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'inspect' ? command : null,
      },
    }, npc);

    const first = await dispatchNpcIntent(state, npc, {
      kind: 'text',
      input: 'inspect',
    });
    const second = await dispatchNpcIntent(state, npc, {
      kind: 'text',
      input: 'inspect',
    });

    assert.deepStrictEqual(second, first);
  });
});
