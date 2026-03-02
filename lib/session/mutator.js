// @ts-check
'use strict';

const util = require('util');
const { Broadcast, Logger } = require('ranvier');
const { getVirtualDoorService } = require('../doors/virtual-door-service');
const { parsePath } = require('./player-metadata');

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
 * @typedef {{
 *   type: 'setPlayerMetadata',
 *   player: { metadata?: Record<string, *>, name?: string },
 *   key: string,
 *   value: *,
 * }} SetPlayerMetadataInstruction
 */

/**
 * @typedef {{
 *   type: 'setRoomFlag',
 *   roomRef: string,
 *   key: string,
 *   value: boolean,
 * }} SetRoomFlagInstruction
 */

/**
 * @typedef {{
 *   type: 'setAreaMetadata',
 *   actor: { room?: { area?: * }, name?: string },
 *   key: string,
 *   value: *,
 * }} SetAreaMetadataInstruction
 */

/**
 * @typedef {{
 *   type: 'deleteRoomMetadata',
 *   roomRef: string,
 *   key: string,
 *   force?: boolean,
 * }} DeleteRoomMetadataInstruction
 */

/**
 * @typedef {{
 *   type: 'deleteAreaMetadata',
 *   actor: { room?: { area?: * }, name?: string },
 *   key: string,
 *   force?: boolean,
 * }} DeleteAreaMetadataInstruction
 */

/**
 * @typedef {{
 *   type: 'deleteWorldMetadata',
 *   key: string,
 *   force?: boolean,
 * }} DeleteWorldMetadataInstruction
 */

/**
 * @typedef {NoopInstruction | TransferItemInstruction | MovePlayerInstruction | DoorMutationInstruction | OpenDoorInstruction | CloseAndLockDoorInstruction | SetPlayerMetadataInstruction | SetRoomFlagInstruction | SetAreaMetadataInstruction | DeleteRoomMetadataInstruction | DeleteAreaMetadataInstruction | DeleteWorldMetadataInstruction} MutationInstruction
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
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

  const itemRef = entityRef(item) || 'unknown-item';
  const fromRef = entityRef(from) || 'unknown-source';
  const toRef = entityRef(to) || 'unknown-target';
  logMutationVerbose(`TRANSFER: Moving item [${itemRef}] from [${fromRef}] to [${toRef}]`);

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
 * @param {*} entity
 * @returns {string}
 */
function entityRef(entity) {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  if (typeof entity.entityReference === 'string' && entity.entityReference.trim().length > 0) {
    return entity.entityReference.trim();
  }

  if (typeof entity.name === 'string' && entity.name.trim().length > 0) {
    return entity.name.trim();
  }

  return '';
}

/**
 * @param {string} message
 */
function logMutationVerbose(message) {
  if (!Logger || typeof Logger.verbose !== 'function') {
    return;
  }

  Logger.verbose(`    ${message}`);
}

/**
 * @param {SetPlayerMetadataInstruction} instruction
 * @returns {function(): void}
 */
function applySetPlayerMetadataInstruction(instruction) {
  const player = instruction && instruction.player;
  if (!player || typeof player !== 'object' || !isObjectRecord(player.metadata)) {
    throw new TypeError('setPlayerMetadata.player must be an object with metadata.');
  }

  const segments = parsePath(instruction && instruction.key);
  if (!segments) {
    throw new TypeError('setPlayerMetadata.key must be a non-empty safe dot path.');
  }

  const leafKey = segments[segments.length - 1];
  /** @type {Record<string, *>} */
  let cursor = /** @type {Record<string, *>} */ (player.metadata);
  /** @type {Array<{ parent: Record<string, *>, segment: string }>} */
  const createdParents = [];

  for (const segment of segments.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      cursor[segment] = {};
      createdParents.push({ parent: cursor, segment });
    }

    const nextValue = cursor[segment];
    if (!isObjectRecord(nextValue)) {
      throw new TypeError('setPlayerMetadata.path contains non-object intermediate segment.');
    }

    cursor = nextValue;
  }

  const hadLeaf = Object.prototype.hasOwnProperty.call(cursor, leafKey);
  const previousLeaf = cursor[leafKey];
  cursor[leafKey] = instruction.value;

  const playerName = typeof player.name === 'string' && player.name.trim().length > 0
    ? player.name.trim()
    : 'unknown-player';
  logMutationVerbose(`METADATA: Setting player [${playerName}] key [${segments.join('.')}]`);

  return () => {
    if (hadLeaf) {
      cursor[leafKey] = previousLeaf;
    } else {
      delete cursor[leafKey];
    }

    for (let i = createdParents.length - 1; i >= 0; i -= 1) {
      const created = createdParents[i];
      const value = created.parent[created.segment];
      if (!isObjectRecord(value) || Object.keys(value).length !== 0) {
        continue;
      }
      delete created.parent[created.segment];
    }
  };
}

const ROOM_FLAG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROOM_METADATA_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const METADATA_SEGMENT_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * @param {*} key
 * @param {RegExp} segmentPattern
 * @returns {string[] | null}
 */
function parseMetadataPathWithPattern(key, segmentPattern) {
  const segments = parsePath(key);
  if (!segments || segments.some(segment => !segmentPattern.test(segment))) {
    return null;
  }

  return segments;
}

/**
 * @param {*} instruction
 * @param {string} operationName
 * @returns {boolean}
 */
function parseDeleteForce(instruction, operationName) {
  const hasForce = !!instruction && typeof instruction === 'object' && Object.prototype.hasOwnProperty.call(instruction, 'force');
  if (!hasForce) {
    return false;
  }

  if (typeof instruction.force !== 'boolean') {
    throw new TypeError(`${operationName}.force must be a boolean when provided.`);
  }

  return instruction.force === true;
}

/**
 * @typedef {{
 *   deleted: boolean,
 *   parent?: Record<string, *>,
 *   leafKey?: string,
 *   previousValue?: *,
 * }} MetadataDeleteResult
 */

/**
 * @param {Record<string, *>} valuesRoot
 * @param {string[]} segments
 * @param {boolean} force
 * @param {string} operationName
 * @returns {MetadataDeleteResult}
 */
function deleteMetadataPath(valuesRoot, segments, force, operationName) {
  const leafKey = segments[segments.length - 1];
  /** @type {Record<string, *>} */
  let cursor = valuesRoot;

  for (const segment of segments.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { deleted: false };
    }

    const nextCursor = cursor[segment];
    if (!isObjectRecord(nextCursor)) {
      return { deleted: false };
    }

    cursor = nextCursor;
  }

  if (!Object.prototype.hasOwnProperty.call(cursor, leafKey)) {
    return { deleted: false };
  }

  const previousValue = cursor[leafKey];
  if ((isObjectRecord(previousValue) || Array.isArray(previousValue)) && !force) {
    throw new TypeError(`${operationName}.path resolves to non-leaf metadata value. Use force: true to delete non-leaf values.`);
  }

  delete cursor[leafKey];
  return {
    deleted: true,
    parent: cursor,
    leafKey,
    previousValue: snapshotValueForUndo(previousValue),
  };
}

/**
 * @param {GameState} state
 * @param {SetRoomFlagInstruction} instruction
 * @returns {function(): void}
 */
function applySetRoomFlagInstruction(state, instruction) {
  const roomRef = instruction && typeof instruction.roomRef === 'string'
    ? instruction.roomRef.trim()
    : '';
  if (!roomRef) {
    throw new TypeError('setRoomFlag.roomRef must be a non-empty room reference.');
  }

  const key = instruction && typeof instruction.key === 'string'
    ? instruction.key.trim()
    : '';
  if (!ROOM_FLAG_KEY_PATTERN.test(key)) {
    throw new TypeError('setRoomFlag.key must be a safe flag key.');
  }

  if (typeof instruction.value !== 'boolean') {
    throw new TypeError('setRoomFlag.value must be a boolean.');
  }

  const room = resolveRoomByRef(state, roomRef);
  if (!room || typeof room !== 'object') {
    throw new TypeError('setRoomFlag.roomRef could not be resolved to a room.');
  }

  const hadMetadataObject = isObjectRecord(room.metadata);
  const originalMetadata = room.metadata;
  if (!hadMetadataObject) {
    room.metadata = {};
  }

  const metadata = /** @type {Record<string, *>} */ (room.metadata);
  const hadValuesProperty = Object.prototype.hasOwnProperty.call(metadata, 'values');
  const previousValuesRoot = metadata.values;
  const hadValuesObject = isObjectRecord(metadata.values);
  if (!hadValuesObject) {
    metadata.values = {};
  }

  const values = /** @type {Record<string, *>} */ (metadata.values);
  const hadMetadataValue = Object.prototype.hasOwnProperty.call(values, key);
  const previousMetadataValue = values[key];

  values[key] = instruction.value;

  const roomLabel = entityRef(room) || roomRef;
  logMutationVerbose(`ROOMFLAG: Setting room [${roomLabel}] flag [${key}]`);

  return () => {
    if (hadMetadataValue) {
      values[key] = previousMetadataValue;
    } else {
      delete values[key];
    }

    if (!hadValuesObject) {
      const currentValuesRoot = metadata.values;
      if (currentValuesRoot === values && Object.keys(values).length === 0) {
        if (hadValuesProperty) {
          metadata.values = previousValuesRoot;
        } else {
          delete metadata.values;
        }
      }
    }

    if (!hadMetadataObject) {
      room.metadata = originalMetadata;
    }
  };
}

/**
 * @param {*} value
 * @param {WeakSet<object>} [seen]
 * @returns {boolean}
 */
function isJsonSafeValue(value, seen = new WeakSet()) {
  if (value === null) {
    return true;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return true;
  }

  if (valueType === 'number') {
    return Number.isFinite(value);
  }

  if (valueType !== 'object') {
    return false;
  }

  const objectValue = /** @type {object} */ (value);
  if (seen.has(objectValue)) {
    return false;
  }
  seen.add(objectValue);

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isJsonSafeValue(entry, seen)) {
        return false;
      }
    }
    return true;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  for (const key of Object.keys(/** @type {Record<string, *>} */ (value))) {
    if (!isJsonSafeValue(/** @type {Record<string, *>} */ (value)[key], seen)) {
      return false;
    }
  }

  return true;
}

/**
 * @param {*} value
 * @returns {*}
 */
function cloneJsonSafeValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {*} value
 * @returns {*}
 */
function snapshotValueForUndo(value) {
  if (!isJsonSafeValue(value)) {
    return value;
  }

  return cloneJsonSafeValue(value);
}

/**
 * @param {SetAreaMetadataInstruction} instruction
 * @returns {function(): void}
 */
function applySetAreaMetadataInstruction(instruction) {
  const actor = instruction && instruction.actor;
  const room = actor && typeof actor === 'object' && actor.room && typeof actor.room === 'object'
    ? actor.room
    : null;
  const area = room && typeof room === 'object' && room.area && typeof room.area === 'object'
    ? room.area
    : null;
  if (!area) {
    throw new TypeError('setAreaMetadata.actor must resolve to actor.room.area.');
  }

  const segments = parsePath(instruction && instruction.key);
  if (!segments || segments.some(segment => !METADATA_SEGMENT_PATTERN.test(segment))) {
    throw new SyntaxError('setAreaMetadata.key must be a non-empty safe camelCase dot path.');
  }

  if (!Object.prototype.hasOwnProperty.call(instruction, 'value') || instruction.value === undefined) {
    throw new TypeError('setAreaMetadata.value must not be undefined.');
  }

  if (!isJsonSafeValue(instruction.value)) {
    throw new TypeError('setAreaMetadata.value must be JSON-safe.');
  }

  const nextValue = cloneJsonSafeValue(instruction.value);

  const hadMetadataObject = isObjectRecord(area.metadata);
  const originalMetadata = area.metadata;
  if (!hadMetadataObject) {
    area.metadata = {};
  }

  const metadata = /** @type {Record<string, *>} */ (area.metadata);
  const hadValuesProperty = Object.prototype.hasOwnProperty.call(metadata, 'values');
  if (hadValuesProperty && !isObjectRecord(metadata.values)) {
    throw new TypeError('setAreaMetadata.path contains non-object metadata.values root.');
  }

  if (!hadValuesProperty) {
    metadata.values = {};
  }

  const valuesRoot = /** @type {Record<string, *>} */ (metadata.values);
  const leafKey = segments[segments.length - 1];
  /** @type {Record<string, *>} */
  let cursor = valuesRoot;
  /** @type {Array<{ parent: Record<string, *>, segment: string }>} */
  const createdParents = [];

  for (const segment of segments.slice(0, -1)) {
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      cursor[segment] = {};
      createdParents.push({ parent: cursor, segment });
    }

    const nextCursor = cursor[segment];
    if (!isObjectRecord(nextCursor)) {
      throw new TypeError('setAreaMetadata.path contains non-object intermediate segment.');
    }

    cursor = nextCursor;
  }

  const hadLeaf = Object.prototype.hasOwnProperty.call(cursor, leafKey);
  const previousLeaf = hadLeaf
    ? snapshotValueForUndo(cursor[leafKey])
    : undefined;
  if (hadLeaf && isObjectRecord(previousLeaf) && Object.keys(previousLeaf).length > 0) {
    throw new TypeError('setAreaMetadata.path conflicts with existing metadata subtree.');
  }

  cursor[leafKey] = nextValue;

  const areaLabel = entityRef(area) || 'unknown-area';
  logMutationVerbose(`AREAMETA: Setting area [${areaLabel}] key [${segments.join('.')}]`);

  return () => {
    if (hadLeaf) {
      cursor[leafKey] = previousLeaf;
    } else {
      delete cursor[leafKey];
    }

    for (let i = createdParents.length - 1; i >= 0; i -= 1) {
      const created = createdParents[i];
      const value = created.parent[created.segment];
      if (!isObjectRecord(value) || Object.keys(value).length !== 0) {
        continue;
      }
      delete created.parent[created.segment];
    }

    if (!hadValuesProperty && isObjectRecord(metadata.values) && Object.keys(/** @type {Record<string, *>} */ (metadata.values)).length === 0) {
      delete metadata.values;
    }

    if (!hadMetadataObject) {
      area.metadata = originalMetadata;
    }
  };
}

/**
 * @param {GameState} state
 * @param {DeleteRoomMetadataInstruction} instruction
 * @returns {function(): void}
 */
function applyDeleteRoomMetadataInstruction(state, instruction) {
  const roomRef = instruction && typeof instruction.roomRef === 'string'
    ? instruction.roomRef.trim()
    : '';
  if (!roomRef) {
    throw new TypeError('deleteRoomMetadata.roomRef must be a non-empty room reference.');
  }

  const segments = parseMetadataPathWithPattern(instruction && instruction.key, ROOM_METADATA_SEGMENT_PATTERN);
  if (!segments) {
    throw new SyntaxError('deleteRoomMetadata.key must be a non-empty safe dot path.');
  }

  const force = parseDeleteForce(instruction, 'deleteRoomMetadata');

  const room = resolveRoomByRef(state, roomRef);
  if (!room || typeof room !== 'object') {
    throw new TypeError('deleteRoomMetadata.roomRef could not be resolved to a room.');
  }

  const metadata = isObjectRecord(room.metadata)
    ? /** @type {Record<string, *>} */ (room.metadata)
    : null;
  if (!metadata) {
    return () => { };
  }

  const hasValuesProperty = Object.prototype.hasOwnProperty.call(metadata, 'values');
  if (!hasValuesProperty) {
    return () => { };
  }

  if (!isObjectRecord(metadata.values)) {
    throw new TypeError('deleteRoomMetadata.path contains non-object metadata.values root.');
  }

  const deleteResult = deleteMetadataPath(
    /** @type {Record<string, *>} */ (metadata.values),
    segments,
    force,
    'deleteRoomMetadata'
  );
  if (!deleteResult.deleted || !deleteResult.parent || !deleteResult.leafKey) {
    return () => { };
  }

  const previousValue = deleteResult.previousValue;

  const roomLabel = entityRef(room) || roomRef;
  logMutationVerbose(`ROOMMETA: Deleting room [${roomLabel}] key [${segments.join('.')}]`);

  return () => {
    deleteResult.parent[deleteResult.leafKey] = snapshotValueForUndo(previousValue);
  };
}

/**
 * @param {DeleteAreaMetadataInstruction} instruction
 * @returns {function(): void}
 */
function applyDeleteAreaMetadataInstruction(instruction) {
  const actor = instruction && instruction.actor;
  const room = actor && typeof actor === 'object' && actor.room && typeof actor.room === 'object'
    ? actor.room
    : null;
  const area = room && typeof room === 'object' && room.area && typeof room.area === 'object'
    ? room.area
    : null;
  if (!area) {
    throw new TypeError('deleteAreaMetadata.actor must resolve to actor.room.area.');
  }

  const segments = parseMetadataPathWithPattern(instruction && instruction.key, METADATA_SEGMENT_PATTERN);
  if (!segments) {
    throw new SyntaxError('deleteAreaMetadata.key must be a non-empty safe camelCase dot path.');
  }

  const force = parseDeleteForce(instruction, 'deleteAreaMetadata');

  const metadata = isObjectRecord(area.metadata)
    ? /** @type {Record<string, *>} */ (area.metadata)
    : null;
  if (!metadata) {
    return () => { };
  }

  const hasValuesProperty = Object.prototype.hasOwnProperty.call(metadata, 'values');
  if (!hasValuesProperty) {
    return () => { };
  }

  if (!isObjectRecord(metadata.values)) {
    throw new TypeError('deleteAreaMetadata.path contains non-object metadata.values root.');
  }

  const deleteResult = deleteMetadataPath(
    /** @type {Record<string, *>} */ (metadata.values),
    segments,
    force,
    'deleteAreaMetadata'
  );
  if (!deleteResult.deleted || !deleteResult.parent || !deleteResult.leafKey) {
    return () => { };
  }

  const previousValue = deleteResult.previousValue;

  const areaLabel = entityRef(area) || 'unknown-area';
  logMutationVerbose(`AREAMETA: Deleting area [${areaLabel}] key [${segments.join('.')}]`);

  return () => {
    deleteResult.parent[deleteResult.leafKey] = snapshotValueForUndo(previousValue);
  };
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

  const fromRef = entityRef(previousRoom) || 'unknown-room';
  const toRef = entityRef(toRoom) || 'unknown-room';
  if (normalizedDirection) {
    logMutationVerbose(`MOVE: Moving actor [${actorName}] from [${fromRef}] to [${toRef}] direction [${normalizedDirection}]`);
  } else {
    logMutationVerbose(`MOVE: Moving actor [${actorName}] from [${fromRef}] to [${toRef}]`);
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

  if (result.changed === true) {
    const actorLabel = displayActorName(actor);
    const fromRoomRef = entityRef(fromRoom) || 'unknown-room';
    const targetRoomRef = typeof instruction.roomRef === 'string' && instruction.roomRef.trim().length > 0
      ? instruction.roomRef.trim()
      : entityRef(destination) || '';
    const direction = typeof instruction.direction === 'string'
      ? normalizeDirection(instruction.direction)
      : '';

    if (direction) {
      logMutationVerbose(`DOOR: ${instruction.mutation} by actor [${actorLabel}] from [${fromRoomRef}] direction [${direction}]`);
    } else if (targetRoomRef) {
      logMutationVerbose(`DOOR: ${instruction.mutation} by actor [${actorLabel}] from [${fromRoomRef}] to [${targetRoomRef}]`);
    } else {
      logMutationVerbose(`DOOR: ${instruction.mutation} by actor [${actorLabel}] from [${fromRoomRef}]`);
    }
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
    case 'setPlayerMetadata': return applySetPlayerMetadataInstruction(instruction);
    case 'setRoomFlag': return applySetRoomFlagInstruction(state, instruction);
    case 'setAreaMetadata': return applySetAreaMetadataInstruction(instruction);
    case 'deleteRoomMetadata': return applyDeleteRoomMetadataInstruction(state, instruction);
    case 'deleteAreaMetadata': return applyDeleteAreaMetadataInstruction(instruction);

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
