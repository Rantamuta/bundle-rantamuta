// @ts-check
'use strict';

const { Logger } = require('ranvier');

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
 * Only entities explicitly marked with `metadata.pullable: true` are pullable.
 *
 * @param {*} entity
 * @returns {boolean}
 */
function isPullable(entity) {
  if (!entity || typeof entity !== 'object') {
    return false;
  }

  const metadata = entity.metadata && typeof entity.metadata === 'object'
    ? /** @type {Record<string, *>} */ (entity.metadata)
    : {};

  return metadata.pullable === true;
}

/**
 * @param {string[] | undefined} span
 * @param {*} entity
 * @param {string} fallback
 * @returns {string}
 */
function displayLabel(span, entity, fallback) {
  const spanText = Array.isArray(span) ? span.map(part => String(part)).join(' ').trim() : '';
  if (spanText.length > 0) {
    return spanText;
  }

  if (entity && typeof entity.name === 'string' && entity.name.length > 0) {
    return entity.name;
  }

  return fallback;
}

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isSemanticMessage(value) {
  return !!value &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    value.type === 'semanticEvent';
}

/**
 * @param {*} directTarget
 * @param {{ state: *, player: *, resolution: *, context: * }} payload
 * @returns {Array<Record<string, *>> | null}
 */
function resolvePullSuccessMessages(directTarget, payload) {
  if (!directTarget || typeof directTarget !== 'object' || typeof directTarget.pullSuccessMessage !== 'function') {
    return null;
  }

  const override = directTarget.pullSuccessMessage(payload);
  if (isSemanticMessage(override)) {
    return [override];
  }

  if (Array.isArray(override)) {
    const messages = override.filter(isSemanticMessage);
    return messages.length > 0 ? messages : null;
  }

  if (override !== null && override !== undefined) {
    Logger.error('pullSuccessMessage override must return semanticEvent instruction(s). Override ignored.');
  }

  return null;
}

module.exports = {
  aliases: [],
  metadata: {
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.items'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Pull what?',
      TARGET_NOT_FOUND: {
        direct: 'You do not see that.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which do you mean?',
      },
      PULL_NOT_PULLABLE: 'Nothing happens.',
    },
  },
  command: state => (args, player, alias, context) => {
    void state;
    void args;
    void alias;

    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    const directTarget = resolution.directTarget;
    if (!directTarget) {
      return fail('TARGET_NOT_FOUND', { role: 'direct' });
    }

    if (!isPullable(directTarget)) {
      return fail('PULL_NOT_PULLABLE');
    }

    const overrideMessages = resolvePullSuccessMessages(directTarget, {
      state,
      player,
      resolution,
      context,
    });

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: overrideMessages || [
          {
            type: 'semanticEvent',
            template: '{actor.You} {verb:pull} {object.direct}.',
            audiencePolicy: 'self_and_others',
            participants: {
              actor: { selector: 'currentPlayer' },
            },
            objectText: {
              direct: `the ${displayLabel(resolution.directSpan, directTarget, 'thing')}`,
            },
          },
        ],
      },
    };
  },
};
