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
 * @param {*} collection
 * @returns {Array<*>}
 */
function toArray(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === 'function') {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === 'function') {
    return Array.from(collection);
  }

  return [];
}

/**
 * @param {*} state
 * @returns {Array<*>}
 */
function allItems(state) {
  const manager = state && state.ItemManager;
  const items = manager && manager.items;
  return toArray(items);
}

/**
 * @param {*} state
 * @param {string} entityRef
 * @returns {* | null}
 */
function findItemByEntityRef(state, entityRef) {
  const needle = normalizeRef(entityRef);
  if (!needle) {
    return null;
  }

  for (const item of allItems(state)) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return item;
    }
  }

  return null;
}

/**
 * @param {*} container
 * @param {string} itemRef
 * @returns {boolean}
 */
function containerHasItemRef(container, itemRef) {
  const needle = normalizeRef(itemRef);
  if (!needle) {
    return false;
  }

  const inventory = container && container.inventory;
  for (const item of toArray(inventory)) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return true;
    }
  }

  return false;
}

/**
 * @param {*} state
 * @param {Array<*>} requirements
 * @returns {boolean}
 */
function requirementsMet(state, requirements) {
  for (const requirement of requirements) {
    const container = findItemByEntityRef(state, requirement && requirement.containerRef);
    if (!container) {
      return false;
    }

    if (!containerHasItemRef(container, requirement && requirement.itemRef)) {
      return false;
    }
  }

  return true;
}

/**
 * @param {*} state
 * @param {*} directTarget
 * @returns {{ ok: true } | { ok: false, message: string } | null}
 */
function evaluateExitGate(state, directTarget) {
  const metadata = directTarget && typeof directTarget === 'object' && directTarget.metadata && typeof directTarget.metadata === 'object'
    ? directTarget.metadata
    : null;
  const gate = metadata && gateFromMetadata(metadata);

  if (!gate) {
    return null;
  }

  const requirements = Array.isArray(gate.requiredPlacements) ? gate.requiredPlacements : [];
  const denyMessage = typeof gate.denyMessage === 'string' && gate.denyMessage.length > 0
    ? gate.denyMessage
    : 'You can\'t go that way.';

  if (!requirements.length || requirementsMet(state, requirements)) {
    return { ok: true };
  }

  return { ok: false, message: denyMessage };
}

/**
 * @param {Record<string, *>} metadata
 * @returns {Record<string, *> | null}
 */
function gateFromMetadata(metadata) {
  const gate = metadata.gate;
  return gate && typeof gate === 'object'
    ? /** @type {Record<string, *>} */ (gate)
    : null;
}

module.exports = {
  evaluateExitGate,
};
