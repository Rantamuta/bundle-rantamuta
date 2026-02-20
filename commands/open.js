// @ts-check
'use strict';

const {
  normalizeRef,
  displayName,
  resolveDoorActionContext,
  selectExplicitKeyCandidate,
  selectAutoKeyCandidate,
} = require('../lib/doors/door-command-helper');

/**
 * @param {string} code
 * @param {Record<string, *>} [details]
 * @param {string} [message]
 * @returns {{ ok: false, error: { code: string, details?: Record<string, *>, message?: string } }}
 */
function fail(code, details, message) {
  return {
    ok: false,
    error: { code, details, message },
  };
}

/**
 * @param {*} player
 * @param {*} resolution
 * @param {*} door
 * @returns {{ key: * | null, explicit: boolean, message?: string }}
 */
function resolveOpenKey(player, resolution, door) {
  const lockedBy = normalizeRef(door && door.lockedBy);
  const explicit = resolution && resolution.ruleKey === 'directIndirect';
  if (!lockedBy) {
    return { key: null, explicit };
  }

  if (explicit) {
    const selected = selectExplicitKeyCandidate(player, resolution.indirectSpan || [], lockedBy);
    if (!selected.selected) {
      const keyPhrase = Array.isArray(resolution.indirectSpan)
        ? resolution.indirectSpan.join(' ').trim()
        : '';
      const keyLabel = keyPhrase || 'that key';
      return {
        key: null,
        explicit: true,
        message: `You try the ${keyLabel}, but it does not fit the lock.`,
      };
    }

    return { key: selected.selected, explicit: true };
  }

  const auto = selectAutoKeyCandidate(player, lockedBy);
  if (!auto) {
    return { key: null, explicit: false };
  }

  return { key: auto, explicit: false };
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
          allowUnresolvedIndirect: true,
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
      GO_DESTINATION_MISSING: 'You can\'t go that way.',
      DOOR_ALREADY_OPEN: 'The door is already open.',
      DOOR_OPEN_LOCKED: 'You cannot open the door; it is locked.',
    },
  },
  command: state => (args, player, alias, context) => {
    void args;
    void alias;

    const resolution = context && context.entityResolution;
    if (!resolution || (resolution.ruleKey !== 'direct' && resolution.ruleKey !== 'directIndirect')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!resolution.directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    const doorContext = resolveDoorActionContext(state, player, resolution);
    if (doorContext.ok === false) {
      return fail(doorContext.code);
    }

    if (doorContext.door.closed !== true && doorContext.door.locked !== true) {
      return fail('DOOR_ALREADY_OPEN', undefined, `The ${doorContext.doorLabel} is already open.`);
    }

    const keyResolution = resolveOpenKey(player, resolution, doorContext.door);
    if (doorContext.door.locked === true && !keyResolution.key && normalizeRef(doorContext.door.lockedBy)) {
      if (keyResolution.explicit) {
        return fail('DOOR_WRONG_KEY', undefined, keyResolution.message || 'That key does not fit the lock.');
      }

      return fail('DOOR_OPEN_LOCKED', undefined, `You cannot open the ${doorContext.doorLabel}; it is locked.`);
    }

    /** @type {Array<Record<string, *>>} */
    const messages = [];
    if (keyResolution.explicit && keyResolution.key && doorContext.door.locked === true) {
      messages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct} with the {object.indirect}.',
        audiencePolicy: 'self',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: doorContext.doorLabel,
          indirect: displayName(keyResolution.key) || 'key',
        },
      });
    } else {
      messages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct}.',
        audiencePolicy: 'self',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: doorContext.doorLabel,
        },
      });
    }

    messages.push({
      type: 'broadcast',
      audience: 'room',
      targetSelector: 'roomByRef',
      targetRoomRef: doorContext.roomRef,
      message: `The ${doorContext.oppositeDoorLabel} opens.`,
    });

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'doorMutation',
            mutation: 'open',
            actor: player,
            direction: doorContext.direction,
          },
        ],
      },
      render: {
        messages,
      },
    };
  },
};
