// @ts-check
'use strict';

const { Logger } = require('ranvier');

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} message
 */
function warn(message) {
  if (!Logger || typeof Logger.warn !== 'function') {
    return;
  }

  Logger.warn(message);
}

/**
 * Return world metadata values root when present.
 * Missing root is reported as null and does not mutate state.
 *
 * @param {*} state
 * @returns {Record<string, *> | null}
 */
function peekWorldMetadataValuesRoot(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const metadata = state.metadata;
  if (metadata === undefined) {
    return null;
  }

  if (!isObjectRecord(metadata)) {
    throw new TypeError('worldMetadata.metadata root must be an object when present.');
  }

  if (!Object.prototype.hasOwnProperty.call(metadata, 'values')) {
    return null;
  }

  const values = metadata.values;
  if (!isObjectRecord(values)) {
    throw new TypeError('worldMetadata.values root must be an object when present.');
  }

  return values;
}

/**
 * Delete world metadata path using caller-provided delete helper semantics.
 * Missing root/path is a no-op and does not create metadata root.
 *
 * @param {*} state
 * @param {string[]} segments
 * @param {boolean} force
 * @param {(valuesRoot: Record<string, *>, segments: string[], force: boolean, operationName: string) => { deleted: boolean, previousValue?: * }} deletePath
 * @returns {{ deleted: boolean, previousValue?: * }}
 */
function deleteWorldMetadataPath(state, segments, force, deletePath) {
  const valuesRoot = peekWorldMetadataValuesRoot(state);
  if (!valuesRoot) {
    return { deleted: false };
  }

  return deletePath(valuesRoot, segments, force, 'deleteWorldMetadata');
}

/**
 * Return world metadata values root and create missing structure.
 * Used by rollback paths to restore deleted values.
 *
 * @param {*} state
 * @returns {Record<string, *>}
 */
function getOrCreateWorldMetadataValuesRoot(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('worldMetadata.state must be an object.');
  }

  if (!isObjectRecord(state.metadata)) {
    if (state.metadata !== undefined) {
      warn('WORLDMETA_COERCE_METADATA_ROOT: state.metadata was non-object; coercing to empty object.');
    }
    state.metadata = {};
  }

  const metadata = /** @type {Record<string, *>} */ (state.metadata);
  if (!isObjectRecord(metadata.values)) {
    if (Object.prototype.hasOwnProperty.call(metadata, 'values')) {
      warn('WORLDMETA_COERCE_VALUES_ROOT: state.metadata.values was non-object; coercing to empty object.');
    }
    metadata.values = {};
  }

  return /** @type {Record<string, *>} */ (metadata.values);
}

module.exports = {
  deleteWorldMetadataPath,
  getOrCreateWorldMetadataValuesRoot,
  peekWorldMetadataValuesRoot,
};
