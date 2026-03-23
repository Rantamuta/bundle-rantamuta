// @ts-check
'use strict';

const { getPlayerMetadata, parsePath } = require('./player-metadata');

const CONVERSATION_METADATA_ROOT = 'conversations';

/**
 * @param {*} npcRef
 * @returns {{ areaId: string, npcId: string }}
 */
function getConversationNpcIdentity(npcRef) {
  if (typeof npcRef !== 'string') {
    throw new TypeError('conversationState.npcRef must be a string.');
  }

  const trimmed = npcRef.trim();
  const separator = trimmed.indexOf(':');
  if (!trimmed || separator <= 0 || separator !== trimmed.lastIndexOf(':') || separator >= trimmed.length - 1) {
    throw new TypeError('conversationState.npcRef must have the form "<areaId>:<npcId>".');
  }

  const areaId = trimmed.slice(0, separator).trim();
  const npcId = trimmed.slice(separator + 1).trim();
  if (!areaId || !npcId) {
    throw new TypeError('conversationState.npcRef must contain non-empty areaId and npcId.');
  }

  const path = `${CONVERSATION_METADATA_ROOT}.${areaId}.${npcId}.state`;
  if (!parsePath(path)) {
    throw new TypeError('conversationState.npcRef must resolve to safe metadata path segments.');
  }

  return { areaId, npcId };
}

/**
 * @param {*} npcRef
 * @returns {string}
 */
function getConversationNpcPath(npcRef) {
  const { areaId, npcId } = getConversationNpcIdentity(npcRef);
  return `${CONVERSATION_METADATA_ROOT}.${areaId}.${npcId}`;
}

/**
 * @param {*} npcRef
 * @returns {string}
 */
function getConversationStatePath(npcRef) {
  return `${getConversationNpcPath(npcRef)}.state`;
}

/**
 * Read persisted conversation state without mutating player metadata.
 *
 * @param {*} player
 * @param {*} npcRef
 * @returns {*}
 */
function getConversationState(player, npcRef) {
  return getPlayerMetadata(player, getConversationStatePath(npcRef));
}

/**
 * Build the canonical setPlayerMetadata instruction for persisted conversation state.
 *
 * @param {*} player
 * @param {*} npcRef
 * @param {*} state
 * @returns {{ type: 'setPlayerMetadata', player: *, key: string, value: * }}
 */
function createSetConversationStateInstruction(player, npcRef, state) {
  return {
    type: 'setPlayerMetadata',
    player,
    key: getConversationStatePath(npcRef),
    value: state,
  };
}

module.exports = {
  CONVERSATION_METADATA_ROOT,
  createSetConversationStateInstruction,
  getConversationNpcIdentity,
  getConversationNpcPath,
  getConversationState,
  getConversationStatePath,
};
