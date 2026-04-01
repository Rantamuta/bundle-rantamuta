// @ts-check
'use strict';

const {
  createValidationSuccess,
  createValidationFailure,
} = require('./contracts');

const DOOR_MUTATIONS = new Set([
  'open',
  'close',
  'unlock',
  'unlockAndOpen',
  'closeAndLock',
]);

const BROADCAST_AUDIENCES = new Set([
  'player',
  'room',
  'area',
  'areaExceptTargets',
]);

const TARGET_SELECTORS = new Set([
  'currentPlayer',
  'currentRoom',
  'currentArea',
  'roomByRef',
]);

const EXCEPT_SELECTORS = new Set([
  'currentRoomTargets',
  'targetsByRoomRef',
]);

const AUDIENCE_POLICIES = new Set([
  'self',
  'others',
  'self_and_others',
  'self_target_and_others',
  'target_and_others',
]);

const ACTOR_SELECTORS = new Set([
  'currentActor',
  'currentPlayer',
]);

const CONTEXT_ROLE_SELECTORS = new Set([
  'entityByContextRole',
]);

const CONTEXT_ROLES = new Set([
  'directTarget',
  'indirectTarget',
]);

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string} code
 * @param {string} message
 * @param {string | undefined} source
 * @param {Record<string, *>} [details]
 */
function pushError(errors, code, message, source, details) {
  errors.push({
    code,
    message,
    ...(source ? { source } : {}),
    ...(details ? { details } : {}),
  });
}

/**
 * @param {*} value
 * @returns {value is boolean}
 */
function isBoolean(value) {
  return typeof value === 'boolean';
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} effectName
 * @returns {boolean}
 */
function requireTextField(payload, field, errors, source, effectName) {
  if (normalizeText(payload[field])) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_REQUIRED',
    `${effectName}.${field} is required.`,
    source,
    { effectName, field }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {Set<string>} allowed
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} effectName
 * @returns {boolean}
 */
function requireEnumField(payload, field, allowed, errors, source, effectName) {
  const value = normalizeText(payload[field]);
  if (!value) {
    pushError(
      errors,
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      `${effectName}.${field} is required.`,
      source,
      { effectName, field }
    );
    return false;
  }

  if (allowed.has(value)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_ENUM_INVALID',
    `${effectName}.${field} must be one of: ${Array.from(allowed).join(', ')}.`,
    source,
    { effectName, field, value }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} effectName
 */
function requireDefinedField(payload, field, errors, source, effectName) {
  if (payload[field] !== undefined) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_REQUIRED',
    `${effectName}.${field} is required.`,
    source,
    { effectName, field }
  );
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} effectName
 */
function validateOptionalBoolean(payload, field, errors, source, effectName) {
  if (payload[field] === undefined || isBoolean(payload[field])) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_BOOLEAN_REQUIRED',
    `${effectName}.${field} must be a boolean when provided.`,
    source,
    { effectName, field }
  );
}

/**
 * @param {*} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} effectName
 * @returns {payload is Record<string, *>}
 */
function requirePayloadObject(payload, errors, source, effectName) {
  if (isObjectRecord(payload)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_PAYLOAD_OBJECT_REQUIRED',
    `${effectName} payload must be an object.`,
    source,
    { effectName }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateTransferItem(payload, errors, source) {
  requireTextField(payload, 'item', errors, source, 'transferItem');
  requireTextField(payload, 'from', errors, source, 'transferItem');
  requireTextField(payload, 'to', errors, source, 'transferItem');
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMovePlayer(payload, errors, source) {
  requireTextField(payload, 'toRoom', errors, source, 'movePlayer');
}

/**
 * @param {Record<string, *>} payload
 * @param {string} effectName
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateDoorTargeting(payload, effectName, errors, source) {
  const hasDirection = normalizeText(payload.direction);
  const hasRoomRef = normalizeText(payload.roomRef);

  if (hasDirection || hasRoomRef) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_REQUIRED',
    `${effectName} requires direction or roomRef.`,
    source,
    { effectName, fields: ['direction', 'roomRef'] }
  );
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateOperateDoor(payload, errors, source) {
  requireEnumField(payload, 'mutation', DOOR_MUTATIONS, errors, source, 'operateDoor');
  validateDoorTargeting(payload, 'operateDoor', errors, source);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} effectName
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateSimpleDoorOp(payload, effectName, errors, source) {
  validateDoorTargeting(payload, effectName, errors, source);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} effectName
 * @param {boolean} requireActor
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMetadataSet(payload, effectName, requireActor, errors, source) {
  if (requireActor) {
    requireTextField(payload, 'actor', errors, source, effectName);
  }

  requireTextField(payload, 'key', errors, source, effectName);
  requireDefinedField(payload, 'value', errors, source, effectName);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} effectName
 * @param {boolean} requireActor
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMetadataDelete(payload, effectName, requireActor, errors, source) {
  if (requireActor) {
    requireTextField(payload, 'actor', errors, source, effectName);
  }

  requireTextField(payload, 'key', errors, source, effectName);
  validateOptionalBoolean(payload, 'force', errors, source, effectName);
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateBroadcast(payload, errors, source) {
  requireEnumField(payload, 'audience', BROADCAST_AUDIENCES, errors, source, 'broadcast');
  requireTextField(payload, 'message', errors, source, 'broadcast');

  const targetSelector = payload.targetSelector;
  if (targetSelector !== undefined) {
    const validSelector = requireEnumField(
      payload,
      'targetSelector',
      TARGET_SELECTORS,
      errors,
      source,
      'broadcast'
    );
    if (validSelector && normalizeText(targetSelector) === 'roomByRef') {
      requireTextField(payload, 'targetRoomRef', errors, source, 'broadcast');
    }
  }

  const exceptSelector = payload.exceptSelector;
  if (exceptSelector !== undefined) {
    const validSelector = requireEnumField(
      payload,
      'exceptSelector',
      EXCEPT_SELECTORS,
      errors,
      source,
      'broadcast'
    );
    if (validSelector && normalizeText(exceptSelector) === 'targetsByRoomRef') {
      requireTextField(payload, 'exceptRoomRef', errors, source, 'broadcast');
    }
  }
}

/**
 * @param {*} participant
 * @param {string} participantName
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 * @returns {participant is Record<string, *>}
 */
function requireParticipantObject(participant, participantName, errors, source) {
  if (isObjectRecord(participant)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_EFFECT_FIELD_REQUIRED',
    `semanticEvent.participants.${participantName} is required.`,
    source,
    { effectName: 'semanticEvent', field: `participants.${participantName}` }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredEffectsFinding[]} errors
 * @param {string | undefined} source
 */
function validateSemanticEvent(payload, errors, source) {
  const hasTemplate = requireTextField(payload, 'template', errors, source, 'semanticEvent');
  requireEnumField(payload, 'audiencePolicy', AUDIENCE_POLICIES, errors, source, 'semanticEvent');

  if (!hasTemplate) {
    return;
  }

  if (!isObjectRecord(payload.participants)) {
    pushError(
      errors,
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'semanticEvent.participants.actor is required.',
      source,
      { effectName: 'semanticEvent', field: 'participants.actor' }
    );
    return;
  }

  if (!requireParticipantObject(payload.participants.actor, 'actor', errors, source)) {
    return;
  }

  requireEnumField(
    payload.participants.actor,
    'selector',
    ACTOR_SELECTORS,
    errors,
    source,
    'semanticEvent.participants.actor'
  );

  for (const participantName of ['target', 'direct', 'indirect']) {
    const participant = payload.participants[participantName];
    if (participant === undefined) {
      continue;
    }

    if (!isObjectRecord(participant)) {
      pushError(
        errors,
        'AUTHORED_EFFECT_PAYLOAD_OBJECT_REQUIRED',
        `semanticEvent.participants.${participantName} must be an object.`,
        source,
        { effectName: 'semanticEvent', field: `participants.${participantName}` }
      );
      continue;
    }

    requireEnumField(
      participant,
      'selector',
      CONTEXT_ROLE_SELECTORS,
      errors,
      source,
      `semanticEvent.participants.${participantName}`
    );
    requireEnumField(
      participant,
      'role',
      CONTEXT_ROLES,
      errors,
      source,
      `semanticEvent.participants.${participantName}`
    );
  }
}

const VALIDATORS = {
  transferItem: validateTransferItem,
  movePlayer: validateMovePlayer,
  operateDoor: validateOperateDoor,
  openDoor(payload, errors, source) {
    validateSimpleDoorOp(payload, 'openDoor', errors, source);
  },
  closeAndLockDoor(payload, errors, source) {
    validateSimpleDoorOp(payload, 'closeAndLockDoor', errors, source);
  },
  setPlayerMetadata(payload, errors, source) {
    validateMetadataSet(payload, 'setPlayerMetadata', false, errors, source);
  },
  setRoomMetadata(payload, errors, source) {
    validateMetadataSet(payload, 'setRoomMetadata', false, errors, source);
  },
  setAreaMetadata(payload, errors, source) {
    validateMetadataSet(payload, 'setAreaMetadata', false, errors, source);
  },
  setWorldMetadata(payload, errors, source) {
    validateMetadataSet(payload, 'setWorldMetadata', false, errors, source);
  },
  deleteRoomMetadata(payload, errors, source) {
    validateMetadataDelete(payload, 'deleteRoomMetadata', false, errors, source);
  },
  deleteAreaMetadata(payload, errors, source) {
    validateMetadataDelete(payload, 'deleteAreaMetadata', false, errors, source);
  },
  deleteWorldMetadata(payload, errors, source) {
    validateMetadataDelete(payload, 'deleteWorldMetadata', false, errors, source);
  },
  broadcast: validateBroadcast,
  semanticEvent: validateSemanticEvent,
};

/**
 * Shared authored-effects validator entrypoint.
 *
 * @param {*} effects
 * @param {{ source?: string }} [options]
 * @returns {import('./contracts').AuthoredEffectsValidationSuccess | import('./contracts').AuthoredEffectsValidationFailure}
 */
function validateAuthoredEffects(effects, options = {}) {
  const source = options.source;
  /** @type {import('./contracts').AuthoredEffectsFinding[]} */
  const errors = [];

  if (!Array.isArray(effects)) {
    return createValidationFailure([{
      code: 'AUTHORED_EFFECTS_ARRAY_REQUIRED',
      message: 'Authored effects root must be an array.',
      ...(source ? { source } : {}),
    }]);
  }

  for (const entry of effects) {
    if (!isObjectRecord(entry)) {
      pushError(
        errors,
        'AUTHORED_EFFECT_ENTRY_OBJECT_REQUIRED',
        'Each authored effect entry must be an object.',
        source
      );
      continue;
    }

    const effectNames = Object.keys(entry);
    if (effectNames.length !== 1) {
      pushError(
        errors,
        'AUTHORED_EFFECT_ENTRY_SINGLE_KEY_REQUIRED',
        'Each authored effect entry must contain exactly one effect key.',
        source
      );
      continue;
    }

    const effectName = effectNames[0];
    const validator = VALIDATORS[effectName];
    if (!validator) {
      pushError(
        errors,
        'AUTHORED_EFFECT_UNSUPPORTED',
        `Unsupported authored effect: ${effectName}.`,
        source,
        { effectName }
      );
      continue;
    }

    const payload = entry[effectName];
    if (!requirePayloadObject(payload, errors, source, effectName)) {
      continue;
    }

    validator(payload, errors, source);
  }

  return errors.length
    ? createValidationFailure(errors)
    : createValidationSuccess();
}

module.exports = {
  validateAuthoredEffects,
};
