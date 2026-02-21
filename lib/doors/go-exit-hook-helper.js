// @ts-check
'use strict';

const { buildRoomViewLines } = require('../helpers/room-view-helper');

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
 * @param {*} actor
 * @param {*} door
 * @returns {boolean}
 */
function actorHasMatchingDoorKey(actor, door) {
  const lockedBy = normalizeRef(door && door.lockedBy);
  if (!lockedBy) {
    return false;
  }

  for (const item of valuesAsArray(actor && actor.inventory)) {
    const keyRef = normalizeRef(item && (item.entityReference || item.ref || item.id));
    if (keyRef === lockedBy) {
      return true;
    }
  }

  return false;
}

/**
 * @param {*} state
 * @param {string} roomId
 * @param {*} exitTarget
 * @returns {* | null}
 */
function resolveDestinationRoom(state, roomId, exitTarget) {
  const roomManager = state && state.RoomManager;
  if (roomManager && typeof roomManager.getRoom === 'function') {
    const room = roomManager.getRoom(roomId);
    if (room && typeof room === 'object') {
      return room;
    }
  }

  const cached = exitTarget && typeof exitTarget === 'object'
    ? exitTarget.__goDestination
    : null;
  if (cached && typeof cached === 'object') {
    const cachedRef = normalizeRef(cached.entityReference || cached.id);
    if (!roomId || !cachedRef || cachedRef === normalizeRef(roomId)) {
      return cached;
    }
  }

  return null;
}

/**
 * @param {'open' | 'unlockAndOpen'} mutation
 * @param {string} direction
 * @returns {Array<Record<string, *>>}
 */
function composedDoorMovementMessages(mutation, direction) {
  const directLabel = doorLabel(direction);
  const inverseLabel = oppositeDoorLabel(direction);

  if (mutation === 'unlockAndOpen') {
    return [
      {
        __goDoorFlavor: true,
        type: 'semanticEvent',
        template: '{actor.You} {verb:unlock} the {object.direct}, {verb:open} it, and {verb:leave}.',
        audiencePolicy: 'self',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: directLabel,
        },
      },
      {
        __goDoorFlavor: true,
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct} and {verb:arrive}.',
        audiencePolicy: 'others',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: inverseLabel,
        },
      },
    ];
  }

  return [
    {
      __goDoorFlavor: true,
      type: 'semanticEvent',
      template: '{actor.You} {verb:open} the {object.direct} and {verb:leave}.',
      audiencePolicy: 'self',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
      objectText: {
        direct: directLabel,
      },
    },
    {
      __goDoorFlavor: true,
      type: 'semanticEvent',
      template: '{actor.You} {verb:open} the {object.direct} and {verb:arrive}.',
      audiencePolicy: 'others',
      participants: {
        actor: { selector: 'currentPlayer' },
      },
      objectText: {
        direct: inverseLabel,
      },
    },
  ];
}

/**
 * @param {*} exitTarget
 * @returns {function(*, string, Record<string, *>): *}
 */
function createFallbackGoCanDirect(exitTarget) {
  return (actor, verbId, context) => {
    const verb = normalizeRef(verbId);
    if (verb !== 'go') {
      return null;
    }

    const currentRoom = actor && actor.room && typeof actor.room === 'object'
      ? actor.room
      : null;
    if (!currentRoom) {
      return null;
    }

    const roomId = typeof exitTarget.roomId === 'string' ? exitTarget.roomId.trim() : '';
    if (!roomId) {
      return null;
    }

    const destination = resolveDestinationRoom(context && context.state, roomId, exitTarget);
    if (!destination || typeof destination !== 'object') {
      return null;
    }

    const door = directionalDoorRecord(destination, currentRoom);
    if (!door || door.locked !== true) {
      return null;
    }

    if (!actorHasMatchingDoorKey(actor, door)) {
      return {
        ok: false,
        code: 'GO_EXIT_LOCKED',
      };
    }

    return null;
  };
}

/**
 * @param {*} exitTarget
 * @returns {function(*, string, Record<string, *>): *}
 */
function createFallbackGoPlanDirect(exitTarget) {
  return (actor, verbId, context) => {
    const verb = normalizeRef(verbId);
    if (verb !== 'go') {
      return null;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.directTarget !== exitTarget) {
      return null;
    }

    const currentRoom = actor && actor.room && typeof actor.room === 'object'
      ? actor.room
      : null;
    if (!currentRoom) {
      return {
        ok: false,
        error: { code: 'GO_NO_ROOM' },
      };
    }

    const roomId = typeof exitTarget.roomId === 'string' ? exitTarget.roomId.trim() : '';
    if (!roomId) {
      return {
        ok: false,
        error: { code: 'GO_DESTINATION_MISSING' },
      };
    }

    const destination = resolveDestinationRoom(context && context.state, roomId, exitTarget);
    if (!destination || typeof destination !== 'object') {
      return {
        ok: false,
        error: { code: 'GO_DESTINATION_MISSING' },
      };
    }

    const direction = normalizeDirection(exitTarget.direction);
    const door = directionalDoorRecord(destination, currentRoom);

    /** @type {Array<Record<string, *>>} */
    const operations = [];
    /** @type {null | 'open' | 'unlockAndOpen'} */
    let autoDoorMutation = null;

    if (door && door.locked === true) {
      if (!actorHasMatchingDoorKey(actor, door)) {
        return {
          ok: false,
          error: { code: 'GO_EXIT_LOCKED' },
        };
      }

      operations.push({
        type: 'doorMutation',
        mutation: 'unlockAndOpen',
        actor,
        direction,
      });
      autoDoorMutation = 'unlockAndOpen';
    } else if (door && door.closed === true) {
      operations.push({
        type: 'doorMutation',
        mutation: 'open',
        actor,
        direction,
      });
      autoDoorMutation = 'open';
    }

    operations.push({
      type: 'movePlayer',
      player: actor,
      toRoom: destination,
      direction,
      ...(autoDoorMutation !== null ? { suppressRoomBroadcast: true } : {}),
    });

    const roomViewLines = buildRoomViewLines(destination, {
      actor,
      room: destination,
      area: destination.area || null,
      world: context && context.state
        ? context.state
        : (exitTarget && typeof exitTarget === 'object' && exitTarget.__goWorld)
          ? exitTarget.__goWorld
          : null,
    });

    const messages = [
      ...(autoDoorMutation !== null ? composedDoorMovementMessages(autoDoorMutation, direction) : []),
      ...roomViewLines,
    ];

    return {
      plan: {
        operations,
      },
      render: {
        messages,
      },
    };
  };
}

/**
 * @param {*} contribution
 * @returns {boolean}
 */
function isContributionFailure(contribution) {
  if (!contribution || typeof contribution !== 'object') {
    return false;
  }

  return contribution.ok === false;
}

/**
 * @param {*} contribution
 * @returns {boolean}
 */
function contributionRequestsReplaceSuccess(contribution) {
  if (!contribution || typeof contribution !== 'object') {
    return false;
  }

  const renderPolicy = contribution.renderPolicy;
  return !!(renderPolicy && typeof renderPolicy === 'object' && renderPolicy.replaceSuccess === true);
}

/**
 * @param {*} contribution
 * @returns {*}
 */
function stripGoDoorFlavorRender(contribution) {
  if (!contribution) {
    return contribution;
  }

  if (Array.isArray(contribution)) {
    const kept = contribution
      .map(entry => stripGoDoorFlavorRender(entry))
      .filter(Boolean);
    return kept.length ? kept : null;
  }

  if (typeof contribution !== 'object') {
    return contribution;
  }

  if (contribution.__goDoorFlavor === true) {
    return null;
  }

  const clone = { ...contribution };
  if (clone.render && typeof clone.render === 'object' && Array.isArray(clone.render.messages)) {
    const keptMessages = clone.render.messages.filter(message => !(message && typeof message === 'object' && message.__goDoorFlavor === true));
    clone.render = {
      ...clone.render,
      messages: keptMessages,
    };
  }

  return clone;
}

module.exports = {
  createFallbackGoCanDirect,
  createFallbackGoPlanDirect,
  isContributionFailure,
  contributionRequestsReplaceSuccess,
  stripGoDoorFlavorRender,
};
