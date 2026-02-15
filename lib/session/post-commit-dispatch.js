// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');

const ALLOWED_AUDIENCES = new Set([
  'player',
  'room',
  'area',
  'areaExceptTargets',
]);

/**
 * @typedef {{
 *   type: 'broadcast',
 *   audience: 'player' | 'room' | 'area' | 'areaExceptTargets',
 *   message: string,
 *   targetSelector?: 'currentPlayer' | 'currentRoom' | 'currentArea' | 'roomByRef',
 *   targetRoomRef?: string,
 *   exceptSelector?: 'currentRoomTargets' | 'targetsByRoomRef',
 *   exceptRoomRef?: string,
 * }} PostCommitBroadcastInstruction
 */

/**
 * @typedef {{
 *   state: *,
 *   player: *,
 * }} PostCommitContext
 */

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
 * @returns {* | null}
 */
function currentRoom(player) {
  return player && typeof player === 'object' && player.room && typeof player.room === 'object'
    ? player.room
    : null;
}

/**
 * @param {*} player
 * @returns {* | null}
 */
function currentArea(player) {
  const room = currentRoom(player);
  return room && typeof room === 'object' && room.area && typeof room.area === 'object'
    ? room.area
    : null;
}

/**
 * @param {*} state
 * @param {string | undefined} roomRef
 * @returns {* | null}
 */
function roomByRef(state, roomRef) {
  const ref = normalizeText(roomRef);
  if (!ref) {
    return null;
  }

  const roomManager = state && typeof state === 'object' && state.RoomManager && typeof state.RoomManager === 'object'
    ? state.RoomManager
    : null;
  if (!roomManager || typeof roomManager.getRoom !== 'function') {
    return null;
  }

  return roomManager.getRoom(ref);
}

/**
 * @param {*} entity
 * @returns {Array<*>}
 */
function broadcastTargets(entity) {
  if (!entity || typeof entity !== 'object' || typeof entity.getBroadcastTargets !== 'function') {
    return [];
  }

  return valuesAsArray(entity.getBroadcastTargets());
}

/**
 * @param {PostCommitContext} context
 * @param {string | undefined} selector
 * @param {PostCommitBroadcastInstruction} instruction
 * @returns {* | null}
 */
function resolveTargetSelector(context, selector, instruction) {
  switch (selector) {
    case 'currentPlayer':
      return context.player || null;
    case 'currentRoom':
      return currentRoom(context.player);
    case 'currentArea':
      return currentArea(context.player);
    case 'roomByRef':
      return roomByRef(context.state, instruction.targetRoomRef);
    default:
      return null;
  }
}

/**
 * @param {PostCommitContext} context
 * @param {string | undefined} selector
 * @param {PostCommitBroadcastInstruction} instruction
 * @returns {Array<*> | null}
 */
function resolveExceptSelector(context, selector, instruction) {
  switch (selector) {
    case 'currentRoomTargets':
      return broadcastTargets(currentRoom(context.player));
    case 'targetsByRoomRef':
      return broadcastTargets(roomByRef(context.state, instruction.exceptRoomRef));
    default:
      return null;
  }
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {PostCommitContext} context
 * @param {PostCommitBroadcastInstruction} instruction
 * @returns {* | null}
 */
function resolveAudienceTarget(context, instruction) {
  const selector = instruction.targetSelector;

  if (selector) {
    return resolveTargetSelector(context, selector, instruction);
  }

  switch (instruction.audience) {
    case 'player':
      return context.player || null;
    case 'room':
      return currentRoom(context.player);
    case 'area':
    case 'areaExceptTargets':
      return currentArea(context.player);
    default:
      return null;
  }
}

/**
 * @param {PostCommitContext} context
 * @param {PostCommitBroadcastInstruction} instruction
 * @returns {Array<*>}
 */
function resolveExceptTargets(context, instruction) {
  const selector = instruction.exceptSelector || 'currentRoomTargets';
  const targets = resolveExceptSelector(context, selector, instruction);
  if (!targets) {
    throw new TypeError(`Invalid postCommit exceptSelector "${selector}".`);
  }

  return targets;
}

/**
 * @param {PostCommitContext} context
 * @param {PostCommitBroadcastInstruction} instruction
 */
function executeBroadcastInstruction(context, instruction) {
  if (Object.prototype.hasOwnProperty.call(instruction, 'target') ||
    Object.prototype.hasOwnProperty.call(instruction, 'exceptTargets')) {
    throw new TypeError('postCommit.broadcast only accepts selector fields (targetSelector/exceptSelector).');
  }

  const audience = normalizeText(instruction.audience);
  if (!ALLOWED_AUDIENCES.has(audience)) {
    throw new TypeError(`Unsupported postCommit audience "${audience}".`);
  }

  const message = normalizeText(instruction.message);
  if (!message) {
    throw new TypeError('postCommit.broadcast requires a non-empty message.');
  }

  const target = resolveAudienceTarget(context, instruction);
  if (!target || typeof target !== 'object') {
    throw new TypeError(`postCommit.broadcast target could not be resolved for audience "${audience}".`);
  }

  switch (audience) {
    case 'player':
    case 'room':
    case 'area':
      Broadcast.sayAt(target, message);
      return;
    case 'areaExceptTargets':
      Broadcast.sayAtExcept(target, message, resolveExceptTargets(context, instruction));
      return;
    default:
      throw new TypeError(`Unsupported postCommit audience "${audience}".`);
  }
}

/**
 * Execute post-commit delivery instructions in best-effort mode.
 *
 * Contract:
 * - delivery-only v1 (`type: 'broadcast'`)
 * - unknown/invalid instructions are logged and skipped
 * - failures do not throw to caller and do not stop subsequent instructions
 *
 * @param {PostCommitContext} context
 * @param {Array<*>} instructions
 * @returns {{ instructionsAttempted: number, failures: number }}
 */
function executePostCommitInstructions(context, instructions) {
  let instructionsAttempted = 0;
  let failures = 0;

  if (!Array.isArray(instructions) || !instructions.length) {
    return { instructionsAttempted, failures };
  }

  for (const instruction of instructions) {
    instructionsAttempted += 1;

    try {
      if (!instruction || typeof instruction !== 'object') {
        throw new TypeError('postCommit instruction must be an object.');
      }

      const candidate = /** @type {Record<string, *>} */ (instruction);
      const type = normalizeText(candidate.type);
      if (type !== 'broadcast') {
        throw new TypeError(`Unsupported postCommit instruction type "${type || '<empty>'}".`);
      }

      executeBroadcastInstruction(context, /** @type {PostCommitBroadcastInstruction} */ (candidate));
    } catch (err) {
      failures += 1;
      const message = err && typeof err === 'object' && 'message' in err
        ? String(err.message)
        : 'Unknown postCommit error.';
      Logger.error(`POST_COMMIT_DISPATCH: ${message}`);
    }
  }

  return { instructionsAttempted, failures };
}

module.exports = {
  executePostCommitInstructions,
};
