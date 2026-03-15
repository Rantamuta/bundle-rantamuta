// @ts-check
'use strict';

const { compileCommandSyntaxMetadata } = require('../lib/session/verb-local-syntax');

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
 * @param {*} item
 * @returns {string}
 */
function itemLabel(item) {
  if (item && typeof item.name === 'string' && item.name.trim().length > 0) {
    return item.name.trim();
  }

  const keywords = item && Array.isArray(item.keywords)
    ? item.keywords.filter(keyword => typeof keyword === 'string' && keyword.trim().length > 0)
    : [];

  if (keywords.length > 0) {
    return keywords[0].trim();
  }

  return 'item';
}

/**
 * @param {*} player
 * @returns {Array<*>}
 */
function inventoryItems(player) {
  const inventory = player && player.inventory;
  if (!inventory) {
    return [];
  }

  if (inventory instanceof Map) {
    return Array.from(inventory.values());
  }

  if (Array.isArray(inventory)) {
    return inventory.slice();
  }

  if (typeof inventory.values === 'function') {
    return Array.from(inventory.values());
  }

  return [];
}

/**
 * @param {*} player
 * @returns {string[]}
 */
function inventoryLines(player) {
  const items = inventoryItems(player);
  if (!items.length) {
    return ['You have nothing.'];
  }

  return [
    'You are carrying:',
    ...items.map(item => `- ${itemLabel(item)}`),
  ];
}

module.exports = {
  aliases: ['i'],
  metadata: compileCommandSyntaxMetadata('inventory', {
    syntaxRules: ['(empty)'],
    entityResolution: {
      rules: {
        intransitive: {},
      },
    },
    errorMessages: {
      INVENTORY_NO_PLAYER: 'You are nowhere.',
    },
  }),
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'intransitive') {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (!player || typeof player !== 'object') {
      return fail('INVENTORY_NO_PLAYER');
    }

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: inventoryLines(player),
      },
    };
  },
};
