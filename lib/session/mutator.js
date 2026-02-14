// @ts-check
'use strict';

const util = require('util');
const { Logger } = require('ranvier');

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

function applyTransferItemInstruction({ item, from, to }) {
  if (!isReversibleItemContainer(from)) {
    throw new TypeError('transferItem.from must provide addItem(item) and removeItem(item).');
  }

  if (!isReversibleItemContainer(to)) {
    throw new TypeError('transferItem.to must provide addItem(item) and removeItem(item).');
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

/**
 * @param {MovePlayerInstruction} instruction
 * @returns {function(): void}
 */
function applyMovePlayerInstruction({ player, toRoom }) {
  if (!player || typeof player !== 'object' || typeof player.moveTo !== 'function') {
    throw new TypeError('movePlayer.player must provide moveTo(room).');
  }

  if (!toRoom || typeof toRoom !== 'object') {
    throw new TypeError('movePlayer.toRoom must be an object.');
  }

  const previousRoom = player.room || null;
  player.moveTo(toRoom);

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
