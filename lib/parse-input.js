// @ts-check
'use strict';

const { canonicalizeInput } = require('./input-canonicalizer');

/**
 * @typedef {Object} ParseArtifact
 * @property {string} actorInput Raw input as provided by the actor.
 * @property {string} canonicalInput Input after canonicalization rewrite.
 * @property {string} normalizedInput Canonical input after parser normalization.
 * @property {string[]} tokens Normalized canonical tokens in order.
 * @property {string=} intentToken Normalized verb token when present.
 * @property {string[]=} bodyTokens Post-verb token stream when present.
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

/**
 * Normalize canonical input tokens while preserving actor-supplied body text.
 *
 * @param {string[]} tokens
 * @returns {string[]}
 */
function normalizeTokens(tokens) {
  const normalized = tokens.map(token => String(token || '').trim()).filter(Boolean);
  if (!normalized.length) {
    return [];
  }

  normalized[0] = normalized[0].toLowerCase();
  return normalized;
}

/**
 * Parse actor command text into the intake artifact consumed by the linked
 * interpretation step.
 *
 * `Receive Input` is intentionally limited here:
 * - canonicalize raw input
 * - tokenize the canonical input
 * - normalize tokens
 * - identify the verb token
 * - preserve the remaining post-verb token stream as-is
 *
 * It must not split direct/indirect spans or infer relation structure.
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

  if (!tokens.length || !tokens[0]) {
    return {
      actorInput: raw,
      canonicalInput,
      normalizedInput,
      tokens: [],
    };
  }

  return {
    actorInput: raw,
    canonicalInput,
    normalizedInput,
    tokens,
    intentToken: tokens[0],
    bodyTokens: tokens.slice(1),
  };
}

module.exports = {
  lexInput,
  parseInput,
};
