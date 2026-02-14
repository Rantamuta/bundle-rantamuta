// @ts-check
'use strict';

/**
 * Deterministic input rewrite rules. First match wins.
 * Each rule is [pattern, replacement] and uses String.replace semantics.
 * Future forms like "x thing" can be added directly (e.g. /^x\\s+(.+)/i -> "look at $1").
 *
 * @type {Array<[RegExp, string]>}
 */
const CANONICALIZATION_RULES = [
  [/^\s*n\s*$/i, 'go north'], // n
  [/^\s*s\s*$/i, 'go south'],// s
  [/^\s*e\s*$/i, 'go east'], // e
  [/^\s*w\s*$/i, 'go west'], // w
  [/^\s*north\s*$/i, 'go north'], // north
  [/^\s*south\s*$/i, 'go south'], // south
  [/^\s*east\s*$/i, 'go east'], // east
  [/^\s*west\s*$/i, 'go west'], // west
  [/^\s*l\s*$/i, 'look'], // l
  [/^\s*x\s+(.+?)\s*$/i, 'look at $1'], // x <target>
];

/**
 * Rewrite actor input into canonical command text when shorthand matches.
 * Returns input unchanged when no rewrite applies.
 *
 * @param {string} actorInput
 * @returns {string}
 */
function canonicalizeInput(actorInput) {
  const raw = String(actorInput || '');

  for (const [pattern, replacement] of CANONICALIZATION_RULES) {
    if (pattern.test(raw)) {
      return raw.replace(pattern, replacement);
    }
  }

  return raw;
}

module.exports = {
  CANONICALIZATION_RULES,
  canonicalizeInput,
};
