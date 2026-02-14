// @ts-check
'use strict';

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
function isTransferContainer(value) {
  return !!value &&
    typeof value.addItem === 'function' &&
    typeof value.removeItem === 'function';
}

/**
 * @param {*} item
 * @param {*} player
 * @returns {boolean}
 */
function isReachableForTake(item, player) {
  const room = player && player.room;
  if (!room || !item || typeof item !== 'object') {
    return false;
  }

  if (item.room === room) {
    return true;
  }

  let holder = item.carriedBy || null;
  while (holder && typeof holder === 'object') {
    if (holder.closed) {
      return false;
    }

    if (holder.room === room) {
      return true;
    }

    holder = holder.carriedBy || null;
  }

  return false;
}

/**
 * @param {*} item
 * @param {*} player
 * @returns {*}
 */
function resolveTakeSource(item, player) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  if (item.carriedBy && typeof item.carriedBy === 'object') {
    return item.carriedBy;
  }

  const room = player && player.room;
  if (!room) {
    return null;
  }

  if (item.room === room) {
    return room;
  }

  if (room.items && typeof room.items.has === 'function' && room.items.has(item)) {
    return room;
  }

  return null;
}

module.exports = {
  aliases: ['get'],
  metadata: {
    entityResolution: {
      rules: {
        direct: {
          scopeProfile: {
            direct: [{ source: 'room.items', nested: true }],
          },
        },
      },
    },
    errorMessages: {
      FORM_MISSING_DIRECT: 'Take what?',
      TARGET_NOT_FOUND: {
        direct: 'You do not see that.',
      },
      AMBIGUOUS_TARGET: {
        direct: 'Which item do you mean?',
      },
      TAKE_CARRY_TOO_MUCH: 'You are carrying too much.',
      TAKE_NOT_REACHABLE: 'You cannot reach that.',
      TAKE_INVALID_SOURCE: 'You cannot take that right now.',
      TAKE_INVALID_TARGET: 'You cannot carry that right now.',
    },
    captureChecks: [
      (context) => {
        const player = context && context.player;
        const inventoryFull = !!(player && typeof player.isInventoryFull === 'function' && player.isInventoryFull());
        if (inventoryFull) {
          return {
            ok: false,
            vetoInfo: { code: 'TAKE_CARRY_TOO_MUCH' },
          };
        }

        return { ok: true };
      },
    ],
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'direct') {
      return fail('FORM_NOT_SUPPORTED');
    }

    const item = resolution.directTarget;
    if (!isReachableForTake(item, player)) {
      return fail('TAKE_NOT_REACHABLE');
    }

    const source = resolveTakeSource(item, player);
    if (!isTransferContainer(source)) {
      return fail('TAKE_INVALID_SOURCE');
    }

    if (!isTransferContainer(player)) {
      return fail('TAKE_INVALID_TARGET');
    }

    return {
      ok: true,
      plan: {
        operations: [
          {
            type: 'transferItem',
            item,
            from: source,
            to: player,
          },
        ],
      },
    };
  }
};
