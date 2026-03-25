// @ts-check
'use strict';

const { getConversationState } = require('./conversation-state');

/**
 * Conversation event-evaluation runtime.
 *
 * This module is the pure conversation "brain" for phase 3.
 * It reads one loaded conversation definition, one player, and one NPC ref,
 * then determines the current state, visible events, selected transition,
 * settled state, and trace data in a deterministic way.
 *
 * It does not:
 * - intercept commands
 * - install menus
 * - execute effects
 * - write player progress
 * - dispatch output
 */

const AUTO_HOP_LIMIT = 32;

/**
 * @typedef {{
 *   id: string,
 *   initial: string,
 *   states: Record<string, *>,
 *   sourcePath?: string,
 *   absolutePath?: string,
 *   bundle?: string,
 *   areaName?: string,
 * }} ConversationDefinition
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string | null,
 * }} VisibleEvent
 */

/**
 * @typedef {{
 *   eventId: string,
 *   source: 'event' | 'default',
 * }} SelectedEvent
 */

/**
 * @typedef {{
 *   source: 'event' | 'default' | 'auto',
 *   target: string,
 *   index: number | null,
 * }} SelectedTransition
 */

/**
 * @typedef {{
 *   mode: 'inspect' | 'event',
 *   inputEventId: string | null,
 *   sourceState: string | null,
 *   selectedEvent: SelectedEvent | null,
 *   selectedTransition: SelectedTransition | null,
 *   destinationState: string | null,
 *   settledState: string | null,
 *   final: boolean,
 *   visibleEventIds: string[],
 *   enteredStates: string[],
 *   autoVisitedStates: string[],
 *   conditionChecks: Array<{
 *     phase: 'visible' | 'event' | 'default' | 'auto',
 *     stateId: string,
 *     eventId: string | null,
 *     index: number | null,
 *     passed: boolean,
 *   }>,
 *   errors: Array<{ code: string, message: string }>,
 * }} ConversationRuntimeTrace
 */

/**
 * @typedef {{
 *   definition: ConversationDefinition,
 *   player: *,
 *   npcRef: string,
 *   eventId?: string | null,
 *   conditionEvaluator?: (condition: *, context: {
 *     q: *,
 *     player: *,
 *     npcRef: string,
 *     definition: ConversationDefinition,
 *     stateId: string,
 *     eventId: string | null,
 *     phase: 'visible' | 'event' | 'default' | 'auto',
 *     index: number | null,
 *   }) => *,
 *   q?: *,
 * }} ConversationRuntimeInput
 */

/**
 * @typedef {{
 *   ok: true,
 *   mode: 'inspect' | 'event',
 *   sourceState: string,
 *   selectedEvent: SelectedEvent | null,
 *   selectedTransition: SelectedTransition | null,
 *   destinationState: string | null,
 *   settledState: string,
 *   final: boolean,
 *   visibleEvents: VisibleEvent[],
 *   transitionEffects: *[],
 *   stateEntryEffects: *[],
 *   trace: ConversationRuntimeTrace,
 * }} ConversationRuntimeSuccess
 */

/**
 * @typedef {{
 *   ok: false,
 *   mode: 'inspect' | 'event',
 *   code: string,
 *   message: string,
 *   sourceState: string | null,
 *   selectedEvent: SelectedEvent | null,
 *   selectedTransition: SelectedTransition | null,
 *   destinationState: string | null,
 *   settledState: string | null,
 *   final: boolean,
 *   visibleEvents: VisibleEvent[],
 *   transitionEffects: *[],
 *   stateEntryEffects: *[],
 *   trace: ConversationRuntimeTrace,
 * }} ConversationRuntimeFailure
 */

/**
 * @typedef {ConversationRuntimeSuccess | ConversationRuntimeFailure} ConversationRuntimeResult
 */

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
function normalizeEventId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {*} value
 * @returns {*[]}
 */
function cloneEffects(value) {
  return Array.isArray(value) ? value.slice() : [];
}

/**
 * @param {ConversationDefinition} definition
 * @param {string} stateId
 * @returns {Record<string, *> | null}
 */
function getStateDefinition(definition, stateId) {
  if (!definition || !isObjectRecord(definition.states)) {
    return null;
  }

  const state = definition.states[stateId];
  return isObjectRecord(state) ? state : null;
}

/**
 * @param {ConversationDefinition} definition
 * @param {string} stateId
 * @param {ConversationRuntimeTrace} trace
 * @returns {{ ok: true, state: Record<string, *> } | ConversationRuntimeFailure}
 */
function requireStateDefinition(definition, stateId, trace) {
  const state = getStateDefinition(definition, stateId);
  if (state) {
    return { ok: true, state };
  }

  return createFailure({
    mode: trace.mode,
    code: 'CONVERSATION_RUNTIME_STATE_MISSING',
    message: `Conversation state "${stateId}" is missing from the loaded definition.`,
    sourceState: trace.sourceState,
    selectedEvent: trace.selectedEvent,
    selectedTransition: trace.selectedTransition,
    destinationState: trace.destinationState,
    settledState: trace.settledState,
    trace,
  });
}

/**
 * @param {Record<string, *> | null} state
 * @returns {Record<string, *> | null}
 */
function getEventsRecord(state) {
  return state && isObjectRecord(state.events) ? state.events : null;
}

/**
 * @param {Record<string, *> | null} state
 * @returns {boolean}
 */
function isFinalState(state) {
  return !!(state && state.final === true);
}

/**
 * @param {Record<string, *> | null} state
 * @returns {*[]}
 */
function getStateEntryEffects(state) {
  const onEntry = state && isObjectRecord(state.onEntry) ? state.onEntry : null;
  return cloneEffects(onEntry && onEntry.effects);
}

/**
 * @param {ConversationRuntimeTrace} trace
 * @param {string} code
 * @param {string} message
 * @returns {void}
 */
function pushTraceError(trace, code, message) {
  trace.errors.push({ code, message });
}

/**
 * @param {{
 *   mode: 'inspect' | 'event',
 *   code: string,
 *   message: string,
 *   sourceState: string | null,
 *   selectedEvent: SelectedEvent | null,
 *   selectedTransition: SelectedTransition | null,
 *   destinationState: string | null,
 *   settledState: string | null,
 *   trace: ConversationRuntimeTrace,
 * }} input
 * @returns {ConversationRuntimeFailure}
 */
function createFailure(input) {
  pushTraceError(input.trace, input.code, input.message);
  return {
    ok: false,
    mode: input.mode,
    code: input.code,
    message: input.message,
    sourceState: input.sourceState,
    selectedEvent: input.selectedEvent,
    selectedTransition: input.selectedTransition,
    destinationState: input.destinationState,
    settledState: input.settledState,
    final: false,
    visibleEvents: [],
    transitionEffects: [],
    stateEntryEffects: [],
    trace: input.trace,
  };
}

/**
 * @param {ConversationRuntimeInput} input
 * @returns {{ ok: true, mode: 'inspect' | 'event', eventId: string | null, trace: ConversationRuntimeTrace } | ConversationRuntimeFailure}
 */
function validateRuntimeInput(input) {
  if (!isObjectRecord(input)) {
    return createFailure({
      mode: 'inspect',
      code: 'CONVERSATION_RUNTIME_INPUT_INVALID',
      message: 'Conversation runtime input must be an object.',
      sourceState: null,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: null,
      settledState: null,
      trace: createTrace('inspect', null),
    });
  }

  const mode = input.eventId === undefined || input.eventId === null ? 'inspect' : 'event';
  const eventId = mode === 'event' ? normalizeEventId(input.eventId) : null;
  const trace = createTrace(mode, eventId);

  if (!isObjectRecord(input.definition) || typeof input.definition.initial !== 'string' || !isObjectRecord(input.definition.states)) {
    return createFailure({
      mode,
      code: 'CONVERSATION_RUNTIME_DEFINITION_INVALID',
      message: 'Conversation runtime requires a loaded definition with string "initial" and object "states".',
      sourceState: null,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: null,
      settledState: null,
      trace,
    });
  }

  if (!input.player || (typeof input.player !== 'object' && typeof input.player !== 'function')) {
    return createFailure({
      mode,
      code: 'CONVERSATION_RUNTIME_PLAYER_INVALID',
      message: 'Conversation runtime requires a player object.',
      sourceState: null,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: null,
      settledState: null,
      trace,
    });
  }

  if (typeof input.npcRef !== 'string' || !input.npcRef.trim()) {
    return createFailure({
      mode,
      code: 'CONVERSATION_RUNTIME_NPC_REF_INVALID',
      message: 'Conversation runtime requires npcRef as a non-empty string.',
      sourceState: null,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: null,
      settledState: null,
      trace,
    });
  }

  if (mode === 'event' && !eventId) {
    return createFailure({
      mode,
      code: 'CONVERSATION_RUNTIME_EVENT_ID_INVALID',
      message: 'Conversation runtime event evaluation requires a non-empty event id.',
      sourceState: null,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: null,
      settledState: null,
      trace,
    });
  }

  return {
    ok: true,
    mode,
    eventId,
    trace,
  };
}

/**
 * @param {'inspect' | 'event'} mode
 * @param {string | null} eventId
 * @returns {ConversationRuntimeTrace}
 */
function createTrace(mode, eventId) {
  return {
    mode,
    inputEventId: eventId,
    sourceState: null,
    selectedEvent: null,
    selectedTransition: null,
    destinationState: null,
    settledState: null,
    final: false,
    visibleEventIds: [],
    enteredStates: [],
    autoVisitedStates: [],
    conditionChecks: [],
    errors: [],
  };
}

/**
 * @param {ConversationRuntimeInput} input
 * @param {ConversationRuntimeTrace} trace
 * @param {'visible' | 'event' | 'default' | 'auto'} phase
 * @param {string} stateId
 * @param {string | null} eventId
 * @param {number | null} index
 * @param {*} condition
 * @returns {{ ok: true, passed: boolean } | ConversationRuntimeFailure}
 */
function evaluateCondition(input, trace, phase, stateId, eventId, index, condition) {
  if (condition === undefined) {
    trace.conditionChecks.push({
      phase,
      stateId,
      eventId,
      index,
      passed: true,
    });

    return { ok: true, passed: true };
  }

  if (typeof input.conditionEvaluator !== 'function') {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_CONDITION_EVALUATOR_REQUIRED',
      message: `Conversation runtime encountered a condition in state "${stateId}" but no conditionEvaluator was provided.`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  let passed;
  try {
    passed = input.conditionEvaluator(condition, {
      q: input.q || null,
      player: input.player,
      npcRef: input.npcRef,
      definition: input.definition,
      stateId,
      eventId,
      phase,
      index,
    }) === true;
  } catch (error) {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_CONDITION_EVALUATION_FAILED',
      message: `Conversation runtime condition evaluation failed in state "${stateId}": ${error && error.message ? error.message : String(error)}`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  trace.conditionChecks.push({
    phase,
    stateId,
    eventId,
    index,
    passed,
  });

  return { ok: true, passed };
}

/**
 * @param {ConversationRuntimeInput} input
 * @param {ConversationRuntimeTrace} trace
 * @param {string} stateId
 * @param {Record<string, *>} state
 * @returns {{ ok: true, visibleEvents: VisibleEvent[] } | ConversationRuntimeFailure}
 */
function computeVisibleEvents(input, trace, stateId, state) {
  if (isFinalState(state)) {
    trace.visibleEventIds = [];
    return { ok: true, visibleEvents: [] };
  }

  const events = getEventsRecord(state);
  if (!events) {
    trace.visibleEventIds = [];
    return { ok: true, visibleEvents: [] };
  }

  /** @type {VisibleEvent[]} */
  const visibleEvents = [];
  for (const [eventId, eventDef] of Object.entries(events)) {
    if (eventId === 'default' || !isObjectRecord(eventDef)) {
      continue;
    }

    const conditionResult = evaluateCondition(input, trace, 'visible', stateId, eventId, null, eventDef.condition);
    if (conditionResult.ok === false) {
      return conditionResult;
    }
    if (!conditionResult.passed) {
      continue;
    }

    visibleEvents.push({
      id: eventId,
      label: typeof eventDef.label === 'string' ? eventDef.label : null,
    });
  }

  trace.visibleEventIds = visibleEvents.map(event => event.id);
  return { ok: true, visibleEvents };
}

/**
 * @param {ConversationRuntimeTrace} trace
 * @param {string} stateId
 * @param {string} eventId
 * @param {Record<string, *>} eventDef
 * @returns {ConversationRuntimeFailure | null}
 */
function validateEventShapeAtRuntime(trace, stateId, eventId, eventDef) {
  const hasTransitions = Array.isArray(eventDef.transitions);
  const hasDirectTarget = typeof eventDef.target === 'string' && eventDef.target.trim().length > 0;

  if (hasTransitions && hasDirectTarget) {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_EVENT_SHAPE_INVALID',
      message: `Event "${eventId}" in state "${stateId}" mixes direct target fields with ordered transitions.`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  if (!hasTransitions && !hasDirectTarget) {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_EVENT_SHAPE_INVALID',
      message: `Event "${eventId}" in state "${stateId}" has no selectable transition target.`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  if (hasTransitions && eventDef.transitions.length === 0) {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_EVENT_SHAPE_INVALID',
      message: `Event "${eventId}" in state "${stateId}" defines an empty transitions array.`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  return null;
}

/**
 * @param {ConversationRuntimeInput} input
 * @param {ConversationRuntimeTrace} trace
 * @param {string} stateId
 * @param {string} eventId
 * @param {Record<string, *>} eventDef
 * @returns {{ ok: true, transition: { target: string, effects: *[], index: number | null } | null } | ConversationRuntimeFailure}
 */
function selectEventTransition(input, trace, stateId, eventId, eventDef) {
  const shapeFailure = validateEventShapeAtRuntime(trace, stateId, eventId, eventDef);
  if (shapeFailure) {
    return shapeFailure;
  }

  const transitions = Array.isArray(eventDef.transitions) ? eventDef.transitions : null;
  if (transitions) {
    for (let index = 0; index < transitions.length; index += 1) {
      const transition = transitions[index];
      if (!isObjectRecord(transition)) {
        return createFailure({
          mode: trace.mode,
          code: 'CONVERSATION_RUNTIME_EVENT_SHAPE_INVALID',
          message: `Event "${eventId}" in state "${stateId}" has a non-object transition at index ${index}.`,
          sourceState: trace.sourceState,
          selectedEvent: trace.selectedEvent,
          selectedTransition: trace.selectedTransition,
          destinationState: trace.destinationState,
          settledState: trace.settledState,
          trace,
        });
      }

      const conditionResult = evaluateCondition(input, trace, 'event', stateId, eventId, index, transition.condition);
      if (conditionResult.ok === false) {
        return conditionResult;
      }
      if (!conditionResult.passed) {
        continue;
      }

      const target = typeof transition.target === 'string' ? transition.target.trim() : '';
      if (!target) {
        return createFailure({
          mode: trace.mode,
          code: 'CONVERSATION_RUNTIME_EVENT_SHAPE_INVALID',
          message: `Event "${eventId}" in state "${stateId}" has a transition without a target at index ${index}.`,
          sourceState: trace.sourceState,
          selectedEvent: trace.selectedEvent,
          selectedTransition: trace.selectedTransition,
          destinationState: trace.destinationState,
          settledState: trace.settledState,
          trace,
        });
      }

      return {
        ok: true,
        transition: {
          target,
          effects: cloneEffects(transition.effects),
          index,
        },
      };
    }

    return { ok: true, transition: null };
  }

  const conditionResult = evaluateCondition(input, trace, 'event', stateId, eventId, null, eventDef.condition);
  if (conditionResult.ok === false) {
    return conditionResult;
  }
  if (!conditionResult.passed) {
    return { ok: true, transition: null };
  }

  return {
    ok: true,
    transition: {
      target: String(eventDef.target).trim(),
      effects: cloneEffects(eventDef.effects),
      index: null,
    },
  };
}

/**
 * @param {ConversationRuntimeInput} input
 * @param {ConversationRuntimeTrace} trace
 * @param {string} stateId
 * @param {Record<string, *>} state
 * @returns {{ ok: true, transition: { target: string, effects: *[], index: number | null } | null } | ConversationRuntimeFailure}
 */
function selectDefaultTransition(input, trace, stateId, state) {
  const events = getEventsRecord(state);
  const defaultEvent = events && isObjectRecord(events.default) ? events.default : null;
  if (!defaultEvent) {
    return { ok: true, transition: null };
  }

  const conditionResult = evaluateCondition(input, trace, 'default', stateId, 'default', null, defaultEvent.condition);
  if (conditionResult.ok === false) {
    return conditionResult;
  }
  if (!conditionResult.passed) {
    return { ok: true, transition: null };
  }

  const target = typeof defaultEvent.target === 'string' ? defaultEvent.target.trim() : '';
  if (!target) {
    return createFailure({
      mode: trace.mode,
      code: 'CONVERSATION_RUNTIME_DEFAULT_SHAPE_INVALID',
      message: `State "${stateId}" defines events.default without a target.`,
      sourceState: trace.sourceState,
      selectedEvent: trace.selectedEvent,
      selectedTransition: trace.selectedTransition,
      destinationState: trace.destinationState,
      settledState: trace.settledState,
      trace,
    });
  }

  return {
    ok: true,
    transition: {
      target,
      effects: cloneEffects(defaultEvent.effects),
      index: null,
    },
  };
}

/**
 * @param {ConversationRuntimeInput} input
 * @param {ConversationRuntimeTrace} trace
 * @param {string} destinationStateId
 * @returns {{ ok: true, settledState: string, visibleEvents: VisibleEvent[], stateEntryEffects: *[] } | ConversationRuntimeFailure}
 */
function settleFromDestination(input, trace, destinationStateId) {
  /** @type {string[]} */
  const visitedStates = [];
  /** @type {*[]} */
  const stateEntryEffects = [];
  let currentStateId = destinationStateId;
  let hopCount = 0;

  while (true) {
    if (visitedStates.includes(currentStateId)) {
      return createFailure({
        mode: trace.mode,
        code: 'CONVERSATION_RUNTIME_AUTO_LOOP',
        message: `Conversation auto routing revisited state "${currentStateId}".`,
        sourceState: trace.sourceState,
        selectedEvent: trace.selectedEvent,
        selectedTransition: trace.selectedTransition,
        destinationState: trace.destinationState,
        settledState: trace.settledState,
        trace,
      });
    }

    visitedStates.push(currentStateId);
    trace.enteredStates.push(currentStateId);
    trace.autoVisitedStates = visitedStates.slice();

    const stateResult = requireStateDefinition(input.definition, currentStateId, trace);
    if (stateResult.ok === false) {
      return stateResult;
    }

    const state = stateResult.state;
    stateEntryEffects.push(...getStateEntryEffects(state));

    if (isFinalState(state)) {
      trace.settledState = currentStateId;
      trace.final = true;
      trace.visibleEventIds = [];
      return {
        ok: true,
        settledState: currentStateId,
        visibleEvents: [],
        stateEntryEffects,
      };
    }

    const autoRoutes = Array.isArray(state.auto) ? state.auto : [];
    if (autoRoutes.length === 0) {
      const visibleResult = computeVisibleEvents(input, trace, currentStateId, state);
      if (visibleResult.ok === false) {
        return visibleResult;
      }

      trace.settledState = currentStateId;
      trace.final = false;
      return {
        ok: true,
        settledState: currentStateId,
        visibleEvents: visibleResult.visibleEvents,
        stateEntryEffects,
      };
    }

    let selectedAutoTarget = null;
    for (let index = 0; index < autoRoutes.length; index += 1) {
      const route = autoRoutes[index];
      if (!isObjectRecord(route)) {
        return createFailure({
          mode: trace.mode,
          code: 'CONVERSATION_RUNTIME_AUTO_SHAPE_INVALID',
          message: `State "${currentStateId}" has a non-object auto route at index ${index}.`,
          sourceState: trace.sourceState,
          selectedEvent: trace.selectedEvent,
          selectedTransition: trace.selectedTransition,
          destinationState: trace.destinationState,
          settledState: trace.settledState,
          trace,
        });
      }

      const conditionResult = evaluateCondition(input, trace, 'auto', currentStateId, null, index, route.condition);
      if (conditionResult.ok === false) {
        return conditionResult;
      }
      if (!conditionResult.passed) {
        continue;
      }

      const target = typeof route.target === 'string' ? route.target.trim() : '';
      if (!target) {
        return createFailure({
          mode: trace.mode,
          code: 'CONVERSATION_RUNTIME_AUTO_SHAPE_INVALID',
          message: `State "${currentStateId}" has an auto route without a target at index ${index}.`,
          sourceState: trace.sourceState,
          selectedEvent: trace.selectedEvent,
          selectedTransition: trace.selectedTransition,
          destinationState: trace.destinationState,
          settledState: trace.settledState,
          trace,
        });
      }

      selectedAutoTarget = target;
      break;
    }

    if (!selectedAutoTarget) {
      trace.settledState = currentStateId;
      trace.final = false;
      trace.visibleEventIds = [];
      return {
        ok: true,
        settledState: currentStateId,
        visibleEvents: [],
        stateEntryEffects,
      };
    }

    hopCount += 1;
    if (hopCount > AUTO_HOP_LIMIT) {
      return createFailure({
        mode: trace.mode,
        code: 'CONVERSATION_RUNTIME_AUTO_HOP_LIMIT',
        message: `Conversation auto routing exceeded the ${AUTO_HOP_LIMIT}-hop limit.`,
        sourceState: trace.sourceState,
        selectedEvent: trace.selectedEvent,
        selectedTransition: trace.selectedTransition,
        destinationState: trace.destinationState,
        settledState: trace.settledState,
        trace,
      });
    }

    currentStateId = selectedAutoTarget;
  }
}

/**
 * Evaluate one loaded conversation definition for one player/NPC pair.
 *
 * @param {ConversationRuntimeInput} input
 * @returns {ConversationRuntimeResult}
 */
function evaluateConversationRuntime(input) {
  const validated = validateRuntimeInput(input);
  if (validated.ok === false) {
    return validated;
  }

  const { mode, eventId, trace } = validated;
  const sourceStateIdRaw = getConversationState(input.player, input.npcRef);
  const sourceStateId = typeof sourceStateIdRaw === 'string' && sourceStateIdRaw.trim()
    ? sourceStateIdRaw.trim()
    : input.definition.initial.trim();

  trace.sourceState = sourceStateId;

  const sourceStateResult = requireStateDefinition(input.definition, sourceStateId, trace);
  if (sourceStateResult.ok === false) {
    if (typeof sourceStateIdRaw === 'string' && sourceStateIdRaw.trim()) {
      sourceStateResult.code = 'CONVERSATION_RUNTIME_PERSISTED_STATE_MISSING';
      sourceStateResult.message = `Persisted conversation state "${sourceStateId}" no longer exists in the loaded definition.`;
      sourceStateResult.trace.errors[sourceStateResult.trace.errors.length - 1] = {
        code: sourceStateResult.code,
        message: sourceStateResult.message,
      };
    }
    return sourceStateResult;
  }

  const sourceState = sourceStateResult.state;

  if (mode === 'inspect') {
    const visibleResult = computeVisibleEvents(input, trace, sourceStateId, sourceState);
    if (visibleResult.ok === false) {
      return visibleResult;
    }

    trace.settledState = sourceStateId;
    trace.final = isFinalState(sourceState);

    return {
      ok: true,
      mode,
      sourceState: sourceStateId,
      selectedEvent: null,
      selectedTransition: null,
      destinationState: sourceStateId,
      settledState: sourceStateId,
      final: isFinalState(sourceState),
      visibleEvents: visibleResult.visibleEvents,
      transitionEffects: [],
      stateEntryEffects: [],
      trace,
    };
  }

  const events = getEventsRecord(sourceState);
  const exactEvent = events && eventId && isObjectRecord(events[eventId]) ? events[eventId] : null;
  /** @type {{ target: string, effects: *[], index: number | null } | null} */
  let selectedTransition = null;
  /** @type {SelectedEvent | null} */
  let selectedEvent = null;

  if (exactEvent && eventId) {
    selectedEvent = {
      eventId,
      source: 'event',
    };
    trace.selectedEvent = selectedEvent;

    const exactResult = selectEventTransition(input, trace, sourceStateId, eventId, exactEvent);
    if (exactResult.ok === false) {
      return exactResult;
    }
    selectedTransition = exactResult.transition;
  }

  if (!selectedTransition) {
    const defaultResult = selectDefaultTransition(input, trace, sourceStateId, sourceState);
    if (defaultResult.ok === false) {
      return defaultResult;
    }

    if (defaultResult.transition) {
      selectedTransition = defaultResult.transition;
      selectedEvent = {
        eventId: 'default',
        source: 'default',
      };
      trace.selectedEvent = selectedEvent;
    }
  }

  if (!selectedTransition) {
    const visibleResult = computeVisibleEvents(input, trace, sourceStateId, sourceState);
    if (visibleResult.ok === false) {
      return visibleResult;
    }

    trace.settledState = sourceStateId;
    trace.final = isFinalState(sourceState);
    trace.selectedTransition = null;

    return {
      ok: true,
      mode,
      sourceState: sourceStateId,
      selectedEvent,
      selectedTransition: null,
      destinationState: null,
      settledState: sourceStateId,
      final: isFinalState(sourceState),
      visibleEvents: visibleResult.visibleEvents,
      transitionEffects: [],
      stateEntryEffects: [],
      trace,
    };
  }

  trace.selectedTransition = {
    source: selectedEvent && selectedEvent.source === 'default' ? 'default' : 'event',
    target: selectedTransition.target,
    index: selectedTransition.index,
  };
  trace.destinationState = selectedTransition.target;

  const destinationStateResult = requireStateDefinition(input.definition, selectedTransition.target, trace);
  if (destinationStateResult.ok === false) {
    return destinationStateResult;
  }

  const settled = settleFromDestination(input, trace, selectedTransition.target);
  if (settled.ok === false) {
    return settled;
  }

  return {
    ok: true,
    mode,
    sourceState: sourceStateId,
    selectedEvent,
    selectedTransition: trace.selectedTransition,
    destinationState: selectedTransition.target,
    settledState: settled.settledState,
    final: trace.final,
    visibleEvents: settled.visibleEvents,
    transitionEffects: selectedTransition.effects,
    stateEntryEffects: settled.stateEntryEffects,
    trace,
  };
}

module.exports = {
  AUTO_HOP_LIMIT,
  evaluateConversationRuntime,
};
