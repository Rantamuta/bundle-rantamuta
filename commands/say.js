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
 * @param {*} parsedInput
 * @returns {{ ok: true, text: string } | { ok: false, code: 'SAY_EMPTY' | 'SAY_TOO_LONG' }}
 */
function validateSpeechFromParsedInput(parsedInput) {
  const text = sanitizeSpeech(extractRawSpeechFromParsedInput(parsedInput));
  if (!text) {
    return { ok: false, code: 'SAY_EMPTY' };
  }
  if (text.length > MAX_SAY_LENGTH) {
    return { ok: false, code: 'SAY_TOO_LONG' };
  }
  return { ok: true, text };
}

module.exports = {
  aliases: [],
  metadata: {
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
      SAY_EMPTY: 'Say what?',
      SAY_TOO_LONG: 'That is too much to say at once.',
    },
  },
  command: state => (args, player, alias, context) => {
    void state;
    void player;
    void alias;
    void context;

    const text = sanitizeSpeech(args);
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
          {
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
