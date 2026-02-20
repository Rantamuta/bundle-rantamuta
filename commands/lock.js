// @ts-check
'use strict';

const {
  createDoorCommandEntityResolutionRules,
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
function resolveLockKey(player, resolution, door) {
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
        message: `You try to lock the door with the ${keyLabel}, but it does not fit the lock.`,
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
      rules: createDoorCommandEntityResolutionRules(),
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Lock what?',
      FORM_MISSING_INDIRECT: 'Lock it with what?',
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
      DOOR_ALREADY_LOCKED: 'The door is already locked.',
      DOOR_CANNOT_LOCK: 'You cannot lock the door.',
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

    if (doorContext.door.locked === true) {
      return fail('DOOR_ALREADY_LOCKED', undefined, `The ${doorContext.doorLabel} is already locked.`);
    }

    const keyResolution = resolveLockKey(player, resolution, doorContext.door);
    if (normalizeRef(doorContext.door.lockedBy) && !keyResolution.key) {
      if (keyResolution.explicit) {
        return fail('DOOR_WRONG_KEY', undefined, keyResolution.message);
      }

      return fail('DOOR_CANNOT_LOCK', undefined, `You cannot lock the ${doorContext.doorLabel}.`);
    }

    /** @type {Array<Record<string, *>>} */
    const messages = [];
    if (keyResolution.explicit && keyResolution.key) {
      messages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:lock} the {object.direct} with the {object.indirect}.',
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
        template: '{actor.You} {verb:lock} the {object.direct}.',
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
      message: `The ${doorContext.oppositeDoorLabel} locks with a click.`,
    });

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'doorMutation',
            mutation: 'closeAndLock',
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
