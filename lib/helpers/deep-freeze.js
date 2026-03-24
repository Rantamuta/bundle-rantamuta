// @ts-check
'use strict';

/**
 * Recursively freeze objects/functions/arrays and return a readonly-typed view.
 *
 * Notes:
 * - cycle-safe via WeakSet
 * - only traverses own data properties (does not invoke getters)
 * - primitives are returned unchanged
 *
 * @template T
 * @param {T} value
 * @returns {Readonly<T>}
 */
function deepFreeze(value) {
  return /** @type {Readonly<T>} */ (deepFreezeInternal(value, new WeakSet()));
}

/**
 * @param {*} value
 * @param {WeakSet<object>} seen
 * @returns {*}
 */
function deepFreezeInternal(value, seen) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }

  const target = /** @type {object} */ (value);

  if (seen.has(target)) {
    return target;
  }

  seen.add(target);

  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      continue;
    }

    deepFreezeInternal(descriptor.value, seen);
  }

  if (ArrayBuffer.isView(target)) {
    return target;
  }

  return Object.freeze(target);
}

module.exports = {
  deepFreeze,
};
