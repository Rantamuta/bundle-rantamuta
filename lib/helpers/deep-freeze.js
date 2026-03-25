// @ts-check
'use strict';

const { deepClone } = require('./deep-clone');

/**
 * @typedef {import('./deep-clone').PlainData} PlainData
 */

/**
 * Deeply freeze a cloned plain-data value.
 *
 * This helper does not mutate/freeze caller-owned input. It first clones via
 * `deepClone(...)`, then recursively freezes the clone only.
 *
 * @template {PlainData} T
 * @param {T} value
 * @returns {Readonly<T>}
 */
function deepFreeze(value) {
  const clone = deepClone(value);

  /**
   * @param {*} node
   * @returns {*}
   */
  function walk(node) {
    if (!node || typeof node !== 'object') {
      return node;
    }

    Object.freeze(node);

    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry);
      }

      return node;
    }

    for (const key of Object.keys(node)) {
      walk(node[key]);
    }

    return node;
  }

  return /** @type {Readonly<T>} */ (walk(clone));
}

module.exports = {
  deepFreeze,
};
