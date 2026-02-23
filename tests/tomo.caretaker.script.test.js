// @ts-check
'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const tomoScript = require('../areas/codex/scripts/npcs/tomoCaretaker');
const CommandDispatch = require('../lib/session/command-dispatch');
const sayDef = require('../commands/say');

function createContainer(entityReference, containsRefs) {
  return {
    entityReference,
    inventory: new Set((containsRefs || []).map(ref => ({ entityReference: ref }))),
  };
}

function createState({ wax = false, stone = false, clapper = false, rooms = {} } = {}) {
  const reliquary = createContainer('codex:reliquary', wax ? ['codex:waxSeal'] : []);
  const basin = createContainer('codex:stoneBasin', stone ? ['codex:prayerStone'] : []);
  const bell = createContainer('codex:crackedBell', clapper ? ['codex:bronzeClapper'] : []);

  const state = {
    ItemManager: {
      items: new Set([reliquary, basin, bell]),
    },
    RoomManager: {
      getRoom: (ref) => rooms[ref] || null,
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

function withNow(now, fn) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        Date.now = originalNow;
      });
    }
    Date.now = originalNow;
    return result;
  } catch (err) {
    Date.now = originalNow;
    throw err;
  }
}

function linesForTarget(deliveries, target) {
  return deliveries
    .filter(entry => entry.target === target)
    .map(entry => entry.line);
}

describe('bundle-rantamuta codex tomo caretaker script', function () {
  let originalSayAt;
  let originalDispatchNpcIntent;

  beforeEach(function () {
    originalSayAt = ranvier.Broadcast.sayAt;
    originalDispatchNpcIntent = CommandDispatch.dispatchNpcIntent;
  });

  afterEach(function () {
    ranvier.Broadcast.sayAt = originalSayAt;
    CommandDispatch.dispatchNpcIntent = originalDispatchNpcIntent;
  });

  it('emits intro once per player', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (target, line) => {
      deliveries.push({ target, line: String(line) });
    };

    const state = createState();
    const npc = {
      metadata: {
        tomo: {
          hintCooldownMs: 999999,
        },
      },
      room: {
        players: new Set(),
      },
      socket: { writable: false },
    };
    const player = { uuid: 'p1', metadata: {}, inventory: new Set() };
    npc.room.getBroadcastTargets = () => [npc, player];

    const onSpawn = tomoScript.listeners.spawn(state);
    const onPlayerEnter = tomoScript.listeners.playerEnter(state);
    onSpawn.call(npc);

    await withNow(1000, () => onPlayerEnter.call(npc, player, null));
    await withNow(2000, () => onPlayerEnter.call(npc, player, null));

    const playerLines = linesForTarget(deliveries, player);
    const introLines = playerLines.filter(line => /three offerings/i.test(line));

    assert.strictEqual(introLines.length, 1);
  });

  it('emits progress hint with remaining ritual placements', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (target, line) => {
      deliveries.push({ target, line: String(line) });
    };

    const state = createState({ wax: true, stone: false, clapper: false });
    const npc = {
      metadata: {
        tomo: {
          hintCooldownMs: 1,
        },
      },
      room: {
        players: new Set(),
      },
      socket: { writable: false },
    };
    const player = {
      uuid: 'p2',
      metadata: {
        codex: {
          tomo: {
            introShown: true,
            completionShown: false,
            galleryRedirectShown: false,
            lastHintAt: 0,
          },
        },
      },
      inventory: new Set(),
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc, player];

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(10000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    const playerLines = linesForTarget(deliveries, player);
    assert.strictEqual(playerLines.length, 1);
    assert.match(playerLines[0], /prayer stone/i);
    assert.match(playerLines[0], /bronze clapper/i);
  });

  it('emits completion redirect when ritual is complete', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (target, line) => {
      deliveries.push({ target, line: String(line) });
    };

    const state = createState({ wax: true, stone: true, clapper: true });
    const npc = {
      metadata: { tomo: {} },
      room: { players: new Set() },
      socket: { writable: false },
    };
    const player = {
      uuid: 'p3',
      metadata: {
        codex: {
          tomo: {
            introShown: true,
            completionShown: false,
            galleryRedirectShown: false,
            lastHintAt: 0,
          },
        },
      },
      inventory: new Set(),
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc, player];

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(20000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    const playerLines = linesForTarget(deliveries, player);
    assert.strictEqual(playerLines.length, 1);
    assert.match(playerLines[0], /descent/i);
    assert.match(playerLines[0], /crypt/i);
  });

  it('emits gallery redirect after completion when player has shard', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (target, line) => {
      deliveries.push({ target, line: String(line) });
    };

    const state = createState({ wax: true, stone: true, clapper: true });
    const npc = {
      metadata: { tomo: {} },
      room: { players: new Set() },
      socket: { writable: false },
    };
    const player = {
      uuid: 'p4',
      metadata: {
        codex: {
          tomo: {
            introShown: true,
            completionShown: true,
            galleryRedirectShown: false,
            lastHintAt: 0,
          },
        },
      },
      inventory: new Set([{ entityReference: 'codex:resonantShard' }]),
      socket: { writable: false },
    };
    npc.room.getBroadcastTargets = () => [npc, player];

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(30000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    const playerLines = linesForTarget(deliveries, player);
    assert.strictEqual(playerLines.length, 1);
    assert.match(playerLines[0], /perception gallery/i);
  });

  it('patrols to next route room on updateTick when room is empty', async function () {
    const movedTo = [];
    const rooms = {
      'codex:bell_courtyard': { entityReference: 'codex:bell_courtyard', players: new Set() },
      'codex:bell_nave': { entityReference: 'codex:bell_nave', players: new Set() },
      'codex:bell_stair': { entityReference: 'codex:bell_stair', players: new Set() },
    };

    const state = createState({ rooms });
    const npc = {
      metadata: {
        tomo: {
          patrolIntervalMs: 1,
          patrolRoute: [
            'codex:bell_courtyard',
            'codex:bell_nave',
            'codex:bell_stair',
            'codex:bell_nave',
          ],
        },
      },
      room: rooms['codex:bell_courtyard'],
      moveTo(room) {
        movedTo.push(room.entityReference);
        this.room = room;
      },
    };

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(50000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.deepStrictEqual(movedTo, ['codex:bell_nave']);
  });

  it('patrol uses NPC command dispatch and does not call moveTo directly', async function () {
    const dispatchCalls = [];
    const movedTo = [];
    CommandDispatch.dispatchNpcIntent = async (_state, _npc, intent) => {
      dispatchCalls.push(intent);
      return { ok: true };
    };

    const rooms = {
      'codex:bell_courtyard': {
        entityReference: 'codex:bell_courtyard',
        players: new Set(),
        exits: [{ direction: 'north', roomId: 'codex:bell_nave' }],
      },
      'codex:bell_nave': { entityReference: 'codex:bell_nave', players: new Set() },
      'codex:bell_stair': { entityReference: 'codex:bell_stair', players: new Set() },
    };

    const state = createState({ rooms });
    const npc = {
      metadata: {
        tomo: {
          patrolIntervalMs: 1,
          patrolRoute: [
            'codex:bell_courtyard',
            'codex:bell_nave',
            'codex:bell_stair',
            'codex:bell_nave',
          ],
        },
      },
      room: rooms['codex:bell_courtyard'],
      moveTo(room) {
        movedTo.push(room.entityReference);
        this.room = room;
      },
    };

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(50000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.strictEqual(movedTo.length, 0);
    assert.strictEqual(dispatchCalls.length, 1);
  });

  it('patrol dispatch emits go intent for route movement', async function () {
    const dispatchCalls = [];
    CommandDispatch.dispatchNpcIntent = async (_state, _npc, intent) => {
      dispatchCalls.push(intent);
      return { ok: true };
    };

    const rooms = {
      'codex:bell_courtyard': {
        entityReference: 'codex:bell_courtyard',
        players: new Set(),
        exits: [{ direction: 'north', roomId: 'codex:bell_nave' }],
      },
      'codex:bell_nave': { entityReference: 'codex:bell_nave', players: new Set() },
      'codex:bell_stair': { entityReference: 'codex:bell_stair', players: new Set() },
    };

    const state = createState({ rooms });
    const npc = {
      metadata: {
        tomo: {
          patrolIntervalMs: 1,
          patrolRoute: [
            'codex:bell_courtyard',
            'codex:bell_nave',
            'codex:bell_stair',
            'codex:bell_nave',
          ],
        },
      },
      room: rooms['codex:bell_courtyard'],
      moveTo() { },
    };

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(50000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.deepStrictEqual(dispatchCalls[0], {
      kind: 'structured',
      verb: 'go',
      direct: ['north'],
      relationToken: null,
      indirect: [],
    });
  });

  it('patrol surfaces UNSUPPORTED_MUTATION_OP and does not direct-mutate when movement is not representable', async function () {
    const dispatchCalls = [];
    const movedTo = [];
    CommandDispatch.dispatchNpcIntent = async (_state, _npc, intent) => {
      dispatchCalls.push(intent);
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_MUTATION_OP' },
      };
    };

    const rooms = {
      'codex:bell_courtyard': {
        entityReference: 'codex:bell_courtyard',
        players: new Set(),
        exits: [{ direction: 'north', roomId: 'codex:bell_nave' }],
      },
      'codex:bell_nave': { entityReference: 'codex:bell_nave', players: new Set() },
      'codex:bell_stair': { entityReference: 'codex:bell_stair', players: new Set() },
    };

    const state = createState({ rooms });
    const npc = {
      metadata: {
        tomo: {
          patrolIntervalMs: 1,
          patrolRoute: [
            'codex:bell_courtyard',
            'codex:bell_nave',
            'codex:bell_stair',
            'codex:bell_nave',
          ],
        },
      },
      room: rooms['codex:bell_courtyard'],
      moveTo(room) {
        movedTo.push(room.entityReference);
        this.room = room;
      },
    };

    tomoScript.listeners.spawn(state).call(npc);
    const startRouteIndex = npc.__tomoRuntime.routeIndex;
    await withNow(50000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.strictEqual(dispatchCalls.length, 1);
    assert.strictEqual(movedTo.length, 0);
    assert.strictEqual(npc.__tomoRuntime.routeIndex, startRouteIndex);
  });

  it('does not patrol when players are present in Tomo room', async function () {
    const movedTo = [];
    const rooms = {
      'codex:bell_courtyard': { entityReference: 'codex:bell_courtyard', players: new Set([{ uuid: 'player-1' }]) },
      'codex:bell_nave': { entityReference: 'codex:bell_nave', players: new Set() },
      'codex:bell_stair': { entityReference: 'codex:bell_stair', players: new Set() },
    };

    const state = createState({ rooms });
    const npc = {
      metadata: {
        tomo: {
          patrolIntervalMs: 1,
          patrolRoute: [
            'codex:bell_courtyard',
            'codex:bell_nave',
            'codex:bell_stair',
            'codex:bell_nave',
          ],
        },
      },
      room: rooms['codex:bell_courtyard'],
      moveTo(room) {
        movedTo.push(room.entityReference);
        this.room = room;
      },
    };

    tomoScript.listeners.spawn(state).call(npc);
    await withNow(60000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.deepStrictEqual(movedTo, []);
  });

  it('routes intro speech through npc dispatcher and does not use direct speech helper', async function () {
    let dispatchCalls = 0;
    const directSpeechCalls = [];
    CommandDispatch.dispatchNpcIntent = async (_state, _npc, intent) => {
      dispatchCalls += 1;
      return { ok: true, intent };
    };
    ranvier.Broadcast.sayAt = (target, line) => {
      directSpeechCalls.push({ target, line: String(line) });
    };

    const state = createState();
    const npc = {
      metadata: {
        tomo: {
          hintCooldownMs: 999999,
        },
      },
      room: {
        players: new Set(),
      },
      socket: { writable: false },
    };
    const player = { uuid: 'p-dispatch', metadata: {}, inventory: new Set(), socket: { writable: false } };
    npc.room.getBroadcastTargets = () => [npc, player];

    const onSpawn = tomoScript.listeners.spawn(state);
    const onPlayerEnter = tomoScript.listeners.playerEnter(state);
    onSpawn.call(npc);

    await withNow(1000, () => onPlayerEnter.call(npc, player, null));

    assert.strictEqual(dispatchCalls, 1);
    assert.strictEqual(directSpeechCalls.length, 0);
  });
});
