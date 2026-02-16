// @ts-check
'use strict';

/**
 * Prevent removing the prayer stone after it has been placed in the stone
 * basin as part of the Bell Tower ritual.
 */
module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      this.allowAction = (action, context) => {
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

        if (carrierRef !== 'rantamuta:stoneBasin') {
          return undefined;
        }

        return 'The basin holds the stone as if in quiet guardianship. You cannot remove it.';
      };
    },
  },
};
