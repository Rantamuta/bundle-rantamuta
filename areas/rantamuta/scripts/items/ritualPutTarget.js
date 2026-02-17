// @ts-check
'use strict';

/**
 * Ritual Put Target
 * -----------------
 *
 * This script is attached to puzzle containers like:
 * - cracked bell
 * - reliquary
 * - stone basin
 *
 * Designer goal:
 * - Accept one specific offering item (for example: bronze clapper in cracked bell).
 * - Reject wrong offerings with a clear, authored message.
 * - Emit a flavor line on successful correct placement.
 * - Optionally update the object's long description and room description line
 *   based on whether the correct offering is currently inside the container.
 *
 * Pipeline goal:
 * - Do not mutate world state in capture/target hooks.
 * - Only contribute policy decisions (allowAction) and reaction output
 *   (bubbleEvent). Actual item movement is still handled by the mutator/commit.
 */
const {
  acceptsDirectTarget,
  getPutPolicy,
  isPutToIndirectTarget,
} = require('../helpers/putPolicy');
const { evaluateExitGate } = require('../helpers/exitGate');

const CRYPT_ROOM_REFERENCE = 'rantamuta:bell_crypt';
const RITUAL_HUM_MESSAGE = 'A low, resonant hum fills the tower, wavering at its edges before steadying.';
const RITUAL_AREA_GRIND_MESSAGE = 'There is a low grinding sound from the base of the bell tower.';
const RITUAL_CRYPT_GRIND_MESSAGE = 'A stone slab on the floor moves aside with a low grinding sound, revealing a staircase descending into darkness.';

/**
 * Normalize entity refs and metadata values so comparisons are predictable.
 *
 * Why this exists:
 * Designers write refs in YAML, and case/spacing differences are easy to make.
 * Normalizing here makes matching robust and deterministic.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Return inventory contents as a plain array for easy iteration.
 *
 * Why this exists:
 * In this codebase an inventory may be map-like or iterable. This helper hides
 * that shape difference so puzzle checks can stay simple.
 *
 * @param {*} entity
 * @returns {Array<*>}
 */
function inventoryValues(entity) {
  const inventory = entity && entity.inventory;
  if (!inventory) {
    return [];
  }

  if (typeof inventory.values === 'function') {
    return Array.from(inventory.values());
  }

  if (typeof inventory[Symbol.iterator] === 'function') {
    return Array.from(inventory);
  }

  return [];
}

/**
 * Read all items from the global manager in deterministic iteration order.
 *
 * @param {*} state
 * @returns {Array<*>}
 */
function allItems(state) {
  const manager = state && state.ItemManager;
  const items = manager && manager.items;
  return inventoryValues({ inventory: items });
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
 * @param {*} state
 * @returns {* | null}
 */
function findCryptRoom(state) {
  const roomManager = state && state.RoomManager;
  if (!roomManager || typeof roomManager.getRoom !== 'function') {
    return null;
  }

  return roomManager.getRoom(CRYPT_ROOM_REFERENCE);
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
    if (exit && typeof exit === 'object' && normalizeRef(exit.direction) === 'down') {
      return exit;
    }
  }

  return null;
}

/**
 * @param {*} state
 * @returns {Array<{ containerRef: string, itemRef: string }>}
 */
function ritualRequirements(state) {
  const cryptRoom = findCryptRoom(state);
  const downExit = findDownExit(cryptRoom);
  const metadata = downExit && typeof downExit === 'object' && downExit.metadata && typeof downExit.metadata === 'object'
    ? downExit.metadata
    : null;
  const gate = metadata && metadata.gate && typeof metadata.gate === 'object'
    ? metadata.gate
    : null;
  const requiredPlacements = gate && Array.isArray(gate.requiredPlacements)
    ? gate.requiredPlacements
    : [];

  return requiredPlacements
    .map(entry => ({
      containerRef: normalizeRef(entry && entry.containerRef),
      itemRef: normalizeRef(entry && entry.itemRef),
    }))
    .filter(entry => entry.containerRef && entry.itemRef);
}

/**
 * @param {*} container
 * @param {string} itemRef
 * @returns {boolean}
 */
function containerHasItemRef(container, itemRef) {
  const needle = normalizeRef(itemRef);
  if (!container || typeof container !== 'object' || !needle) {
    return false;
  }

  return inventoryValues(container).some(item => normalizeRef(item && item.entityReference) === needle);
}

/**
 * Determine whether this exact successful `put` will open the crypt descent.
 *
 * This check is read-only and predictive:
 * - It verifies the gate is currently closed.
 * - It then evaluates required placements, treating the current planned put
 *   (directTarget -> indirectTarget) as satisfied even before commit executes.
 *
 * @param {*} state
 * @param {*} context
 * @returns {boolean}
 */
function willOpenDescentAfterCurrentPut(state, context) {
  const requirements = ritualRequirements(state);
  if (!requirements.length) {
    return false;
  }

  const cryptRoom = findCryptRoom(state);
  const downExit = findDownExit(cryptRoom);
  if (!downExit) {
    return false;
  }

  const gateStatus = evaluateExitGate(state, downExit);
  if (!gateStatus || gateStatus.ok !== false) {
    return false;
  }

  const entityResolution = context && context.entityResolution && typeof context.entityResolution === 'object'
    ? context.entityResolution
    : null;
  if (!entityResolution || entityResolution.ruleKey !== 'directIndirect') {
    return false;
  }

  const directRef = normalizeRef(entityResolution.directTarget && entityResolution.directTarget.entityReference);
  const indirectRef = normalizeRef(entityResolution.indirectTarget && entityResolution.indirectTarget.entityReference);
  if (!directRef || !indirectRef) {
    return false;
  }

  return requirements.every(requirement => {
    if (requirement.containerRef === indirectRef && requirement.itemRef === directRef) {
      return true;
    }

    const container = findItemByEntityRef(state, requirement.containerRef);
    return containerHasItemRef(container, requirement.itemRef);
  });
}

/**
 * Check whether this container currently holds the puzzle's accepted item.
 *
 * Example:
 * - cracked bell policy expects `rantamuta:bronzeClapper`
 * - if the bell inventory contains an item with that entityReference,
 *   this returns true.
 *
 * Why this exists:
 * We need a single authoritative "is solved for this object right now?"
 * check to drive stateful descriptions.
 *
 * @param {*} entity
 * @param {*} policy
 * @returns {boolean}
 */
function hasAcceptedItem(entity, policy) {
  const acceptedItemRef = normalizeRef(policy && policy.acceptedItemRef);
  if (!acceptedItemRef) {
    return false;
  }

  for (const item of inventoryValues(entity)) {
    const entityRef = normalizeRef(item && item.entityReference);
    if (entityRef === acceptedItemRef) {
      return true;
    }
  }

  return false;
}

/**
 * Update this object's text from optional puzzle policy fields:
 * - descriptionEmpty
 * - descriptionFilled
 * - roomDescEmpty
 * - roomDescFilled
 *
 * How designers use it in YAML:
 * metadata:
 *   puzzle:
 *     putPolicy:
 *       acceptedItemRef: "rantamuta:bronzeClapper"
 *       descriptionEmpty: "The old bell ... clapper is missing."
 *       descriptionFilled: "The old bell ... clapper now hangs within it."
 *
 * Behavior:
 * - If accepted item is present, use descriptionFilled (fallback to empty).
 * - If accepted item is absent, use descriptionEmpty (fallback to filled).
 *
 * Why this exists:
 * This keeps look/examine text aligned with live puzzle state without changing
 * any command logic.
 *
 * @param {*} entity
 */
function syncPuzzleDescription(entity) {
  const policy = getPutPolicy(entity);
  if (!policy) {
    return;
  }

  const descriptionEmpty = typeof policy.descriptionEmpty === 'string'
    ? policy.descriptionEmpty.trim()
    : '';
  const descriptionFilled = typeof policy.descriptionFilled === 'string'
    ? policy.descriptionFilled.trim()
    : '';
  const roomDescEmpty = typeof policy.roomDescEmpty === 'string'
    ? policy.roomDescEmpty.trim()
    : '';
  const roomDescFilled = typeof policy.roomDescFilled === 'string'
    ? policy.roomDescFilled.trim()
    : '';

  if (!descriptionEmpty && !descriptionFilled && !roomDescEmpty && !roomDescFilled) {
    return;
  }

  const isFilled = hasAcceptedItem(entity, policy);

  const nextDescription = isFilled
    ? descriptionFilled || descriptionEmpty
    : descriptionEmpty || descriptionFilled;
  const nextRoomDesc = isFilled
    ? roomDescFilled || roomDescEmpty
    : roomDescEmpty || roomDescFilled;

  if (nextDescription) {
    entity.description = nextDescription;
  }

  if (nextRoomDesc) {
    entity.roomDesc = nextRoomDesc;
  }
}

/**
 * @param {*} entity
 */
function wrapContainerMutators(entity) {
  const previousAddItem = typeof entity.addItem === 'function'
    ? entity.addItem
    : null;
  const previousRemoveItem = typeof entity.removeItem === 'function'
    ? entity.removeItem
    : null;

  if (previousAddItem) {
    entity.addItem = (item) => {
      const result = previousAddItem.call(entity, item);
      syncPuzzleDescription(entity);
      return result;
    };
  }

  if (previousRemoveItem) {
    entity.removeItem = (item) => {
      const result = previousRemoveItem.call(entity, item);
      syncPuzzleDescription(entity);
      return result;
    };
  }
}

/**
 * @param {*} entity
 * @returns {function(*, *): *}
 */
function createAllowAction(entity) {
  return (action, context) => {
    if (!isPutToIndirectTarget(action, context, entity)) {
      return undefined;
    }

    const policy = getPutPolicy(entity);
    if (!policy) {
      return undefined;
    }

    const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
    if (acceptsDirectTarget(policy, directTarget)) {
      return undefined;
    }

    return typeof policy.rejectMessage === 'string' && policy.rejectMessage.length > 0
      ? policy.rejectMessage
      : 'You can\'t put that there.';
  };
}

/**
 * @param {*} state
 * @param {*} entity
 * @returns {function(*, *): *}
 */
function createBubbleEvent(state, entity) {
  return (action, context) => {
    if (!isPutToIndirectTarget(action, context, entity)) {
      return null;
    }

    const policy = getPutPolicy(entity);
    if (!policy || typeof policy.successRender !== 'string' || policy.successRender.length === 0) {
      return null;
    }

    const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
    if (!acceptsDirectTarget(policy, directTarget)) {
      return null;
    }

    const contribution = {
      render: {
        messages: [
          {
            type: 'broadcast',
            audience: 'player',
            message: policy.successRender,
          },
        ],
      },
    };

    if (willOpenDescentAfterCurrentPut(state, context)) {
      contribution.render.messages.push(
        {
          type: 'broadcast',
          audience: 'area',
          targetSelector: 'currentArea',
          message: RITUAL_HUM_MESSAGE,
        },
        {
          type: 'broadcast',
          audience: 'areaExceptTargets',
          targetSelector: 'currentArea',
          exceptSelector: 'targetsByRoomRef',
          exceptRoomRef: CRYPT_ROOM_REFERENCE,
          message: RITUAL_AREA_GRIND_MESSAGE,
        },
        {
          type: 'broadcast',
          audience: 'room',
          targetSelector: 'roomByRef',
          targetRoomRef: CRYPT_ROOM_REFERENCE,
          message: RITUAL_CRYPT_GRIND_MESSAGE,
        }
      );
    }

    return contribution;
  };
}

/**
 * @param {*} state
 * @returns {function(this: *, ...args: *[]): void}
 */
function createSpawnListener(state) {
  return function onSpawn() {
    wrapContainerMutators(this);
    this.allowAction = createAllowAction(this);
    this.bubbleEvent = createBubbleEvent(state, this);
    syncPuzzleDescription(this);
  };
}

module.exports = {
  listeners: {
    spawn: state => createSpawnListener(state),
  },
};
