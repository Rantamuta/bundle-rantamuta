'use strict';

const { Logger } = require('ranvier');

const VALID_MUTATIONS = new Set(['open', 'close', 'unlock', 'unlockAndOpen', 'closeAndLock']);

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
 * Resolve room from state by authored reference.
 * Falls back to normalized key search when direct map lookup misses.
 *
 * @param {*} state
 * @param {string} candidateRef
 * @returns {*}
 */
function getRoomByRef(state, candidateRef) {
  const rawRef = String(candidateRef || '').trim();
  const normalized = normalizeRef(rawRef);
  if (!rawRef || !normalized) {
    return null;
  }

  const roomManager = state && typeof state === 'object'
    ? state.RoomManager
    : null;
  if (!roomManager || typeof roomManager !== 'object') {
    return null;
  }

  if (typeof roomManager.getRoom === 'function') {
    const direct = roomManager.getRoom(rawRef);
    if (direct) {
      return direct;
    }
  }

  const roomsMap = roomManager.rooms;
  if (roomsMap && typeof roomsMap.entries === 'function') {
    for (const [roomRefKey, room] of roomsMap.entries()) {
      if (normalizeRef(roomRefKey) === normalized) {
        return room;
      }
    }
  }

  return null;
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
 * Resolve exit by canonical direction token.
 *
 * @param {*} fromRoom
 * @param {string} direction
 * @returns {*}
 */
function findExitByDirection(fromRoom, direction) {
  const targetDirection = normalizeRef(direction);
  if (!targetDirection) {
    return null;
  }

  for (const exit of roomExits(fromRoom)) {
    if (normalizeRef(exit && exit.direction) === targetDirection) {
      return exit;
    }
  }

  return null;
}

/**
 * Resolve source room for mutation calls.
 *
 * @param {*} state
 * @param {*} actor
 * @param {string} explicitFromRoomRef
 * @returns {{ room: *, ref: string } | null}
 */
function resolveSourceRoom(state, actor, explicitFromRoomRef) {
  const explicitRef = normalizeRef(explicitFromRoomRef);
  if (explicitRef) {
    const explicitRoom = getRoomByRef(state, explicitRef);
    if (!explicitRoom) {
      return null;
    }

    return { room: explicitRoom, ref: roomRef(explicitRoom) };
  }

  if (actor && typeof actor === 'object' && actor.room && typeof actor.room === 'object') {
    const actorRoom = actor.room;
    const actorRoomRef = roomRef(actorRoom);
    if (actorRoomRef) {
      return { room: actorRoom, ref: actorRoomRef };
    }
  }

  return null;
}

/**
 * Resolve destination room for mutation calls.
 *
 * @param {*} state
 * @param {*} fromRoom
 * @param {string} explicitRoomRef
 * @param {string} direction
 * @returns {{ room: *, ref: string } | null}
 */
function resolveDestinationRoom(state, fromRoom, explicitRoomRef, direction) {
  const targetRef = normalizeRef(explicitRoomRef);
  if (targetRef) {
    const targetRoom = getRoomByRef(state, targetRef);
    if (!targetRoom) {
      return null;
    }

    return { room: targetRoom, ref: roomRef(targetRoom) };
  }

  const exit = findExitByDirection(fromRoom, direction);
  if (!exit) {
    return null;
  }

  const resolvedRef = exitRoomRef(exit);
  if (!resolvedRef) {
    return null;
  }

  const room = getRoomByRef(state, resolvedRef);
  if (!room) {
    return null;
  }

  return { room, ref: roomRef(room) };
}

/**
 * Apply one door mutation verb to normalized boolean state.
 *
 * @param {{ closed: boolean, locked: boolean }} current
 * @param {'open'|'close'|'unlock'|'unlockAndOpen'|'closeAndLock'} mutation
 * @returns {{ closed: boolean, locked: boolean }}
 */
function applyDoorMutation(current, mutation) {
  switch (mutation) {
    case 'open':
    case 'unlockAndOpen':
      return { closed: false, locked: false };

    case 'close':
      return { closed: true, locked: current.locked === true };

    case 'unlock':
      return { closed: current.closed === true, locked: false };

    case 'closeAndLock':
      return { closed: true, locked: true };

    default:
      return current;
  }
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
 * Apply door mutation using virtual pair authority when available.
 *
 * @param {{
 *  actor?: *,
 *  fromRoomRef?: string,
 *  direction?: string,
 *  roomRef?: string,
 *  mutation: 'open'|'close'|'unlock'|'unlockAndOpen'|'closeAndLock',
 * }} input
 * @returns {{ ok: boolean, changed: boolean, virtual: boolean, code?: string, fromRoomRef?: string, roomRef?: string }}
 */
function mutateDoor(service, input) {
  const mutation = input && typeof input === 'object'
    ? input.mutation
    : null;

  if (typeof mutation !== 'string' || !VALID_MUTATIONS.has(mutation)) {
    throw new TypeError(`mutateDoor: unsupported mutation "${String(mutation)}".`);
  }

  const source = resolveSourceRoom(service.state, input.actor, input.fromRoomRef);
  if (!source) {
    return { ok: false, changed: false, virtual: false, code: 'source_missing' };
  }

  const destination = resolveDestinationRoom(service.state, source.room, input.roomRef, input.direction);
  if (!destination) {
    return { ok: false, changed: false, virtual: false, code: 'destination_missing' };
  }

  const targetedPair = service.pairByEdgeKey.get(edgeKey(source.ref, destination.ref)) || null;
  if (targetedPair) {
    const roomA = getRoomByRef(service.state, targetedPair.roomARef);
    const roomB = getRoomByRef(service.state, targetedPair.roomBRef);
    if (!roomA || !roomB) {
      return { ok: false, changed: false, virtual: true, code: 'pair_room_missing' };
    }

    const current = reconcilePairState(roomA, targetedPair.roomARef, roomB, targetedPair.roomBRef);
    if (!current) {
      return { ok: false, changed: false, virtual: true, code: 'pair_door_missing' };
    }

    const next = applyDoorMutation(current, mutation);
    const changed = current.closed !== next.closed || current.locked !== next.locked;

    if (!reflectPairState(roomA, targetedPair.roomARef, roomB, targetedPair.roomBRef, next)) {
      return { ok: false, changed: false, virtual: true, code: 'reflect_failed' };
    }

    return {
      ok: true,
      changed,
      virtual: true,
      fromRoomRef: source.ref,
      roomRef: destination.ref,
    };
  }

  const door = getDirectionalDoorRecord(destination.room, source.ref);
  if (!door || typeof door !== 'object') {
    return { ok: false, changed: false, virtual: false, code: 'door_missing' };
  }

  const current = normalizedDoorFlags(door);
  const next = applyDoorMutation(current, mutation);
  const changed = current.closed !== next.closed || current.locked !== next.locked;
  door.closed = next.closed;
  door.locked = next.locked;

  return {
    ok: true,
    changed,
    virtual: false,
    fromRoomRef: source.ref,
    roomRef: destination.ref,
  };
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
 *  mutateDoor: function({
 *    actor?: *,
 *    fromRoomRef?: string,
 *    direction?: string,
 *    roomRef?: string,
 *    mutation: 'open'|'close'|'unlock'|'unlockAndOpen'|'closeAndLock',
 *  }): { ok: boolean, changed: boolean, virtual: boolean, code?: string, fromRoomRef?: string, roomRef?: string },
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
    mutateDoor(input) {
      return mutateDoor(service, input || {});
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
