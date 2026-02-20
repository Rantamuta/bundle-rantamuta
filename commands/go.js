// @ts-check
'use strict';

const { buildRoomViewLines } = require('../lib/helpers/room-view-helper');
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
 * @param {string} code
 * @param {Record<string, *>} [details]
 * @returns {{ ok: false, error: { code: string, details?: Record<string, *> } }}
 */
function fail(code, details) {
  return {
    ok: false,
    error: { code, details },
  };
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

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
 * @param {*} player
 * @param {*} door
 * @returns {boolean}
 */
function hasMatchingDoorKey(player, door) {
  const lockedBy = normalizeRef(door && door.lockedBy);
  if (!lockedBy) {
    return false;
  }

  for (const item of valuesAsArray(player && player.inventory)) {
    const keyRef = normalizeRef(item && (item.entityReference || item.ref || item.id));
    if (keyRef && keyRef === lockedBy) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string} direction
 * @returns {string}
 */
function oppositeDirection(direction) {
  const normalized = normalizeDirection(direction);
  return OPPOSITE_DIRECTION[normalized] || '';
}

module.exports = {
  metadata: {
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['room.exits'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Go where?',
      TARGET_NOT_FOUND: {
        direct: 'You can\'t go that way.',
      },
      GO_NO_ROOM: 'You are nowhere.',
      GO_EXIT_CLOSED: 'The way is closed.',
      GO_EXIT_LOCKED: 'The way is locked.',
      GO_DESTINATION_MISSING: 'You can\'t go that way.',
    },
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    const currentRoom = player && player.room;
    if (!currentRoom || typeof currentRoom !== 'object') {
      return fail('GO_NO_ROOM');
    }

    const exit = resolution.directTarget;
    const roomId = exit && typeof exit.roomId === 'string' ? exit.roomId : '';
    if (!roomId) {
      return fail('GO_DESTINATION_MISSING');
    }
    const direction = normalizeDirection(exit && exit.direction);

    const roomManager = state && state.RoomManager;
    const destination = roomManager && typeof roomManager.getRoom === 'function'
      ? roomManager.getRoom(roomId)
      : null;
    if (!destination) {
      return fail('GO_DESTINATION_MISSING');
    }

    const door = typeof destination.getDoor === 'function'
      ? destination.getDoor(currentRoom)
      : null;

    /** @type {Array<Record<string, *>>} */
    const operations = [];
    /** @type {null | 'open' | 'unlockAndOpen'} */
    let autoDoorMutation = null;
    if (door && door.locked) {
      if (!hasMatchingDoorKey(player, door)) {
        return fail('GO_EXIT_LOCKED');
      }

      operations.push({
        type: 'doorMutation',
        mutation: 'unlockAndOpen',
        actor: player,
        direction,
      });
      autoDoorMutation = 'unlockAndOpen';
    } else if (door && door.closed) {
      operations.push({
        type: 'doorMutation',
        mutation: 'open',
        actor: player,
        direction,
      });
      autoDoorMutation = 'open';
    }

    operations.push({
      type: 'movePlayer',
      player,
      toRoom: destination,
      direction,
      ...(autoDoorMutation !== null ? { suppressRoomBroadcast: true } : {}),
    });

    const doorLabel = direction ? `${direction} door` : 'door';
    const oppositeDoorLabel = oppositeDirection(direction)
      ? `${oppositeDirection(direction)} door`
      : 'door';

    /** @type {Array<Record<string, *>>} */
    const composedMessages = [];
    if (autoDoorMutation === 'unlockAndOpen') {
      composedMessages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:unlock} the {object.direct}, {verb:open} it, and {verb:leave}.',
        audiencePolicy: 'self',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: doorLabel,
        },
      });
      composedMessages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct} and {verb:arrive}.',
        audiencePolicy: 'others',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: oppositeDoorLabel,
        },
      });
    } else if (autoDoorMutation === 'open') {
      composedMessages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct} and {verb:leave}.',
        audiencePolicy: 'self',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: doorLabel,
        },
      });
      composedMessages.push({
        type: 'semanticEvent',
        template: '{actor.You} {verb:open} the {object.direct} and {verb:arrive}.',
        audiencePolicy: 'others',
        participants: {
          actor: { selector: 'currentPlayer' },
        },
        objectText: {
          direct: oppositeDoorLabel,
        },
      });
    }

    return {
      ok: true,
      plan: {
        operations,
      },
      render: {
        messages: [
          ...composedMessages,
          ...buildRoomViewLines(destination, {
            actor: player,
            room: destination,
            area: destination.area || null,
            world: state,
          }),
        ],
      },
    };
  },
};
