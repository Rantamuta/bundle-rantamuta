// @ts-check
'use strict';

const { getVirtualDoorService } = require('../runtime/doors/virtual-door-service');
const { parsePath } = require('../runtime/mutation/player-metadata');

function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

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

function actorInventory(actor) {
  return valuesAsArray(actor && actor.inventory);
}

function containerInventory(container) {
  return valuesAsArray(container && container.inventory);
}

function actorEffects(actor) {
  return valuesAsArray(actor && actor.effects);
}

function effectId(entry) {
  if (typeof entry === 'string') {
    return normalizeRef(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeRef(entry.id || entry.name || entry.entityReference);
}

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

function questEntryId(entry) {
  if (typeof entry === 'string') {
    return normalizeRef(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeRef(entry.id || entry.qid || entry.questId || entry.name || entry.entityReference);
}

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

function roomItems(room) {
  return valuesAsArray(room && room.items);
}

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

function directionalDoorBetween(scope, roomARef, roomBRef) {
  const roomA = resolveRoom(scope, roomARef);
  const roomB = resolveRoom(scope, roomBRef);
  if (!roomA || !roomB) {
    return null;
  }

  return directionalDoor(scope, roomA, roomBRef) || directionalDoor(scope, roomB, roomARef);
}

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

function matchesEntityRef(entity, targetRef) {
  return entityRef(entity) === targetRef;
}

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

function actorHasEffect(actor, effectRef) {
  const targetRef = normalizeRef(effectRef);
  if (!targetRef || !actor || typeof actor !== 'object') {
    return false;
  }

  return actorEffects(actor).some(effect => effectId(effect) === targetRef);
}

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

function metadataPathSegments(key) {
  const segments = parsePath(key);
  return segments && segments.length > 0 ? segments : null;
}

function resolveMetadataSegment(record, segment, onCollision, pathPrefix = '') {
  const normalizedSegment = String(segment || '').toLowerCase();
  if (!normalizedSegment) {
    return null;
  }

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

  let cursor = values;
  const resolvedPath = [];
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }

    const resolvedSegment = resolveMetadataSegment(
      cursor,
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

function createQueryFacade(scope) {
  function warnUnresolvable(code, message) {
    if (typeof scope.onQueryWarning === 'function') {
      scope.onQueryWarning(code, message);
    }
  }

  const facade = {
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
          `KEY_COLLISION:getRoomMetadata:${normalizeRef(roomRef)}:${String(pathLabel || '').toLowerCase()}`,
          `KEY_COLLISION: Predicate query q.getRoomMetadata("${String(roomRef || '')}", "${String(key || '')}") found case-colliding metadata keys at "${pathLabel}": [${details.matchedKeys.join(', ')}]. Using last match "${details.matchedKeys[details.matchedKeys.length - 1]}".`
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
          `KEY_COLLISION:getAreaMetadata:${normalizeRef(areaRef)}:${String(pathLabel || '').toLowerCase()}`,
          `KEY_COLLISION: Predicate query q.getAreaMetadata("${String(areaRef || '')}", "${String(key || '')}") found case-colliding metadata keys at "${pathLabel}": [${details.matchedKeys.join(', ')}]. Using last match "${details.matchedKeys[details.matchedKeys.length - 1]}".`
        );
      });
    },

    getWorldMetadata: key => {
      const world = scope.world && typeof scope.world === 'object'
        ? scope.world
        : null;
      if (!world) {
        return undefined;
      }

      const metadata = world.metadata && typeof world.metadata === 'object'
        ? world.metadata
        : null;

      return readMetadataValue(metadata, key, details => {
        const pathLabel = details.pathPrefix
          ? `${details.pathPrefix}.${details.segment}`
          : details.segment;
        warnUnresolvable(
          `KEY_COLLISION:getWorldMetadata:world:${String(pathLabel || '').toLowerCase()}`,
          `KEY_COLLISION: Predicate query q.getWorldMetadata("${String(key || '')}") found case-colliding metadata keys at "${pathLabel}": [${details.matchedKeys.join(', ')}]. Using last match "${details.matchedKeys[details.matchedKeys.length - 1]}".`
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

    currentContainerHasItem: itemRef => {
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

module.exports = {
  createQueryFacade,
};
