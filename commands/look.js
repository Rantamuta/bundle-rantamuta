// @ts-check
'use strict';

const { buildRoomViewLines } = require('../lib/helpers/room-view-helper');
const { resolveInlineTags, buildSurfaceRef } = require('../lib/inline-tags/resolve-inline-tags');

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
 * @param {*} target
 * @param {{ actor?: *, room?: *, area?: *, world?: * } | undefined} context
 * @returns {string[]}
 */
function buildDirectLookLines(target, context) {
  if (!target || typeof target !== 'object') {
    return ['You see nothing special.'];
  }

  if (typeof target.description === 'string' && target.description.trim().length > 0) {
    const description = resolveInlineTags(target.description, {
      surfaceRef: buildSurfaceRef(target, 'look.description'),
      renderContext: {
        actor: context && Object.prototype.hasOwnProperty.call(context, 'actor') ? context.actor : null,
        room: context && Object.prototype.hasOwnProperty.call(context, 'room') ? context.room : null,
        area: context && Object.prototype.hasOwnProperty.call(context, 'area') ? context.area : null,
        world: context && Object.prototype.hasOwnProperty.call(context, 'world') ? context.world : null,
        source: 'look.description',
        entity: target,
      },
    });
    return [description.trim()];
  }

  return ['You see nothing special.'];
}

module.exports = {
  aliases: ['l'],
  metadata: {
    entityResolution: {
      rules: {
        intransitive: {},
        direct: {
          scopeProfile: {
            direct: ['room.items', 'room.npcs', 'room.details', 'player.inventory'],
          },
        },
      },
    },
    errorMessages: {
      LOOK_NO_ROOM: 'You are nowhere.',
    },
  },
  command: state => (args, player, alias, context) => {
    const resolution = context && context.entityResolution;
    if (!resolution || (resolution.ruleKey !== 'intransitive' && resolution.ruleKey !== 'direct')) {
      return fail('FORM_NOT_SUPPORTED');
    }

    if (resolution.ruleKey === 'direct') {
      if (!resolution.directTarget) {
        return fail('TARGET_NOT_FOUND', { role: 'direct' });
      }

      return {
        ok: true,
        plan: {
          operations: [{ type: 'noop' }],
        },
        render: {
          messages: buildDirectLookLines(resolution.directTarget, {
            actor: player,
            room: player && player.room ? player.room : null,
            area: player && player.room && player.room.area ? player.room.area : null,
            world: state,
          }),
        },
      };
    }

    /** @type {import('ranvier/types/Room') | null | undefined} */
    const room = player.room;
    if (!room) {
      return fail('LOOK_NO_ROOM');
    }

    const lines = buildRoomViewLines(room, {
      actor: player,
      room,
      area: room.area || null,
      world: state,
    });

    return {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: lines,
      },
    };
  }
};
