// @ts-check
'use strict';

const { compileCommandSyntaxMetadata } = require('../lib/session/verb-local-syntax');

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
  metadata: compileCommandSyntaxMetadata('go', {
    syntaxRules: ['EXIT'],
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Go where?',
      FORM_NOT_SUPPORTED: 'You can\'t go that way.',
      TARGET_NOT_FOUND: {
        direct: 'You can\'t go that way.',
      },
      GO_NO_ROOM: 'You are nowhere.',
      GO_EXIT_LOCKED: 'The way is locked.',
      GO_DESTINATION_MISSING: 'You can\'t go that way.',
    },
  }),
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    const currentRoom = player && player.room;
    if (!currentRoom || typeof currentRoom !== 'object') {
      return fail('GO_NO_ROOM');
    }

    const exit = resolution.directTarget;
    const roomId = exit && typeof exit.roomId === 'string' ? exit.roomId : '';
    if (!roomId) {
      return fail('GO_DESTINATION_MISSING');
    }
    const roomManager = state && state.RoomManager;
    const destination = roomManager && typeof roomManager.getRoom === 'function'
      ? roomManager.getRoom(roomId)
      : null;
    if (!destination) {
      return fail('GO_DESTINATION_MISSING');
    }

    if (exit && typeof exit === 'object') {
      exit.__goDestination = destination;
      exit.__goWorld = state;
    }

    return {
      ok: true,
      plan: {
        operations: [],
      },
      render: {
        messages: [],
      },
    };
  },
};
