'use strict';

/**
 * VirtualDoor service lifecycle accessors.
 *
 * This module owns creation, retrieval, and disposal of a per-GameState
 * VirtualDoor service instance. Behavior APIs are added in later checklist
 * items; this phase only establishes lifecycle and storage boundaries.
 */
const serviceRegistry = new WeakMap();

/**
 * Minimal service shell for this phase.
 *
 * @param {*} state
 * @returns {{ state: * }}
 */
function createVirtualDoorService(state) {
  return { state };
}

/**
 * Ensure a VirtualDoor service exists for the given state.
 * Idempotent: repeated calls return the same service instance.
 *
 * @param {*} state
 * @returns {{ state: * }}
 */
function ensureVirtualDoorService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    throw new TypeError('ensureVirtualDoorService(state): state must be an object.');
  }

  const existing = serviceRegistry.get(state);
  if (existing) {
    return existing;
  }

  const service = createVirtualDoorService(state);
  serviceRegistry.set(state, service);
  return service;
}

/**
 * Return initialized VirtualDoor service for state.
 * Auto-calls idempotent ensure when uninitialized.
 *
 * @param {*} state
 * @returns {{ state: * }}
 */
function getVirtualDoorService(state) {
  return ensureVirtualDoorService(state);
}

/**
 * Dispose VirtualDoor service instance for state.
 *
 * @param {*} state
 * @returns {void}
 */
function disposeVirtualDoorService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    return;
  }

  serviceRegistry.delete(state);
}

module.exports = {
  ensureVirtualDoorService,
  getVirtualDoorService,
  disposeVirtualDoorService,
};
