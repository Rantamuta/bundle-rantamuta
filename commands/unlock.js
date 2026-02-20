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
      FORM_MISSING_DIRECT: 'Unlock what?',
      FORM_MISSING_INDIRECT: 'Unlock it with what?',
      FORM_UNSUPPORTED_RELATION: 'You can only use "with" for that.',
      TARGET_NOT_FOUND: {
        direct: 'You do not see that.',
        indirect: 'You do not have that.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which do you mean?',
        indirect: 'Which do you mean?',
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
    if (!resolution || (resolution.ruleKey !== 'direct' && resolution.ruleKey !== 'directIndirect')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!resolution.directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    if (resolution.ruleKey === 'directIndirect' && !resolution.indirectTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'indirect' });
    }

    return fail('DOOR_NOT_IMPLEMENTED');
  },
};
