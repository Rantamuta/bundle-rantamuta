// @ts-check
'use strict';

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
 */

/** @typedef {import('ranvier/types/GameState')} GameState */

/**
 * @typedef {{ type: 'noop' }} NoopInstruction
 */

/**
 * @typedef {{
 *   type: 'transferItem',
 *   item: *,
 *   from: { removeItem: function(*): void },
 *   to: { addItem: function(*): void },
 * }} TransferItemInstruction
 */

/**
 * @typedef {NoopInstruction | TransferItemInstruction} MutationInstruction
 */

/**
 * @typedef {{ operations: MutationInstruction[] }} MutationPlan
 */

/**
 * @param {*} value
 * @returns {value is { addItem: function(*): void }}
 */
function isAddContainer(value) {
  return !!value && typeof value.addItem === 'function';
}

/**
 * @param {*} value
 * @returns {value is { removeItem: function(*): void }}
 */
function isRemoveContainer(value) {
  return !!value && typeof value.removeItem === 'function';
}

function applyTransferItemInstruction({ item, from, to }) {

  if (!isRemoveContainer(from)) {
    throw new TypeError('transferItem.from must provide removeItem(item).');
  }

  if (!isAddContainer(to)) {
    throw new TypeError('transferItem.to must provide addItem(item).');
  }

  from.removeItem(item);
  to.addItem(item);

  return () => {
    if (typeof to.removeItem === 'function') {
      to.removeItem(item);
    }
    if (typeof from.addItem === 'function') {
      from.addItem(item);
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

    default:
      throw new RangeError(`Unsupported mutation instruction type: ${instruction.type}`);
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

  const undoStack = [];

  try {
    for (const instruction of plan.operations) {
      const undo = applyMutationInstruction(state, instruction);
      undoStack.push(undo);
    }
  } catch (err) {
    while (undoStack.length) {
      const undo = undoStack.pop();
      try {
        undo();
      } catch (_) {
        // Best-effort rollback; original error is authoritative.
      }
    }
    throw err;
  }
}

module.exports = {
  applyMutationInstruction,
  applyMutationPlan,
};
