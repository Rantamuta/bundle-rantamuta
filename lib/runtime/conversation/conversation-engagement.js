// @ts-check
'use strict';

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
