// @ts-check
'use strict';

const { validateAuthoredInstructions } = require('../authored-instructions');

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Array<{ code: string, message: string, source?: string, details?: Record<string, *> }>} errors
 * @param {string} code
 * @param {string} message
 * @param {string} [sourceLabel]
 * @param {Record<string, *>} [details]
 * @returns {void}
 */
function pushError(errors, code, message, sourceLabel, details) {
  errors.push({
    code,
    message,
    ...(sourceLabel ? { source: sourceLabel } : {}),
    ...(details ? { details } : {}),
  });
}

/**
 * @param {*} stateDef
 * @returns {Record<string, *> | null}
 */
function getEventsRecord(stateDef) {
  if (!isObjectRecord(stateDef) || !isObjectRecord(stateDef.events)) {
    return null;
  }

  return stateDef.events;
}

/**
 * @param {Array<{ code: string, message: string, source?: string, details?: Record<string, *> }>} errors
 * @param {*} actions
 * @param {string} sourceLabel
 * @returns {void}
 */
function appendInstructionValidationErrors(errors, actions, sourceLabel) {
  const validation = validateAuthoredInstructions(actions, { source: sourceLabel });
  if (validation.ok) {
    return;
  }

  for (const error of validation.errors) {
    errors.push(error);
  }
}

/**
 * Validate the supported minimal authored conversation subset used by
 * runtime loading and tooling parity.
 *
 * @param {*} doc
 * @param {string} [sourceLabel]
 * @returns {{ ok: true, errors: [] } | { ok: false, errors: Array<{ code: string, message: string, source?: string, details?: Record<string, *> }> }}
 */
function validateConversationDefinition(doc, sourceLabel = '') {
  /** @type {Array<{ code: string, message: string, source?: string, details?: Record<string, *> }>} */
  const errors = [];
  const definition = isObjectRecord(doc) ? doc : {};

  const id = typeof definition.id === 'string' ? definition.id.trim() : '';
  if (!id) {
    pushError(errors, 'CONVERSATION_ID_REQUIRED', 'Conversation definition must declare top-level string "id".', sourceLabel);
  }

  const initial = typeof definition.initial === 'string' ? definition.initial.trim() : '';
  if (!initial) {
    pushError(errors, 'CONVERSATION_INITIAL_REQUIRED', 'Conversation definition must declare top-level string "initial".', sourceLabel);
  }

  const states = isObjectRecord(definition.states) ? definition.states : null;
  if (!states) {
    pushError(errors, 'CONVERSATION_STATES_REQUIRED', 'Conversation definition must declare top-level object "states".', sourceLabel);
  }

  if (!states) {
    return {
      ok: false,
      errors,
    };
  }

  if (initial && !Object.prototype.hasOwnProperty.call(states, initial)) {
    pushError(
      errors,
      'CONVERSATION_INITIAL_STATE_MISSING',
      `Conversation initial state "${initial}" is not defined in "states".`,
      sourceLabel,
      { initial }
    );
  }

  for (const [stateId, stateDef] of Object.entries(states)) {
    const events = getEventsRecord(stateDef);
    const hasDefault = !!(events && Object.prototype.hasOwnProperty.call(events, 'default') && isObjectRecord(events.default));
    const hasNonDefaultEvents = !!(events && Object.keys(events).some(eventId => eventId !== 'default'));
    const hasAuto = isObjectRecord(stateDef) && Object.prototype.hasOwnProperty.call(stateDef, 'auto');
    const auto = isObjectRecord(stateDef) && Array.isArray(stateDef.auto) ? stateDef.auto : [];
    const isFinal = isObjectRecord(stateDef) && stateDef.final === true;

    if (hasAuto && !Array.isArray(stateDef.auto)) {
      pushError(
        errors,
        'CONVERSATION_AUTO_SHAPE_INVALID',
        `Auto-routing state "${stateId}" must define auto as an array of routes.`,
        sourceLabel,
        { stateId }
      );
    }

    if (isFinal && hasNonDefaultEvents) {
      pushError(
        errors,
        'CONVERSATION_FINAL_STATE_HAS_EVENTS',
        `Final state "${stateId}" must not define events.`,
        sourceLabel,
        { stateId }
      );
    }

    if (isFinal && hasDefault) {
      pushError(
        errors,
        'CONVERSATION_FINAL_STATE_HAS_DEFAULT',
        `Final state "${stateId}" must not define events.default.`,
        sourceLabel,
        { stateId }
      );
    }

    if (auto.length > 0 && hasNonDefaultEvents) {
      pushError(
        errors,
        'CONVERSATION_AUTO_STATE_HAS_EVENTS',
        `Auto-routing state "${stateId}" must not define events.`,
        sourceLabel,
        { stateId }
      );
    }

    if (auto.length > 0 && hasDefault) {
      pushError(
        errors,
        'CONVERSATION_AUTO_STATE_HAS_DEFAULT',
        `Auto-routing state "${stateId}" must not define events.default.`,
        sourceLabel,
        { stateId }
      );
    }

    if (auto.length > 0 && isFinal) {
      pushError(
        errors,
        'CONVERSATION_AUTO_STATE_IS_FINAL',
        `Auto-routing state "${stateId}" must not also be final.`,
        sourceLabel,
        { stateId }
      );
    }

    const onEntry = isObjectRecord(stateDef) && isObjectRecord(stateDef.onEntry)
      ? stateDef.onEntry
      : null;
    if (onEntry && Object.prototype.hasOwnProperty.call(onEntry, 'actions')) {
      appendInstructionValidationErrors(errors, onEntry.actions, sourceLabel);
    }

    for (const route of auto) {
      if (!isObjectRecord(route)) {
        pushError(
          errors,
          'CONVERSATION_AUTO_ROUTE_INVALID',
          `Auto-routing state "${stateId}" has a non-object auto route.`,
          sourceLabel,
          { stateId }
        );
        continue;
      }

      if (typeof route.target !== 'string' || !route.target.trim()) {
        pushError(
          errors,
          'CONVERSATION_AUTO_TARGET_REQUIRED',
          `Auto route in state "${stateId}" must define a target.`,
          sourceLabel,
          { stateId }
        );
        continue;
      }

      const targetState = route.target.trim();
      if (!Object.prototype.hasOwnProperty.call(states, targetState)) {
        pushError(
          errors,
          'CONVERSATION_AUTO_TARGET_MISSING',
          `Auto route in state "${stateId}" targets missing state "${targetState}".`,
          sourceLabel,
          { stateId, target: targetState }
        );
      }
    }

    if (!events) {
      continue;
    }

    for (const [eventId, eventDef] of Object.entries(events)) {
      if (!isObjectRecord(eventDef)) {
        continue;
      }

      if (eventId === 'default') {
        if (typeof eventDef.label === 'string' && eventDef.label.trim()) {
          pushError(
            errors,
            'CONVERSATION_DEFAULT_HAS_LABEL',
            `Default transition in state "${stateId}" must not define label.`,
            sourceLabel,
            { stateId }
          );
        }

        const targetState = typeof eventDef.target === 'string' ? eventDef.target.trim() : '';
        if (targetState && !Object.prototype.hasOwnProperty.call(states, targetState)) {
          pushError(
            errors,
            'CONVERSATION_DEFAULT_TARGET_MISSING',
            `Default transition in state "${stateId}" targets missing state "${targetState}".`,
            sourceLabel,
            { stateId, target: targetState }
          );
        }

        if (Object.prototype.hasOwnProperty.call(eventDef, 'actions')) {
          appendInstructionValidationErrors(errors, eventDef.actions, sourceLabel);
        }
        continue;
      }

      const directTarget = typeof eventDef.target === 'string' ? eventDef.target.trim() : '';
      if (directTarget && !Object.prototype.hasOwnProperty.call(states, directTarget)) {
        pushError(
          errors,
          'CONVERSATION_EVENT_TARGET_MISSING',
          `Event "${eventId}" in state "${stateId}" targets missing state "${directTarget}".`,
          sourceLabel,
          { stateId, eventId, target: directTarget }
        );
      }

      const transitions = Array.isArray(eventDef.transitions) ? eventDef.transitions : [];
      if (directTarget && transitions.length > 0) {
        pushError(
          errors,
          'CONVERSATION_EVENT_SHAPE_CONFLICT',
          `Event "${eventId}" in state "${stateId}" must not mix direct target fields with transitions.`,
          sourceLabel,
          { stateId, eventId }
        );
      }

      if (!directTarget && transitions.length === 0) {
        pushError(
          errors,
          'CONVERSATION_EVENT_TARGET_REQUIRED',
          `Event "${eventId}" in state "${stateId}" must define either a direct target or transitions.`,
          sourceLabel,
          { stateId, eventId }
        );
      }

      if (Object.prototype.hasOwnProperty.call(eventDef, 'actions')) {
        appendInstructionValidationErrors(errors, eventDef.actions, sourceLabel);
      }

      for (const transition of transitions) {
        if (!isObjectRecord(transition)) {
          pushError(
            errors,
            'CONVERSATION_TRANSITION_SHAPE_INVALID',
            `Event "${eventId}" in state "${stateId}" has a non-object transition.`,
            sourceLabel,
            { stateId, eventId }
          );
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(transition, 'actions')) {
          appendInstructionValidationErrors(errors, transition.actions, sourceLabel);
        }

        if (typeof transition.target !== 'string' || !transition.target.trim()) {
          pushError(
            errors,
            'CONVERSATION_TRANSITION_TARGET_REQUIRED',
            `Transition for event "${eventId}" in state "${stateId}" must define a target.`,
            sourceLabel,
            { stateId, eventId }
          );
          continue;
        }

        const targetState = transition.target.trim();
        if (!Object.prototype.hasOwnProperty.call(states, targetState)) {
          pushError(
            errors,
            'CONVERSATION_TRANSITION_TARGET_MISSING',
            `Transition for event "${eventId}" in state "${stateId}" targets missing state "${targetState}".`,
            sourceLabel,
            { stateId, eventId, target: targetState }
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    errors: [],
  };
}

module.exports = {
  validateConversationDefinition,
};
