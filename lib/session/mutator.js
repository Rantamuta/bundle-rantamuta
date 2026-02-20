// @ts-check
'use strict';

const util = require('util');
const { Broadcast, Logger } = require('ranvier');
const { getVirtualDoorService } = require('../doors/virtual-door-service');

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
 *   suppressRoomBroadcast?: boolean,
 * }} MovePlayerInstruction
 */

/**
 * @typedef {{
 *   type: 'doorMutation',
 *   mutation: 'open' | 'close' | 'unlock' | 'unlockAndOpen' | 'closeAndLock',
 *   actor?: { room?: * },
 *   fromRoomRef?: string,
 *   direction?: string,
 *   roomRef?: string,
 * }} DoorMutationInstruction
 */

/**
 * @typedef {{
 *   type: 'openDoor',
 *   actor?: { room?: * },
  *   direction?: string,
  *   roomRef?: string,
 * }} OpenDoorInstruction
 */

/**
 * @typedef {{
 *   type: 'closeAndLockDoor',
 *   actor?: { room?: * },
 *   direction?: string,
 *   roomRef?: string,
 * }} CloseAndLockDoorInstruction
 */

/**
 * @typedef {NoopInstruction | TransferItemInstruction | MovePlayerInstruction | DoorMutationInstruction | OpenDoorInstruction | CloseAndLockDoorInstruction} MutationInstruction
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
function applyMovePlayerInstruction({ player, toRoom, direction, suppressRoomBroadcast }) {
  if (!player || typeof player !== 'object' || typeof player.moveTo !== 'function') {
    throw new TypeError('movePlayer.player must provide moveTo(room).');
  }

  if (!toRoom || typeof toRoom !== 'object') {
    throw new TypeError('movePlayer.toRoom must be an object.');
  }

  const previousRoom = player.room || null;
  const normalizedDirection = normalizeDirection(direction);
  const actorName = displayActorName(player);
  if (!suppressRoomBroadcast && previousRoom) {
    const leaveMessage = normalizedDirection
      ? `${actorName} leaves ${normalizedDirection}.`
      : `${actorName} leaves.`;
    broadcastOthers(previousRoom, player, leaveMessage);
  }

  player.moveTo(toRoom);

  const arrivalFrom = oppositeDirection(normalizedDirection);
  if (!suppressRoomBroadcast && toRoom) {
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
 * @param {GameState} state
 * @param {string} roomRef
 * @returns {* | null}
 */
function resolveRoomByRef(state, roomRef) {
  const roomManager = state && state.RoomManager;
  if (!roomManager || typeof roomManager.getRoom !== 'function') {
    return null;
  }

  return roomManager.getRoom(roomRef) || null;
}

/**
 * @param {*} actor
 * @param {string} direction
 * @returns {* | null}
 */
function resolveExitByDirection(actor, direction) {
  const fromRoom = actor && actor.room && typeof actor.room === 'object'
    ? actor.room
    : null;
  return resolveExitByDirectionFromRoom(fromRoom, direction);
}

/**
 * @param {*} fromRoom
 * @param {string} direction
 * @returns {* | null}
 */
function resolveExitByDirectionFromRoom(fromRoom, direction) {
  const normalizedDirection = normalizeDirection(direction);
  if (!normalizedDirection || !fromRoom || typeof fromRoom !== 'object') {
    return null;
  }

  if (typeof fromRoom.findExit === 'function') {
    const matchedExit = fromRoom.findExit(normalizedDirection);
    if (matchedExit && typeof matchedExit === 'object') {
      return matchedExit;
    }
  }

  const exits = typeof fromRoom.getExits === 'function'
    ? fromRoom.getExits()
    : Array.isArray(fromRoom.exits)
      ? fromRoom.exits
      : null;
  if (!Array.isArray(exits)) {
    return null;
  }

  for (const exit of exits) {
    if (!exit || typeof exit !== 'object') {
      continue;
    }

    if (normalizeDirection(exit.direction) === normalizedDirection) {
      return exit;
    }
  }

  return null;
}

/**
 * @param {*} destinationRoom
 * @param {*} fromRoom
 * @returns {* | null}
 */
function resolveDoorRecord(destinationRoom, fromRoom) {
  if (!destinationRoom || typeof destinationRoom !== 'object' || !fromRoom || typeof fromRoom !== 'object') {
    return null;
  }

  if (typeof destinationRoom.getDoor === 'function') {
    const door = destinationRoom.getDoor(fromRoom);
    return door && typeof door === 'object' ? door : null;
  }

  const fromRoomRef = fromRoom && typeof fromRoom.entityReference === 'string'
    ? fromRoom.entityReference
    : '';
  if (!fromRoomRef) {
    return null;
  }

  const doors = destinationRoom.doors;
  if (!doors) {
    return null;
  }

  if (typeof doors.get === 'function') {
    const door = doors.get(fromRoomRef);
    return door && typeof door === 'object' ? door : null;
  }

  if (typeof doors === 'object' && Object.prototype.hasOwnProperty.call(doors, fromRoomRef)) {
    const door = doors[fromRoomRef];
    return door && typeof door === 'object' ? door : null;
  }

  return null;
}

/**
 * @param {GameState} state
 * @param {OpenDoorInstruction} instruction
 * @returns {function(): void}
 */
function applyOpenDoorInstruction(state, instruction) {
  return applyDoorMutationInstruction(state, {
    ...instruction,
    type: 'doorMutation',
    mutation: 'open',
  }, 'openDoor');
}

/**
 * @param {GameState} state
 * @param {CloseAndLockDoorInstruction} instruction
 * @returns {function(): void}
 */
function applyCloseAndLockDoorInstruction(state, instruction) {
  return applyDoorMutationInstruction(state, {
    ...instruction,
    type: 'doorMutation',
    mutation: 'closeAndLock',
  }, 'closeAndLockDoor');
}

/**
 * @param {GameState} state
 * @param {DoorMutationInstruction} instruction
 * @param {string} [warningPrefixOverride]
 * @returns {function(): void}
 */
function applyDoorMutationInstruction(state, instruction, warningPrefixOverride) {
  if (!instruction || typeof instruction !== 'object' || typeof instruction.mutation !== 'string') {
    throw new TypeError('doorMutation.mutation is required.');
  }
  const actor = instruction.actor && typeof instruction.actor === 'object'
    ? instruction.actor
    : null;
  const fromRoom = typeof instruction.fromRoomRef === 'string' && instruction.fromRoomRef.trim().length > 0
    ? resolveRoomByRef(state, instruction.fromRoomRef.trim())
    : actor && actor.room && typeof actor.room === 'object'
      ? actor.room
      : null;

  const destination = typeof instruction.roomRef === 'string' && instruction.roomRef.trim().length > 0
    ? resolveRoomByRef(state, instruction.roomRef.trim())
    : fromRoom
      ? (() => {
          const exit = resolveExitByDirectionFromRoom(fromRoom, instruction.direction || '');
          const roomRef = exit && typeof exit.roomId === 'string' && exit.roomId.trim().length > 0
            ? exit.roomId.trim()
            : '';
          return roomRef ? resolveRoomByRef(state, roomRef) : null;
        })()
      : null;

  /** @type {Array<{ door: *, closed: boolean, locked: boolean }>} */
  const snapshots = [];
  if (fromRoom && destination) {
    const outbound = resolveDoorRecord(destination, fromRoom);
    if (outbound) {
      snapshots.push({
        door: outbound,
        closed: outbound.closed === true,
        locked: outbound.locked === true,
      });
    }

    const inbound = resolveDoorRecord(fromRoom, destination);
    if (inbound && inbound !== outbound) {
      snapshots.push({
        door: inbound,
        closed: inbound.closed === true,
        locked: inbound.locked === true,
      });
    }
  }

  const service = getVirtualDoorService(state);
  const result = service.mutateDoor({
    actor,
    fromRoomRef: typeof instruction.fromRoomRef === 'string' && instruction.fromRoomRef.trim().length > 0
      ? instruction.fromRoomRef.trim()
      : undefined,
    direction: typeof instruction.direction === 'string' && instruction.direction.trim().length > 0
      ? instruction.direction.trim()
      : undefined,
    roomRef: typeof instruction.roomRef === 'string' && instruction.roomRef.trim().length > 0
      ? instruction.roomRef.trim()
      : undefined,
    mutation: instruction.mutation,
  });

  if (!result || result.ok !== true) {
    const warningPrefix = warningPrefixOverride || `doorMutation(${instruction.mutation})`;
    const reason = result && typeof result.code === 'string' && result.code
      ? result.code
      : 'unknown_error';
    Logger.warn(`${warningPrefix}: ${reason}. Instruction ignored.`);
    return () => { };
  }

  if (result.changed !== true || snapshots.length === 0) {
    return () => { };
  }

  return () => {
    for (const snapshot of snapshots) {
      snapshot.door.closed = snapshot.closed;
      snapshot.door.locked = snapshot.locked;
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
    case 'doorMutation': return applyDoorMutationInstruction(state, instruction);
    case 'openDoor': return applyOpenDoorInstruction(state, instruction);
    case 'closeAndLockDoor': return applyCloseAndLockDoorInstruction(state, instruction);

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
