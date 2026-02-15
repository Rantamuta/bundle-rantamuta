// @ts-check
'use strict';

const { evaluateExitGate } = require('../helpers/exitGate');

const RUNES_DORMANT_DESCRIPTION = 'Ancient runes curl around the basin lip, each line cut with unnerving precision.';
const RUNES_GLOWING_DESCRIPTION = 'Ancient runes curl around the basin lip, now lit by an ethereal glow that wavers like breath.';

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
function valuesAsArray(collection) {
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
 * @param {*} room
 * @returns {* | null}
 */
function findDownExit(room) {
  if (!room || typeof room !== 'object') {
    return null;
  }

  const exits = typeof room.getExits === 'function'
    ? room.getExits()
    : room.exits;
  if (!Array.isArray(exits)) {
    return null;
  }

  for (const exit of exits) {
    if (exit && typeof exit === 'object' && String(exit.direction || '').trim().toLowerCase() === 'down') {
      return exit;
    }
  }

  return null;
}

/**
 * @param {*} state
 * @param {*} room
 * @returns {boolean}
 */
function isDescentOpen(state, room) {
  const downExit = findDownExit(room);
  if (!downExit) {
    return false;
  }

  const gate = evaluateExitGate(state, downExit);
  if (!gate) {
    return true;
  }

  return gate.ok !== false;
}

/**
 * @param {*} room
 * @param {string} entityRef
 * @returns {* | null}
 */
function findRoomItemByRef(room, entityRef) {
  const targetRef = normalizeRef(entityRef);
  if (!room || typeof room !== 'object' || !targetRef) {
    return null;
  }

  const items = valuesAsArray(room.items);
  for (const item of items) {
    if (normalizeRef(item && item.entityReference) === targetRef) {
      return item;
    }
  }

  return null;
}

/**
 * @param {*} container
 * @param {string} entityRef
 * @returns {boolean}
 */
function containerHasItemRef(container, entityRef) {
  const targetRef = normalizeRef(entityRef);
  if (!container || typeof container !== 'object' || !targetRef) {
    return false;
  }

  const items = valuesAsArray(container.inventory);
  return items.some(item => normalizeRef(item && item.entityReference) === targetRef);
}

/**
 * @param {*} room
 * @returns {boolean}
 */
function basinHasPrayerStone(room) {
  const basin = findRoomItemByRef(room, 'rantamuta:stoneBasin');
  if (!basin) {
    return false;
  }

  return containerHasItemRef(basin, 'rantamuta:prayerStone');
}

/**
 * @param {*} room
 * @returns {* | null}
 */
function findRunesDetail(room) {
  const metadata = room && room.metadata && typeof room.metadata === 'object'
    ? room.metadata
    : null;
  const details = metadata && Array.isArray(metadata.details)
    ? metadata.details
    : null;
  if (!details) {
    return null;
  }

  return details.find(detail => {
    if (!detail || typeof detail !== 'object') {
      return false;
    }

    const name = normalizeRef(detail.name);
    if (name === 'runes') {
      return true;
    }

    const keywords = Array.isArray(detail.keywords) ? detail.keywords : [];
    return keywords.some(keyword => normalizeRef(keyword) === 'runes');
  }) || null;
}

/**
 * Keep `x runes` in sync with prayer-stone basin state.
 *
 * @param {*} room
 */
function syncRunesDetailDescription(room) {
  const detail = findRunesDetail(room);
  if (!detail) {
    return;
  }

  detail.description = basinHasPrayerStone(room)
    ? RUNES_GLOWING_DESCRIPTION
    : RUNES_DORMANT_DESCRIPTION;
}

/**
 * @param {*} room
 */
function attachBasinRunesSync(room) {
  const basin = findRoomItemByRef(room, 'rantamuta:stoneBasin');
  if (!basin || typeof basin !== 'object') {
    return;
  }

  if (basin.__runesDetailSyncWrapped) {
    return;
  }

  const previousBasinAddItem = typeof basin.addItem === 'function'
    ? basin.addItem
    : null;
  const previousBasinRemoveItem = typeof basin.removeItem === 'function'
    ? basin.removeItem
    : null;

  if (previousBasinAddItem) {
    basin.addItem = (item) => {
      const result = previousBasinAddItem.call(basin, item);
      syncRunesDetailDescription(room);
      return result;
    };
  }

  if (previousBasinRemoveItem) {
    basin.removeItem = (item) => {
      const result = previousBasinRemoveItem.call(basin, item);
      syncRunesDetailDescription(room);
      return result;
    };
  }

  basin.__runesDetailSyncWrapped = true;
}

/**
 * @param {*} action
 * @param {*} context
 * @returns {boolean}
 */
function isGoWithDirectExit(action, context) {
  if (!action || typeof action !== 'object' || action.verbId !== 'go') {
    return false;
  }

  const entityResolution = context && context.entityResolution && typeof context.entityResolution === 'object'
    ? context.entityResolution
    : null;
  return !!(entityResolution && entityResolution.ruleKey === 'direct' && entityResolution.directTarget);
}

module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      const previousAllowAction = typeof this.allowAction === 'function'
        ? this.allowAction
        : null;
      const previousRenderPredicates = this.renderPredicates && typeof this.renderPredicates === 'object'
        ? this.renderPredicates
        : {};

      this.renderPredicates = {
        ...previousRenderPredicates,
        slab_open: typeof previousRenderPredicates.slab_open === 'function'
          ? previousRenderPredicates.slab_open
          : () => isDescentOpen(state, this),
        slab_blocking: typeof previousRenderPredicates.slab_blocking === 'function'
          ? previousRenderPredicates.slab_blocking
          : () => !isDescentOpen(state, this),
        basin_runes_glowing: typeof previousRenderPredicates.basin_runes_glowing === 'function'
          ? previousRenderPredicates.basin_runes_glowing
          : () => basinHasPrayerStone(this),
        basin_runes_dormant: typeof previousRenderPredicates.basin_runes_dormant === 'function'
          ? previousRenderPredicates.basin_runes_dormant
          : () => !basinHasPrayerStone(this),
      };

      this.allowAction = (action, context) => {
        if (previousAllowAction) {
          const previousResult = previousAllowAction.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        if (!isGoWithDirectExit(action, context)) {
          return undefined;
        }

        const directTarget = context.entityResolution.directTarget;
        const gate = evaluateExitGate(state, directTarget);
        if (gate && gate.ok === false) {
          return gate.message;
        }

        return undefined;
      };

      syncRunesDetailDescription(this);
    },
    ready: () => function onReady() {
      attachBasinRunesSync(this);
      syncRunesDetailDescription(this);
    },
  },
};
