// @ts-check
'use strict';

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
 * @param {*} value
 * @returns {string}
 */
function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  aliases: [],
  metadata: {
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits', 'room.items'],
          },
        },
        directIndirect: {
          acceptedRelations: ['with'],
          scopeProfile: {
            direct: ['room.exits', 'room.items'],
            indirect: ['player.inventory'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Open what?',
      FORM_MISSING_INDIRECT: 'Open it with what?',
      FORM_UNSUPPORTED_RELATION: 'You can only use "with" for that.',
      TARGET_NOT_FOUND: {
        direct: 'You do not see that.',
        indirect: 'You do not have that.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which do you mean?',
        indirect: 'Which do you mean?',
      },
      TARGET_NOT_DOOR: 'You cannot do that with that target.',
      DOOR_NO_ROOM: 'You are nowhere.',
    },
  },
  command: state => (args, player, alias, context) => {
    void state;
    void args;
    void player;
    void alias;

    const resolution = context && context.entityResolution;
    if (!resolution || (resolution.ruleKey !== 'direct' && resolution.ruleKey !== 'directIndirect')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!resolution.directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    if (resolution.ruleKey === 'directIndirect' && !resolution.indirectTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'indirect' });
    }

    const currentRoom = player && player.room && typeof player.room === 'object'
      ? player.room
      : null;
    if (!currentRoom) {
      return fail('DOOR_NO_ROOM');
    }

    const roomRef = resolution.directTarget && typeof resolution.directTarget.roomId === 'string'
      ? resolution.directTarget.roomId.trim()
      : '';
    if (!roomRef) {
      return fail('TARGET_NOT_DOOR');
    }

    const direction = normalizeDirection(resolution.directTarget && resolution.directTarget.direction);
    const fromRoomRef = typeof currentRoom.entityReference === 'string'
      ? currentRoom.entityReference
      : undefined;
    const doorLabel = direction ? `${direction} door` : 'door';

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'doorMutation',
            mutation: 'open',
            actor: player,
            fromRoomRef,
            direction: direction || undefined,
            roomRef,
          },
        ],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.You} {verb:open} {object.direct}.',
            audiencePolicy: 'self_and_others',
            participants: {
              actor: { selector: 'currentPlayer' },
            },
            objectText: {
              direct: `the ${doorLabel}`,
            },
          },
        ],
      },
    };
  },
};
