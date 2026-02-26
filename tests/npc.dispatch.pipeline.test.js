// @ts-check
'use strict';

const assert = require('assert');
const path = require('path');
const ranvier = require('ranvier');
const { handleCommand, dispatchNpcIntent } = require('../lib/session/command-dispatch');
const EntityResolution = require('../lib/session/entity-resolution');
const { parseInput } = require('../lib/parse-input');
const setPlayerMetadataDef = require('../commands/setplayermetadata');

/**
 * @param {*} value
 * @returns {*}
 */
function asActor(value) {
  return value;
}

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

describe('bundle-rantamuta npc dispatch pipeline', function () {
  let originalSayAt;
  let originalPrompt;
  let originalMutatorApply;
  let originalResolveEntityContext;

  beforeEach(function () {
    originalSayAt = ranvier.Broadcast.sayAt;
    originalPrompt = ranvier.Broadcast.prompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    originalMutatorApply = require(mutatorPath).applyMutationPlan;
    originalResolveEntityContext = EntityResolution.resolveEntityContext;
  });

  afterEach(function () {
    ranvier.Broadcast.sayAt = originalSayAt;
    ranvier.Broadcast.prompt = originalPrompt;
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    require(mutatorPath).applyMutationPlan = originalMutatorApply;
    EntityResolution.resolveEntityContext = originalResolveEntityContext;
  });

  it('routes npc dispatch through capture plan bubble commit render in order', async function () {
    const mutatorPath = path.resolve(__dirname, '../lib/session/mutator.js');
    const mutator = require(mutatorPath);
    const phaseTrace = [];
    const deliveries = [];

    ranvier.Broadcast.sayAt = (_target, message) => {
      deliveries.push(String(message));
      phaseTrace.push(`render:${String(message)}`);
    };
    ranvier.Broadcast.prompt = () => { };
    mutator.applyMutationPlan = () => {
      phaseTrace.push('commit');
    };

    const directTarget = {
      uuid: 'npc-pipeline-direct',
      name: 'relic',
      keywords: ['relic'],
      planDirect() {
        phaseTrace.push('planDirect');
        return {
          ok: true,
          render: {
            messages: ['plan-direct-line'],
          },
        };
      },
    };
    const npc = asActor({
      name: 'Tomo',
      isNpc: true,
      room: {
        items: new Set([directTarget]),
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    });
    npc.room.getBroadcastTargets = () => [npc];

    const command = {
      metadata: {
        entityResolution: {
          rules: {
            direct: {
              scopeProfile: {
                direct: ['room.items'],
              },
            },
          },
        },
        captureChecks: [
          () => {
            phaseTrace.push('capture');
            return null;
          },
        ],
        reactions: [
          () => {
            phaseTrace.push('bubble');
            return {
              render: {
                messages: ['bubble-line'],
              },
            };
          },
        ],
      },
      execute: async () => {
        phaseTrace.push('plan');
        return {
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: ['command-line'] },
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

    assert.deepStrictEqual(result, { ok: true });
    assert.deepStrictEqual(phaseTrace, [
      'capture',
      'plan',
      'planDirect',
      'bubble',
      'commit',
      'render:command-line',
      'render:plan-direct-line',
      'render:bubble-line',
    ]);
    assert.deepStrictEqual(deliveries, [
      'command-line',
      'plan-direct-line',
      'bubble-line',
    ]);
  });

  it('uses the same entity-resolution function for player and npc dispatch', async function () {
    const resolutionCalls = [];
    EntityResolution.resolveEntityContext = (state, command, actor, parsedInput) => {
      resolutionCalls.push({
        actorName: actor && actor.name,
        parsedInput,
      });
      return {
        ok: true,
        value: {
          ruleKey: 'intransitive',
          directSpan: [],
          indirectSpan: [],
          relationTokenRaw: null,
          relationTokenCanonical: null,
          declaration: { rules: {} },
        },
      };
    };

    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };

    const player = asActor({
      name: 'Tester',
      isNpc: false,
      room: {
        area: {},
        getBroadcastTargets: () => [player],
      },
      socket: { writable: false },
    });
    player.room.getBroadcastTargets = () => [player];

    const npc = asActor({
      name: 'Tomo',
      isNpc: true,
      room: {
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    });
    npc.room.getBroadcastTargets = () => [npc];

    const command = {
      metadata: {},
      execute: async () => ({
        ok: true,
        plan: { operations: [{ type: 'noop' }] },
        render: { messages: [] },
      }),
    };

    const playerState = withPlayerManager({
      CommandManager: {
        get: key => key === 'look' ? command : null,
      },
    }, player);
    const npcState = withPlayerManager({
      CommandManager: {
        get: key => key === 'look' ? command : null,
      },
    }, npc);

    await handleCommand(playerState, { player }, 'look');
    await dispatchNpcIntent(npcState, npc, {
      kind: 'structured',
      verb: 'look',
      direct: [],
      relationToken: null,
      indirect: [],
    });

    assert.strictEqual(resolutionCalls.length, 2);
    assert.deepStrictEqual(resolutionCalls[0].parsedInput, parseInput('look'));
    assert.deepStrictEqual(resolutionCalls[1].parsedInput, parseInput('look'));
  });

  it('commits setplayermetadata through npc dispatch commit path', async function () {
    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };

    const targetPlayer = {
      name: 'Rendall',
      metadata: {},
      socket: { writable: false },
    };
    const npc = asActor({
      name: 'Tomo',
      isNpc: true,
      room: {
        area: {},
        getBroadcastTargets: () => [npc],
      },
      socket: { writable: false },
    });
    npc.room.getBroadcastTargets = () => [npc];

    const state = {
      CommandManager: {
        get: key => {
          if (key !== 'setplayermetadata') {
            return null;
          }
          return {
            metadata: setPlayerMetadataDef.metadata,
            execute: setPlayerMetadataDef.command(state),
          };
        },
      },
      PlayerManager: {
        getPlayer: token => token === 'Rendall' ? targetPlayer : null,
      },
    };

    const result = await dispatchNpcIntent(state, npc, {
      kind: 'structured',
      verb: 'setplayermetadata',
      direct: ['Rendall', 'tomo.introShown', 'true'],
      relationToken: null,
      indirect: [],
    });

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(targetPlayer.metadata.tomo.introShown, true);
  });
});
