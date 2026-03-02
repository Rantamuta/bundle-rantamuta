// @ts-check
'use strict';

/**
 * Phase 1 predicate runtime (service layer).
 *
 * This module implements the plan's runtime-owned predicate evaluation service:
 * - area-local registry loading from `areas/<area>/predicates.js`
 * - export/key/function validation for registry safety
 * - strict evaluation semantics (`=== true` only)
 * - read-only predicate input contract (`{ actor, q, context }`)
 * - warn-once diagnostics for missing/invalid/throwing predicates
 *
 * Boundary by design:
 * - render-facing helper only (no script-public API here)
 * - no direct wiring to room rendering or tag parsing in this phase
 *   (those are wired in later phases)
 */
const fs = require('fs');
const path = require('path');
const { Logger } = require('ranvier');
const { getVirtualDoorService } = require('../doors/virtual-door-service');
const { parsePath } = require('../session/player-metadata');

const PREDICATE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_BUNDLES_ROOT_PATH = path.resolve(__dirname, '..', '..', '..');

/**
 * Accept only object-literal style exports for predicate registries.
 * This prevents arrays/functions from being treated as valid maps.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Canonicalize refs/tokens so predicate lookups are case/whitespace stable.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Normalize arrays/sets/maps/custom inventory wrappers into a plain array.
 * Predicate queries read many collection shapes and need one traversal path.
 *
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

  if (collection && typeof collection === 'object' && Array.isArray(collection.items)) {
    return collection.items;
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
 * Read actor effects in a shape-agnostic way.
 *
 * @param {*} actor
 * @returns {*[]}
 */
function actorEffects(actor) {
  return valuesAsArray(actor && actor.effects);
}

/**
 * Read actor inventory in a shape-agnostic way.
 *
 * @param {*} actor
 * @returns {*[]}
 */
function actorInventory(actor) {
  return valuesAsArray(actor && actor.inventory);
}

/**
 * Read container inventory in a shape-agnostic way.
 *
 * @param {*} container
 * @returns {*[]}
 */
function containerInventory(container) {
  return valuesAsArray(container && container.inventory);
}

/**
 * Extract a stable effect identifier from either string or object forms.
 *
 * @param {*} entry
 * @returns {string}
 */
function effectId(entry) {
  if (typeof entry === 'string') {
    return normalizeRef(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeRef(entry.id || entry.name || entry.entityReference);
}

/**
 * Derive authored-style refs from runtime entities without exposing internals.
 *
 * @param {*} entity
 * @returns {string}
 */
function entityRef(entity) {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  if (typeof entity.entityReference === 'string') {
    return normalizeRef(entity.entityReference);
  }

  if (typeof entity.ref === 'string') {
    return normalizeRef(entity.ref);
  }

  if (entity.area && typeof entity.area === 'object' && typeof entity.area.name === 'string' && typeof entity.id === 'string') {
    return normalizeRef(`${entity.area.name}:${entity.id}`);
  }

  return '';
}

/**
 * Project raw actor objects into the restricted predicate actor contract.
 * This keeps predicates read-only and prevents accidental engine coupling.
 *
 * @param {*} actor
 * @returns {Readonly<{ ref: string | null, name: string | null, level: number | null, role: number | string | null, roomRef: string | null, effectIds: readonly string[] }> | null}
 */
function normalizeActorView(actor) {
  if (!actor || typeof actor !== 'object') {
    return null;
  }

  const name = typeof actor.name === 'string' && actor.name.trim().length > 0
    ? actor.name.trim()
    : null;

  const refFromActor = typeof actor.ref === 'string' && actor.ref.trim().length > 0
    ? actor.ref.trim()
    : typeof actor.entityReference === 'string' && actor.entityReference.trim().length > 0
      ? actor.entityReference.trim()
      : null;

  const ref = refFromActor || (name ? `player:${name.toLowerCase()}` : null);

  const level = Number.isFinite(actor.level)
    ? Number(actor.level)
    : null;

  const role = (typeof actor.role === 'number' || typeof actor.role === 'string')
    ? actor.role
    : null;

  const roomRef = actor.room && typeof actor.room === 'object' && typeof actor.room.entityReference === 'string'
    ? actor.room.entityReference
    : typeof actor.roomRef === 'string'
      ? actor.roomRef
      : null;

  const effectIds = Object.freeze(
    actorEffects(actor)
      .map(effectId)
      .filter(Boolean)
  );

  return Object.freeze({
    ref,
    name,
    level,
    role,
    roomRef,
    effectIds,
  });
}

/**
 * Normalize quest entries to a comparable id regardless of storage shape.
 *
 * @param {*} entry
 * @returns {string}
 */
function questEntryId(entry) {
  if (typeof entry === 'string') {
    return normalizeRef(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeRef(entry.id || entry.qid || entry.questId || entry.name || entry.entityReference);
}

/**
 * Resolve a room ref against current context or managers.
 * Queries use this to stay room-ref based instead of object-identity based.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {string} roomRef
 * @returns {* | null}
 */
function resolveRoom(scope, roomRef) {
  const targetRef = normalizeRef(roomRef);
  if (!targetRef) {
    return null;
  }

  if (normalizeRef(scope.room && scope.room.entityReference) === targetRef) {
    return scope.room;
  }

  const roomManager = scope.world && scope.world.RoomManager;
  if (roomManager && typeof roomManager.getRoom === 'function') {
    const direct = roomManager.getRoom(roomRef);
    if (direct) {
      return direct;
    }

    const normalized = roomManager.getRoom(targetRef);
    if (normalized) {
      return normalized;
    }
  }

  const rooms = roomManager && roomManager.rooms;
  if (rooms && typeof rooms.entries === 'function') {
    for (const [entryRef, room] of rooms.entries()) {
      if (normalizeRef(entryRef) === targetRef) {
        return room || null;
      }
    }
  }

  return null;
}

/**
 * Resolve an area ref against current context or managers.
 * Queries use this to keep authored refs as the public contract.
 *
 * @param {{ area: *, world: * }} scope
 * @param {string} areaRef
 * @returns {* | null}
 */
function resolveArea(scope, areaRef) {
  const targetRef = normalizeRef(areaRef);
  if (!targetRef) {
    return null;
  }

  if (scope.area && typeof scope.area === 'object') {
    const currentAreaName = normalizeRef(scope.area.name);
    const currentAreaRef = normalizeRef(scope.area.entityReference || scope.area.name);
    if (currentAreaName === targetRef || currentAreaRef === targetRef) {
      return scope.area;
    }
  }

  const areaManager = scope.world && scope.world.AreaManager;
  if (areaManager && typeof areaManager.getAreaByReference === 'function') {
    const foundByRef = areaManager.getAreaByReference(areaRef);
    if (foundByRef) {
      return foundByRef;
    }
  }

  if (areaManager && typeof areaManager.getArea === 'function') {
    return areaManager.getArea(areaRef) || null;
  }

  return null;
}

/**
 * Read room items in a collection-shape-agnostic way.
 *
 * @param {*} room
 * @returns {*[]}
 */
function roomItems(room) {
  return valuesAsArray(room && room.items);
}

/**
 * Resolve an exit definition from a room by direction token.
 *
 * @param {*} room
 * @param {string} direction
 * @returns {* | null}
 */
function findRoomExit(room, direction) {
  const needle = normalizeRef(direction);
  if (!needle || !room || typeof room !== 'object') {
    return null;
  }

  if (typeof room.findExit === 'function') {
    const matched = room.findExit(needle);
    if (matched && typeof matched === 'object') {
      return matched;
    }
  }

  const exits = typeof room.getExits === 'function'
    ? room.getExits()
    : Array.isArray(room.exits)
      ? room.exits
      : null;
  if (!Array.isArray(exits)) {
    return null;
  }

  for (const exit of exits) {
    if (!exit || typeof exit !== 'object') {
      continue;
    }

    if (normalizeRef(exit.direction) === needle) {
      return exit;
    }
  }

  return null;
}

/**
 * Resolve directional door state from one room to another room ref.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {*} fromRoom
 * @param {string} toRoomRef
 * @returns {* | null}
 */
function directionalDoor(scope, fromRoom, toRoomRef) {
  if (!fromRoom || typeof fromRoom !== 'object') {
    return null;
  }

  const destination = resolveRoom(scope, toRoomRef);
  if (!destination) {
    return null;
  }

  if (typeof destination.getDoor === 'function') {
    const door = destination.getDoor(fromRoom);
    return door && typeof door === 'object' ? door : null;
  }

  const fromRoomRef = normalizeRef(fromRoom.entityReference);
  if (!fromRoomRef) {
    return null;
  }

  const doors = destination.doors;
  if (!doors) {
    return null;
  }

  if (typeof doors.get === 'function') {
    const door = doors.get(fromRoom.entityReference) || doors.get(fromRoomRef);
    return door && typeof door === 'object' ? door : null;
  }

  if (typeof doors === 'object') {
    if (Object.prototype.hasOwnProperty.call(doors, fromRoom.entityReference)) {
      const byRawKey = doors[fromRoom.entityReference];
      return byRawKey && typeof byRawKey === 'object' ? byRawKey : null;
    }

    if (Object.prototype.hasOwnProperty.call(doors, fromRoomRef)) {
      const byNormalizedKey = doors[fromRoomRef];
      return byNormalizedKey && typeof byNormalizedKey === 'object' ? byNormalizedKey : null;
    }
  }

  return null;
}

/**
 * Resolve directional door state from current room to a direction.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {string} direction
 * @returns {* | null}
 */
function directionalDoorByDirection(scope, direction) {
  const fromRoom = scope.room && typeof scope.room === 'object'
    ? scope.room
    : null;
  if (!fromRoom) {
    return null;
  }

  const exit = findRoomExit(fromRoom, direction);
  if (!exit || typeof exit.roomId !== 'string' || exit.roomId.trim().length === 0) {
    return null;
  }

  return directionalDoor(scope, fromRoom, exit.roomId);
}

/**
 * Resolve a door record between two rooms using directional storage.
 * Tries A->B first, then B->A for resilience with asymmetric data.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {string} roomARef
 * @param {string} roomBRef
 * @returns {* | null}
 */
function directionalDoorBetween(scope, roomARef, roomBRef) {
  const roomA = resolveRoom(scope, roomARef);
  const roomB = resolveRoom(scope, roomBRef);
  if (!roomA || !roomB) {
    return null;
  }

  return directionalDoor(scope, roomA, roomBRef) || directionalDoor(scope, roomB, roomARef);
}

/**
 * Resolve effective virtual-door state for a room pair when virtualization is active.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {string} roomARef
 * @param {string} roomBRef
 * @returns {{ closed: boolean, locked: boolean } | null}
 */
function virtualDoorStateBetween(scope, roomARef, roomBRef) {
  const world = scope.world && typeof scope.world === 'object'
    ? scope.world
    : null;
  if (!world) {
    return null;
  }

  const normalizedA = normalizeRef(roomARef);
  const normalizedB = normalizeRef(roomBRef);
  if (!normalizedA || !normalizedB) {
    return null;
  }

  let service;
  try {
    service = getVirtualDoorService(world);
  } catch (error) {
    return null;
  }

  if (!service || !service.pairByEdgeKey || typeof service.pairByEdgeKey.get !== 'function') {
    return null;
  }

  const pair = service.pairByEdgeKey.get(`${normalizedA}->${normalizedB}`)
    || service.pairByEdgeKey.get(`${normalizedB}->${normalizedA}`)
    || null;
  if (!pair || typeof pair !== 'object') {
    return null;
  }

  const canonicalRoomARef = typeof pair.roomARef === 'string' ? pair.roomARef : roomARef;
  const canonicalRoomBRef = typeof pair.roomBRef === 'string' ? pair.roomBRef : roomBRef;
  const roomA = resolveRoom(scope, canonicalRoomARef);
  const roomB = resolveRoom(scope, canonicalRoomBRef);
  if (!roomA || !roomB) {
    return null;
  }

  const doorAtoB = directionalDoor(scope, roomA, canonicalRoomBRef);
  const doorBtoA = directionalDoor(scope, roomB, canonicalRoomARef);
  if (!doorAtoB || !doorBtoA) {
    return null;
  }

  const aClosed = doorAtoB.closed === true || doorAtoB.locked === true;
  const bClosed = doorBtoA.closed === true || doorBtoA.locked === true;
  return {
    closed: aClosed || bClosed,
    locked: doorAtoB.locked === true || doorBtoA.locked === true,
  };
}

/**
 * Resolve effective door state between two rooms.
 * Virtualized pairs use virtual-door effective state; non-virtual pairs use directional records.
 *
 * @param {{ room: *, area: *, world: * }} scope
 * @param {string} roomARef
 * @param {string} roomBRef
 * @returns {{ closed: boolean, locked: boolean } | null}
 */
function effectiveDoorStateBetween(scope, roomARef, roomBRef) {
  const virtualState = virtualDoorStateBetween(scope, roomARef, roomBRef);
  if (virtualState) {
    return virtualState;
  }

  const directionalState = directionalDoorBetween(scope, roomARef, roomBRef);
  if (!directionalState) {
    return null;
  }

  return {
    closed: directionalState.closed === true,
    locked: directionalState.locked === true,
  };
}

/**
 * Compare runtime entities using normalized authored refs.
 *
 * @param {*} entity
 * @param {string} targetRef
 * @returns {boolean}
 */
function matchesEntityRef(entity, targetRef) {
  return entityRef(entity) === targetRef;
}

/**
 * Shared containment check used by container-scoped query methods.
 *
 * @param {*} container
 * @param {string} itemRef
 * @returns {boolean}
 */
function containerHasItem(container, itemRef) {
  const targetRef = normalizeRef(itemRef);
  if (!targetRef) {
    return false;
  }

  for (const item of containerInventory(container)) {
    if (matchesEntityRef(item, targetRef)) {
      return true;
    }
  }

  return false;
}

/**
 * Actor inventory check behind `q.actorHasItem`.
 *
 * @param {*} actor
 * @param {string} itemRef
 * @returns {boolean}
 */
function actorHasItem(actor, itemRef) {
  const targetRef = normalizeRef(itemRef);
  if (!targetRef || !actor || typeof actor !== 'object') {
    return false;
  }

  for (const item of actorInventory(actor)) {
    if (matchesEntityRef(item, targetRef)) {
      return true;
    }
  }

  return false;
}

/**
 * Actor effect check behind `q.actorHasEffect`.
 *
 * @param {*} actor
 * @param {string} effectRef
 * @returns {boolean}
 */
function actorHasEffect(actor, effectRef) {
  const targetRef = normalizeRef(effectRef);
  if (!targetRef || !actor || typeof actor !== 'object') {
    return false;
  }

  return actorEffects(actor).some(effect => effectId(effect) === targetRef);
}

/**
 * Shared actor quest check for active/completed buckets.
 *
 * @param {*} actor
 * @param {'active' | 'completed'} bucket
 * @param {string} questRef
 * @returns {boolean}
 */
function actorHasQuest(actor, bucket, questRef) {
  const targetRef = normalizeRef(questRef);
  if (!targetRef || !actor || typeof actor !== 'object') {
    return false;
  }

  const quests = actor.quests && typeof actor.quests === 'object'
    ? actor.quests
    : null;
  const entries = valuesAsArray(quests && quests[bucket]);

  return entries.some(entry => questEntryId(entry) === targetRef);
}

/**
 * @param {*} key
 * @returns {string[] | null}
 */
function metadataPathSegments(key) {
  const segments = parsePath(key);
  return segments && segments.length > 0 ? segments : null;
}

/**
 * Resolve one metadata path segment case-insensitively against an object record.
 * If multiple sibling keys match case-insensitively, the last match wins.
 *
 * @param {Record<string, *>} record
 * @param {string} segment
 * @param {(details: { pathPrefix: string, segment: string, matchedKeys: string[] }) => void} [onCollision]
 * @param {string} [pathPrefix]
 * @returns {string | null}
 */
function resolveMetadataSegment(record, segment, onCollision, pathPrefix = '') {
  const normalizedSegment = String(segment || '').toLowerCase();
  if (!normalizedSegment) {
    return null;
  }

  /** @type {string[]} */
  const matches = [];
  for (const key of Object.keys(record)) {
    if (String(key).toLowerCase() === normalizedSegment) {
      matches.push(key);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1 && typeof onCollision === 'function') {
    onCollision({
      pathPrefix,
      segment,
      matchedKeys: matches.slice(),
    });
  }

  return matches[matches.length - 1];
}

/**
 * @param {*} metadata
 * @param {*} key
 * @param {(details: { pathPrefix: string, segment: string, matchedKeys: string[] }) => void} [onSegmentCollision]
 * @returns {*}
 */
function readMetadataValue(metadata, key, onSegmentCollision) {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const values = metadata.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return undefined;
  }

  const segments = metadataPathSegments(key);
  if (!segments) {
    return undefined;
  }

  /** @type {*} */
  let cursor = values;
  /** @type {string[]} */
  const resolvedPath = [];
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }

    const resolvedSegment = resolveMetadataSegment(
      /** @type {Record<string, *>} */ (cursor),
      segment,
      onSegmentCollision,
      resolvedPath.join('.')
    );
    if (!resolvedSegment) {
      return undefined;
    }

    resolvedPath.push(resolvedSegment);
    cursor = cursor[resolvedSegment];
  }

  return cursor;
}

/**
 * Compatibility reader for boolean flag helpers.
 * Uses parsePath safety rules but does not enforce segment naming shape.
 *
 * @param {*} metadata
 * @param {*} key
 * @returns {*}
 */
function readMetadataCompatibilityValue(metadata, key) {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const values = metadata.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return undefined;
  }

  const segments = parsePath(key);
  if (!segments || segments.length === 0) {
    return undefined;
  }

  /** @type {*} */
  let cursor = values;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }

    cursor = cursor[segment];
  }

  return cursor;
}

/**
 * Build the read-only query surface exposed to predicates (`q`).
 * This is the single place where allowed read access is defined.
 *
 * @param {{
 *  actor: *,
 *  room: *,
 *  area: *,
 *  world: *,
 *  entity: *,
 *  currentContainer: *,
 *  onQueryWarning?: (code: string, message: string) => void,
 * }} scope
 * @returns {{
 *  roomFlag: (roomRef: string, key: string) => boolean,
 *  areaFlag: (areaRef: string, key: string) => boolean,
 *  getRoomMetadata: (roomRef: string, key: string) => *,
 *  getAreaMetadata: (areaRef: string, key: string) => *,
 *  roomHasItem: (roomRef: string, itemRef: string) => boolean,
 *  currentContainerHasItem: (itemRef: string) => boolean,
 *  roomContainerHasItem: (roomRef: string, containerRef: string, itemRef: string) => boolean,
 *  actorHasItem: (itemRef: string) => boolean,
 *  actorHasEffect: (effectId: string) => boolean,
 *  actorQuestActive: (questRef: string) => boolean,
 *  actorQuestCompleted: (questRef: string) => boolean,
 *  isDoorClosed: (direction: string) => boolean,
 *  isDoorLocked: (direction: string) => boolean,
 *  isDoorClosedBetween: (roomARef: string, roomBRef: string) => boolean,
 *  isDoorLockedBetween: (roomARef: string, roomBRef: string) => boolean,
 * }}
 */
function createQueryFacade(scope) {
  /**
   * Emit non-fatal query diagnostics for unresolvable inputs.
   *
   * @param {string} code
   * @param {string} message
   * @returns {void}
   */
  function warnUnresolvable(code, message) {
    if (typeof scope.onQueryWarning === 'function') {
      scope.onQueryWarning(code, message);
    }
  }

  const facade = {
    roomFlag: (roomRef, key) => {
      const room = resolveRoom(scope, roomRef);
      if (!room || typeof key !== 'string' || key.trim().length === 0) {
        return false;
      }

      const metadata = room.metadata && typeof room.metadata === 'object'
        ? room.metadata
        : null;
      const compatibilityValue = readMetadataCompatibilityValue(metadata, key);
      if (compatibilityValue !== undefined) {
        return compatibilityValue === true;
      }

      const flags = metadata && metadata.flags && typeof metadata.flags === 'object'
        ? metadata.flags
        : null;

      return !!(flags && flags[key] === true);
    },

    areaFlag: (areaRef, key) => {
      const area = resolveArea(scope, areaRef);
      if (!area || typeof key !== 'string' || key.trim().length === 0) {
        return false;
      }

      const metadata = area.metadata && typeof area.metadata === 'object'
        ? area.metadata
        : null;
      const compatibilityValue = readMetadataCompatibilityValue(metadata, key);
      if (compatibilityValue !== undefined) {
        return compatibilityValue === true;
      }

      const flags = metadata && metadata.flags && typeof metadata.flags === 'object'
        ? metadata.flags
        : null;

      return !!(flags && flags[key] === true);
    },

    getRoomMetadata: (roomRef, key) => {
      const room = resolveRoom(scope, roomRef);
      if (!room) {
        return undefined;
      }

      const metadata = room.metadata && typeof room.metadata === 'object'
        ? room.metadata
        : null;

      return readMetadataValue(metadata, key, details => {
        const pathLabel = details.pathPrefix
          ? `${details.pathPrefix}.${details.segment}`
          : details.segment;
        warnUnresolvable(
          `PREDICATE_QUERY_METADATA_KEY_COLLISION:getRoomMetadata:${normalizeRef(roomRef)}:${String(pathLabel || '').toLowerCase()}`,
          `PREDICATE_QUERY_METADATA_KEY_COLLISION: Predicate query q.getRoomMetadata("${String(roomRef || '')}", "${String(key || '')}") found case-colliding metadata keys at "${pathLabel}": [${details.matchedKeys.join(', ')}]. Using last match "${details.matchedKeys[details.matchedKeys.length - 1]}".`
        );
      });
    },

    getAreaMetadata: (areaRef, key) => {
      const area = resolveArea(scope, areaRef);
      if (!area) {
        return undefined;
      }

      const metadata = area.metadata && typeof area.metadata === 'object'
        ? area.metadata
        : null;

      return readMetadataValue(metadata, key, details => {
        const pathLabel = details.pathPrefix
          ? `${details.pathPrefix}.${details.segment}`
          : details.segment;
        warnUnresolvable(
          `PREDICATE_QUERY_METADATA_KEY_COLLISION:getAreaMetadata:${normalizeRef(areaRef)}:${String(pathLabel || '').toLowerCase()}`,
          `PREDICATE_QUERY_METADATA_KEY_COLLISION: Predicate query q.getAreaMetadata("${String(areaRef || '')}", "${String(key || '')}") found case-colliding metadata keys at "${pathLabel}": [${details.matchedKeys.join(', ')}]. Using last match "${details.matchedKeys[details.matchedKeys.length - 1]}".`
        );
      });
    },

    roomHasItem: (roomRef, itemRef) => {
      const room = resolveRoom(scope, roomRef);
      const targetRef = normalizeRef(itemRef);
      if (!room || !targetRef) {
        return false;
      }

      for (const item of roomItems(room)) {
        if (matchesEntityRef(item, targetRef)) {
          return true;
        }
      }

      return false;
    },

    currentContainerHasItem: (itemRef) => {
      const currentContainer = scope.currentContainer
        || (scope.entity && typeof scope.entity === 'object' && scope.entity.inventory ? scope.entity : null);
      if (!currentContainer) {
        return false;
      }

      return containerHasItem(currentContainer, itemRef);
    },

    roomContainerHasItem: (roomRef, containerRef, itemRef) => {
      const room = resolveRoom(scope, roomRef);
      const targetContainerRef = normalizeRef(containerRef);
      if (!room || !targetContainerRef) {
        return false;
      }

      for (const item of roomItems(room)) {
        if (!matchesEntityRef(item, targetContainerRef)) {
          continue;
        }

        if (containerHasItem(item, itemRef)) {
          return true;
        }
      }

      return false;
    },

    actorHasItem: itemRef => actorHasItem(scope.actor, itemRef),

    actorHasEffect: effectRef => actorHasEffect(scope.actor, effectRef),

    actorQuestActive: questRef => actorHasQuest(scope.actor, 'active', questRef),

    actorQuestCompleted: questRef => actorHasQuest(scope.actor, 'completed', questRef),

    isDoorClosed: direction => {
      const fromRoomRef = normalizeRef(scope.room && scope.room.entityReference);
      const exit = findRoomExit(scope.room, direction);
      const toRoomRef = normalizeRef(exit && exit.roomId);
      if (!fromRoomRef || !toRoomRef) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_DIRECTION_CLOSED:${normalizeRef(direction) || '(empty)'}`,
          `Predicate query q.isDoorClosed("${String(direction || '')}") could not resolve a door direction from room "${fromRoomRef || '(unknown)'}".`
        );
        return false;
      }

      const state = effectiveDoorStateBetween(scope, fromRoomRef, toRoomRef);
      if (!state) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_CLOSED:${fromRoomRef}->${toRoomRef}`,
          `Predicate query q.isDoorClosed("${String(direction || '')}") could not resolve directional door state for "${fromRoomRef}" -> "${toRoomRef}".`
        );
      }
      return !!(state && state.closed === true);
    },

    isDoorLocked: direction => {
      const fromRoomRef = normalizeRef(scope.room && scope.room.entityReference);
      const exit = findRoomExit(scope.room, direction);
      const toRoomRef = normalizeRef(exit && exit.roomId);
      if (!fromRoomRef || !toRoomRef) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_DIRECTION_LOCKED:${normalizeRef(direction) || '(empty)'}`,
          `Predicate query q.isDoorLocked("${String(direction || '')}") could not resolve a door direction from room "${fromRoomRef || '(unknown)'}".`
        );
        return false;
      }

      const state = effectiveDoorStateBetween(scope, fromRoomRef, toRoomRef);
      if (!state) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_LOCKED:${fromRoomRef}->${toRoomRef}`,
          `Predicate query q.isDoorLocked("${String(direction || '')}") could not resolve directional door state for "${fromRoomRef}" -> "${toRoomRef}".`
        );
      }
      return !!(state && state.locked === true);
    },

    isDoorClosedBetween: (roomARef, roomBRef) => {
      const normalizedA = normalizeRef(roomARef);
      const normalizedB = normalizeRef(roomBRef);
      if (!normalizedA || !normalizedB) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_INPUT_CLOSED:${normalizedA || '(empty)'}<->${normalizedB || '(empty)'}`,
          `Predicate query q.isDoorClosedBetween("${String(roomARef || '')}", "${String(roomBRef || '')}") requires two room references.`
        );
        return false;
      }

      const state = effectiveDoorStateBetween(scope, roomARef, roomBRef);
      if (!state) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_CLOSED:${normalizedA}->${normalizedB}`,
          `Predicate query q.isDoorClosedBetween("${String(roomARef || '')}", "${String(roomBRef || '')}") could not resolve directional door state.`
        );
      }
      return !!(state && state.closed === true);
    },

    isDoorLockedBetween: (roomARef, roomBRef) => {
      const normalizedA = normalizeRef(roomARef);
      const normalizedB = normalizeRef(roomBRef);
      if (!normalizedA || !normalizedB) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_INPUT_LOCKED:${normalizedA || '(empty)'}<->${normalizedB || '(empty)'}`,
          `Predicate query q.isDoorLockedBetween("${String(roomARef || '')}", "${String(roomBRef || '')}") requires two room references.`
        );
        return false;
      }

      const state = effectiveDoorStateBetween(scope, roomARef, roomBRef);
      if (!state) {
        warnUnresolvable(
          `PREDICATE_QUERY_UNRESOLVED_DOOR_BETWEEN_LOCKED:${normalizedA}->${normalizedB}`,
          `Predicate query q.isDoorLockedBetween("${String(roomARef || '')}", "${String(roomBRef || '')}") could not resolve directional door state.`
        );
      }
      return !!(state && state.locked === true);
    },
  };

  return Object.freeze(facade);
}

/**
 * Normalize caller-provided render context into a predictable shape.
 * This keeps evaluator behavior deterministic across call sites.
 *
 * @param {{
 *  actor?: *,
 *  room?: *,
 *  area?: *,
 *  world?: *,
 *  source?: *,
 *  entity?: *,
 *  currentContainer?: *,
 * }} renderContext
 */
function normalizeRenderContext(renderContext) {
  const input = renderContext && typeof renderContext === 'object'
    ? renderContext
    : {};

  const room = input.room && typeof input.room === 'object'
    ? input.room
    : null;
  const area = input.area && typeof input.area === 'object'
    ? input.area
    : (room && room.area && typeof room.area === 'object' ? room.area : null);

  return {
    actor: Object.prototype.hasOwnProperty.call(input, 'actor') ? input.actor : null,
    room,
    area,
    world: Object.prototype.hasOwnProperty.call(input, 'world') ? input.world : null,
    source: typeof input.source === 'string' && input.source.trim().length > 0
      ? input.source.trim()
      : 'unknown',
    entity: input.entity && typeof input.entity === 'object' ? input.entity : null,
    currentContainer: input.currentContainer && typeof input.currentContainer === 'object'
      ? input.currentContainer
      : null,
  };
}

/**
 * Identify area/bundle context for area-local predicate resolution.
 *
 * @param {{ area: *, room: * }} renderContext
 * @returns {{ areaName: string, bundle: string, areaRef: string }}
 */
function areaLocator(renderContext) {
  const area = renderContext.area && typeof renderContext.area === 'object'
    ? renderContext.area
    : null;

  const areaName = typeof (area && area.name) === 'string'
    ? area.name
    : (() => {
      const roomRef = renderContext.room && typeof renderContext.room.entityReference === 'string'
        ? renderContext.room.entityReference
        : '';
      const parsedArea = String(roomRef).split(':')[0];
      return parsedArea || 'unknown';
    })();

  const bundle = typeof (area && area.bundle) === 'string'
    ? area.bundle
    : '';

  return {
    areaName,
    bundle,
    areaRef: areaName || 'unknown',
  };
}

/**
 * Route warnings to injected logger or fallback logger.
 *
 * @param {*} logger
 * @param {string} message
 */
function warn(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
    return;
  }

  Logger.warn(message);
}

/**
 * Route errors to injected logger or fallback logger.
 *
 * @param {*} logger
 * @param {string} message
 */
function error(logger, message) {
  if (logger && typeof logger.error === 'function') {
    logger.error(message);
    return;
  }

  Logger.error(message);
}

/**
 * Create a render-only predicate evaluator with area-local registry loading.
 * This runtime intentionally exposes no script-public API.
 *
 * @param {{ bundlesRootPath?: string, logger?: { warn?: Function, error?: Function } }} [options]
 */
function createPredicateRuntime(options = {}) {
  const bundlesRootPath = typeof options.bundlesRootPath === 'string' && options.bundlesRootPath.trim().length > 0
    ? options.bundlesRootPath
    : DEFAULT_BUNDLES_ROOT_PATH;
  const logger = options.logger || Logger;
  const hasInjectedWarnLogger = !!(options.logger && typeof options.logger.warn === 'function');

  /** @type {Map<string, Readonly<Record<string, Function>>>} */
  const areaRegistryCache = new Map();
  /** @type {Set<string>} */
  const warnedKeys = new Set();

  /**
   * Emit non-fatal diagnostics once per (area,predicate,source,code).
   * This preserves signal without log spam in hot render paths.
   *
   * @param {string} areaRef
   * @param {string} predicateName
   * @param {string} source
   * @param {string} code
   * @param {string} message
   */
  function warnOnce(areaRef, predicateName, source, code, message) {
    const key = `${areaRef}:${predicateName}:${source}:${code}`;
    if (warnedKeys.has(key)) {
      return;
    }

    warnedKeys.add(key);
    warn(logger, message);
  }

  /**
   * Load and validate one area's predicate registry and cache the result.
   * Missing or invalid registries degrade to an empty map.
   *
   * @param {string} bundle
   * @param {string} areaName
   * @returns {Readonly<Record<string, Function>>}
   */
  function loadAreaRegistry(bundle, areaName) {
    const areaKey = `${bundle}:${areaName}`;
    if (areaRegistryCache.has(areaKey)) {
      return areaRegistryCache.get(areaKey);
    }

    /** @type {Record<string, Function>} */
    const registry = {};

    if (!bundle || !areaName) {
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    const predicatesPath = path.join(bundlesRootPath, bundle, 'areas', areaName, 'predicates.js');
    if (!fs.existsSync(predicatesPath)) {
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    let loaded;
    try {
      loaded = require(predicatesPath);
    } catch (err) {
      error(logger, `Failed to load predicate registry from [${predicatesPath}]: ${err && err.message ? err.message : String(err)}`);
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    if (!isPlainObject(loaded)) {
      error(logger, `Predicate registry [${predicatesPath}] must export an object map. Registry ignored.`);
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    for (const [predicateName, predicate] of Object.entries(loaded)) {
      if (!PREDICATE_KEY_PATTERN.test(predicateName)) {
        error(logger, `Predicate name [${predicateName}] in [${predicatesPath}] is invalid. Key ignored.`);
        continue;
      }

      if (typeof predicate !== 'function') {
        error(logger, `Predicate [${predicateName}] in [${predicatesPath}] must be a function. Key ignored.`);
        continue;
      }

      registry[predicateName] = predicate;
    }

    const frozenRegistry = Object.freeze(registry);
    areaRegistryCache.set(areaKey, frozenRegistry);
    return frozenRegistry;
  }

  /**
   * Evaluate a named predicate against normalized render context.
   * Failures never throw to callers; non-true outcomes resolve to false.
   *
   * @param {string} predicateName
   * @param {{
   *  actor?: *,
   *  room?: *,
   *  area?: *,
   *  world?: *,
   *  source?: *,
   *  entity?: *,
   *  currentContainer?: *,
   * }} [renderContext]
   * @returns {boolean}
   */
  function evaluate(predicateName, renderContext = {}) {
    const trimmedName = typeof predicateName === 'string' ? predicateName.trim() : '';
    if (!trimmedName) {
      return false;
    }

    const normalizedContext = normalizeRenderContext(renderContext);
    const areaInfo = areaLocator(normalizedContext);

    const registry = loadAreaRegistry(areaInfo.bundle, areaInfo.areaName);
    const predicate = registry[trimmedName];

    if (typeof predicate !== 'function') {
      warnOnce(
        areaInfo.areaRef,
        trimmedName,
        normalizedContext.source,
        'PREDICATE_MISSING',
        `Predicate [${trimmedName}] not found for area [${areaInfo.areaRef}] in source [${normalizedContext.source}].`
      );
      return false;
    }

    const context = Object.freeze({
      source: normalizedContext.source,
      areaRef: areaInfo.areaRef,
      roomRef: normalizedContext.room && typeof normalizedContext.room.entityReference === 'string'
        ? normalizedContext.room.entityReference
        : null,
      entityRef: normalizedContext.entity && typeof normalizedContext.entity.entityReference === 'string'
        ? normalizedContext.entity.entityReference
        : null,
    });

    const q = createQueryFacade({
      actor: normalizedContext.actor,
      room: normalizedContext.room,
      area: normalizedContext.area,
      world: normalizedContext.world,
      entity: normalizedContext.entity,
      currentContainer: normalizedContext.currentContainer,
      onQueryWarning: hasInjectedWarnLogger
        ? (code, message) => {
          warnOnce(areaInfo.areaRef, trimmedName, normalizedContext.source, code, message);
        }
        : undefined,
    });

    const input = Object.freeze({
      actor: normalizeActorView(normalizedContext.actor),
      q,
      context,
    });

    let result;
    try {
      result = predicate(input);
    } catch (err) {
      warnOnce(
        areaInfo.areaRef,
        trimmedName,
        normalizedContext.source,
        'PREDICATE_THROW',
        `Predicate [${trimmedName}] threw in area [${areaInfo.areaRef}] source [${normalizedContext.source}]: ${err && err.message ? err.message : String(err)}`
      );
      return false;
    }

    if (result !== true) {
      if (typeof result !== 'boolean') {
        warnOnce(
          areaInfo.areaRef,
          trimmedName,
          normalizedContext.source,
          'PREDICATE_INVALID_RETURN',
          `Predicate [${trimmedName}] returned non-boolean value in area [${areaInfo.areaRef}] source [${normalizedContext.source}].`
        );
      }
      return false;
    }

    return true;
  }

  return {
    evaluate,
  };
}

module.exports = {
  createPredicateRuntime,
  DEFAULT_BUNDLES_ROOT_PATH,
};
