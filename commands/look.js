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
 * @param {*} collection
 * @returns {Array<*>}
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

  if (typeof collection[Symbol.iterator] === 'function') {
    return Array.from(collection);
  }

  return [];
}

/**
 * @param {*} room
 * @returns {string[]}
 */
function roomItemLines(room) {
  return valuesAsArray(room && room.items)
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.roomDesc === 'string' && item.roomDesc.length > 0) {
        return item.roomDesc;
      }

      if (typeof item.name === 'string' && item.name.length > 0) {
        return `You see ${item.name} here.`;
      }

      return '';
    })
    .filter(Boolean);
}

module.exports = {
  aliases: ['l'],
  metadata: {
    entityResolution: {
      rules: {
        intransitive: {},
      },
    },
    errorMessages: {
      LOOK_NO_ROOM: 'You are nowhere.',
    },
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || resolution.ruleKey !== 'intransitive') {
      return fail('FORM_NOT_SUPPORTED');
    }

    /** @type {import('ranvier/types/Room') | null | undefined} */
    const room = player.room;
    if (!room) {
      return fail('LOOK_NO_ROOM');
    }

    const lines = [
      `<bold>${room.title}</bold>`,
      room.description,
      ...roomItemLines(room),
    ];

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines,
      },
    };
  }
};
