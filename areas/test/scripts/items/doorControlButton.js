// @ts-check
'use strict';

/**
 * @param {*} value
 * @returns {Record<string, *>}
 */
function asObject(value) {
  return value && typeof value === 'object'
    ? /** @type {Record<string, *>} */ (value)
    : {};
}

/**
 * @param {*} state
 * @param {string} roomRef
 * @returns {* | null}
 */
function getRoomByRef(state, roomRef) {
  const ref = String(roomRef || '').trim();
  if (!ref) {
    return null;
  }

  const roomManager = state && state.RoomManager;
  if (!roomManager || typeof roomManager.getRoom !== 'function') {
    return null;
  }

  return roomManager.getRoom(ref) || null;
}

/**
 * @param {*} button
 * @returns {Record<string, *>}
 */
function getMetadata(button) {
  return asObject(button && button.metadata);
}

/**
 * @param {*} state
 * @param {*} button
 * @returns {function(*, string, Record<string, *>): *}
 */
function createPlanDirect(state, button) {
  return (actor, verbId, context) => {
    void state;
    if (verbId !== 'push') {
      return null;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.directTarget !== button) {
      return null;
    }

    const metadata = getMetadata(button);
    const instruction = asObject(metadata.mutationInstruction);
    if (!instruction.type || typeof instruction.type !== 'string') {
      return null;
    }

    return {
      plan: {
        operations: [
          {
            ...instruction,
            actor,
          },
        ],
      },
    };
  };
}

/**
 * @param {*} state
 * @param {*} button
 * @returns {function(*, string, Record<string, *>): *}
 */
function createPushReaction(state, button) {
  return (actor, verbId, context) => {
    void actor;
    if (verbId !== 'push') {
      return null;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.directTarget !== button) {
      return null;
    }

    const metadata = getMetadata(button);
    const doorConfig = asObject(metadata.doorContext);
    const roomMessages = asObject(metadata.roomMessages);

    const messages = [];
    if (typeof roomMessages.currentRoom === 'string' && roomMessages.currentRoom.trim().length > 0) {
      messages.push({
        type: 'broadcast',
        audience: 'room',
        message: roomMessages.currentRoom.trim(),
      });
    }

    if (typeof roomMessages.otherRoom === 'string' &&
      roomMessages.otherRoom.trim().length > 0 &&
      typeof doorConfig.roomRef === 'string' &&
      doorConfig.roomRef.trim().length > 0 &&
      getRoomByRef(state, doorConfig.roomRef.trim())) {
      messages.push({
        type: 'broadcast',
        audience: 'room',
        targetSelector: 'roomByRef',
        targetRoomRef: doorConfig.roomRef.trim(),
        message: roomMessages.otherRoom.trim(),
      });
    }

    if (!messages.length) {
      return null;
    }

    return {
      render: {
        messages,
      },
    };
  };
}

/**
 * @param {*} state
 * @returns {function(): void}
 */
function createSpawnListener(state) {
  return function onSpawn() {
    this.planDirect = createPlanDirect(state, this);
    this.pushReaction = createPushReaction(state, this);
  };
}

module.exports = {
  listeners: {
    spawn: state => createSpawnListener(state),
  },
};
