// @ts-check
'use strict';

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} entity
 * @returns {{ acceptedItemRef?: string, rejectMessage?: string, successRender?: string } | null}
 */
function getPutPolicy(entity) {
  const metadata = entity && entity.metadata && typeof entity.metadata === 'object'
    ? entity.metadata
    : null;
  const puzzle = metadata && metadata.puzzle && typeof metadata.puzzle === 'object'
    ? metadata.puzzle
    : null;
  const putPolicy = puzzle && puzzle.putPolicy && typeof puzzle.putPolicy === 'object'
    ? puzzle.putPolicy
    : null;

  return putPolicy || null;
}

/**
 * @param {*} action
 * @param {*} context
 * @param {*} indirectTarget
 * @returns {boolean}
 */
function isPutToIndirectTarget(action, context, indirectTarget) {
  if (!action || typeof action !== 'object' || action.verbId !== 'put' || action.role !== 'indirect') {
    return false;
  }

  const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
    ? context.entityResolution
    : null;
  if (!resolution || resolution.ruleKey !== 'directIndirect') {
    return false;
  }

  return resolution.indirectTarget === indirectTarget;
}

/**
 * @param {*} policy
 * @param {*} directTarget
 * @returns {boolean}
 */
function acceptsDirectTarget(policy, directTarget) {
  const acceptedItemRef = normalizeRef(policy && policy.acceptedItemRef);
  if (!acceptedItemRef) {
    return true;
  }

  const directRef = normalizeRef(directTarget && directTarget.entityReference);
  return directRef === acceptedItemRef;
}

module.exports = {
  acceptsDirectTarget,
  getPutPolicy,
  isPutToIndirectTarget,
};
