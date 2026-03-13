// @ts-check
'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const actorHookHarness = require('../areas/test/scripts/npcs/actorHookHarness');
const { dispatchNpcIntent } = require('../lib/session/command-dispatch');
const sayDef = require('../commands/say');

/**
 * @param {*} value
 * @returns {string[]}
 */
function toLines(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(entry => String(entry));
}

/**
 * @param {*} room
 * @returns {*}
 */
function createState(room) {
  const state = {
    PlayerManager: {
      getPlayer: actor => actor,
    },
    RoomManager: {
      getRoom: ref => (ref === room.entityReference ? room : null),
    },
  };

  const sayCommand = {
    metadata: sayDef.metadata,
    execute: sayDef.command(state),
  };

  state.CommandManager = {
    get: key => key === 'say' ? sayCommand : null,
  };

  return state;
}

/**
 * @param {string} id
 * @param {Record<string, *>} actorHarness
 * @param {*} room
 * @returns {*}
 */
function createNpc(id, actorHarness, room) {
  return {
    entityReference: `test:${id}`,
    name: id,
    isNpc: true,
    metadata: { actorHarness },
    room,
    socket: { writable: false },
  };
}

describe('test area actor hook harness script', function () {
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

  it('adds deterministic room metadata and render output through planActor', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (_target, message) => {
      deliveries.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    const room = {
      entityReference: 'test:actorHooks',
      area: {},
      metadata: {},
      getBroadcastTargets: () => [planner],
    };
    const planner = createNpc('actorPlanner', {
      planVerb: 'say',
      planMessage: 'actor-plan-fired',
      roomMetadataKey: 'actorHookPlanFired',
      roomMetadataValue: true,
    }, room);
    room.getBroadcastTargets = () => [planner];

    actorHookHarness.listeners.spawn(createState(room)).call(planner);

    const result = await dispatchNpcIntent(createState(room), planner, {
      kind: 'text',
      input: 'say calibration',
    });

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(room.metadata.values.actorHookPlanFired, true);
    assert.ok(toLines(deliveries).includes('actor-plan-fired'));
    assert.ok(toLines(deliveries).some(line => /calibration/i.test(line)));
  });

  it('denies a normally valid say command through canActor', async function () {
    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };

    const room = {
      entityReference: 'test:actorHooks',
      area: {},
      metadata: {},
      getBroadcastTargets: () => [gatekeeper],
    };
    const gatekeeper = createNpc('actorGatekeeper', {
      denyVerb: 'say',
      denyMessage: 'The harness gate refuses that verb.',
    }, room);
    room.getBroadcastTargets = () => [gatekeeper];

    actorHookHarness.listeners.spawn(createState(room)).call(gatekeeper);

    const result = await dispatchNpcIntent(createState(room), gatekeeper, {
      kind: 'text',
      input: 'say calibration',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'ACTOR_KIND_FORBIDDEN',
        message: 'The harness gate refuses that verb.',
        details: {
          actorKind: 'npc',
          verbId: 'say',
          source: 'test.actorHookHarness',
        },
      },
    });
    assert.strictEqual(room.metadata.values, undefined);
  });
});
