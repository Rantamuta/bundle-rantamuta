// @ts-check
'use strict';

const assert = require('assert');
const ranvier = require('ranvier');
const mirrorCantorScript = require('../areas/codex/scripts/npcs/mirrorCantor');
const { dispatchNpcIntent } = require('../lib/session/command-dispatch');
const sayDef = require('../commands/say');
const goDef = require('../commands/go');

/**
 * @param {*} actor
 * @param {*} rooms
 * @returns {*}
 */
function createState(actor, rooms) {
  const state = {
    PlayerManager: {
      getPlayer: name => (name === actor.name ? actor : null),
    },
    RoomManager: {
      getRoom: ref => rooms[ref] || null,
    },
  };

  state.CommandManager = {
    get: key => {
      if (key === 'say') {
        return {
          metadata: sayDef.metadata,
          execute: sayDef.command(state),
        };
      }
      if (key === 'go') {
        return {
          metadata: goDef.metadata,
          execute: goDef.command(state),
        };
      }
      return null;
    },
  };

  return state;
}

describe('codex mirror cantor script', function () {
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

  it('adds a mirrored echo through planActor when the cantor speaks', async function () {
    const deliveries = [];
    ranvier.Broadcast.sayAt = (_target, message) => {
      deliveries.push(String(message));
    };
    ranvier.Broadcast.prompt = () => { };

    const gallery = {
      entityReference: 'codex:perception_gallery',
      area: {},
      metadata: { values: { mirrorsAwake: true } },
      exits: [{ direction: 'west', roomId: 'codex:square' }],
      getBroadcastTargets: () => [cantor],
    };
    const square = {
      entityReference: 'codex:square',
      area: {},
      metadata: {},
      exits: [],
      getBroadcastTargets: () => [],
    };
    const cantor = {
      entityReference: 'codex:mirrorCantor',
      name: 'Mirror Cantor',
      isNpc: true,
      metadata: {
        mirrorCantor: {
          planVerb: 'say',
          planMessage: 'The mirrors answer a beat later in borrowed voices.',
          roomMetadataKey: 'mirrorCantorEchoed',
          roomMetadataValue: true,
          denyVerb: 'go',
          denyMessage: 'The cantor plants her staff. "Not while the mirrors are listening."',
        },
      },
      room: gallery,
      socket: { writable: false },
    };
    gallery.getBroadcastTargets = () => [cantor];

    const state = createState(cantor, {
      'codex:perception_gallery': gallery,
      'codex:square': square,
    });
    mirrorCantorScript.listeners.spawn(state).call(cantor);

    const result = await dispatchNpcIntent(state, cantor, {
      kind: 'text',
      input: 'say the gallery remembers',
    });

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(gallery.metadata.values.mirrorCantorEchoed, true);
    assert.ok(deliveries.includes('The mirrors answer a beat later in borrowed voices.'));
    assert.ok(deliveries.some(line => /gallery remembers/i.test(line)));
  });

  it('denies go through canActor even when the exit is otherwise valid', async function () {
    ranvier.Broadcast.sayAt = () => { };
    ranvier.Broadcast.prompt = () => { };

    const gallery = {
      entityReference: 'codex:perception_gallery',
      area: {},
      metadata: { values: { mirrorsAwake: true } },
      exits: [{ direction: 'west', roomId: 'codex:square' }],
      getBroadcastTargets: () => [cantor],
    };
    const square = {
      entityReference: 'codex:square',
      area: {},
      metadata: {},
      exits: [],
      getBroadcastTargets: () => [],
    };
    const cantor = {
      entityReference: 'codex:mirrorCantor',
      name: 'Mirror Cantor',
      isNpc: true,
      metadata: {
        mirrorCantor: {
          planVerb: 'say',
          planMessage: 'The mirrors answer a beat later in borrowed voices.',
          roomMetadataKey: 'mirrorCantorEchoed',
          roomMetadataValue: true,
          denyVerb: 'go',
          denyMessage: 'The cantor plants her staff. "Not while the mirrors are listening."',
        },
      },
      room: gallery,
      socket: { writable: false },
    };
    gallery.getBroadcastTargets = () => [cantor];

    const state = createState(cantor, {
      'codex:perception_gallery': gallery,
      'codex:square': square,
    });
    mirrorCantorScript.listeners.spawn(state).call(cantor);

    const result = await dispatchNpcIntent(state, cantor, {
      kind: 'text',
      input: 'go west',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'ACTOR_KIND_FORBIDDEN',
        message: 'The cantor plants her staff. "Not while the mirrors are listening."',
        details: {
          actorKind: 'npc',
          verbId: 'go',
          source: 'codex.mirrorCantor',
        },
      },
    });
    assert.strictEqual(cantor.room, gallery);
  });
});
