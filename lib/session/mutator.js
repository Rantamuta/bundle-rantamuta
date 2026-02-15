// @ts-check
'use strict';

const util = require('util');
const { Broadcast, Logger } = require('ranvier');

/**
 * @module session/mutator
 * @description
 * Executor layer for mutation plans emitted by command handlers.
 *
 * The mutator is responsible for applying concrete world-state changes from
 * instruction objects. It is intentionally separate from command logic so
 * commands can evolve toward "plan, don't mutate" behavior.
 *
 * Why this exists:
 * - Keeps mutation semantics in one place instead of spread across verbs.
 * - Enables transactional behavior (apply all or rollback on failure).
 * - Gives us a stable seam for validation, auditing, and future extensions.
 *
 * Error contract:
 * - Mutation errors are system errors, not game errors.
 * - Game errors should be handled by command handlers and not cause mutation plans to be emitted.
 * - DO NOT use mutator errors for normal player feedback; use command handler validation instead.
 * - Mutator throws are treated as invariant/system errors, not normal player validation feedback.
 * - Rollback failures are logged at error severity with instruction context
 *   because integrity may be at risk.
 */

/** @typedef {import('ranvier/types/GameState')} GameState */

/**
 * @typedef {{ type: 'noop' }} NoopInstruction
 */

/**
 * @typedef {{
 *   addItem: function(*): void,
 *   removeItem: function(*): void,
 * }} ReversibleItemContainer
 */

/**
 * @typedef {{
 *   type: 'transferItem',
 *   item: *,
 *   from: ReversibleItemContainer,
 *   to: ReversibleItemContainer,
 * }} TransferItemInstruction
 */

/**
 * @typedef {{
 *   type: 'movePlayer',
 *   player: { room?: *, moveTo: function(*): void },
 *   toRoom: *,
 *   direction?: string,
 * }} MovePlayerInstruction
 */

/**
 * @typedef {NoopInstruction | TransferItemInstruction | MovePlayerInstruction} MutationInstruction
 */

/**
 * @typedef {{ operations: MutationInstruction[] }} MutationPlan
 */

/**
 * @typedef {{ undo: function(): void, instruction: MutationInstruction, index: number }} UndoEntry
 */

/**
 * @param {*} value
 * @returns {value is ReversibleItemContainer}
 */
function isReversibleItemContainer(value) {
  return !!value &&
    typeof value.addItem === 'function' &&
    typeof value.removeItem === 'function';
}

/**
 * @param {*} item
 * @param {*} destination
 * @returns {boolean}
 */
function wouldCreateContainmentCycle(item, destination) {
  if (!item || typeof item !== 'object' || !destination || typeof destination !== 'object') {
    return false;
  }

  /** @type {WeakSet<object>} */
  const seen = new WeakSet();
  let holder = destination;

  while (holder && typeof holder === 'object') {
    if (holder === item) {
      return true;
    }

    if (seen.has(holder)) {
      return false;
    }
    seen.add(holder);

    holder = holder.carriedBy && typeof holder.carriedBy === 'object'
      ? holder.carriedBy
      : null;
  }

  return false;
}

function applyTransferItemInstruction({ item, from, to }) {
  if (!isReversibleItemContainer(from)) {
    throw new TypeError('transferItem.from must provide addItem(item) and removeItem(item).');
  }

  if (!isReversibleItemContainer(to)) {
    throw new TypeError('transferItem.to must provide addItem(item) and removeItem(item).');
  }

  if (from === to) {
    throw new TypeError('transferItem.from and transferItem.to must be different containers.');
  }

  if (item === to || wouldCreateContainmentCycle(item, to)) {
    throw new TypeError('transferItem cannot move an item into itself or one of its descendants.');
  }

  from.removeItem(item);
  try {
    // to.addItem may throw (e.g. data corruption);
    to.addItem(item);
  } catch (err) {
    // if to.addItem throws, we put the item back into `from`.
    from.addItem(item);
    throw err;
  }

  return () => {
    to.removeItem(item);
    from.addItem(item);
  };
}

const OPPOSITE_DIRECTIONS = Object.freeze({
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  northeast: 'southwest',
  southwest: 'northeast',
  northwest: 'southeast',
  southeast: 'northwest',
  up: 'down',
  down: 'up',
  in: 'out',
  out: 'in',
});

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} player
 * @returns {string}
 */
function displayActorName(player) {
  if (player && typeof player === 'object' && typeof player.name === 'string' && player.name.trim().length > 0) {
    return player.name.trim();
  }

  return 'Someone';
}

/**
 * @param {*} direction
 * @returns {string}
 */
function oppositeDirection(direction) {
  const normalized = normalizeDirection(direction);
  if (!normalized) {
    return '';
  }

  return OPPOSITE_DIRECTIONS[normalized] || '';
}

/**
 * @param {*} room
 * @param {*} actor
 * @param {string} message
 */
function broadcastOthers(room, actor, message) {
  if (!room || typeof room !== 'object' || !message) {
    return;
  }

  if (typeof room.getBroadcastTargets !== 'function') {
    return;
  }

  Broadcast.sayAtExcept(room, message, actor ? [actor] : []);
}

/**
 * @param {MovePlayerInstruction} instruction
 * @returns {function(): void}
 */
function applyMovePlayerInstruction({ player, toRoom, direction }) {
  if (!player || typeof player !== 'object' || typeof player.moveTo !== 'function') {
    throw new TypeError('movePlayer.player must provide moveTo(room).');
  }

  if (!toRoom || typeof toRoom !== 'object') {
    throw new TypeError('movePlayer.toRoom must be an object.');
  }

  const previousRoom = player.room || null;
  const normalizedDirection = normalizeDirection(direction);
  const actorName = displayActorName(player);
  if (previousRoom) {
    const leaveMessage = normalizedDirection
      ? `${actorName} leaves ${normalizedDirection}.`
      : `${actorName} leaves.`;
    broadcastOthers(previousRoom, player, leaveMessage);
  }

  player.moveTo(toRoom);

  const arrivalFrom = oppositeDirection(normalizedDirection);
  if (toRoom) {
    const arrivalMessage = arrivalFrom
      ? `${actorName} arrives from the ${arrivalFrom}.`
      : `${actorName} arrives.`;
    broadcastOthers(toRoom, player, arrivalMessage);
  }

  return () => {
    if (previousRoom && typeof previousRoom === 'object') {
      player.moveTo(previousRoom);
    }
  };
}

/**
 * Apply a single mutation instruction and return its inverse operation.
 *
 * @param {GameState} state
 * @param {MutationInstruction} instruction
 * @returns {function(): void}
 */
function applyMutationInstruction(state, instruction) {
  if (!instruction || typeof instruction !== 'object') {
    throw new TypeError('Mutation instruction must be an object.');
  }

  if (!instruction.type) {
    throw new TypeError('Mutation instruction missing required type.');
  }

  switch (instruction.type) {
    case 'noop':
      return () => { };

    case 'transferItem': return applyTransferItemInstruction(instruction);
    case 'movePlayer': return applyMovePlayerInstruction(instruction);

    default:
      throw new RangeError('Unsupported mutation instruction type.');
  }
}

/**
 * Apply a mutation plan atomically. If any operation fails, prior operations
 * are rolled back in reverse order.
 *
 * @param {GameState} state
 * @param {MutationPlan} plan
 */
function applyMutationPlan(state, plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.operations)) {
    throw new TypeError('Mutation plan must be an object with an operations array.');
  }

  /** @type {UndoEntry[]} */
  const undoStack = [];

  try {
    for (const [index, instruction] of plan.operations.entries()) {
      const undo = applyMutationInstruction(state, instruction);
      undoStack.push({ undo, instruction, index });
    }
  } catch (err) {
    while (undoStack.length) {
      const entry = undoStack.pop();
      if (!entry) {
        continue;
      }

      try {
        entry.undo();
      } catch (rollbackErr) {
        const originalError = /** @type {{ message?: string, stack?: string }} */ (err);
        const rollbackError = /** @type {{ message?: string, stack?: string }} */ (rollbackErr);
        const instructionPreview = util.inspect(entry.instruction, { depth: 2, breakLength: 120 });
        const originalMessage = originalError.message || 'Unknown mutation error';
        const rollbackMessage = rollbackError.message || 'Unknown rollback error';

        Logger.error(
          `MUTATOR ROLLBACK FAILURE (operation ${entry.index}): ${rollbackMessage}. ` +
          `Original error: ${originalMessage}. Instruction: ${instructionPreview}`
        );

        if (rollbackError.stack) {
          Logger.error(rollbackError.stack);
        }
      }
    }

    throw err;
  }
}

module.exports = {
  applyMutationInstruction,
  applyMutationPlan,
};
