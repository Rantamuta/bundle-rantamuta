// @ts-check
'use strict';

const RITUAL_STEPS = Object.freeze([
  Object.freeze({
    key: 'wax_seal_reliquary',
    containerRef: 'codex:reliquary',
    itemRef: 'codex:waxSeal',
  }),
  Object.freeze({
    key: 'prayer_stone_basin',
    containerRef: 'codex:stoneBasin',
    itemRef: 'codex:prayerStone',
  }),
  Object.freeze({
    key: 'bronze_clapper_bell',
    containerRef: 'codex:crackedBell',
    itemRef: 'codex:bronzeClapper',
  }),
]);

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
 * @param {string} entityRef
 * @returns {* | null}
 */
function findItemByEntityRef(state, entityRef) {
  const needle = normalizeRef(entityRef);
  if (!needle) {
    return null;
  }

  const itemManager = state && state.ItemManager;
  const items = itemManager && itemManager.items;

  for (const item of toArray(items)) {
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
  if (!container || !needle) {
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
 * @returns {{
 *   completedCount: number,
 *   isComplete: boolean,
 *   completedSteps: Array<{ key: string, containerRef: string, itemRef: string }>,
 *   missingSteps: Array<{ key: string, containerRef: string, itemRef: string }>,
 * }}
 */
function getRitualState(state) {
  const completedSteps = [];
  const missingSteps = [];

  for (const step of RITUAL_STEPS) {
    const container = findItemByEntityRef(state, step.containerRef);
    const isCompleted = containerHasItemRef(container, step.itemRef);

    if (isCompleted) {
      completedSteps.push(step);
    } else {
      missingSteps.push(step);
    }
  }

  return {
    completedCount: completedSteps.length,
    isComplete: completedSteps.length === RITUAL_STEPS.length,
    completedSteps,
    missingSteps,
  };
}

module.exports = {
  RITUAL_STEPS,
  getRitualState,
  normalizeRef,
};
