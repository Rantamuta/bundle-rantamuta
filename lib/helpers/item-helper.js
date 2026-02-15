//@ts-check
/** Various helper functions for item manipulation and interaction */
'use strict';

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function itemTokens(item) {
  const tokens = new Set();

  const name = normalizeToken(item && item.name);
  if (name) {
    tokens.add(name);
    for (const token of name.split(/\s+/u)) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  if (Array.isArray(item && item.keywords)) {
    for (const keyword of item.keywords) {
      const normalized = normalizeToken(keyword);
      if (!normalized) {
        continue;
      }

      tokens.add(normalized);
      for (const token of normalized.split(/\s+/u)) {
        if (token) {
          tokens.add(token);
        }
      }
    }
  }

  return tokens;
}

/**
 * Match items against noun/adjective input tokens.
 *
 * Contract:
 * - `names` is an ordered token list where the last token is the noun target.
 * - preceding tokens are adjective qualifiers.
 * - noun matching accepts item name tokens or keyword aliases.
 * - adjective matching requires all adjective tokens to be present in item
 *   name tokens or keywords.
 *
 * @param {Array<object>} items candidate items
 * @param {Array<string>} names ordered name tokens (for example ['stinky', 'old', 'rag'])
 * @returns {Array<object>} all matching items in original `items` order
 */
function matchItems(items, names) {
  if (!Array.isArray(items) || !Array.isArray(names)) {
    return [];
  }

  const normalizedNames = names.map(normalizeToken).filter(Boolean);
  if (!normalizedNames.length) {
    return [];
  }

  const noun = normalizedNames[normalizedNames.length - 1];
  const adjectives = normalizedNames.slice(0, -1);

  return items.filter(item => {
    const tokens = itemTokens(item);
    if (!tokens.has(noun)) {
      return false;
    }

    return adjectives.every(adjective => tokens.has(adjective));
  });
}

module.exports = {
  matchItems,
};
