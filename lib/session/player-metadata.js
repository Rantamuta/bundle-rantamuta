// @ts-check
'use strict';

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} path
 * @returns {string[] | null}
 */
function parsePath(path) {
  if (typeof path !== 'string') {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split('.');
  if (segments.length === 0) {
    return null;
  }

  for (const segment of segments) {
    if (!segment || FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      return null;
    }
  }

  return segments;
}

/**
 * Read player metadata by dot path without mutating state.
 *
 * @param {*} player
 * @param {*} key
 * @param {*} defaultValue
 * @returns {*}
 */
function getPlayerMetadata(player, key, defaultValue = undefined) {
  const segments = parsePath(key);
  if (!segments) {
    return defaultValue;
  }

  const metadata = isObjectRecord(player && player.metadata)
    ? /** @type {Record<string, *>} */ (player.metadata)
    : null;
  if (!metadata) {
    return defaultValue;
  }

  /** @type {*} */
  let cursor = metadata;
  for (const segment of segments) {
    if (!isObjectRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return defaultValue;
    }

    cursor = cursor[segment];
  }

  return cursor === undefined ? defaultValue : cursor;
}

module.exports = {
  FORBIDDEN_PATH_SEGMENTS,
  getPlayerMetadata,
  parsePath,
};
