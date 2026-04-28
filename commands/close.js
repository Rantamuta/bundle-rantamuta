// @ts-check
'use strict';

const { resolveDoorActionContext } = require('../lib/runtime/doors/door-command-helper');
const { compileCommandSyntaxMetadata } = require('../lib/runtime/command/verb-local-syntax');

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

module.exports = {
  aliases: [],
  metadata: compileCommandSyntaxMetadata('close', {
    syntaxRules: ['ENTITY'],
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits', 'room.items'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Close what?',
      TARGET_NOT_FOUND: {
        direct: 'You do not see that.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which do you mean?',
      },
      TARGET_NOT_DOOR: 'You cannot do that with that target.',
      DOOR_NO_ROOM: 'You are nowhere.',
      GO_DESTINATION_MISSING: 'You can\'t go that way.',
      DOOR_ALREADY_CLOSED: 'The door is already closed.',
    },
  }),
  command: state => (args, player, alias, context) => {
    void args;
    void alias;

    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!resolution.directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    const doorContext = resolveDoorActionContext(state, player, resolution);
    if (doorContext.ok === false) {
      return fail(doorContext.code);
    }

    if (doorContext.door.closed === true) {
      return fail('DOOR_ALREADY_CLOSED', undefined, `The ${doorContext.doorLabel} is already closed.`);
    }

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'operateDoor',
            mutation: 'close',
            actor: player,
            direction: doorContext.direction,
          },
        ],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.You} {verb:close} the {object.direct}.',
            audiencePolicy: 'self',
            participants: {
              actor: { selector: 'currentPlayer' },
            },
            objectText: {
              direct: doorContext.doorLabel,
            },
          },
          {
            type: 'broadcast',
            audience: 'room',
            targetSelector: 'roomByRef',
            targetRoomRef: doorContext.roomRef,
            message: `The ${doorContext.oppositeDoorLabel} closes.`,
          },
        ],
      },
    };
  },
};
