'use strict';

const RELATION_TOKENS = new Set(['in', 'on', 'from', 'with']);
const RELATION_SHAPE_INTENTS = new Set(['put']);

const UNKNOWN_INTENT_CODE = 'PARSER_UNKNOWN_INTENT';
const SEMANTIC_ERROR_CODE = 'PARSER_SEMANTIC_RELATION_SHAPE';

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
