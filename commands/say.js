// @ts-check
'use strict';

const MAX_SAY_LENGTH = 256;

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
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Deterministic speech normalization for say input.
 *
 * @param {*} value
 * @returns {string}
 */
function sanitizeSpeech(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {*} parsedInput
 * @returns {string}
 */
function extractRawSpeechFromParsedInput(parsedInput) {
  const normalizedInput = normalizeText(parsedInput && parsedInput.normalizedInput);
  if (!normalizedInput) {
    return '';
  }

  const firstSpaceIndex = normalizedInput.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return '';
  }

  return normalizedInput.slice(firstSpaceIndex + 1);
}

/**
 * @param {*} span
 * @returns {string}
 */
function spanText(span) {
  return Array.isArray(span) ? span.join(' ') : '';
}

module.exports = {
  aliases: [],
  metadata: {
    entityResolution: {
      rules: {
        literal: {},
        literalIndirect: {
          acceptedRelations: ['to'],
          allowUnresolvedIndirect: true,
          scopeProfile: {
            indirect: ['room.players', 'room.npcs'],
          },
        },
      },
    },
    captureChecks: [
      context => {
        const text = sanitizeSpeech(extractRawSpeechFromParsedInput(context && context.parsedInput));
        if (!text) {
          return {
            ok: false,
            code: 'SAY_EMPTY',
          };
        }
        if (text.length > MAX_SAY_LENGTH) {
          return {
            ok: false,
            code: 'SAY_TOO_LONG',
          };
        }
        return null;
      },
    ],
    errorMessages: {
      FORM_MISSING_DIRECT: 'Say what?',
      SAY_EMPTY: 'Say what?',
      SAY_TOO_LONG: 'That is too much to say at once.',
      FORM_QUOTED_SECONDARY_UNSUPPORTED: 'You cannot put the addressee in quotes.',
    },
  },
  command: state => (args, player, alias, context) => {
    void state;
    void player;
    void alias;

    const parsedInput = context && context.parsedInput && typeof context.parsedInput === 'object'
      ? context.parsedInput
      : {};
    const resolution = context && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : {};
    const primaryText = spanText(parsedInput.primaryTargetSpan) || spanText(resolution.directSpan);
    const relationText = typeof parsedInput.relationToken === 'string'
      ? parsedInput.relationToken
      : (typeof resolution.relationTokenRaw === 'string' ? resolution.relationTokenRaw : '');
    const secondaryText = spanText(parsedInput.secondaryTargetSpan) || spanText(resolution.indirectSpan);

    const directedText = sanitizeSpeech(primaryText || args);
    const fallbackText = sanitizeSpeech(
      [primaryText, relationText, secondaryText].filter(Boolean).join(' ') || args
    );
    const text = resolution.indirectTarget ? directedText : fallbackText;
    if (!text) {
      return fail('SAY_EMPTY');
    }
    if (text.length > MAX_SAY_LENGTH) {
      return fail('SAY_TOO_LONG');
    }

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: [
          resolution.indirectTarget
            ? {
                type: 'semanticEvent',
                template: '{actor.you} {verb:say}, "{object.direct}" to {target.you}',
                audiencePolicy: 'self_target_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                  target: { selector: 'entityByContextRole', role: 'indirectTarget' },
                },
                objectText: {
                  direct: text,
                },
              }
            : {
                type: 'semanticEvent',
                template: '{actor.you} {verb:say}, "{object.direct}"',
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentActor' },
                },
                objectText: {
                  direct: text,
                },
              },
        ],
      },
    };
  },
};
