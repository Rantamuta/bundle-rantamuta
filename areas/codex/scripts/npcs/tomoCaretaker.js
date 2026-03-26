// @ts-check
'use strict';

const { getRitualState, normalizeRef } = require('../helpers/ritualState');
const CommandDispatch = require('../../../../lib/runtime/command/command-dispatch');
const { getPlayerMetadata } = require('../../../../lib/runtime/mutation/player-metadata');

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
 * @returns {{
 *   introShown: boolean,
 *   completionShown: boolean,
 *   galleryRedirectShown: boolean,
 *   lastHintAt: number,
 *   lastProgressCount: number,
 *   playerToken: string,
 * }}
 */
function readPlayerTomoMemory(player) {
  const introShown = getPlayerMetadata(player, 'tomo.introShown', false) === true;
  const completionShown = getPlayerMetadata(player, 'tomo.completionShown', false) === true;
  const galleryRedirectShown = getPlayerMetadata(player, 'tomo.galleryRedirectShown', false) === true;
  const lastHintAt = Number(getPlayerMetadata(player, 'tomo.lastHintAt', 0));
  const lastProgressCount = Number(getPlayerMetadata(player, 'tomo.lastProgressCount', -1));
  const playerToken = String(
    (player && (player.name || player.uuid || normalizeRef(player.entityReference))) || ''
  ).trim();

  return {
    introShown,
    completionShown,
    galleryRedirectShown,
    lastHintAt: Number.isFinite(lastHintAt) ? lastHintAt : 0,
    lastProgressCount: Number.isFinite(lastProgressCount) ? lastProgressCount : -1,
    playerToken,
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
 * @param {*} npc
 * @param {*} player
 * @param {string} key
 * @param {*} value
 */
function queueTomoMemoryWrite(npc, player, key, value) {
  if (!npc || typeof npc !== 'object' || !player || typeof player !== 'object') {
    return;
  }

  const runtime = npc.__tomoRuntime && typeof npc.__tomoRuntime === 'object'
    ? npc.__tomoRuntime
    : null;
  if (!runtime) {
    return;
  }

  if (!Array.isArray(runtime.pendingMetadataWrites)) {
    runtime.pendingMetadataWrites = [];
  }

  runtime.pendingMetadataWrites.push({
    player,
    key: `tomo.${String(key || '').trim()}`,
    value,
  });
}

/**
 * @param {*} npc
 * @param {string} verbId
 * @returns {{ plan: { operations: Array<{ type: string, player: *, key: string, value: * }> } } | null}
 */
function contributePendingTomoMetadataWrites(npc, verbId) {
  if (verbId !== 'say' || !npc || typeof npc !== 'object') {
    return null;
  }

  const runtime = npc.__tomoRuntime && typeof npc.__tomoRuntime === 'object'
    ? npc.__tomoRuntime
    : null;
  if (!runtime || !Array.isArray(runtime.pendingMetadataWrites) || runtime.pendingMetadataWrites.length === 0) {
    return null;
  }

  const operations = runtime.pendingMetadataWrites
    .filter(write => write && typeof write === 'object' && write.player && typeof write.key === 'string' && write.key.length > 0)
    .map(write => ({
      type: 'setPlayerMetadata',
      player: write.player,
      key: write.key,
      value: write.value,
    }));

  runtime.pendingMetadataWrites = [];
  if (operations.length === 0) {
    return null;
  }

  return {
    plan: {
      operations,
    },
  };
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

  const memory = readPlayerTomoMemory(player);
  const now = Date.now();
  const config = npc && npc.__tomoConfig ? npc.__tomoConfig : readConfig(npc);
  const ritual = getRitualState(state);

  if (!memory.introShown) {
    queueTomoMemoryWrite(npc, player, 'introShown', true);
    await speakViaCommandDispatch(state, npc, introLine());
    return;
  }

  if (ritual.isComplete && !memory.completionShown) {
    queueTomoMemoryWrite(npc, player, 'completionShown', true);
    queueTomoMemoryWrite(npc, player, 'lastProgressCount', 3);
    await speakViaCommandDispatch(state, npc, completionLine());
    return;
  }

  if (ritual.isComplete && memory.completionShown && !memory.galleryRedirectShown && playerHasItemRef(player, SHARD_REF)) {
    queueTomoMemoryWrite(npc, player, 'galleryRedirectShown', true);
    await speakViaCommandDispatch(state, npc, galleryRedirectLine());
    return;
  }

  if (!ritual.isComplete && memory.lastProgressCount !== ritual.completedCount) {
    queueTomoMemoryWrite(npc, player, 'lastProgressCount', ritual.completedCount);
    queueTomoMemoryWrite(npc, player, 'lastHintAt', now);
    await speakViaCommandDispatch(state, npc, progressLine(ritual.missingSteps));
    return;
  }

  const elapsed = now - Number(memory.lastHintAt || 0);
  if (elapsed < config.hintCooldownMs) {
    return;
  }

  if (!ritual.isComplete) {
    queueTomoMemoryWrite(npc, player, 'lastProgressCount', ritual.completedCount);
    queueTomoMemoryWrite(npc, player, 'lastHintAt', now);
    await speakViaCommandDispatch(state, npc, progressLine(ritual.missingSteps));
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
      lastPatrolError: null,
      pendingMetadataWrites: [],
    };
    this.planActor = function tomoPlanActor(actor, verbId, context) {
      void actor;
      void context;
      return contributePendingTomoMetadataWrites(this, verbId);
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
