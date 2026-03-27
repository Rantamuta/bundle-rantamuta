// @ts-check
'use strict';

const { Logger } = require('ranvier');
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
 * @param {*} effect
 * @returns {string | null}
 */
function getMessageRoomText(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
    return null;
  }

  const value = Object.prototype.hasOwnProperty.call(effect, 'messageRoom')
    ? effect.messageRoom
    : null;

  const text = normalizeText(value);
  return text || null;
}

/**
 * Lower the minimal directed-speech-supported authored subset.
 *
 * Currently supported:
 * - `messageRoom: "..."` => room broadcast render instruction
 *
 * @param {Array<*>} effects
 * @returns {{ ok: true, renderMessages: Array<*> } | { ok: false, code: string, message: string }}
 */
function lowerDirectedSpeechEffects(effects) {
  /** @type {Array<*>} */
  const renderMessages = [];

  for (const effect of effects) {
    const messageRoom = getMessageRoomText(effect);
    if (messageRoom) {
      renderMessages.push({
        type: 'broadcast',
        audience: 'room',
        message: messageRoom,
      });
      continue;
    }

    return {
      ok: false,
      code: 'CONVERSATION_DIRECTED_SPEECH_UNSUPPORTED_EFFECT',
      message: `Unsupported directed speech effect: ${JSON.stringify(effect)}`,
    };
  }

  return { ok: true, renderMessages };
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

  const evaluation = evaluateConversationRuntime({
    definition: definitionOutcome.definition,
    player,
    npcRef,
    eventId,
  });

  if (evaluation.ok === false) {
    return logFailure(state, evaluation.code, evaluation.message);
  }

  if (!evaluation.selectedTransition) {
    return null;
  }

  const lowered = lowerDirectedSpeechEffects([
    ...evaluation.transitionEffects,
    ...evaluation.stateEntryEffects,
  ]);
  if (lowered.ok === false) {
    return logFailure(state, lowered.code, lowered.message);
  }

  return {
    ok: true,
    plan: {
      operations: [
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
