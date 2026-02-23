// @ts-check
'use strict';

const { getRitualState, normalizeRef } = require('../helpers/ritualState');
const CommandDispatch = require('../../../../lib/session/command-dispatch');
const { getPlayerMetadata } = require('../../../../lib/session/player-metadata');

const DEFAULT_ROUTE = Object.freeze([
  'codex:bell_courtyard',
  'codex:bell_nave',
  'codex:bell_stair',
  'codex:bell_nave',
]);

const DEFAULT_PATROL_INTERVAL_MS = 30000;
const DEFAULT_HINT_COOLDOWN_MS = 90000;
const SHARD_REF = 'codex:resonantShard';

const STEP_HINT_BY_KEY = Object.freeze({
  wax_seal_reliquary: 'set the wax seal into the reliquary in the nave',
  prayer_stone_basin: 'place the prayer stone into the basin in the crypt',
  bronze_clapper_bell: 'hang the bronze clapper in the cracked bell in the belfry',
});

/**
 * @param {*} collection
 * @returns {Array<*>}
 */
function toArray(collection) {
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
 * @param {*} npc
 * @returns {{
 *   patrolRoute: string[],
 *   patrolIntervalMs: number,
 *   hintCooldownMs: number,
 * }}
 */
function readConfig(npc) {
  const metadata = npc && npc.metadata && typeof npc.metadata === 'object'
    ? npc.metadata
    : {};
  const tomo = metadata.tomo && typeof metadata.tomo === 'object'
    ? metadata.tomo
    : {};

  const patrolRoute = Array.isArray(tomo.patrolRoute)
    ? tomo.patrolRoute.map(ref => String(ref || '').trim()).filter(Boolean)
    : [...DEFAULT_ROUTE];

  return {
    patrolRoute: patrolRoute.length > 0 ? patrolRoute : [...DEFAULT_ROUTE],
    patrolIntervalMs: Number.isFinite(tomo.patrolIntervalMs) ? Math.max(0, Math.floor(tomo.patrolIntervalMs)) : DEFAULT_PATROL_INTERVAL_MS,
    hintCooldownMs: Number.isFinite(tomo.hintCooldownMs) ? Math.max(0, Math.floor(tomo.hintCooldownMs)) : DEFAULT_HINT_COOLDOWN_MS,
  };
}

/**
 * @param {*} npc
 * @param {{ patrolRoute: string[] }} config
 * @returns {number}
 */
function initialRouteIndex(npc, config) {
  const currentRef = normalizeRef(npc && npc.room && npc.room.entityReference);
  const route = config.patrolRoute;
  if (!currentRef || !route.length) {
    return 0;
  }

  const idx = route.findIndex(ref => normalizeRef(ref) === currentRef);
  return idx >= 0 ? idx : 0;
}

/**
 * @param {*} player
 * @returns {string}
 */
function playerMemoryKey(player) {
  return normalizeRef(player && (player.uuid || player.entityReference || player.name));
}

/**
 * @param {*} npc
 * @param {*} player
 * @returns {Record<string, *>}
 */
function ensurePlayerTomoMemory(npc, player) {
  if (!npc || typeof npc !== 'object' || !player || typeof player !== 'object') {
    return {};
  }

  if (!npc.__tomoRuntime || typeof npc.__tomoRuntime !== 'object') {
    npc.__tomoRuntime = {};
  }

  // TODO(v1-parity): move per-player Tomo memory to a command+mutator persistence path.
  if (!npc.__tomoRuntime.playerMemoryById || typeof npc.__tomoRuntime.playerMemoryById !== 'object') {
    npc.__tomoRuntime.playerMemoryById = {};
  }

  const key = playerMemoryKey(player);
  if (!key) {
    return {};
  }

  if (!npc.__tomoRuntime.playerMemoryById[key] ||
    typeof npc.__tomoRuntime.playerMemoryById[key] !== 'object') {
    npc.__tomoRuntime.playerMemoryById[key] = {};
  }

  const tomoMemory = npc.__tomoRuntime.playerMemoryById[key];
  if (tomoMemory.introShown !== true) {
    tomoMemory.introShown = false;
  }
  if (tomoMemory.completionShown !== true) {
    tomoMemory.completionShown = false;
  }
  if (tomoMemory.galleryRedirectShown !== true) {
    tomoMemory.galleryRedirectShown = false;
  }
  if (!Number.isFinite(tomoMemory.lastHintAt)) {
    tomoMemory.lastHintAt = 0;
  }
  if (!Number.isFinite(tomoMemory.lastProgressCount)) {
    tomoMemory.lastProgressCount = -1;
  }

  return tomoMemory;
}

/**
 * @param {*} player
 * @param {Record<string, *>} runtimeMemory
 * @returns {{
 *   introShown: boolean,
 *   completionShown: boolean,
 *   galleryRedirectShown: boolean,
 *   lastHintAt: number,
 *   lastProgressCount: number,
 * }}
 */
function readPlayerTomoMemory(player, runtimeMemory) {
  const persistedIntroShown = getPlayerMetadata(player, 'tomo.introShown', undefined);
  const persistedCompletionShown = getPlayerMetadata(player, 'tomo.completionShown', undefined);
  const persistedGalleryRedirectShown = getPlayerMetadata(player, 'tomo.galleryRedirectShown', undefined);
  const persistedLastHintAt = getPlayerMetadata(player, 'tomo.lastHintAt', undefined);
  const persistedLastProgressCount = getPlayerMetadata(player, 'tomo.lastProgressCount', undefined);

  return {
    introShown: typeof persistedIntroShown === 'boolean'
      ? persistedIntroShown
      : runtimeMemory.introShown === true,
    completionShown: typeof persistedCompletionShown === 'boolean'
      ? persistedCompletionShown
      : runtimeMemory.completionShown === true,
    galleryRedirectShown: typeof persistedGalleryRedirectShown === 'boolean'
      ? persistedGalleryRedirectShown
      : runtimeMemory.galleryRedirectShown === true,
    lastHintAt: Number.isFinite(persistedLastHintAt)
      ? Number(persistedLastHintAt)
      : Number(runtimeMemory.lastHintAt || 0),
    lastProgressCount: Number.isFinite(persistedLastProgressCount)
      ? Number(persistedLastProgressCount)
      : Number(runtimeMemory.lastProgressCount || -1),
  };
}

/**
 * @param {*} player
 * @param {string} itemRef
 * @returns {boolean}
 */
function playerHasItemRef(player, itemRef) {
  const needle = normalizeRef(itemRef);
  if (!needle) {
    return false;
  }

  for (const item of toArray(player && player.inventory)) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return true;
    }
  }

  return false;
}

/**
 * @param {*} state
 * @param {*} npc
 * @param {string} line
 */
async function speakViaCommandDispatch(state, npc, line) {
  if (!npc || typeof npc !== 'object' || typeof line !== 'string' || line.length === 0) {
    return { ok: false, error: { code: 'NPC_SAY_INVALID' } };
  }

  return CommandDispatch.dispatchNpcIntent(state, npc, {
    kind: 'structured',
    verb: 'say',
    direct: [line],
  });
}

/**
 * @returns {string}
 */
function introLine() {
  return 'Three offerings wake this tower: seal to reliquary, stone to basin, clapper to bell.';
}

/**
 * @param {Array<{ key: string }>} missingSteps
 * @returns {string}
 */
function progressLine(missingSteps) {
  const phrases = missingSteps
    .map(step => STEP_HINT_BY_KEY[step.key] || '')
    .filter(Boolean);

  if (phrases.length === 0) {
    return 'The rite is balanced.';
  }

  if (phrases.length === 1) {
    return `Only one offering remains: ${phrases[0]}.`;
  }

  if (phrases.length === 2) {
    return `You still need to ${phrases[0]}, and ${phrases[1]}.`;
  }

  return 'Start with the reliquary, then the basin, then the bell.';
}

/**
 * @returns {string}
 */
function completionLine() {
  return 'The descent is open. Go down from the crypt and see what answered the rite.';
}

/**
 * @returns {string}
 */
function galleryRedirectLine() {
  return 'Take that resonant shard east to the Perception Gallery. The mirrors will answer it.';
}

/**
 * @param {*} state
 * @param {*} npc
 * @param {*} player
 */
async function maybeGuidePlayer(state, npc, player) {
  if (!player || typeof player !== 'object') {
    return;
  }

  const runtimeMemory = ensurePlayerTomoMemory(npc, player);
  const memory = readPlayerTomoMemory(player, runtimeMemory);
  const now = Date.now();
  const config = npc && npc.__tomoConfig ? npc.__tomoConfig : readConfig(npc);
  const ritual = getRitualState(state);

  if (!memory.introShown) {
    await speakViaCommandDispatch(state, npc, introLine());
    runtimeMemory.introShown = true;
    return;
  }

  if (ritual.isComplete && !memory.completionShown) {
    await speakViaCommandDispatch(state, npc, completionLine());
    runtimeMemory.completionShown = true;
    runtimeMemory.lastProgressCount = 3;
    return;
  }

  if (ritual.isComplete && memory.completionShown && !memory.galleryRedirectShown && playerHasItemRef(player, SHARD_REF)) {
    await speakViaCommandDispatch(state, npc, galleryRedirectLine());
    runtimeMemory.galleryRedirectShown = true;
    return;
  }

  if (!ritual.isComplete && memory.lastProgressCount !== ritual.completedCount) {
    await speakViaCommandDispatch(state, npc, progressLine(ritual.missingSteps));
    runtimeMemory.lastProgressCount = ritual.completedCount;
    runtimeMemory.lastHintAt = now;
    return;
  }

  const elapsed = now - Number(memory.lastHintAt || 0);
  if (elapsed < config.hintCooldownMs) {
    return;
  }

  if (!ritual.isComplete) {
    await speakViaCommandDispatch(state, npc, progressLine(ritual.missingSteps));
    runtimeMemory.lastProgressCount = ritual.completedCount;
    runtimeMemory.lastHintAt = now;
  }
}

/**
 * @param {*} room
 * @returns {boolean}
 */
function roomHasPlayers(room) {
  return toArray(room && room.players).length > 0;
}

/**
 * @param {*} room
 * @returns {Array<*>}
 */
function roomExits(room) {
  if (!room || typeof room !== 'object') {
    return [];
  }

  if (typeof room.getExits === 'function') {
    return toArray(room.getExits());
  }

  return Array.isArray(room.exits) ? room.exits : [];
}

/**
 * @param {*} room
 * @param {string} destinationRoomRef
 * @returns {string}
 */
function resolveDirectionToRoom(room, destinationRoomRef) {
  const destinationRef = normalizeRef(destinationRoomRef);
  if (!destinationRef) {
    return '';
  }

  for (const exit of roomExits(room)) {
    if (!exit || typeof exit !== 'object') {
      continue;
    }
    if (normalizeRef(exit.roomId) !== destinationRef) {
      continue;
    }

    const direction = String(exit.direction || '').trim().toLowerCase();
    if (direction) {
      return direction;
    }
  }

  return '';
}

/**
 * @param {*} state
 * @param {*} npc
 */
async function maybePatrol(state, npc) {
  const runtime = npc && npc.__tomoRuntime && typeof npc.__tomoRuntime === 'object'
    ? npc.__tomoRuntime
    : null;
  const config = npc && npc.__tomoConfig && typeof npc.__tomoConfig === 'object'
    ? npc.__tomoConfig
    : null;
  if (!runtime || !config) {
    return;
  }

  const now = Date.now();
  if (now - runtime.lastMoveAt < config.patrolIntervalMs) {
    return;
  }

  if (roomHasPlayers(npc && npc.room)) {
    return;
  }

  const nextIndex = (runtime.routeIndex + 1) % config.patrolRoute.length;
  const nextRoomRef = config.patrolRoute[nextIndex];
  const roomManager = state && state.RoomManager;
  if (!roomManager || typeof roomManager.getRoom !== 'function') {
    return;
  }

  const nextRoom = roomManager.getRoom(nextRoomRef);
  if (!nextRoom) {
    return;
  }

  const direction = resolveDirectionToRoom(npc && npc.room, nextRoomRef);
  if (!direction) {
    runtime.lastPatrolError = {
      code: 'UNSUPPORTED_MUTATION_OP',
      details: {
        operation: 'tomo.patrol.go',
        reason: 'NO_DIRECTION_TO_NEXT_ROOM',
        nextRoomRef,
      },
    };
    return runtime.lastPatrolError;
  }

  const result = await CommandDispatch.dispatchNpcIntent(state, npc, {
    kind: 'structured',
    verb: 'go',
    direct: [direction],
    relationToken: null,
    indirect: [],
  });

  if (!result || result.ok !== true) {
    runtime.lastPatrolError = result && typeof result === 'object' && result.error
      ? result.error
      : { code: 'UNSUPPORTED_MUTATION_OP' };
    return result;
  }

  runtime.routeIndex = nextIndex;
  runtime.lastMoveAt = now;
  runtime.lastPatrolError = null;
  return result;
}

/**
 * @param {*} state
 * @returns {function(): void}
 */
function createSpawnListener(state) {
  void state;
  return function onSpawn() {
    const config = readConfig(this);
    this.__tomoConfig = config;
    this.__tomoRuntime = {
      routeIndex: initialRouteIndex(this, config),
      lastMoveAt: 0,
      playerMemoryById: {},
      // TODO(v1-parity): replace runtime-only Tomo memory with persisted command+mutator memory operations.
      lastPatrolError: null,
    };
  };
}

/**
 * @param {*} state
 * @returns {function(*, *): void}
 */
function createPlayerEnterListener(state) {
  return async function onPlayerEnter(player, prevRoom) {
    void prevRoom;
    await maybeGuidePlayer(state, this, player);
  };
}

/**
 * @param {*} state
 * @returns {function(): void}
 */
function createUpdateTickListener(state) {
  return async function onUpdateTick() {
    await maybePatrol(state, this);
  };
}

module.exports = {
  listeners: {
    spawn: state => createSpawnListener(state),
    playerEnter: state => createPlayerEnterListener(state),
    updateTick: state => createUpdateTickListener(state),
  },
};
