// @ts-check
'use strict';

const {
  createTransposeSuccess,
  createTransposeFailure,
} = require('./contracts');
const {
  resolveScopedReference,
  expandRoomRef,
  resolveRoomReference,
} = require('./reference-resolution');
const { validateAuthoredEffects } = require('./validator');

/** @type {Record<string, (payload: Record<string, *>, scope: Record<string, *>) => import('./contracts').AuthoredEffectsTransposeSuccess | import('./contracts').AuthoredEffectsTransposeFailure>} */
const LOWERERS = Object.create(null);

/**
 * @typedef {{
 *   actor: *,
 *   mutation?: string,
 *   fromRoomRef?: string,
 *   direction?: string,
 *   roomRef?: string,
 * }} LoweredDoorFields
 */

/**
 * @param {string} effectName
 * @param {string} field
 * @param {*} value
 * @param {Record<string, *>} scope
 * @returns {* | import('./contracts').AuthoredEffectsTransposeFailure}
 */
function requireReference(effectName, field, value, scope) {
  const resolved = resolveScopedReference(scope, value);
  if (resolved !== null) {
    return resolved;
  }

  return createTransposeFailure(
    'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
    `${effectName}.${field} could not be resolved from authored-effects scope.`,
    { effectName, field, value }
  );
}

/**
 * @param {import('./contracts').AuthoredEffectsTransposeSuccess} target
 * @param {import('./contracts').AuthoredEffectsTransposeSuccess} source
 */
function appendSuccess(target, source) {
  target.operations.push(...source.operations);
  target.renderMessages.push(...source.renderMessages);
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {*} value
 * @returns {*}
 */
function clonePayload(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {* | import('./contracts').AuthoredEffectsTransposeFailure} value
 * @returns {value is import('./contracts').AuthoredEffectsTransposeFailure}
 */
function isTransposeFailure(value) {
  return !!value && typeof value === 'object' && value.ok === false;
}

/**
 * @param {string} effectName
 * @param {string} field
 * @param {*} value
 * @param {Record<string, *>} scope
 * @returns {string | import('./contracts').AuthoredEffectsTransposeFailure}
 */
function requireExpandedRoomRef(effectName, field, value, scope) {
  const roomRef = expandRoomRef(scope, value);
  if (roomRef && resolveRoomReference(scope, value) !== null) {
    return roomRef;
  }

  return createTransposeFailure(
    'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
    `${effectName}.${field} could not be resolved from authored-effects scope.`,
    { effectName, field, value }
  );
}

/**
 * @param {string} effectName
 * @param {{ actor?: *, mutation?: *, fromRoomRef?: *, direction?: *, roomRef?: * }} payload
 * @param {Record<string, *>} scope
 * @returns {import('./contracts').AuthoredEffectsTransposeFailure | LoweredDoorFields}
 */
function lowerDoorFields(effectName, payload, scope) {
  const actor = payload.actor !== undefined
    ? resolveScopedReference(scope, payload.actor)
    : resolveScopedReference(scope, 'actor');
  if (actor === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      `${effectName}.actor could not be resolved from authored-effects scope.`,
      { effectName, field: 'actor', value: payload.actor }
    );
  }

  let fromRoomRef;
  if (payload.fromRoomRef !== undefined) {
    fromRoomRef = requireExpandedRoomRef(effectName, 'fromRoomRef', payload.fromRoomRef, scope);
    if (isTransposeFailure(fromRoomRef)) {
      return fromRoomRef;
    }
  }

  let roomRef;
  if (payload.roomRef !== undefined) {
    roomRef = requireExpandedRoomRef(effectName, 'roomRef', payload.roomRef, scope);
    if (isTransposeFailure(roomRef)) {
      return roomRef;
    }
  }

  return {
    actor,
    ...(normalizeText(payload.mutation) ? { mutation: normalizeText(payload.mutation) } : {}),
    ...(fromRoomRef ? { fromRoomRef } : {}),
    ...(normalizeText(payload.direction) ? { direction: normalizeText(payload.direction) } : {}),
    ...(roomRef ? { roomRef } : {}),
  };
}

/**
 * @param {string} effectName
 * @param {{ actor?: *, roomRef?: * }} payload
 * @param {Record<string, *>} scope
 * @returns {import('./contracts').AuthoredEffectsTransposeFailure | *}
 */
function resolveMetadataActor(effectName, payload, scope) {
  if (payload.roomRef !== undefined) {
    const room = resolveRoomReference(scope, payload.roomRef);
    if (room === null) {
      return createTransposeFailure(
        'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
        `${effectName}.roomRef could not be resolved from authored-effects scope.`,
        { effectName, field: 'roomRef', value: payload.roomRef }
      );
    }

    return { room };
  }

  const actor = payload.actor !== undefined
    ? resolveScopedReference(scope, payload.actor)
    : resolveScopedReference(scope, 'actor');
  if (actor !== null) {
    return actor;
  }

  return createTransposeFailure(
    'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
    `${effectName}.actor could not be resolved from authored-effects scope.`,
    { effectName, field: 'actor', value: payload.actor }
  );
}

/**
 * Generic authored-effects transposer entrypoint.
 *
 * @param {{
 *   effects: Array<*>,
 *   scope: Record<string, *>,
 * }} input
 * @returns {import('./contracts').AuthoredEffectsTransposeSuccess | import('./contracts').AuthoredEffectsTransposeFailure}
 */
function transposeAuthoredEffects(input) {
  const effects = input && typeof input === 'object' && Array.isArray(input.effects)
    ? input.effects
    : input && typeof input === 'object'
      ? input.effects
      : undefined;
  const scope = input && typeof input === 'object' && input.scope && typeof input.scope === 'object'
    ? input.scope
    : {};

  const validation = validateAuthoredEffects(effects);
  if (!validation.ok) {
    return createTransposeFailure(
      'AUTHORED_EFFECTS_INVALID',
      'Authored effects failed validation.',
      { errors: validation.errors }
    );
  }

  const output = createTransposeSuccess();
  for (const entry of effects) {
    const effectName = Object.keys(entry)[0];
    const lowerEffect = LOWERERS[effectName];
    if (!lowerEffect) {
      return createTransposeFailure(
        'AUTHORED_EFFECT_LOWERING_MISSING',
        `No lowering is registered for authored effect "${effectName}".`,
        { effectName }
      );
    }

    const lowered = lowerEffect(entry[effectName], scope);
    if (!lowered.ok) {
      return lowered;
    }

    appendSuccess(output, lowered);
  }

  return output;
}

LOWERERS.transferItem = function lowerTransferItem(payload, scope) {
  const item = requireReference('transferItem', 'item', payload.item, scope);
  if (item && item.ok === false) {
    return item;
  }

  const from = requireReference('transferItem', 'from', payload.from, scope);
  if (from && from.ok === false) {
    return from;
  }

  const to = requireReference('transferItem', 'to', payload.to, scope);
  if (to && to.ok === false) {
    return to;
  }

  return createTransposeSuccess([
    {
      type: 'transferItem',
      item,
      from,
      to,
    },
  ]);
};

LOWERERS.movePlayer = function lowerMovePlayer(payload, scope) {
  const player = payload.player !== undefined
    ? resolveScopedReference(scope, payload.player)
    : resolveScopedReference(scope, 'player');
  if (player === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      'movePlayer.player could not be resolved from authored-effects scope.',
      { effectName: 'movePlayer', field: 'player', value: payload.player }
    );
  }

  const toRoom = resolveRoomReference(scope, payload.toRoom);
  if (toRoom === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      'movePlayer.toRoom could not be resolved from authored-effects scope.',
      { effectName: 'movePlayer', field: 'toRoom', value: payload.toRoom }
    );
  }

  return createTransposeSuccess([
    {
      type: 'movePlayer',
      player,
      toRoom,
      ...(normalizeText(payload.direction) ? { direction: normalizeText(payload.direction) } : {}),
      ...(typeof payload.suppressRoomBroadcast === 'boolean'
        ? { suppressRoomBroadcast: payload.suppressRoomBroadcast }
        : {}),
    },
  ]);
};

LOWERERS.operateDoor = function lowerOperateDoor(payload, scope) {
  const lowered = lowerDoorFields('operateDoor', payload, scope);
  if (isTransposeFailure(lowered)) {
    return lowered;
  }

  return createTransposeSuccess([
    {
      type: 'operateDoor',
      ...lowered,
    },
  ]);
};

LOWERERS.openDoor = function lowerOpenDoor(payload, scope) {
  const lowered = lowerDoorFields('openDoor', payload, scope);
  if (isTransposeFailure(lowered)) {
    return lowered;
  }

  return createTransposeSuccess([
    {
      type: 'openDoor',
      actor: lowered.actor,
      ...(lowered.fromRoomRef ? { fromRoomRef: lowered.fromRoomRef } : {}),
      ...(lowered.direction ? { direction: lowered.direction } : {}),
      ...(lowered.roomRef ? { roomRef: lowered.roomRef } : {}),
    },
  ]);
};

LOWERERS.closeAndLockDoor = function lowerCloseAndLockDoor(payload, scope) {
  const lowered = lowerDoorFields('closeAndLockDoor', payload, scope);
  if (isTransposeFailure(lowered)) {
    return lowered;
  }

  return createTransposeSuccess([
    {
      type: 'closeAndLockDoor',
      actor: lowered.actor,
      ...(lowered.fromRoomRef ? { fromRoomRef: lowered.fromRoomRef } : {}),
      ...(lowered.direction ? { direction: lowered.direction } : {}),
      ...(lowered.roomRef ? { roomRef: lowered.roomRef } : {}),
    },
  ]);
};

LOWERERS.setPlayerMetadata = function lowerSetPlayerMetadata(payload, scope) {
  const player = payload.player !== undefined
    ? resolveScopedReference(scope, payload.player)
    : resolveScopedReference(scope, 'player');
  if (player === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      'setPlayerMetadata.player could not be resolved from authored-effects scope.',
      { effectName: 'setPlayerMetadata', field: 'player', value: payload.player }
    );
  }

  return createTransposeSuccess([
    {
      type: 'setPlayerMetadata',
      player,
      key: payload.key,
      value: payload.value,
    },
  ]);
};

LOWERERS.setRoomMetadata = function lowerSetRoomMetadata(payload, scope) {
  const actor = resolveMetadataActor('setRoomMetadata', payload, scope);
  if (actor && actor.ok === false) {
    return actor;
  }

  return createTransposeSuccess([
    {
      type: 'setRoomMetadata',
      actor,
      key: payload.key,
      value: payload.value,
    },
  ]);
};

LOWERERS.setAreaMetadata = function lowerSetAreaMetadata(payload, scope) {
  const actor = resolveMetadataActor('setAreaMetadata', payload, scope);
  if (actor && actor.ok === false) {
    return actor;
  }

  return createTransposeSuccess([
    {
      type: 'setAreaMetadata',
      actor,
      key: payload.key,
      value: payload.value,
    },
  ]);
};

LOWERERS.setWorldMetadata = function lowerSetWorldMetadata(payload) {
  return createTransposeSuccess([
    {
      type: 'setWorldMetadata',
      key: payload.key,
      value: payload.value,
    },
  ]);
};

LOWERERS.deleteRoomMetadata = function lowerDeleteRoomMetadata(payload, scope) {
  const actor = resolveMetadataActor('deleteRoomMetadata', payload, scope);
  if (actor && actor.ok === false) {
    return actor;
  }

  return createTransposeSuccess([
    {
      type: 'deleteRoomMetadata',
      actor,
      key: payload.key,
      ...(payload.force !== undefined ? { force: payload.force } : {}),
    },
  ]);
};

LOWERERS.deleteAreaMetadata = function lowerDeleteAreaMetadata(payload, scope) {
  const actor = resolveMetadataActor('deleteAreaMetadata', payload, scope);
  if (actor && actor.ok === false) {
    return actor;
  }

  return createTransposeSuccess([
    {
      type: 'deleteAreaMetadata',
      actor,
      key: payload.key,
      ...(payload.force !== undefined ? { force: payload.force } : {}),
    },
  ]);
};

LOWERERS.deleteWorldMetadata = function lowerDeleteWorldMetadata(payload) {
  return createTransposeSuccess([
    {
      type: 'deleteWorldMetadata',
      key: payload.key,
      ...(payload.force !== undefined ? { force: payload.force } : {}),
    },
  ]);
};

LOWERERS.broadcast = function lowerBroadcast(payload, scope) {
  let targetRoomRef;
  if (payload.targetRoomRef !== undefined) {
    targetRoomRef = requireExpandedRoomRef('broadcast', 'targetRoomRef', payload.targetRoomRef, scope);
    if (isTransposeFailure(targetRoomRef)) {
      return targetRoomRef;
    }
  }

  let exceptRoomRef;
  if (payload.exceptRoomRef !== undefined) {
    exceptRoomRef = requireExpandedRoomRef('broadcast', 'exceptRoomRef', payload.exceptRoomRef, scope);
    if (isTransposeFailure(exceptRoomRef)) {
      return exceptRoomRef;
    }
  }

  return createTransposeSuccess([], [
    {
      type: 'broadcast',
      audience: payload.audience,
      message: payload.message,
      ...(payload.targetSelector !== undefined ? { targetSelector: payload.targetSelector } : {}),
      ...(targetRoomRef ? { targetRoomRef } : {}),
      ...(payload.exceptSelector !== undefined ? { exceptSelector: payload.exceptSelector } : {}),
      ...(exceptRoomRef ? { exceptRoomRef } : {}),
    },
  ]);
};

LOWERERS.semanticEvent = function lowerSemanticEvent(payload) {
  return createTransposeSuccess([], [
    {
      type: 'semanticEvent',
      ...clonePayload(payload),
    },
  ]);
};

module.exports = {
  LOWERERS,
  transposeAuthoredEffects,
};
