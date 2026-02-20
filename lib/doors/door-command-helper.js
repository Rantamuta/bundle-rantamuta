// @ts-check
'use strict';

const Helper = require('../helpers/entity-resolution-helper');

const OPPOSITE_DIRECTION = Object.freeze({
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  up: 'down',
  down: 'up',
  northeast: 'southwest',
  southwest: 'northeast',
  northwest: 'southeast',
  southeast: 'northwest',
  in: 'out',
  out: 'in',
});

/**
 * Build canonical entity-resolution rules used by door commands that support:
 * - direct target (`open north door`)
 * - optional explicit key (`open north door with bronze key`)
 *
 * @returns {{
 *  direct: { scopeProfile: { direct: string[] } },
 *  directIndirect: {
 *    acceptedRelations: string[],
 *    allowUnresolvedIndirect: boolean,
 *    scopeProfile: { direct: string[], indirect: string[] },
 *  },
 * }}
 */
function createDoorCommandEntityResolutionRules() {
  return {
    direct: {
      scopeProfile: {
        direct: ['room.exits', 'room.items'],
      },
    },
    directIndirect: {
      acceptedRelations: ['with'],
      allowUnresolvedIndirect: true,
      scopeProfile: {
        direct: ['room.exits', 'room.items'],
        indirect: ['player.inventory'],
      },
    },
  };
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeDirection(value) {
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
 * @param {*} value
 * @returns {string}
 */
function keyEntityReference(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  return normalizeRef(value.entityReference || value.ref || value.id || value.name);
}

/**
 * @param {*} value
 * @returns {string}
 */
function displayName(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name) {
    return name;
  }

  return typeof value.entityReference === 'string'
    ? value.entityReference
    : '';
}

/**
 * @param {*} destination
 * @param {*} fromRoom
 * @returns {* | null}
 */
function directionalDoorRecord(destination, fromRoom) {
  if (!destination || typeof destination !== 'object' || !fromRoom || typeof fromRoom !== 'object') {
    return null;
  }

  if (typeof destination.getDoor === 'function') {
    const door = destination.getDoor(fromRoom);
    if (door && typeof door === 'object') {
      return door;
    }
  }

  const sourceRef = normalizeRef(fromRoom.entityReference);
  if (!sourceRef || !destination.doors) {
    return null;
  }

  if (typeof destination.doors.get === 'function') {
    return destination.doors.get(sourceRef) || null;
  }

  if (typeof destination.doors === 'object') {
    return destination.doors[sourceRef] || null;
  }

  return null;
}

/**
 * @param {*} direction
 * @returns {string}
 */
function doorLabel(direction) {
  const normalized = normalizeDirection(direction);
  return normalized ? `${normalized} door` : 'door';
}

/**
 * @param {*} direction
 * @returns {string}
 */
function oppositeDoorLabel(direction) {
  const normalized = normalizeDirection(direction);
  return OPPOSITE_DIRECTION[normalized]
    ? `${OPPOSITE_DIRECTION[normalized]} door`
    : 'door';
}

/**
 * @param {*} state
 * @param {*} player
 * @param {*} resolution
 * @returns {{
 *  ok: true,
 *  currentRoom: *,
 *  destination: *,
 *  door: *,
 *  direction: string,
 *  roomRef: string,
 *  doorLabel: string,
 *  oppositeDoorLabel: string,
 * } | { ok: false, code: string }}
 */
function resolveDoorActionContext(state, player, resolution) {
  const currentRoom = player && player.room && typeof player.room === 'object'
    ? player.room
    : null;
  if (!currentRoom) {
    return { ok: false, code: 'DOOR_NO_ROOM' };
  }

  const directTarget = resolution && resolution.directTarget && typeof resolution.directTarget === 'object'
    ? resolution.directTarget
    : null;
  const roomRef = directTarget && typeof directTarget.roomId === 'string'
    ? directTarget.roomId.trim()
    : '';
  if (!roomRef) {
    return { ok: false, code: 'TARGET_NOT_DOOR' };
  }

  const roomManager = state && state.RoomManager && typeof state.RoomManager === 'object'
    ? state.RoomManager
    : null;
  const destination = roomManager && typeof roomManager.getRoom === 'function'
    ? roomManager.getRoom(roomRef)
    : null;
  if (!destination || typeof destination !== 'object') {
    return { ok: false, code: 'GO_DESTINATION_MISSING' };
  }

  const door = directionalDoorRecord(destination, currentRoom);
  if (!door || typeof door !== 'object') {
    return { ok: false, code: 'TARGET_NOT_DOOR' };
  }

  const direction = normalizeDirection(directTarget.direction);

  return {
    ok: true,
    currentRoom,
    destination,
    door,
    direction,
    roomRef,
    doorLabel: doorLabel(direction),
    oppositeDoorLabel: oppositeDoorLabel(direction),
  };
}

/**
 * @param {*} player
 * @param {string[]} phraseTokens
 * @returns {Array<{ item: *, score: number, declarationOrder: number }>}
 */
function explicitKeyPhraseCandidates(player, phraseTokens) {
  const entries = valuesAsArray(player && player.inventory)
    .map((item, index) => ({
      item,
      score: Helper.computeMatchScore(item, phraseTokens),
      declarationOrder: index,
    }))
    .filter(entry => entry.score > 0);

  if (!entries.length) {
    return [];
  }

  const bestScore = Math.max(...entries.map(entry => entry.score));
  return entries
    .filter(entry => entry.score === bestScore)
    .sort((a, b) => a.declarationOrder - b.declarationOrder);
}

/**
 * @param {*} player
 * @param {string[]} phraseTokens
 * @param {string} lockedByRef
 * @returns {{ selected: * | null, phraseMatches: Array<*>, compatible: Array<*> }}
 */
function selectExplicitKeyCandidate(player, phraseTokens, lockedByRef) {
  const ranked = explicitKeyPhraseCandidates(player, phraseTokens);
  const phraseMatches = ranked.map(entry => entry.item);
  const compatible = phraseMatches.filter(item => keyEntityReference(item) === normalizeRef(lockedByRef));
  return {
    selected: compatible.length ? compatible[0] : null,
    phraseMatches,
    compatible,
  };
}

/**
 * @param {*} player
 * @param {string} lockedByRef
 * @returns {* | null}
 */
function selectAutoKeyCandidate(player, lockedByRef) {
  const needle = normalizeRef(lockedByRef);
  if (!needle) {
    return null;
  }

  for (const item of valuesAsArray(player && player.inventory)) {
    if (keyEntityReference(item) === needle) {
      return item;
    }
  }

  return null;
}

module.exports = {
  createDoorCommandEntityResolutionRules,
  normalizeRef,
  normalizeDirection,
  keyEntityReference,
  displayName,
  resolveDoorActionContext,
  selectExplicitKeyCandidate,
  selectAutoKeyCandidate,
};
