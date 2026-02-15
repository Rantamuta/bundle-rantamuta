// @ts-check
'use strict';

const { buildRoomViewLines } = require('../lib/helpers/room-view-helper');

/**
 * @param {string} code
 * @param {Record<string, *>} [details]
 * @returns {{ ok: false, error: { code: string, details?: Record<string, *> } }}
 */
function fail(code, details) {
  return {
    ok: false,
    error: { code, details },
  };
}

/**
 * @param {*} target
 * @returns {string[]}
 */
function buildDirectLookLines(target) {
  if (!target || typeof target !== 'object') {
    return ['You see nothing special.'];
  }

  if (typeof target.description === 'string' && target.description.trim().length > 0) {
    return [target.description.trim()];
  }

  return ['You see nothing special.'];
}

module.exports = {
  aliases: ['l'],
  metadata: {
    entityResolution: {
      rules: {
        intransitive: {},
        direct: {
          scopeProfile: {
            direct: ['room.items', 'room.details', 'player.inventory'],
          },
        },
      },
    },
    errorMessages: {
      LOOK_NO_ROOM: 'You are nowhere.',
    },
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || (resolution.ruleKey !== 'intransitive' && resolution.ruleKey !== 'direct')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (resolution.ruleKey === 'direct') {
      if (!resolution.directTarget) {
        return fail('TARGET_NOT_FOUND', { role: 'direct' });
      }

      return {
        ok: true,
        plan: {
          operations: [{ type: 'noop' }],
        },
        render: {
          lines: buildDirectLookLines(resolution.directTarget),
        },
      };
    }

    /** @type {import('ranvier/types/Room') | null | undefined} */
    const room = player.room;
    if (!room) {
      return fail('LOOK_NO_ROOM');
    }

    const lines = buildRoomViewLines(room);

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines,
      },
    };
  }
};
