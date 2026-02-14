// @ts-check
'use strict';

const { evaluateExitGate } = require('../helpers/exitGate');

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
