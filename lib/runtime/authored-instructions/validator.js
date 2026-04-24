// @ts-check
'use strict';

/**
 * @module runtime/authored-instructions/validator
 * @description
 * Structural validator for the authored-instructions runtime surface.
 *
 * This file checks that authored instruction entries conform to the supported
 * instruction vocabulary and payload shapes before any runtime lowering is
 * attempted.
 *
 * It is responsible for validating things such as:
 *
 * - root array shape
 * - one-instruction-per-entry object shape
 * - supported instruction names
 * - required fields
 * - enum values
 * - basic field type/shape rules
 * - optional targeting field structure where that contract is supported
 *
 * It returns shared validation envelopes and findings from `contracts.js` so
 * callers can report deterministic authoring errors without partially lowering
 * invalid data.
 *
 * Future-direction note:
 *
 * This file may be most valuable as a validator for the authored DSL shape,
 * rather than as the authoritative validator for executable runtime
 * instruction validity.
 *
 * In that model, this file would continue to answer questions such as:
 *
 * - is the authored root value an array?
 * - does each entry use the expected one-key object form?
 * - are required authored fields present?
 * - are authored enum-like fields spelled correctly?
 * - does the authored document obey the declared DSL surface?
 *
 * But it would deliberately stop claiming responsibility for a stronger
 * guarantee:
 *
 * - that the lowered mutation/render instructions are valid according to the
 *   real runtime executors
 *
 * That stronger guarantee belongs more naturally with the executable runtime
 * instruction contracts themselves.
 *
 * Today, mutation instructions are actually enforced by the mutator, and
 * render instructions are actually enforced by the render dispatcher. If this
 * file maintains its own parallel understanding of those runtime contracts, it
 * can drift from the real execution surfaces and become a source of false
 * confidence.
 *
 * A healthier long-term split may be:
 *
 * - this file validates authored-instructions DSL shape
 * - lowering code translates authored data into canonical instruction payloads
 * - runtime-owned mutation/render validators, or contract descriptors shared
 *   with those executors, validate the lowered payloads authoritatively
 *
 * That approach would let both YAML-authored content and `.js`-authored
 * scripts rely on the same executable instruction contract, while preserving a
 * useful early authoring check for DSL-shape mistakes here.
 *
 * This file does not resolve runtime references, lower instructions into
 * canonical mutation/render payloads, execute instructions, or own any
 * conversation-specific behavior. It is only the structural gate for the
 * authored-instructions data contract.
 */

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
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
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
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 * @returns {boolean}
 */
function requireTextField(payload, field, errors, source, instructionName) {
  if (normalizeText(payload[field])) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    `${instructionName}.${field} is required.`,
    source,
    { instructionName, field }
  );
  return false;
}

/**
 * Require that a payload field is a non-empty string and that its normalized
 * value is present in the provided allowed-value set.
 *
 * Example enum input:
 *
 * ```js
 * const DOOR_MUTATIONS = new Set([
 *   'open',
 *   'close',
 *   'unlock',
 *   'unlockAndOpen',
 *   'closeAndLock',
 * ]);
 * ```
 *
 * If the field is missing/blank, or its value is not in `allowed`, this helper
 * appends a structured validation finding and returns `false`.
 *
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {Set<string>} allowed
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 * @returns {boolean}
 */
function requireEnumField(payload, field, allowed, errors, source, instructionName) {
  const value = normalizeText(payload[field]);
  if (!value) {
    pushError(
      errors,
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      `${instructionName}.${field} is required.`,
      source,
      { instructionName, field }
    );
    return false;
  }

  if (allowed.has(value)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_ENUM_INVALID',
    `${instructionName}.${field} must be one of: ${Array.from(allowed).join(', ')}.`,
    source,
    { instructionName, field, value }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 */
function requireDefinedField(payload, field, errors, source, instructionName) {
  if (payload[field] !== undefined) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    `${instructionName}.${field} is required.`,
    source,
    { instructionName, field }
  );
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 */
function validateOptionalBoolean(payload, field, errors, source, instructionName) {
  if (payload[field] === undefined || isBoolean(payload[field])) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
    `${instructionName}.${field} must be a boolean when provided.`,
    source,
    { instructionName, field }
  );
}

/**
 * @param {Record<string, *>} payload
 * @param {string} field
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 */
function validateOptionalTextField(payload, field, errors, source, instructionName) {
  if (payload[field] === undefined) {
    return;
  }

  if (typeof payload[field] === 'string' && normalizeText(payload[field])) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    `${instructionName}.${field} must be a non-empty string when provided.`,
    source,
    { instructionName, field }
  );
}

/**
 * @param {*} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @param {string} instructionName
 * @returns {payload is Record<string, *>}
 */
function requirePayloadObject(payload, errors, source, instructionName) {
  if (isObjectRecord(payload)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_PAYLOAD_OBJECT_REQUIRED',
    `${instructionName} payload must be an object.`,
    source,
    { instructionName }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateTransferItem(payload, errors, source) {
  requireTextField(payload, 'item', errors, source, 'transferItem');
  requireTextField(payload, 'from', errors, source, 'transferItem');
  requireTextField(payload, 'to', errors, source, 'transferItem');
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMovePlayer(payload, errors, source) {
  requireTextField(payload, 'toRoom', errors, source, 'movePlayer');
  validateOptionalTextField(payload, 'player', errors, source, 'movePlayer');
  validateOptionalTextField(payload, 'direction', errors, source, 'movePlayer');
  validateOptionalBoolean(payload, 'suppressRoomBroadcast', errors, source, 'movePlayer');
}

/**
 * @param {Record<string, *>} payload
 * @param {string} instructionName
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateDoorTargeting(payload, instructionName, errors, source) {
  validateOptionalTextField(payload, 'direction', errors, source, instructionName);
  validateOptionalTextField(payload, 'roomRef', errors, source, instructionName);
  validateOptionalTextField(payload, 'fromRoomRef', errors, source, instructionName);

  if (payload.direction !== undefined || payload.roomRef !== undefined) {
    return;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    `${instructionName} requires direction or roomRef.`,
    source,
    { instructionName, fields: ['direction', 'roomRef'] }
  );
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateOperateDoor(payload, errors, source) {
  requireEnumField(payload, 'mutation', DOOR_MUTATIONS, errors, source, 'operateDoor');
  validateDoorTargeting(payload, 'operateDoor', errors, source);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} instructionName
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateSimpleDoorOp(payload, instructionName, errors, source) {
  validateDoorTargeting(payload, instructionName, errors, source);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} instructionName
 * @param {boolean} requireActor
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMetadataSet(payload, instructionName, requireActor, errors, source) {
  if (requireActor) {
    requireTextField(payload, 'actor', errors, source, instructionName);
  }

  validateOptionalTextField(payload, 'actor', errors, source, instructionName);
  validateOptionalTextField(payload, 'player', errors, source, instructionName);
  validateOptionalTextField(payload, 'roomRef', errors, source, instructionName);

  requireTextField(payload, 'key', errors, source, instructionName);
  requireDefinedField(payload, 'value', errors, source, instructionName);
}

/**
 * @param {Record<string, *>} payload
 * @param {string} instructionName
 * @param {boolean} requireActor
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 */
function validateMetadataDelete(payload, instructionName, requireActor, errors, source) {
  if (requireActor) {
    requireTextField(payload, 'actor', errors, source, instructionName);
  }

  validateOptionalTextField(payload, 'actor', errors, source, instructionName);
  validateOptionalTextField(payload, 'player', errors, source, instructionName);
  validateOptionalTextField(payload, 'roomRef', errors, source, instructionName);

  requireTextField(payload, 'key', errors, source, instructionName);
  validateOptionalBoolean(payload, 'force', errors, source, instructionName);
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
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
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
 * @param {string | undefined} source
 * @returns {participant is Record<string, *>}
 */
function requireParticipantObject(participant, participantName, errors, source) {
  if (isObjectRecord(participant)) {
    return true;
  }

  pushError(
    errors,
    'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    `semanticEvent.participants.${participantName} is required.`,
    source,
    { instructionName: 'semanticEvent', field: `participants.${participantName}` }
  );
  return false;
}

/**
 * @param {Record<string, *>} payload
 * @param {import('./contracts').AuthoredInstructionsFinding[]} errors
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
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'semanticEvent.participants.actor is required.',
      source,
      { instructionName: 'semanticEvent', field: 'participants.actor' }
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
        'AUTHORED_INSTRUCTION_PAYLOAD_OBJECT_REQUIRED',
        `semanticEvent.participants.${participantName} must be an object.`,
        source,
        { instructionName: 'semanticEvent', field: `participants.${participantName}` }
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
 * Shared authored-instructions validator entrypoint.
 *
 * @param {*} effects
 * @param {{ source?: string }} [options]
 * @returns {import('./contracts').AuthoredInstructionsValidationSuccess | import('./contracts').AuthoredInstructionsValidationFailure}
 */
function validateAuthoredInstructions(effects, options = {}) {
  const source = options.source;
  /** @type {import('./contracts').AuthoredInstructionsFinding[]} */
  const errors = [];

  if (!Array.isArray(effects)) {
    return createValidationFailure([{
      code: 'AUTHORED_INSTRUCTIONS_ARRAY_REQUIRED',
      message: 'Authored instructions root must be an array.',
      ...(source ? { source } : {}),
    }]);
  }

  for (const entry of effects) {
    if (!isObjectRecord(entry)) {
      pushError(
        errors,
        'AUTHORED_INSTRUCTION_ENTRY_OBJECT_REQUIRED',
        'Each authored instruction entry must be an object.',
        source
      );
      continue;
    }

    const instructionNames = Object.keys(entry);
    if (instructionNames.length !== 1) {
      pushError(
        errors,
        'AUTHORED_INSTRUCTION_ENTRY_SINGLE_KEY_REQUIRED',
        'Each authored instruction entry must contain exactly one instruction key.',
        source
      );
      continue;
    }

    const instructionName = instructionNames[0];
    const validator = VALIDATORS[instructionName];
    if (!validator) {
      pushError(
        errors,
        'AUTHORED_INSTRUCTION_UNSUPPORTED',
        `Unsupported authored instruction: ${instructionName}.`,
        source,
        { instructionName }
      );
      continue;
    }

    const payload = entry[instructionName];
    if (!requirePayloadObject(payload, errors, source, instructionName)) {
      continue;
    }

    validator(payload, errors, source);
  }

  return errors.length
    ? createValidationFailure(errors)
    : createValidationSuccess();
}

module.exports = {
  validateAuthoredInstructions,
};
