// @ts-check
'use strict';

const assert = require('assert');
const commandDef = require('../commands/setplayermetadata');

function createState() {
  const playersByName = new Map();

  return {
    PlayerManager: {
      getPlayer(name) {
        return playersByName.get(String(name || '').toLowerCase()) || null;
      },
    },
    playersByName,
  };
}

describe('bundle-rantamuta setplayermetadata command', function () {
  it('is npc-only via actorKindsAllowed metadata gate', function () {
    assert.ok(commandDef.metadata);
    assert.deepStrictEqual(commandDef.metadata.actorKindsAllowed, ['npc']);
  });

  it('returns usage failure when required args are missing', function () {
    const state = createState();
    const execute = commandDef.command(state);
    const npc = { isNpc: true, name: 'Tomo' };

    const result = execute('', npc, null, {});

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'SET_PLAYER_METADATA_USAGE',
      },
    });
  });

  it('returns player-not-found failure when player token cannot resolve', function () {
    const state = createState();
    const execute = commandDef.command(state);
    const npc = { isNpc: true, name: 'Tomo' };

    const result = execute('missing tomo.introShown true', npc, null, {});

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'SET_PLAYER_METADATA_PLAYER_NOT_FOUND',
      },
    });
  });

  it('returns invalid-key failure for unsafe keys', function () {
    const state = createState();
    const player = { name: 'Rendall', metadata: {} };
    state.playersByName.set('rendall', player);
    const execute = commandDef.command(state);
    const npc = { isNpc: true, name: 'Tomo' };

    const result = execute('Rendall foo..bar true', npc, null, {});

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'SET_PLAYER_METADATA_INVALID_KEY',
      },
    });
  });

  it('returns mutation plan and does not mutate directly', function () {
    const state = createState();
    const player = { name: 'Rendall', metadata: {} };
    state.playersByName.set('rendall', player);
    const execute = commandDef.command(state);
    const npc = { isNpc: true, name: 'Tomo' };

    const before = JSON.stringify(player.metadata);
    const result = execute('Rendall tomo.introShown true', npc, null, {});

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [
          {
            type: 'setPlayerMetadata',
            player,
            key: 'tomo.introShown',
            value: true,
          },
        ],
      },
    });

    assert.strictEqual(JSON.stringify(player.metadata), before);
  });
});
