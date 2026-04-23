// @ts-check
'use strict';

/**
 * @module runtime/conversation/directed-speech
 * @description
 * Plain-language summary:
 *
 * This file is the small conversation-owned entrypoint for addressed speech
 * such as:
 *
 *   say <text> to <npc>
 *
 * It exists so command code, especially `say`, can hand off one narrow
 * question:
 *
 * - does this addressed utterance match a conversation route for this NPC?
 *
 * If so, this file orchestrates the conversation-specific work:
 *
 * - load the NPC's conversation definition
 * - evaluate the player's spoken event against the conversation runtime
 * - transpose any authored instructions into canonical mutops/render instructions
 * - add the structural conversation-state write
 * - return a normal command-style success envelope
 *
 * If not, it returns `null` so the caller can fall through to ordinary speech.
 *
 * This file is not:
 *
 * - a generic command dispatcher
 * - the conversation runtime itself
 * - the authored-instructions transposer
 * - a renderer
 * - a player-facing error surface
 *
 * Scope rules:
 *
 * - keep the command-side call surface very small
 * - own conversation-specific orchestration locally
 * - log maintainer-facing failures here and fall through to ordinary speech
 * - avoid leaking conversation loader/runtime/transposer details into `say`
 *
 * If you are looking for the conversation hook used by `say`, this is probably
 * the right file.
 * If you are looking for pure conversation evaluation rules, see
 * `conversation-runtime.js` instead.
 */

const { Logger } = require('ranvier');
const { transposeAuthoredInstructions } = require('../authored-instructions');
const { createQueryFacade } = require('../../helpers/query-facade');
const { createConversationConditionEvaluator } = require('./conversation-condition-evaluator');
const { getConversationDefinitionService } = require('./conversation-definition-service');
const { evaluateConversationRuntime } = require('./conversation-runtime');
const { createSetConversationStateInstruction } = require('./conversation-state');

/**
 * Small conversation-owned entrypoint for addressed speech such as:
 *   say <event> to <npc>
 *
 * Command code should only need to call this one function.
 *
 * Return contract:
 * - success envelope: directed speech matched a conversation route
 * - null: no intercept, caller should continue with ordinary addressed speech
 *
 * Maintainer-facing failures are logged here and still return null so player
 * experience falls back to ordinary speech.
 */

/**
 * @param {*} state
 * @returns {{ error?: (message: string) => void }}
 */
function resolveLogger(state) {
  if (state && typeof state === 'object' && state.Logger && typeof state.Logger === 'object') {
    return state.Logger;
  }

  return Logger;
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {*} npc
 * @returns {{ bundle: string, name: string } | null}
 */
function getNpcAreaInfo(npc) {
  const room = npc && typeof npc === 'object' ? npc.room : null;
  const area = room && typeof room === 'object' ? room.area : null;
  const bundle = normalizeText(area && area.bundle);
  const name = normalizeText(area && area.name);

  if (!bundle || !name) {
    return null;
  }

  return { bundle, name };
}

/**
 * @param {*} npc
 * @returns {string}
 */
function getNpcRef(npc) {
  return normalizeText(npc && npc.entityReference);
}

/**
 * @param {*} player
 * @param {*} npc
 * @returns {* | null}
 */
function resolveConversationRoom(player, npc) {
  return npc && typeof npc === 'object' && npc.room && typeof npc.room === 'object'
    ? npc.room
    : player && typeof player === 'object' && player.room && typeof player.room === 'object'
      ? player.room
      : null;
}

/**
 * @param {*} room
 * @returns {* | null}
 */
function resolveConversationArea(room) {
  return room && typeof room === 'object' && room.area && typeof room.area === 'object'
    ? room.area
    : null;
}

/**
 * @param {*} state
 * @param {*} player
 * @param {*} npc
 * @returns {{ q: Readonly<Record<string, Function>>, room: *, area: * }}
 */
function createDirectedSpeechQueryContext(state, player, npc) {
  const room = resolveConversationRoom(player, npc);
  const area = resolveConversationArea(room);
  const q = createQueryFacade({
    actor: player,
    room,
    area,
    world: state,
    entity: npc,
    currentContainer: npc,
  });

  return { q, room, area };
}

/**
 * @param {*} state
 * @param {string} code
 * @param {string} message
 * @returns {null}
 */
function logFailure(state, code, message) {
  const logger = resolveLogger(state);
  if (logger && typeof logger.error === 'function') {
    logger.error(`CONVERSATION_DIRECTED_SPEECH ${code}: ${message}`);
  }

  return null;
}

/**
 * Try to resolve addressed speech as a conversation event.
 *
 * Execution shape:
 *
 * 1. Normalize the spoken text into an event id candidate.
 * 2. Read the addressed NPC identity and area context.
 * 3. Ask the conversation-definition service whether that NPC has a valid
 *    bound conversation definition.
 * 4. Evaluate the current player/NPC conversation state for the spoken event.
 * 5. If a transition is selected, lower returned authored instructions into
 *    canonical mutation operations and render messages.
 * 6. Append a structural conversation-state persistence write as a mutation
 *    operation via `createSetConversationStateInstruction(...)`, using the
 *    evaluator's `settledState`.
 * 7. Return a normal command-style success envelope.
 *
 * Fall-through behavior:
 *
 * - returns `null` when the speech text is empty after normalization
 * - returns `null` when the addressed NPC has no conversation binding
 * - returns `null` when the current conversation state has no selected
 *   transition for the spoken event
 * - logs maintainer-facing failures and still returns `null` for runtime
 *   problems such as broken NPC context, evaluator failure, or lowering failure
 *
 * Success return shape:
 *
 * - `ok: true`
 * - `plan.operations`
 *   - all mutation operations lowered from transition and state-entry authored
 *     instructions, in authored order within the operation bucket
 *   - one final `setPlayerMetadata`-style conversation-state instruction from
 *     `createSetConversationStateInstruction(...)` for the evaluator's settled
 *     conversation state
 * - `render.messages`
 *   - all render messages lowered from transition and state-entry authored
 *     instructions
 *
 * This helper does not mutate state directly and does not render directly. It
 * only returns the command-style envelope that the normal command pipeline will
 * later commit and render.
 *
 * @param {*} state
 * @param {*} player
 * @param {*} speechText
 * @param {*} npc
 * @returns {{ ok: true, plan: { operations: Array<*> }, render: { messages: Array<*> } } | null}
 */
function tryDirectedConversation(state, player, speechText, npc) {
  const eventId = normalizeText(speechText);
  if (!eventId) {
    return null;
  }

  const npcRef = getNpcRef(npc);
  if (!npcRef) {
    return logFailure(state, 'NPC_REF_MISSING', 'Directed speech target did not provide entityReference.');
  }

  const areaInfo = getNpcAreaInfo(npc);
  if (!areaInfo) {
    return logFailure(state, 'NPC_AREA_UNRESOLVED', `Directed speech target "${npcRef}" has no room.area bundle/name.`);
  }

  const definitionService = getConversationDefinitionService(state);
  const definitionOutcome = definitionService.getConversationDefinitionForNpc(npc, areaInfo);
  if (!definitionOutcome || definitionOutcome.status === 'none') {
    return null;
  }

  // Broken bindings are already logged by the definition service. Fall through.
  if (definitionOutcome.status === 'broken') {
    return null;
  }

  const queryContext = createDirectedSpeechQueryContext(state, player, npc);

  const evaluation = evaluateConversationRuntime({
    definition: definitionOutcome.definition,
    player,
    npcRef,
    eventId,
    q: queryContext.q,
    conditionEvaluator: createConversationConditionEvaluator(),
  });

  if (evaluation.ok === false) {
    return logFailure(state, evaluation.code, evaluation.message);
  }

  if (!evaluation.selectedTransition) {
    return null;
  }

  const lowered = transposeAuthoredInstructions({
    instructions: [
      ...evaluation.transitionActions,
      ...evaluation.stateEntryActions,
    ],
    scope: {
      state,
      player,
      actor: player,
      npc,
      room: queryContext.room,
      area: queryContext.area,
      inventory: npc,
    },
  });
  if (lowered.ok === false) {
    return logFailure(state, lowered.code, lowered.message);
  }

  return {
    ok: true,
    plan: {
      operations: [
        ...lowered.operations,
        createSetConversationStateInstruction(player, npcRef, evaluation.settledState),
      ],
    },
    render: {
      messages: lowered.renderMessages,
    },
  };
}

module.exports = {
  tryDirectedConversation,
};
