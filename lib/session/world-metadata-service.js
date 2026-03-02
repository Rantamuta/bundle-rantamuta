// @ts-check
'use strict';

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
    state.metadata = {};
  }

  const metadata = /** @type {Record<string, *>} */ (state.metadata);
  if (!isObjectRecord(metadata.values)) {
    metadata.values = {};
  }

  return /** @type {Record<string, *>} */ (metadata.values);
}

module.exports = {
  deleteWorldMetadataPath,
  getOrCreateWorldMetadataValuesRoot,
  peekWorldMetadataValuesRoot,
};
