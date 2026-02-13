// @ts-check
'use strict';

const RELATION_TOKENS = new Set(['in', 'on', 'from', 'with', 'to', 'into', 'onto', 'off', 'up', 'down', 'over', 'under']);
const RELATION_SHAPE_INTENTS = new Set(['put']);

const UNKNOWN_INTENT_CODE = 'PARSER_UNKNOWN_INTENT';
const SEMANTIC_ERROR_CODE = 'PARSER_SEMANTIC_RELATION_SHAPE';

/**
 * Parser utility for bundle-level actor input.
 *
 * This module performs the syntax-only stages of command interpretation:
 * - lexical tokenization (`lexInput`)
 * - deterministic token normalization
 * - parse artifact construction (`parseInput`)
 *
 * It is intentionally limited in scope:
 * - no world/entity lookup
 * - no permission/rule validation
 * - no state mutation
 * - no side effects
 *
 * Typical use:
 * 1. Call `parseInput(actorInput)` in the input-event command path.
 * 2. If classification is `success`, use `intentToken` for command lookup and
 *    keep spans (`primaryTargetSpan`, `relationToken`, `secondaryTargetSpan`)
 *    for downstream target resolution/validation.
 * 3. If classification is `unknown intent` or `semantic error`, emit the
 *    appropriate user-facing fallback/unknown behavior.
 *
 * @typedef {Object} ParseArtifact
 * @property {string} actorInput
 * Raw user input as received from the actor.
 * @property {string} normalizedInput
 * Input after deterministic normalization.
 * @property {string|null} intentToken
 * First normalized token used for command lookup.
 * @property {string[]} primaryTargetSpan
 * Tokens between `intentToken` and `relationToken`.
 * @property {string|null} relationToken
 * Recognized relation keyword token when present.
 * @property {string[]} secondaryTargetSpan
 * Tokens following `relationToken`.
 * @property {'success'|'unknown intent'|'semantic error'} classification
 * Parser-owned outcome class.
 * @property {null|{class: string, code: string, details: Object}} errorEnvelope
 * Stable machine-assertable failure payload for non-success cases.
 */

/**
 * Convert raw actor input into ordered lexical tokens.
 *
 * Rules:
 * - trims surrounding whitespace
 * - collapses repeated internal whitespace
 * - preserves token order
 *
 * @param {string} actorInput
 * @returns {string[]}
 */
function lexInput(actorInput) {
  const raw = String(actorInput || '');
  const normalizedWhitespace = raw.trim().replace(/\s+/g, ' ');
  if (!normalizedWhitespace) {
    return [];
  }

  return normalizedWhitespace.split(' ');
}

function normalizeTokens(tokens) {
  if (!tokens.length) {
    return [];
  }

  const normalizedTokens = [...tokens];
  normalizedTokens[0] = normalizedTokens[0].toLowerCase();

  for (let i = 1; i < normalizedTokens.length; i += 1) {
    const candidate = normalizedTokens[i].toLowerCase();
    if (RELATION_TOKENS.has(candidate)) {
      normalizedTokens[i] = candidate;
    }
  }

  return normalizedTokens;
}

function makeUnknownIntent(actorInput, normalizedInput) {
  return {
    actorInput,
    normalizedInput,
    intentToken: null,
    primaryTargetSpan: [],
    relationToken: null,
    secondaryTargetSpan: [],
    classification: 'unknown intent',
    errorEnvelope: {
      class: 'unknown intent',
      code: UNKNOWN_INTENT_CODE,
      details: {
        reason: 'missing-intent-token',
      },
    },
  };
}

function makeSemanticError(actorInput, normalizedInput, intentToken, primaryTargetSpan, relationToken, secondaryTargetSpan, missingSpan) {
  return {
    actorInput,
    normalizedInput,
    intentToken,
    primaryTargetSpan,
    relationToken,
    secondaryTargetSpan,
    classification: 'semantic error',
    errorEnvelope: {
      class: 'semantic error',
      code: SEMANTIC_ERROR_CODE,
      details: {
        intentToken,
        relationToken,
        missingSpan,
      },
    },
  };
}

/**
 * Parse actor command text into a structured parser artifact.
 *
 * Classifications:
 * - `success`: parse shape is valid for downstream interpretation.
 * - `unknown intent`: no usable intent token exists (for example empty input).
 * - `semantic error`: known relation-form intent has malformed slot shape.
 *
 * Stable failure codes:
 * - `PARSER_UNKNOWN_INTENT`
 * - `PARSER_SEMANTIC_RELATION_SHAPE`
 *
 * @param {string} actorInput
 * @returns {ParseArtifact}
 */
function parseInput(actorInput) {
  const raw = String(actorInput || '');
  const lexicalTokens = lexInput(raw);
  const tokens = normalizeTokens(lexicalTokens);
  const normalizedInput = tokens.join(' ');

  if (!tokens.length || !tokens[0]) {
    return makeUnknownIntent(raw, normalizedInput);
  }

  const intentToken = tokens[0];
  const afterIntent = tokens.slice(1);
  const relationIndex = afterIntent.findIndex(token => RELATION_TOKENS.has(token));

  let primaryTargetSpan = [];
  let relationToken = null;
  let secondaryTargetSpan = [];

  if (relationIndex >= 0) {
    relationToken = afterIntent[relationIndex];
    primaryTargetSpan = afterIntent.slice(0, relationIndex);
    secondaryTargetSpan = afterIntent.slice(relationIndex + 1);
  } else {
    primaryTargetSpan = afterIntent;
  }

  if (RELATION_SHAPE_INTENTS.has(intentToken) && relationToken) {
    if (primaryTargetSpan.length === 0) {
      return makeSemanticError(
        raw,
        normalizedInput,
        intentToken,
        primaryTargetSpan,
        relationToken,
        secondaryTargetSpan,
        'primaryTargetSpan'
      );
    }

    if (secondaryTargetSpan.length === 0) {
      return makeSemanticError(
        raw,
        normalizedInput,
        intentToken,
        primaryTargetSpan,
        relationToken,
        secondaryTargetSpan,
        'secondaryTargetSpan'
      );
    }
  }

  return {
    actorInput: raw,
    normalizedInput,
    intentToken,
    primaryTargetSpan,
    relationToken,
    secondaryTargetSpan,
    classification: 'success',
    errorEnvelope: null,
  };
}

module.exports = {
  lexInput,
  parseInput,
  UNKNOWN_INTENT_CODE,
  SEMANTIC_ERROR_CODE,
};
