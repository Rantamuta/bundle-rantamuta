// @ts-check
'use strict';

const { deepClone } = require('./deep-clone');

/**
 * @typedef {import('./deep-clone').PlainData} PlainData
 */

/**
 * Recursive readonly type for deepFreeze return values.
 *
 * @template T
 * @typedef {T extends readonly (infer U)[]
 *   ? ReadonlyArray<DeepReadonly<U>>
 *   : T extends object
 *     ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
 *     : T} DeepReadonly
 */

/**
 * Branded deep-frozen type for evaluator-facing APIs.
 *
 * This is a static-checking marker only. It does not add a runtime field.
 *
 * @template T
 * @typedef {DeepReadonly<T> & { readonly __deepFrozenBrand__?: 'deep-frozen' }} DeepFrozen
 */

/**
 * Deeply freeze a cloned plain-data value.
 *
 * This helper does not mutate/freeze caller-owned input. It first clones via
 * `deepClone(...)`, then recursively freezes the clone only.
 *
 * @template {PlainData} T
 * @param {T} value
 * @returns {DeepFrozen<T>}
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
      for (const key of Object.keys(node)) {
        walk(node[key]);
      }

      return node;
    }

    for (const key of Object.keys(node)) {
      walk(node[key]);
    }

    return node;
  }

  return /** @type {DeepFrozen<T>} */ (walk(clone));
}

module.exports = {
  deepFreeze,
};
