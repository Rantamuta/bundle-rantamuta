'use strict';

const { Logger } = require('ranvier');

/**
 * VirtualDoor service lifecycle accessors.
 *
 * This module owns creation, retrieval, and disposal of a per-GameState
 * VirtualDoor service instance. Behavior APIs are added in later checklist
 * items; this phase only establishes lifecycle and storage boundaries.
 */
const serviceRegistry = new WeakMap();

/**
 * Normalize refs for stable map keys and comparisons.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Read room entity reference in a shape-safe way.
 *
 * @param {*} room
 * @returns {string}
 */
function roomRef(room) {
  return normalizeRef(room && room.entityReference);
}

/**
 * Read exits in a shape-safe way.
 *
 * @param {*} room
 * @returns {Array<*>}
 */
function roomExits(room) {
  if (!room || typeof room !== 'object') {
    return [];
  }

  if (typeof room.getExits === 'function') {
    const exits = room.getExits();
    return Array.isArray(exits) ? exits : [];
  }

  return Array.isArray(room.exits) ? room.exits : [];
}

/**
 * Resolve destination room reference from an exit object.
 *
 * @param {*} exit
 * @returns {string}
 */
function exitRoomRef(exit) {
  return normalizeRef(exit && (exit.roomId || exit.roomRef || exit.room));
}

/**
 * Read side-local virtualDoor config from an exit.
 *
 * Supported forms:
 * - exit.virtualDoor
 * - exit.metadata.virtualDoor
 *
 * @param {*} exit
 * @returns {*}
 */
function exitVirtualDoorConfig(exit) {
  if (!exit || typeof exit !== 'object') {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(exit, 'virtualDoor')) {
    return exit.virtualDoor;
  }

  if (exit.metadata && typeof exit.metadata === 'object' && Object.prototype.hasOwnProperty.call(exit.metadata, 'virtualDoor')) {
    return exit.metadata.virtualDoor;
  }

  return undefined;
}

/**
 * Determine whether an exit explicitly opts out of virtualization.
 *
 * @param {*} exit
 * @returns {boolean}
 */
function isVirtualDoorOptOut(exit) {
  return exitVirtualDoorConfig(exit) === false;
}

/**
 * Count exits from a room to a target room reference.
 *
 * @param {*} room
 * @param {string} targetRoomRef
 * @returns {number}
 */
function countExitsTo(room, targetRoomRef) {
  const targetRef = normalizeRef(targetRoomRef);
  if (!targetRef) {
    return 0;
  }

  let count = 0;
  for (const exit of roomExits(room)) {
    if (exitRoomRef(exit) === targetRef) {
      count += 1;
    }
  }
  return count;
}

/**
 * Check whether a destination room has a directional door record keyed by
 * source room reference.
 *
 * @param {*} destinationRoom
 * @param {string} sourceRoomRef
 * @returns {boolean}
 */
function hasDirectionalDoorRecord(destinationRoom, sourceRoomRef) {
  return !!getDirectionalDoorRecord(destinationRoom, sourceRoomRef);
}

/**
 * Resolve directional door record from destination room keyed by source room.
 *
 * @param {*} destinationRoom
 * @param {string} sourceRoomRef
 * @returns {*}
 */
function getDirectionalDoorRecord(destinationRoom, sourceRoomRef) {
  const sourceRef = normalizeRef(sourceRoomRef);
  if (!destinationRoom || typeof destinationRoom !== 'object' || !sourceRef) {
    return null;
  }

  const doors = destinationRoom.doors;
  if (!doors) {
    return null;
  }

  if (typeof doors.has === 'function') {
    if (doors.has(sourceRef)) {
      return doors.get(sourceRef);
    }

    // Fallback for key casing drift.
    for (const [key, value] of doors.entries()) {
      if (normalizeRef(key) === sourceRef) {
        return value;
      }
    }
    return null;
  }

  if (typeof doors === 'object') {
    if (Object.prototype.hasOwnProperty.call(doors, sourceRef)) {
      return doors[sourceRef];
    }

    // Fallback for key casing drift.
    for (const [key, value] of Object.entries(doors)) {
      if (normalizeRef(key) === sourceRef) {
        return value;
      }
    }
    return null;
  }

  return null;
}

/**
 * Collect all loaded rooms from state.
 *
 * @param {*} state
 * @returns {Array<*>}
 */
function allRooms(state) {
  const roomManager = state && typeof state === 'object'
    ? state.RoomManager
    : null;

  const roomsMap = roomManager && typeof roomManager === 'object'
    ? roomManager.rooms
    : null;

  if (roomsMap && typeof roomsMap.values === 'function') {
    return Array.from(roomsMap.values());
  }

  return [];
}

/**
 * Build a stable key for one directed room edge.
 *
 * @param {string} fromRoomRef
 * @param {string} toRoomRef
 * @returns {string}
 */
function edgeKey(fromRoomRef, toRoomRef) {
  return `${normalizeRef(fromRoomRef)}->${normalizeRef(toRoomRef)}`;
}

/**
 * Build a stable key for an unordered room pair.
 *
 * @param {string} roomARef
 * @param {string} roomBRef
 * @returns {string}
 */
function pairKey(roomARef, roomBRef) {
  const a = normalizeRef(roomARef);
  const b = normalizeRef(roomBRef);
  return a <= b ? `${a}<->${b}` : `${b}<->${a}`;
}

/**
 * Resolve virtual pair lockedBy policy from reciprocal directional records.
 *
 * @param {*} roomA
 * @param {string} roomARef
 * @param {*} roomB
 * @param {string} roomBRef
 * @returns {{ conflict: boolean, lockedBy: string | null, rawA: string | null, rawB: string | null }}
 */
function resolvePairLockedBy(roomA, roomARef, roomB, roomBRef) {
  const doorAtoB = getDirectionalDoorRecord(roomB, roomARef);
  const doorBtoA = getDirectionalDoorRecord(roomA, roomBRef);

  const rawA = doorAtoB && typeof doorAtoB === 'object' && typeof doorAtoB.lockedBy === 'string'
    ? doorAtoB.lockedBy
    : null;
  const rawB = doorBtoA && typeof doorBtoA === 'object' && typeof doorBtoA.lockedBy === 'string'
    ? doorBtoA.lockedBy
    : null;

  const lockedByA = normalizeRef(rawA);
  const lockedByB = normalizeRef(rawB);

  if (lockedByA && lockedByB && lockedByA !== lockedByB) {
    return {
      conflict: true,
      lockedBy: null,
      rawA,
      rawB,
    };
  }

  return {
    conflict: false,
    lockedBy: lockedByA || lockedByB || null,
    rawA,
    rawB,
  };
}

/**
 * Convert mixed truthy data into canonical boolean flags.
 *
 * @param {*} door
 * @returns {{ closed: boolean, locked: boolean }}
 */
function normalizedDoorFlags(door) {
  if (!door || typeof door !== 'object') {
    return { closed: false, locked: false };
  }

  return {
    closed: door.closed === true,
    locked: door.locked === true,
  };
}

/**
 * Reconcile directional records into one effective virtual-door state.
 *
 * Formula (spec):
 * - aClosed = A.closed || A.locked
 * - bClosed = B.closed || B.locked
 * - vDoor.closed = aClosed || bClosed
 * - vDoor.locked = A.locked || B.locked
 *
 * @param {*} roomA
 * @param {string} roomARef
 * @param {*} roomB
 * @param {string} roomBRef
 * @returns {{ closed: boolean, locked: boolean } | null}
 */
function reconcilePairState(roomA, roomARef, roomB, roomBRef) {
  const doorAtoB = getDirectionalDoorRecord(roomB, roomARef);
  const doorBtoA = getDirectionalDoorRecord(roomA, roomBRef);
  if (!doorAtoB || !doorBtoA || typeof doorAtoB !== 'object' || typeof doorBtoA !== 'object') {
    return null;
  }

  const aFlags = normalizedDoorFlags(doorAtoB);
  const bFlags = normalizedDoorFlags(doorBtoA);
  const aClosed = aFlags.closed || aFlags.locked;
  const bClosed = bFlags.closed || bFlags.locked;

  return {
    closed: aClosed || bClosed,
    locked: aFlags.locked || bFlags.locked,
  };
}

/**
 * Reflect effective virtual state to both directional records.
 *
 * @param {*} roomA
 * @param {string} roomARef
 * @param {*} roomB
 * @param {string} roomBRef
 * @param {{ closed: boolean, locked: boolean }} state
 * @returns {boolean}
 */
function reflectPairState(roomA, roomARef, roomB, roomBRef, state) {
  const doorAtoB = getDirectionalDoorRecord(roomB, roomARef);
  const doorBtoA = getDirectionalDoorRecord(roomA, roomBRef);
  if (!doorAtoB || !doorBtoA || typeof doorAtoB !== 'object' || typeof doorBtoA !== 'object') {
    return false;
  }

  // Immediate reflection on load/reload reconciliation.
  doorAtoB.closed = state.closed === true;
  doorAtoB.locked = state.locked === true;
  doorBtoA.closed = state.closed === true;
  doorBtoA.locked = state.locked === true;
  return true;
}

/**
 * Scan loaded rooms and build virtual-door-eligible pair indices.
 * Item 3 + item 4 scope:
 * - reciprocal exits
 * - reciprocal directional door records
 * - exactly one exit each direction
 * - opt-out via `virtualDoor: false` on either side
 * - `lockedBy` resolution + conflict fallback to non-virtual with warning
 * - load/reload reconciliation and immediate reflection to both directional records
 *
 * @param {*} state
 * @returns {{ pairByEdgeKey: Map<string, object>, pairByRoomRefs: Map<string, object> }}
 */
function scanVirtualDoorPairs(state) {
  const rooms = allRooms(state);
  const roomsByRef = new Map();
  for (const room of rooms) {
    const ref = roomRef(room);
    if (ref) {
      roomsByRef.set(ref, room);
    }
  }

  const pairByEdgeKey = new Map();
  const pairByRoomRefs = new Map();
  const seenPairs = new Set();

  for (const roomA of rooms) {
    const roomARef = roomRef(roomA);
    if (!roomARef) {
      continue;
    }

    for (const exitA of roomExits(roomA)) {
      const roomBRef = exitRoomRef(exitA);
      if (!roomBRef) {
        continue;
      }

      const roomB = roomsByRef.get(roomBRef);
      if (!roomB) {
        continue;
      }

      const exitB = roomExits(roomB).find(candidateExit => exitRoomRef(candidateExit) === roomARef);
      if (!exitB) {
        continue;
      }

      if (countExitsTo(roomA, roomBRef) !== 1 || countExitsTo(roomB, roomARef) !== 1) {
        continue;
      }

      if (isVirtualDoorOptOut(exitA) || isVirtualDoorOptOut(exitB)) {
        continue;
      }

      if (!hasDirectionalDoorRecord(roomB, roomARef) || !hasDirectionalDoorRecord(roomA, roomBRef)) {
        continue;
      }

      const lockedByResolution = resolvePairLockedBy(roomA, roomARef, roomB, roomBRef);
      if (lockedByResolution.conflict) {
        Logger.warn(
          `VirtualDoor: disabled virtualization for "${roomARef}" <-> "${roomBRef}" due to conflicting lockedBy values `
          + `("${lockedByResolution.rawA || '(none)'}" vs "${lockedByResolution.rawB || '(none)'}").`
        );
        continue;
      }

      const effectiveState = reconcilePairState(roomA, roomARef, roomB, roomBRef);
      if (!effectiveState || !reflectPairState(roomA, roomARef, roomB, roomBRef, effectiveState)) {
        continue;
      }

      const stablePairKey = pairKey(roomARef, roomBRef);
      if (seenPairs.has(stablePairKey)) {
        continue;
      }
      seenPairs.add(stablePairKey);

      const edgeAtoB = edgeKey(roomARef, roomBRef);
      const edgeBtoA = edgeKey(roomBRef, roomARef);
      const pair = Object.freeze({
        key: stablePairKey,
        roomARef,
        roomBRef,
        edgeAtoB,
        edgeBtoA,
        lockedBy: lockedByResolution.lockedBy,
        state: Object.freeze({ ...effectiveState }),
        sideConfig: Object.freeze({
          [roomARef]: exitVirtualDoorConfig(exitA),
          [roomBRef]: exitVirtualDoorConfig(exitB),
        }),
      });

      pairByRoomRefs.set(stablePairKey, pair);
      pairByEdgeKey.set(edgeAtoB, pair);
      pairByEdgeKey.set(edgeBtoA, pair);
    }
  }

  return { pairByEdgeKey, pairByRoomRefs };
}

/**
 * Minimal service shell for this phase.
 *
 * @param {*} state
 * @returns {{
 *  state: *,
 *  pairByEdgeKey: Map<string, object>,
 *  pairByRoomRefs: Map<string, object>,
 *  refreshPairings: function(): void,
 * }}
 */
function createVirtualDoorService(state) {
  const service = {
    state,
    pairByEdgeKey: new Map(),
    pairByRoomRefs: new Map(),
    refreshPairings() {
      const scanned = scanVirtualDoorPairs(state);
      service.pairByEdgeKey = scanned.pairByEdgeKey;
      service.pairByRoomRefs = scanned.pairByRoomRefs;
    },
  };

  service.refreshPairings();
  return service;
}

/**
 * Ensure a VirtualDoor service exists for the given state.
 * Idempotent: repeated calls return the same service instance.
 *
 * @param {*} state
 * @returns {{ state: * }}
 */
function ensureVirtualDoorService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    throw new TypeError('ensureVirtualDoorService(state): state must be an object.');
  }

  const existing = serviceRegistry.get(state);
  if (existing) {
    return existing;
  }

  const service = createVirtualDoorService(state);
  serviceRegistry.set(state, service);
  return service;
}

/**
 * Return initialized VirtualDoor service for state.
 * Auto-calls idempotent ensure when uninitialized.
 *
 * @param {*} state
 * @returns {{ state: * }}
 */
function getVirtualDoorService(state) {
  return ensureVirtualDoorService(state);
}

/**
 * Dispose VirtualDoor service instance for state.
 *
 * @param {*} state
 * @returns {void}
 */
function disposeVirtualDoorService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    return;
  }

  serviceRegistry.delete(state);
}

module.exports = {
  ensureVirtualDoorService,
  getVirtualDoorService,
  disposeVirtualDoorService,
  // exposed for targeted unit tests
  _scanVirtualDoorPairs: scanVirtualDoorPairs,
};
