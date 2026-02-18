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
 * @param {*} state
 * @returns {function(*, *): *}
 */
function createExitCanDirect(state, exit) {
  return (actor, verbId) => {
    void actor;

    if (verbId !== 'go') {
      return undefined;
    }

    const gate = evaluateExitGate(state, exit);
    if (gate && gate.ok === false) {
      return gate.message;
    }

    return undefined;
  };
}

/**
 * @param {*} state
 * @param {*} exit
 */
function attachExitCanDirect(state, exit) {
  if (!exit || typeof exit !== 'object') {
    return;
  }

  exit.canDirect = createExitCanDirect(state, exit);
}

/**
 * @param {*} state
 * @param {*} room
 */
function attachDownExitPolicy(state, room) {
  if (!room || typeof room !== 'object') {
    return;
  }

  /**
   * @param {*} exits
   * @returns {*}
   */
  const apply = exits => {
    if (!Array.isArray(exits)) {
      return exits;
    }

    for (const exit of exits) {
      if (exit && typeof exit === 'object' && normalizeRef(exit.direction) === 'down') {
        attachExitCanDirect(state, exit);
      }
    }

    return exits;
  };

  apply(room.exits);

  if (!room.__downExitPolicyWrapped && typeof room.getExits === 'function') {
    const previousGetExits = room.getExits;
    room.getExits = function getExitsWithDownPolicy(...args) {
      const exits = previousGetExits.apply(this, args);
      return apply(exits);
    };
    room.__downExitPolicyWrapped = true;
  }

  apply(typeof room.getExits === 'function' ? room.getExits() : null);
}

/**
 * @param {*} state
 * @returns {function(): void}
 */
function createSpawnListener(state) {
  return function onSpawn() {
    attachDownExitPolicy(state, this);
    syncRunesDetailDescription(this);
  };
}

/**
 * @param {*} state
 * @returns {function(): void}
 */
function createReadyListener(state) {
  return function onReady() {
    attachDownExitPolicy(state, this);
    attachBasinRunesSync(this);
    syncRunesDetailDescription(this);
  };
}

module.exports = {
  listeners: {
    spawn: state => createSpawnListener(state),
    ready: state => createReadyListener(state),
  },
};
