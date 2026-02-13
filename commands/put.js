// @ts-check
'use strict';

const { ItemType } = require('ranvier');
const { matchItems } = require('../lib/helpers/item-helper');
const { parseInput } = require('../lib/parse-input');

/**
 * @typedef {import('../lib/parse-input').ParseArtifact} ParseArtifact
 */

/**
 * @typedef {{ parsedInput?: ParseArtifact, rawInput?: string }} ExecutionContext
 */

/**
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function fail(code, message) {
  return {
    ok: false,
    error: { code, message },
  };
}

/**
 * @param {*} collection
 * @returns {Array<object>}
 */
function valuesAsArray(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === 'function') {
    return Array.from(collection.values());
  }

  return [];
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
 * @param {string} args
 * @param {ExecutionContext=} context
 * @returns {ParseArtifact}
 */
function resolveParseArtifact(args, context) {
  const parsedFromContext = context && context.parsedInput;
  if (parsedFromContext && parsedFromContext.intentToken === 'put') {
    return parsedFromContext;
  }

  const normalizedArgs = String(args || '').trim();
  return parseInput(normalizedArgs ? `put ${normalizedArgs}` : 'put');
}

/**
 * Find one item by token span using noun/adjective matching.
 *
 * @param {Array<object>} candidates
 * @param {Array<string>} span
 * @returns {{ kind: 'none' } | { kind: 'many' } | { kind: 'one', item: object }}
 */
function selectSingleItem(candidates, span) {
  const matches = matchItems(candidates, span);
  if (matches.length === 0) {
    return { kind: 'none' };
  }

  if (matches.length > 1) {
    return { kind: 'many' };
  }

  return { kind: 'one', item: matches[0] };
}

module.exports = {
  aliases: ['insert', 'place', 'stuff', 'hide'],
  command: state => (args, player, alias, context) => {
    const parsed = resolveParseArtifact(args, context);
    const directObjectWords = Array.isArray(parsed.primaryTargetSpan) ? parsed.primaryTargetSpan : [];
    const indirectObjectWords = Array.isArray(parsed.secondaryTargetSpan) ? parsed.secondaryTargetSpan : [];
    const preposition = parsed.relationToken;

    if (!directObjectWords.length) {
      return fail('PUT_MISSING_ITEM', 'Put what?');
    }

    if (!preposition || !indirectObjectWords.length) {
      return fail('PUT_MISSING_DESTINATION', 'Put it where?');
    }

    if (preposition !== 'in' && preposition !== 'into') {
      return fail('PUT_UNSUPPORTED_RELATION', 'You can only put things in containers.');
    }

    if (!player || !player.room) {
      return fail('PUT_NO_ROOM', 'You are nowhere.');
    }

    const sourceSelection = selectSingleItem(valuesAsArray(player.inventory), directObjectWords);
    if (sourceSelection.kind === 'none') {
      return fail('PUT_ITEM_NOT_FOUND', 'You do not have that.');
    }
    if (sourceSelection.kind === 'many') {
      return fail('PUT_ITEM_AMBIGUOUS', 'Which item do you mean?');
    }
    const item = sourceSelection.item;

    const targetSelection = selectSingleItem(valuesAsArray(player.room.items), indirectObjectWords);
    if (targetSelection.kind === 'none') {
      return fail('PUT_TARGET_NOT_FOUND', 'You do not see that here.');
    }
    if (targetSelection.kind === 'many') {
      return fail('PUT_TARGET_AMBIGUOUS', 'Which container do you mean?');
    }
    const target = targetSelection.item;

    if (!isContainerItem(target)) {
      return fail('PUT_TARGET_NOT_CONTAINER', 'You can\'t put things in that.');
    }

    if (target.locked) {
      return fail('PUT_TARGET_LOCKED', 'It is locked.');
    }

    if (target.closed) {
      return fail('PUT_TARGET_CLOSED', 'It is closed.');
    }

    if (!hasContainerCapacity(target)) {
      return fail('PUT_TARGET_FULL', 'It is full.');
    }

    if (typeof player.addItem !== 'function' || typeof player.removeItem !== 'function') {
      return fail('PUT_INVALID_SOURCE', 'You cannot move that right now.');
    }

    if (typeof target.addItem !== 'function' || typeof target.removeItem !== 'function') {
      return fail('PUT_INVALID_TARGET', 'You cannot put that there.');
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
    };
  }
};
