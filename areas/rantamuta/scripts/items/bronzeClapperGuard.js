// @ts-check
'use strict';

/**
 * Prevent removing the bronze clapper after it has been placed in the cracked
 * bell as part of the Bell Tower ritual.
 */
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

        if (!action || typeof action !== 'object' || action.verbId !== 'take' || action.role !== 'direct') {
          return undefined;
        }

        const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
          ? context.entityResolution
          : null;
        if (!resolution || resolution.ruleKey !== 'direct' || resolution.directTarget !== this) {
          return undefined;
        }

        const carriedBy = this.carriedBy && typeof this.carriedBy === 'object' ? this.carriedBy : null;
        const carrierRef = carriedBy && typeof carriedBy.entityReference === 'string'
          ? carriedBy.entityReference
          : '';

        if (carrierRef !== 'rantamuta:crackedBell') {
          return undefined;
        }

        return 'The clapper is locked into position. Removing it would undo the balance.';
      };
    },
  },
};
