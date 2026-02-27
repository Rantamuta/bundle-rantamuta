// @ts-check
'use strict';

const DEFAULT_MAX_ENTRIES = 10000;

/**
 * Create a small LRU cache for compiled inline-tag templates.
 *
 * @param {{ maxEntries?: number }} [options]
 * @returns {{ get: (key: string) => *, set: (key: string, value: *) => void, clear: () => void, size: () => number, maxEntries: number }}
 */
function createInlineTagCache(options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES;

  /** @type {Map<string, *>} */
  const entries = new Map();

  return {
    get: (key) => {
      if (!entries.has(key)) {
        return undefined;
      }

      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },

    set: (key, value) => {
      if (entries.has(key)) {
        entries.delete(key);
      }

      entries.set(key, value);
      if (entries.size <= maxEntries) {
        return;
      }

      const lruKey = entries.keys().next().value;
      entries.delete(lruKey);
    },

    clear: () => {
      entries.clear();
    },

    size: () => entries.size,
    maxEntries,
  };
}

module.exports = {
  createInlineTagCache,
  DEFAULT_MAX_ENTRIES,
};
