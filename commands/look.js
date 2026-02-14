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

module.exports = {
  aliases: ['l'],
  metadata: {
    entityResolution: {
      rules: {
        intransitive: {},
      },
    },
    errorMessages: {
      LOOK_NO_ROOM: 'You are nowhere.',
    },
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'intransitive') {
      return fail('FORM_NOT_SUPPORTED');
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
