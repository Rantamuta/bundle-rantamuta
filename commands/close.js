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
      DOOR_NOT_IMPLEMENTED: 'Not implemented yet.',
    },
  },
  command: state => (args, player, alias, context) => {
    void state;
    void args;
    void player;
    void alias;

    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!resolution.directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    return fail('DOOR_NOT_IMPLEMENTED');
  },
};
