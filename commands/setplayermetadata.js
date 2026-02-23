// @ts-check
'use strict';

const { parsePath } = require('../lib/session/player-metadata');

/**
 * @param {string} code
 * @returns {{ ok: false, error: { code: string } }}
 */
function fail(code) {
  return {
    ok: false,
    error: { code },
  };
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {string} raw
 * @returns {*}
 */
function parseMetadataValue(raw) {
  const normalized = normalizeText(raw);
  if (/^true$/iu.test(normalized)) {
    return true;
  }
  if (/^false$/iu.test(normalized)) {
    return false;
  }
  if (/^null$/iu.test(normalized)) {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return raw;
}

module.exports = {
  aliases: [],
  metadata: {
    actorKindsAllowed: ['npc'],
    errorMessages: {
      SET_PLAYER_METADATA_USAGE: 'Usage: setplayermetadata <player> <key> <value>',
      SET_PLAYER_METADATA_PLAYER_NOT_FOUND: 'Player target not found.',
      SET_PLAYER_METADATA_INVALID_KEY: 'Invalid metadata key.',
    },
  },
  command: state => (args, actor, alias, context) => {
    void actor;
    void alias;
    void context;

    const normalized = normalizeText(args);
    if (!normalized) {
      return fail('SET_PLAYER_METADATA_USAGE');
    }

    const tokens = normalized.split(/\s+/u);
    if (tokens.length < 3) {
      return fail('SET_PLAYER_METADATA_USAGE');
    }

    const playerToken = tokens[0];
    const key = tokens[1];
    const valueToken = tokens.slice(2).join(' ');

    if (!parsePath(key)) {
      return fail('SET_PLAYER_METADATA_INVALID_KEY');
    }

    const playerManager = state && state.PlayerManager;
    if (!playerManager || typeof playerManager.getPlayer !== 'function') {
      return fail('SET_PLAYER_METADATA_PLAYER_NOT_FOUND');
    }

    const targetPlayer = playerManager.getPlayer(playerToken);
    if (!targetPlayer || typeof targetPlayer !== 'object') {
      return fail('SET_PLAYER_METADATA_PLAYER_NOT_FOUND');
    }

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'setPlayerMetadata',
            player: targetPlayer,
            key,
            value: parseMetadataValue(valueToken),
          },
        ],
      },
    };
  },
};
