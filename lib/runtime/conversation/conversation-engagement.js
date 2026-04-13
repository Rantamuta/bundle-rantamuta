// @ts-check
'use strict';

/**
 * @module runtime/conversation/conversation-engagement
 * @description
 * Plain-language summary:
 *
 * This file is the small in-memory holder for a player's current conversation
 * engagement state.
 *
 * In the larger conversation architecture, persisted conversation progress
 * lives in player metadata (`conversation-state.js`), while transient
 * interaction state lives here. That transient state is the kind of data a
 * live conversation loop needs in order to support features such as:
 *
 * - which NPC the player is currently engaged with
 * - which conversation definition/menu is currently active
 * - which visible options were last presented
 * - menu revision / stale-menu protection
 * - one-shot selector interception or similar temporary input handling
 *
 * This module is intentionally tiny. It does not evaluate conversations,
 * render menus, persist progress, or intercept commands. It only stores and
 * retrieves the current engagement object for an owner object such as a
 * session or player.
 *
 * If you are looking for persisted long-term conversation progress, use
 * `conversation-state.js`.
 * If you are looking for pure FSM evaluation, use `conversation-runtime.js`.
 * If you are looking for the current live engagement record for an actor or
 * session, this is the right file.
 */

/** @type {WeakMap<object, *>} */
const engagementByOwner = new WeakMap();

/**
 * @param {*} owner
 * @returns {object}
 */
function requireOwner(owner) {
  if (!owner || typeof owner !== 'object') {
    throw new TypeError('conversationEngagement.owner must be an object.');
  }

  return owner;
}

/**
 * @param {*} owner
 * @returns {*}
 */
function getConversationEngagement(owner) {
  return engagementByOwner.get(requireOwner(owner));
}

/**
 * @param {*} owner
 * @param {*} engagement
 * @returns {*}
 */
function setConversationEngagement(owner, engagement) {
  const normalizedOwner = requireOwner(owner);
  engagementByOwner.set(normalizedOwner, engagement);
  return engagement;
}

/**
 * Replace engagement and return the previous value.
 *
 * @param {*} owner
 * @param {*} engagement
 * @returns {*}
 */
function replaceConversationEngagement(owner, engagement) {
  const normalizedOwner = requireOwner(owner);
  const previous = engagementByOwner.get(normalizedOwner);
  engagementByOwner.set(normalizedOwner, engagement);
  return previous;
}

/**
 * @param {*} owner
 * @returns {boolean}
 */
function clearConversationEngagement(owner) {
  const normalizedOwner = requireOwner(owner);
  return engagementByOwner.delete(normalizedOwner);
}

module.exports = {
  clearConversationEngagement,
  getConversationEngagement,
  replaceConversationEngagement,
  setConversationEngagement,
};
