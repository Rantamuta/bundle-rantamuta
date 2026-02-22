// @ts-check
'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const tomoScript = require('../areas/codex/scripts/npcs/tomoCaretaker');

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

  return {
    ItemManager: {
      items: new Set([reliquary, basin, bell]),
    },
    RoomManager: {
      getRoom: (ref) => rooms[ref] || null,
    },
  };
}

function withNow(now, fn) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

describe('bundle-rantamuta codex tomo caretaker script', function () {
  let originalSayAt;

  beforeEach(function () {
    originalSayAt = ranvier.Broadcast.sayAt;
  });

  afterEach(function () {
    ranvier.Broadcast.sayAt = originalSayAt;
  });

  it('emits intro once per player', function () {
    const lines = [];
    ranvier.Broadcast.sayAt = (target, line) => {
      lines.push({ target, line: String(line) });
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
    };
    const player = { uuid: 'p1', metadata: {}, inventory: new Set() };

    const onSpawn = tomoScript.listeners.spawn(state);
    const onPlayerEnter = tomoScript.listeners.playerEnter(state);
    onSpawn.call(npc);

    withNow(1000, () => onPlayerEnter.call(npc, player, null));
    withNow(2000, () => onPlayerEnter.call(npc, player, null));

    const introLines = lines
      .map(entry => entry.line)
      .filter(line => /three offerings/i.test(line));

    assert.strictEqual(introLines.length, 1);
  });

  it('emits progress hint with remaining ritual placements', function () {
    const lines = [];
    ranvier.Broadcast.sayAt = (_target, line) => {
      lines.push(String(line));
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
    };

    tomoScript.listeners.spawn(state).call(npc);
    withNow(10000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /prayer stone/i);
    assert.match(lines[0], /bronze clapper/i);
  });

  it('emits completion redirect when ritual is complete', function () {
    const lines = [];
    ranvier.Broadcast.sayAt = (_target, line) => {
      lines.push(String(line));
    };

    const state = createState({ wax: true, stone: true, clapper: true });
    const npc = {
      metadata: { tomo: {} },
      room: { players: new Set() },
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
    };

    tomoScript.listeners.spawn(state).call(npc);
    withNow(20000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /descent/i);
    assert.match(lines[0], /crypt/i);
  });

  it('emits gallery redirect after completion when player has shard', function () {
    const lines = [];
    ranvier.Broadcast.sayAt = (_target, line) => {
      lines.push(String(line));
    };

    const state = createState({ wax: true, stone: true, clapper: true });
    const npc = {
      metadata: { tomo: {} },
      room: { players: new Set() },
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
    };

    tomoScript.listeners.spawn(state).call(npc);
    withNow(30000, () => tomoScript.listeners.playerEnter(state).call(npc, player, null));

    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /perception gallery/i);
  });

  it('patrols to next route room on updateTick when room is empty', function () {
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
    withNow(50000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.deepStrictEqual(movedTo, ['codex:bell_nave']);
  });

  it('does not patrol when players are present in Tomo room', function () {
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
    withNow(60000, () => tomoScript.listeners.updateTick(state).call(npc));

    assert.deepStrictEqual(movedTo, []);
  });
});
