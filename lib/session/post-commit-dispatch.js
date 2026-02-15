// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');
const { renderSemanticEvent } = require('./semantic-message');

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
 *   directTarget?: *,
 *   indirectTarget?: *,
 * }} PostCommitContext
 */

/**
 * @typedef {{
 *   type: 'semanticEvent',
 *   template: string,
 *   audiencePolicy: 'self' | 'others' | 'self_and_others' | 'self_target_and_others' | 'target_and_others',
 *   participants: {
 *     actor: {
 *       selector: 'currentPlayer'
 *     },
 *     target?: {
 *       selector: 'entityByContextRole',
 *       role: 'directTarget' | 'indirectTarget'
 *     },
 *     direct?: {
 *       selector: 'entityByContextRole',
 *       role: 'directTarget' | 'indirectTarget'
 *     },
 *     indirect?: {
 *       selector: 'entityByContextRole',
 *       role: 'directTarget' | 'indirectTarget'
 *     },
 *   },
 *   objectText?: { direct?: string, indirect?: string },
 *   templates?: { actor?: string, target?: string, others?: string },
 * }} PostCommitSemanticEventInstruction
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
 * @param {*} entity
 * @returns {string}
 */
function stableEntityKey(entity) {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  if (entity.uuid !== undefined && entity.uuid !== null) {
    return `uuid:${String(entity.uuid)}`;
  }

  if (entity.entityReference !== undefined && entity.entityReference !== null) {
    return `ref:${String(entity.entityReference)}`;
  }

  if (entity.id !== undefined && entity.id !== null) {
    return `id:${String(entity.id)}`;
  }

  if (entity.name !== undefined && entity.name !== null) {
    return `name:${String(entity.name).toLowerCase()}`;
  }

  return '';
}

/**
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameEntity(a, b) {
  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  const ak = stableEntityKey(a);
  const bk = stableEntityKey(b);
  return !!ak && ak === bk;
}

/**
 * @param {PostCommitContext} context
 * @param {*} selector
 * @returns {* | null}
 */
function resolveSemanticParticipantSelector(context, selector) {
  if (!selector || typeof selector !== 'object') {
    return null;
  }

  if (selector.selector === 'currentPlayer') {
    return context.player || null;
  }

  if (selector.selector === 'entityByContextRole') {
    if (selector.role === 'directTarget') {
      return context.directTarget || null;
    }
    if (selector.role === 'indirectTarget') {
      return context.indirectTarget || null;
    }
  }

  return null;
}

/**
 * @param {PostCommitContext} context
 * @param {PostCommitSemanticEventInstruction} instruction
 * @returns {* | null}
 */
function resolveSemanticTargetParticipant(context, instruction) {
  const participants = instruction && instruction.participants && typeof instruction.participants === 'object'
    ? instruction.participants
    : null;
  if (!participants || !participants.target) {
    return null;
  }

  return resolveSemanticParticipantSelector(context, participants.target);
}

/**
 * @param {PostCommitContext} context
 * @param {*} actor
 * @param {*} target
 * @returns {Array<*>}
 */
function resolveSemanticOthers(context, actor, target) {
  const roomTargets = broadcastTargets(currentRoom(context.player));
  /** @type {Array<*>} */
  const others = [];
  const seen = new Set();

  for (const candidate of roomTargets) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    if (sameEntity(candidate, actor) || sameEntity(candidate, target)) {
      continue;
    }

    const key = stableEntityKey(candidate);
    if (key && seen.has(key)) {
      continue;
    }

    if (key) {
      seen.add(key);
    }
    others.push(candidate);
  }

  return others;
}

/**
 * @param {PostCommitContext} context
 * @returns {{ currentPlayer: *, directTarget: *, indirectTarget: * }}
 */
function semanticRenderContext(context) {
  return {
    currentPlayer: context.player || null,
    directTarget: context.directTarget || null,
    indirectTarget: context.indirectTarget || null,
  };
}

/**
 * @param {PostCommitContext} context
 * @param {PostCommitSemanticEventInstruction} instruction
 */
function executeSemanticEventInstruction(context, instruction) {
  const actor = context.player;
  if (!actor || typeof actor !== 'object') {
    throw new TypeError('postCommit.semanticEvent requires an active player.');
  }

  const target = resolveSemanticTargetParticipant(context, instruction);
  const others = resolveSemanticOthers(context, actor, target);

  const baseRenderContext = semanticRenderContext(context);

  const actorResult = renderSemanticEvent(instruction, baseRenderContext, 'self');
  if (!actorResult.ok) {
    const actorFailure = /** @type {{ code: string, message: string }} */ (actorResult);
    throw new TypeError(`postCommit.semanticEvent actor render failed (${actorFailure.code}): ${actorFailure.message}`);
  }
  if (actorResult.included && actorResult.text) {
    Broadcast.sayAt(actor, actorResult.text);
  }

  const targetResult = renderSemanticEvent(instruction, baseRenderContext, 'target');
  if (!targetResult.ok) {
    const targetFailure = /** @type {{ code: string, message: string }} */ (targetResult);
    throw new TypeError(`postCommit.semanticEvent target render failed (${targetFailure.code}): ${targetFailure.message}`);
  }
  if (target && targetResult.included && targetResult.text) {
    Broadcast.sayAt(target, targetResult.text);
  }

  for (const other of others) {
    const otherResult = renderSemanticEvent(
      instruction,
      { ...baseRenderContext, otherRecipient: other },
      'other'
    );
    if (!otherResult.ok) {
      const otherFailure = /** @type {{ code: string, message: string }} */ (otherResult);
      throw new TypeError(`postCommit.semanticEvent others render failed (${otherFailure.code}): ${otherFailure.message}`);
    }
    if (otherResult.included && otherResult.text) {
      Broadcast.sayAt(other, otherResult.text);
    }
  }
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
 * - delivery-only v1 (`type: 'broadcast'` or `type: 'semanticEvent'`)
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
      if (type === 'broadcast') {
        executeBroadcastInstruction(context, /** @type {PostCommitBroadcastInstruction} */ (candidate));
        continue;
      }

      if (type === 'semanticEvent') {
        executeSemanticEventInstruction(context, /** @type {PostCommitSemanticEventInstruction} */ (candidate));
        continue;
      }

      if (type !== 'broadcast' && type !== 'semanticEvent') {
        throw new TypeError(`Unsupported postCommit instruction type "${type || '<empty>'}".`);
      }
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
