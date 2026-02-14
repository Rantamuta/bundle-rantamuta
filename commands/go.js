// @ts-check
'use strict';

const { buildRoomViewLines } = require('../lib/helpers/room-view-helper');

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
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} state
 * @returns {Array<*>}
 */
function allItems(state) {
  const manager = state && state.ItemManager;
  if (!manager || !manager.items || typeof manager.items.values !== 'function') {
    return [];
  }

  return Array.from(manager.items.values());
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

  for (const item of allItems(state)) {
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
  if (!needle) {
    return false;
  }

  const inventory = container && container.inventory;
  if (!inventory || typeof inventory.values !== 'function') {
    return false;
  }

  for (const item of inventory.values()) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return true;
    }
  }

  return false;
}

/**
 * @param {*} state
 * @param {*} directTarget
 * @returns {{ ok: true } | { ok: false, message: string } | null}
 */
function evaluateExitGate(state, directTarget) {
  const metadata = directTarget && directTarget.metadata && typeof directTarget.metadata === 'object'
    ? directTarget.metadata
    : null;
  const gate = metadata && metadata.gate && typeof metadata.gate === 'object'
    ? metadata.gate
    : null;

  if (!gate) {
    return null;
  }

  const requirements = Array.isArray(gate.requiredPlacements) ? gate.requiredPlacements : [];
  const denyMessage = typeof gate.denyMessage === 'string' && gate.denyMessage.length > 0
    ? gate.denyMessage
    : 'You can\'t go that way.';

  if (!requirements.length) {
    return { ok: true };
  }

  for (const requirement of requirements) {
    const containerRef = requirement && requirement.containerRef;
    const itemRef = requirement && requirement.itemRef;
    const container = findItemByEntityRef(state, containerRef);
    if (!container) {
      return { ok: false, message: denyMessage };
    }

    if (!containerHasItemRef(container, itemRef)) {
      return { ok: false, message: denyMessage };
    }
  }

  return { ok: true };
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
    captureChecks: [
      (context) => {
        const resolution = context && context.entityResolution;
        if (!resolution || resolution.ruleKey !== 'direct') {
          return { ok: true };
        }

        const directTarget = resolution.directTarget;
        const gateResult = evaluateExitGate(context && context.state, directTarget);
        if (gateResult && gateResult.ok === false) {
          return {
            ok: false,
            vetoInfo: {
              code: 'FORBIDDEN_BLOCKED',
              message: gateResult.message,
            },
          };
        }

        return { ok: true };
      },
    ],
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
    if (door && door.locked) {
      return fail('GO_EXIT_LOCKED');
    }
    if (door && door.closed) {
      return fail('GO_EXIT_CLOSED');
    }

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'movePlayer',
            player,
            toRoom: destination,
          },
        ],
      },
      render: {
        lines: buildRoomViewLines(destination),
      },
    };
  },
};
