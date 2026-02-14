// @ts-check
'use strict';

const { ItemType } = require('ranvier');

/**
 * @param {string} code
 * @param {Record<string, *>} [details]
 * @returns {{ ok: false, error: { code: string, details?: Record<string, *> } }}
 */
function fail(code, details) {
  return {
    ok: false,
    error: { code, details },
  };
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isContainerItem(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return value.type === ItemType.CONTAINER || value.type === 'CONTAINER';
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isValidTransferContainer(value) {
  return !!value &&
    typeof value.addItem === 'function' &&
    typeof value.removeItem === 'function';
}

/**
 * @param {*} container
 * @returns {boolean}
 */
function hasContainerCapacity(container) {
  const maxItems = typeof container.maxItems === 'number' ? container.maxItems : Infinity;
  if (!Number.isFinite(maxItems)) {
    return true;
  }

  const inventorySize = container.inventory && typeof container.inventory.size === 'number'
    ? container.inventory.size
    : 0;

  return inventorySize < maxItems;
}

/**
 * @param {*} entity
 * @param {string} fallback
 * @returns {string}
 */
function displayName(entity, fallback) {
  if (entity && typeof entity.name === 'string' && entity.name.length > 0) {
    return entity.name;
  }

  return fallback;
}

/**
 * @param {string[] | undefined} span
 * @param {*} entity
 * @param {string} fallback
 * @returns {string}
 */
function displayLabel(span, entity, fallback) {
  const spanText = Array.isArray(span) ? span.map(part => String(part)).join(' ').trim() : '';
  if (spanText.length > 0) {
    return spanText;
  }

  return displayName(entity, fallback);
}

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} indirectTarget
 * @returns {{ acceptedItemRef?: string, rejectMessage?: string, successRender?: string } | null}
 */
function getPutPolicy(indirectTarget) {
  const metadata = indirectTarget && indirectTarget.metadata && typeof indirectTarget.metadata === 'object'
    ? indirectTarget.metadata
    : null;
  const puzzle = metadata && metadata.puzzle && typeof metadata.puzzle === 'object'
    ? metadata.puzzle
    : null;
  const putPolicy = puzzle && puzzle.putPolicy && typeof puzzle.putPolicy === 'object'
    ? puzzle.putPolicy
    : null;

  return putPolicy || null;
}

/**
 * @param {*} directTarget
 * @param {*} indirectTarget
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function evaluatePutPolicy(directTarget, indirectTarget) {
  const policy = getPutPolicy(indirectTarget);
  if (!policy) {
    return { ok: true };
  }

  const acceptedItemRef = normalizeRef(policy.acceptedItemRef);
  if (!acceptedItemRef) {
    return { ok: true };
  }

  const directRef = normalizeRef(directTarget && directTarget.entityReference);
  if (directRef === acceptedItemRef) {
    return { ok: true };
  }

  const message = typeof policy.rejectMessage === 'string' && policy.rejectMessage.length > 0
    ? policy.rejectMessage
    : 'You can\'t put that there.';

  return {
    ok: false,
    message,
  };
}

module.exports = {
  aliases: ['place', 'drop'],
  metadata: {
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: ['player.inventory'],
          },
        },
        directIndirect: {
          acceptedRelations: ['in', 'into'],
          scopeProfile: {
            direct: ['player.inventory'],
            indirect: ['player.inventory', 'room.items'],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Put what?',
      FORM_MISSING_INDIRECT: 'Put it where?',
      FORM_UNSUPPORTED_RELATION: 'You can only put things in containers.',
      TARGET_NOT_FOUND: {
        direct: 'You do not have that.',
        indirect: 'You do not see that here.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which item do you mean?',
        indirect: 'Which container do you mean?',
      },
      PUT_TARGET_NOT_CONTAINER: 'You can\'t put things in that.',
      PUT_TARGET_LOCKED: 'It is locked.',
      PUT_TARGET_CLOSED: 'It is closed.',
      PUT_TARGET_FULL: 'It is full.',
      PUT_INVALID_SOURCE: 'You cannot move that right now.',
      PUT_INVALID_TARGET: 'You cannot put that there.',
    },
    captureChecks: [
      (context) => {
        const resolution = context && context.entityResolution;
        if (!resolution || resolution.ruleKey !== 'directIndirect') {
          return { ok: true };
        }

        const policyResult = evaluatePutPolicy(resolution.directTarget, resolution.indirectTarget);
        if (!policyResult.ok) {
          return {
            ok: false,
            vetoInfo: {
              code: 'FORBIDDEN_BLOCKED',
              message: policyResult.message,
            },
          };
        }

        return { ok: true };
      },
    ],
    bubbleReactions: [
      (context) => {
        const resolution = context && context.entityResolution;
        if (!resolution || resolution.ruleKey !== 'directIndirect') {
          return null;
        }

        const policy = getPutPolicy(resolution.indirectTarget);
        if (!policy || typeof policy.successRender !== 'string' || !policy.successRender.length) {
          return null;
        }

        const policyResult = evaluatePutPolicy(resolution.directTarget, resolution.indirectTarget);
        if (!policyResult.ok) {
          return null;
        }

        return {
          render: {
            lines: [policy.successRender],
          },
        };
      },
    ],
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || (resolution.ruleKey !== 'direct' && resolution.ruleKey !== 'directIndirect')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    const item = resolution.directTarget;

    if (!isValidTransferContainer(player)) {
      return fail('PUT_INVALID_SOURCE');
    }

    if (resolution.ruleKey === 'direct') {
      const room = player && player.room;
      if (!isValidTransferContainer(room)) {
        return fail('PUT_INVALID_TARGET');
      }

      return {
        ok: true,
        plan: {
          operations: [
            {
              type: 'transferItem',
              item,
              from: player,
              to: room,
            },
          ],
        },
        render: {
          lines: [
            `You put the ${displayLabel(resolution.directSpan, item, 'item')} down.`,
          ],
        },
      };
    }

    const target = resolution.indirectTarget;

    if (!isContainerItem(target)) {
      return fail('PUT_TARGET_NOT_CONTAINER');
    }

    if (target.locked) {
      return fail('PUT_TARGET_LOCKED');
    }

    if (target.closed) {
      return fail('PUT_TARGET_CLOSED');
    }

    if (!hasContainerCapacity(target)) {
      return fail('PUT_TARGET_FULL');
    }

    if (!isValidTransferContainer(target)) {
      return fail('PUT_INVALID_TARGET');
    }

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'transferItem',
            item,
            from: player,
            to: target,
          },
        ],
      },
      render: {
        lines: [
          `You put the ${displayLabel(resolution.directSpan, item, 'item')} in the ${displayLabel(resolution.indirectSpan, target, 'container')}.`,
        ],
      },
    };
  }
};
