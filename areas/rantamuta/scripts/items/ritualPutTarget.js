// @ts-check
'use strict';

const {
  acceptsDirectTarget,
  getPutPolicy,
  isPutToIndirectTarget,
} = require('../helpers/putPolicy');

module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      const previousAllowAction = typeof this.allowAction === 'function'
        ? this.allowAction
        : null;
      const previousBubbleEvent = typeof this.bubbleEvent === 'function'
        ? this.bubbleEvent
        : null;

      this.allowAction = (action, context) => {
        if (previousAllowAction) {
          const previousResult = previousAllowAction.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        if (!isPutToIndirectTarget(action, context, this)) {
          return undefined;
        }

        const policy = getPutPolicy(this);
        if (!policy) {
          return undefined;
        }

        const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
        if (acceptsDirectTarget(policy, directTarget)) {
          return undefined;
        }

        return typeof policy.rejectMessage === 'string' && policy.rejectMessage.length > 0
          ? policy.rejectMessage
          : 'You can\'t put that there.';
      };

      this.bubbleEvent = (action, context) => {
        if (previousBubbleEvent) {
          const previousResult = previousBubbleEvent.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        if (!isPutToIndirectTarget(action, context, this)) {
          return null;
        }

        const policy = getPutPolicy(this);
        if (!policy || typeof policy.successRender !== 'string' || policy.successRender.length === 0) {
          return null;
        }

        const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
        if (!acceptsDirectTarget(policy, directTarget)) {
          return null;
        }

        return {
          render: {
            lines: [policy.successRender],
          },
        };
      };
    },
  },
};
