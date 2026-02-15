// @ts-check
'use strict';

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
 * @returns {Record<string, *>}
 */
function roomMetadata(room) {
  return room && room.metadata && typeof room.metadata === 'object'
    ? /** @type {Record<string, *>} */ (room.metadata)
    : {};
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function toTextLines(value) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value
      .map(entry => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean);
  }

  return [];
}

/**
 * @param {*} room
 * @param {{ actor?: *, room?: *, area?: *, world?: * } | undefined} context
 * @returns {{ actor: *, room: *, area: *, world: * }}
 */
function normalizeRenderContext(room, context) {
  const actor = context && Object.prototype.hasOwnProperty.call(context, 'actor')
    ? context.actor
    : null;
  const world = context && Object.prototype.hasOwnProperty.call(context, 'world')
    ? context.world
    : null;
  const area = context && Object.prototype.hasOwnProperty.call(context, 'area')
    ? context.area
    : room && typeof room === 'object'
      ? room.area || null
      : null;

  return Object.freeze({
    actor,
    room,
    area,
    world,
  });
}

/**
 * @param {*} room
 * @param {string} predicateKey
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @returns {boolean}
 */
function evaluateRenderPredicate(room, predicateKey, context) {
  if (!room || typeof room !== 'object' || typeof predicateKey !== 'string' || predicateKey.trim().length === 0) {
    return false;
  }

  const predicateMap = room.renderPredicates && typeof room.renderPredicates === 'object'
    ? /** @type {Record<string, *>} */ (room.renderPredicates)
    : null;
  if (!predicateMap) {
    return false;
  }

  const predicate = predicateMap[predicateKey.trim()];
  if (typeof predicate === 'boolean') {
    return predicate;
  }

  if (typeof predicate !== 'function') {
    return false;
  }

  try {
    return !!predicate(context);
  } catch (_err) {
    return false;
  }
}

/**
 * @param {*} room
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @returns {string[]}
 */
function roomDescriptionLines(room, context) {
  if (!room || typeof room !== 'object') {
    return [];
  }

  if (typeof room.describeForLook === 'function') {
    try {
      const overrideLines = toTextLines(room.describeForLook(context));
      if (overrideLines.length > 0) {
        return overrideLines;
      }
    } catch (_err) {
      // fall through to metadata/base description
    }
  }

  const metadata = roomMetadata(room);
  const variants = Array.isArray(metadata.descriptionVariants)
    ? metadata.descriptionVariants
    : [];

  for (const variant of variants) {
    if (!variant || typeof variant !== 'object') {
      continue;
    }

    const variantRecord = /** @type {Record<string, *>} */ (variant);
    const when = typeof variantRecord.when === 'string' ? variantRecord.when.trim() : '';
    if (!when || !evaluateRenderPredicate(room, when, context)) {
      continue;
    }

    const variantLines = toTextLines(variantRecord.text);
    if (variantLines.length > 0) {
      return variantLines;
    }
  }

  return toTextLines(room.description);
}

/**
 * @param {*} room
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @returns {string[]}
 */
function roomDescriptionFragmentLines(room, context) {
  const metadata = roomMetadata(room);
  const fragments = Array.isArray(metadata.descriptionFragments)
    ? metadata.descriptionFragments
    : [];

  /** @type {string[]} */
  const lines = [];

  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object') {
      continue;
    }

    const fragmentRecord = /** @type {Record<string, *>} */ (fragment);
    const when = typeof fragmentRecord.when === 'string' ? fragmentRecord.when.trim() : '';
    if (!when || !evaluateRenderPredicate(room, when, context)) {
      continue;
    }

    lines.push(...toTextLines(fragmentRecord.text));
  }

  return lines;
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

/**
 * @param {*} room
 * @returns {string[]}
 */
function roomExitLines(room) {
  const exits = typeof room.getExits === 'function'
    ? valuesAsArray(room.getExits())
    : valuesAsArray(room && room.exits);

  const directions = exits
    .map(exit => String(exit && exit.direction ? exit.direction : '').trim().toLowerCase())
    .filter(Boolean);

  if (!directions.length) {
    return [];
  }

  return [`Exits: ${directions.join(', ')}`];
}

/**
 * Build the room description used by arrival rendering and
 * the intransitive `look` command.
 *
 * Composition order is deterministic:
 * 1) room title
 * 2) resolved room description (hook/variant/base fallback)
 * 3) matching description fragments
 * 4) exit line(s)
 * 5) visible room item lines
 *
 * This helper is read-only and must not mutate room/world state.
 *
 * @param {*} room
 * @param {{ actor?: *, room?: *, area?: *, world?: * }} [context]
 * @returns {string[]}
 */
function buildRoomViewLines(room, context) {
  if (!room || typeof room !== 'object') {
    return [];
  }

  const renderContext = normalizeRenderContext(room, context);

  /** @type {string[]} */
  const lines = [];

  if (typeof room.title === 'string' && room.title.length > 0) {
    lines.push(`<bold>${room.title}</bold>`);
  }

  lines.push(...roomDescriptionLines(room, renderContext));
  lines.push(...roomDescriptionFragmentLines(room, renderContext));

  lines.push(...roomExitLines(room));
  lines.push(...roomItemLines(room));
  return lines;
}

module.exports = {
  buildRoomViewLines,
  evaluateRenderPredicate,
  roomDescriptionLines,
  roomDescriptionFragmentLines,
  roomExitLines,
  roomItemLines,
  normalizeRenderContext,
  toTextLines,
  valuesAsArray,
};
