// @ts-check
'use strict';

const { evaluateExitGate } = require('../helpers/exitGate');

/**
 * @param {*} room
 * @returns {* | null}
 */
function findDownExit(room) {
  if (!room || typeof room !== 'object') {
    return null;
  }

  const exits = typeof room.getExits === 'function'
    ? room.getExits()
    : room.exits;
  if (!Array.isArray(exits)) {
    return null;
  }

  for (const exit of exits) {
    if (exit && typeof exit === 'object' && String(exit.direction || '').trim().toLowerCase() === 'down') {
      return exit;
    }
  }

  return null;
}

/**
 * @param {*} state
 * @param {*} room
 * @returns {boolean}
 */
function isDescentOpen(state, room) {
  const downExit = findDownExit(room);
  if (!downExit) {
    return false;
  }

  const gate = evaluateExitGate(state, downExit);
  if (!gate) {
    return true;
  }

  return gate.ok !== false;
}

/**
 * @param {*} action
 * @param {*} context
 * @returns {boolean}
 */
function isGoWithDirectExit(action, context) {
  if (!action || typeof action !== 'object' || action.verbId !== 'go') {
    return false;
  }

  const entityResolution = context && context.entityResolution && typeof context.entityResolution === 'object'
    ? context.entityResolution
    : null;
  return !!(entityResolution && entityResolution.ruleKey === 'direct' && entityResolution.directTarget);
}

module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      const previousAllowAction = typeof this.allowAction === 'function'
        ? this.allowAction
        : null;
      const previousRenderPredicates = this.renderPredicates && typeof this.renderPredicates === 'object'
        ? this.renderPredicates
        : {};

      this.renderPredicates = {
        ...previousRenderPredicates,
        slab_open: typeof previousRenderPredicates.slab_open === 'function'
          ? previousRenderPredicates.slab_open
          : () => isDescentOpen(state, this),
        slab_blocking: typeof previousRenderPredicates.slab_blocking === 'function'
          ? previousRenderPredicates.slab_blocking
          : () => !isDescentOpen(state, this),
      };

      this.allowAction = (action, context) => {
        if (previousAllowAction) {
          const previousResult = previousAllowAction.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        if (!isGoWithDirectExit(action, context)) {
          return undefined;
        }

        const directTarget = context.entityResolution.directTarget;
        const gate = evaluateExitGate(state, directTarget);
        if (gate && gate.ok === false) {
          return gate.message;
        }

        return undefined;
      };
    },
  },
};
