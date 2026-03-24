// @ts-check
'use strict';

/**
 * Recursive readonly type for deepFreeze return values.
 *
 * @template T
 * @typedef {T extends (...args: any[]) => any
 *   ? T
 *   : T extends readonly (infer U)[]
 *     ? ReadonlyArray<DeepReadonly<U>>
 *     : T extends object
 *       ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
 *       : T} DeepReadonly
 */

/**
 * Recursively freeze objects/functions/arrays and return a deep-readonly-typed view.
 *
 * Notes:
 * - cycle-safe via WeakSet
 * - only traverses own data properties (does not invoke getters)
 * - primitives are returned unchanged
 *
 * @template T
 * @param {T} value
 * @returns {DeepReadonly<T>}
 */
function deepFreeze(value) {
  return /** @type {DeepReadonly<T>} */ (deepFreezeInternal(value, new WeakSet()));
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

  if (target instanceof Map || target instanceof Set) {
    throw new TypeError('deepFreeze does not support Map or Set values');
  }

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
