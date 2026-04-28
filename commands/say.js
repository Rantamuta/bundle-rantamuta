// @ts-check
'use strict';

const { compileCommandSyntaxMetadata } = require('../lib/runtime/command/verb-local-syntax');
const { tryDirectedConversation } = require('../lib/runtime/conversation/directed-speech');

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
 * @param {*} context
 * @returns {string}
 */
function extractSpeechFromContext(context) {
  const slots = context && context.entityResolution && Array.isArray(context.entityResolution.slots)
    ? context.entityResolution.slots
    : [];
  const textSlot = slots.find(slot => slot && slot.kind === 'TEXT' && typeof slot.surface === 'string');
  if (textSlot) {
    return textSlot.surface;
  }

  return extractRawSpeechFromParsedInput(context && context.parsedInput);
}

/**
 * @param {*} context
 * @returns {string}
 */
function requireMatchedRuleText(context) {
  const matchedRuleText = context && context.entityResolution
    ? context.entityResolution.matchedRuleText
    : null;

  if (typeof matchedRuleText !== 'string' || !matchedRuleText.trim()) {
    throw new TypeError('say command requires entityResolution.matchedRuleText; legacy ruleKey dispatch is forbidden.');
  }

  return matchedRuleText;
}

/**
 * @param {string} text
 * @returns {{ ok: true, plan: { operations: Array<*> }, render: { messages: Array<*> } }}
 */
function createOrdinarySayResult(text) {
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
}

/**
 * @param {string} text
 * @returns {{ ok: true, plan: { operations: Array<*> }, render: { messages: Array<*> } }}
 */
function createAddressedSayResult(text) {
  return {
    ok: true,
    plan: {
      operations: [{ type: 'noop' }],
    },
    render: {
      messages: [
        {
          type: 'semanticEvent',
          template: '{actor.you} {verb:say}, "{object.direct}" to {target.you}.',
          audiencePolicy: 'self_target_and_others',
          participants: {
            actor: { selector: 'currentActor' },
            target: { selector: 'entityByContextRole', role: 'indirectTarget' },
          },
          objectText: {
            direct: text,
          },
        },
      ],
    },
  };
}

module.exports = {
  aliases: [],
  metadata: compileCommandSyntaxMetadata('say', {
    syntaxRules: ['TEXT to LIVING', 'TEXT', '(empty)'],
    captureChecks: [
      context => {
        const text = sanitizeSpeech(extractSpeechFromContext(context));
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
  }),
  command: state => (args, player, alias, context) => {
    void state;
    void player;
    void alias;

    const text = sanitizeSpeech(extractSpeechFromContext(context) || args);
    if (!text) {
      return fail('SAY_EMPTY');
    }
    if (text.length > MAX_SAY_LENGTH) {
      return fail('SAY_TOO_LONG');
    }

    const matchedRuleText = requireMatchedRuleText(context);

    switch (matchedRuleText) {
      case 'TEXT to LIVING': {
        const conversationResult = tryDirectedConversation(
          state,
          player,
          text,
          context && context.entityResolution ? context.entityResolution.indirectTarget : null
        );
        return conversationResult || createAddressedSayResult(text);
      }

      case 'TEXT':
        return createOrdinarySayResult(text);

      case '(empty)':
        return fail('SAY_EMPTY');

      default:
        throw new TypeError(`say command received unsupported matchedRuleText "${matchedRuleText}".`);
    }
  },
};
