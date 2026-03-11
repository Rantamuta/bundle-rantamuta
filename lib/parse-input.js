// @ts-check
'use strict';

/**
 * @module parse-input
 * @description
 * Tokenizes and parses raw actor command text into a structured command artifact.
 *
 * This module:
 * - normalizes whitespace (trim + collapse repeated spaces)
 * - preserves token order
 * - lowercases the intent token (first token)
 * - lowercases recognized relation tokens (in, on, from, with, to, etc.)
 * - splits input into intent/direct-object/relation/indirect-object spans
 *
 * Parse behavior:
 * - Empty input => { actorInput, normalizedInput }
 * - Intransitive input (verb only) => { actorInput, normalizedInput, intentToken }
 *   where intentToken is the full normalized command text
 * - Verb + direct object => { actorInput, normalizedInput, intentToken, primaryTargetSpan }
 * - Verb + direct object + relation + indirect object => adds relationToken and secondaryTargetSpan
 *
 * @exports lexInput
 * @exports parseInput
 */
const RELATION_TOKENS = new Set(['in', 'on', 'from', 'with', 'to', 'into', 'onto', 'off', 'over', 'under']);
const { canonicalizeInput } = require('./input-canonicalizer');

/**
 * @typedef {Object} ParseArtifactBase
 * @property {string} actorInput Raw input as provided by the actor.
 * @property {string} canonicalInput Input after canonicalization rewrite.
 * @property {string} normalizedInput Input after parser normalization.
 * @property {string=} intentToken Normalized intent token when present.
 * @property {string[]=} primaryTargetSpan Direct-object token span when present.
 * @property {string=} relationToken Relation token when present.
 * @property {string[]=} secondaryTargetSpan Indirect-object token span when present.
 */

/**
 * @typedef {ParseArtifactBase} ParseArtifactEmpty
 */

/**
 * @typedef {ParseArtifactBase & {
 *   intentToken: string,
 * }} ParseArtifactIntransitive
 */

/**
 * @typedef {ParseArtifactBase & {
 *   intentToken: string,
 *   primaryTargetSpan: string[],
 * }} ParseArtifactDirect
 */

/**
 * @typedef {ParseArtifactBase & {
 *   intentToken: string,
 *   primaryTargetSpan: string[],
 *   relationToken: string,
 *   secondaryTargetSpan: string[],
 * }} ParseArtifactRelation
 */

/**
 * @typedef {(
 *   ParseArtifactEmpty |
 *   ParseArtifactIntransitive |
 *   ParseArtifactDirect |
 *   ParseArtifactRelation
 * )} ParseArtifact
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
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  /** @type {string[]} */
  const tokens = [];
  let current = '';
  let quote = null;

  for (const ch of trimmed) {
    if (quote) {
      if (ch === quote) {
        current += ch;
        quote = null;
        continue;
      }

      if (/\s/u.test(ch)) {
        if (!current.endsWith(' ')) {
          current += ' ';
        }
        continue;
      }

      current += ch;
      continue;
    }

    if (/\s/u.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if ((ch === '"' || ch === '\'') && !current) {
      quote = ch;
      current += ch;
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function stripMatchingQuotes(token) {
  if (typeof token !== 'string' || token.length < 2) {
    return token;
  }

  const first = token[0];
  const last = token[token.length - 1];
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    return token.slice(1, -1);
  }

  return token;
}

function normalizePrimarySpanTokens(tokens) {
  return tokens.map(stripMatchingQuotes);
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

/**
 * Parse actor command text into a structured parser artifact.
 *
 * @param {string} actorInput
 * @returns {ParseArtifact}
 */
function parseInput(actorInput) {
  const raw = String(actorInput || '');
  const canonicalInput = canonicalizeInput(raw);
  const lexicalTokens = lexInput(canonicalInput);
  const tokens = normalizeTokens(lexicalTokens);
  const normalizedInput = tokens.join(' ');

  // No input, so return { actorInput: "", normalizedInput: "" }
  if (!tokens.length || !tokens[0]) {
    return { actorInput: raw, canonicalInput, normalizedInput };
  }

  const intentToken = tokens[0];
  const afterIntent = tokens.slice(1);
  const relationIndex = intentToken === 'say'
    ? afterIntent.findIndex(token => token === 'to')
    : afterIntent.findIndex(token => RELATION_TOKENS.has(token));

  let primaryTargetSpan = [];
  let relationToken = null;
  let secondaryTargetSpan = [];

  if (relationIndex >= 0) {
    relationToken = afterIntent[relationIndex];
    primaryTargetSpan = normalizePrimarySpanTokens(afterIntent.slice(0, relationIndex));
    secondaryTargetSpan = afterIntent.slice(relationIndex + 1);
  } else {
    primaryTargetSpan = normalizePrimarySpanTokens(afterIntent);
  }

  const inTransitive = !relationToken && !primaryTargetSpan.length;
  if (inTransitive) {
    // If the command is intransitive, then the intent is the entire input.
    return { actorInput: raw, canonicalInput, normalizedInput, intentToken: normalizedInput };
  }

  // If there is no relation token, then the intent is the first token and the primary target is everything after it.
  if (!relationToken) return { actorInput: raw, canonicalInput, normalizedInput, intentToken, primaryTargetSpan };

  // The command is of the form "<verb> <directObject>  <in|on|near...> <indirectObject>", so return all the parsed components.
  else return {
    actorInput: raw,
    canonicalInput,
    normalizedInput,
    intentToken,
    primaryTargetSpan,
    relationToken,
    secondaryTargetSpan,
  };
}

module.exports = {
  lexInput,
  parseInput,
};
