// @ts-check
'use strict';

/**
 * Clone plain data values (primitives, arrays, object literals) and reject
 * unsupported runtime objects.
 */

/**
 * @typedef {null | undefined | string | number | boolean | bigint | symbol | PlainDataObject | PlainDataArray} PlainData
 * @typedef {{ [key: string]: PlainData }} PlainDataObject
 * @typedef {PlainData[]} PlainDataArray
 */

/**
 * Return true when a value is an object-literal style record.
 *
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject runtime-specific object values that are outside plain-data contract.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isUnsupportedObjectValue(value) {
  return value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) ||
    ArrayBuffer.isView(value);
}

/**
 * Clone a plain-data value.
 *
 * Supported input contract:
 * - primitives
 * - object literals (or null-prototype objects) of supported values
 * - arrays of supported values
 *
 * Explicitly rejected:
 * - functions
 * - Date/Map/Set/Buffer/typed arrays/other ArrayBuffer views
 * - circular references
 * - class instances and other non-plain objects
 * - accessors/non-enumerable/symbol-keyed properties
 *
 * @template {PlainData} T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
  /** @type {WeakSet<object>} */
  const activeStack = new WeakSet();

  /**
   * @param {*} node
   * @returns {*}
   */
  function walk(node) {
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'function') {
        throw new TypeError('deepClone only supports plain data. Received function value.');
      }

      return node;
    }

    if (isUnsupportedObjectValue(node)) {
      throw new TypeError('deepClone only supports plain data. Received unsupported runtime object value.');
    }

    if (activeStack.has(node)) {
      throw new TypeError('deepClone only supports acyclic plain data. Received circular input.');
    }

    activeStack.add(node);

    try {
      if (Array.isArray(node)) {
        const descriptors = Object.getOwnPropertyDescriptors(node);
        const symbols = Object.getOwnPropertySymbols(node);
        if (symbols.length > 0) {
          throw new TypeError('deepClone only supports string-keyed plain data arrays.');
        }

        /** @type {Array<*>} */
        const clone = new Array(node.length);
        for (const key of Object.keys(descriptors)) {
          if (key === 'length') {
            continue;
          }

          const descriptor = descriptors[key];
          if (!descriptor.enumerable || !('value' in descriptor)) {
            throw new TypeError('deepClone only supports enumerable data properties.');
          }

          Object.defineProperty(clone, key, {
            value: walk(descriptor.value),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }

        return clone;
      }

      if (!isPlainObject(node)) {
        throw new TypeError('deepClone only supports plain objects and arrays.');
      }

      const descriptors = Object.getOwnPropertyDescriptors(node);
      const symbols = Object.getOwnPropertySymbols(node);
      if (symbols.length > 0) {
        throw new TypeError('deepClone only supports string-keyed plain data objects.');
      }

      const prototype = Object.getPrototypeOf(node);
      /** @type {Record<string, *>} */
      const clone = /** @type {Record<string, *>} */ (Object.create(prototype));
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError('deepClone only supports enumerable data properties.');
        }

        Object.defineProperty(clone, key, {
          value: walk(descriptor.value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }

      return clone;
    } finally {
      activeStack.delete(node);
    }
  }

  return /** @type {T} */ (walk(value));
}

module.exports = {
  deepClone,
};
