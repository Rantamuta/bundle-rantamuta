// @ts-check
'use strict';

const { createPredicateRuntime } = require('./predicate-runtime');
const { resolveInlineTags, buildSurfaceRef } = require('../inline-tags/resolve-inline-tags');

const defaultPredicateRuntime = createPredicateRuntime();

/**
 * Normalize common collection shapes into a plain array for deterministic
 * room rendering traversals.
 *
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
 * Read room metadata safely so render paths can treat absent/invalid metadata
 * as an empty object instead of branching everywhere.
 *
 * @param {*} room
 * @returns {Record<string, *>}
 */
function roomMetadata(room) {
  return room && room.metadata && typeof room.metadata === 'object'
    ? /** @type {Record<string, *>} */ (room.metadata)
    : {};
}

/**
 * Normalize text payloads into trimmed line arrays so description, variant,
 * and fragment paths share a single output shape.
 *
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
 * Resolve inline tags in string/array text payloads while preserving input shape.
 *
 * @param {*} value
 * @param {*} entity
 * @param {string} surface
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @returns {*}
 */
function resolveInlineText(value, entity, surface, context) {
  const actor = context && Object.prototype.hasOwnProperty.call(context, 'actor') ? context.actor : null;
  const room = context && Object.prototype.hasOwnProperty.call(context, 'room') ? context.room : null;
  const area = context && Object.prototype.hasOwnProperty.call(context, 'area') ? context.area : null;
  const world = context && Object.prototype.hasOwnProperty.call(context, 'world') ? context.world : null;

  if (typeof value === 'string') {
    return resolveInlineTags(value, {
      surfaceRef: buildSurfaceRef(entity, surface),
      renderContext: {
        actor,
        room,
        area,
        world,
        source: surface,
        entity,
      },
    });
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry !== 'string') {
        return entry;
      }

      return resolveInlineTags(entry, {
        surfaceRef: buildSurfaceRef(entity, `${surface}:${index}`),
        renderContext: {
          actor,
          room,
          area,
          world,
          source: `${surface}:${index}`,
          entity,
        },
      });
    });
  }

  return value;
}

/**
 * Create a stable render context object used by room description helpers.
 * This keeps actor/room/area/world bindings explicit and consistent.
 *
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
 * Resolve a predicate runtime from world state (if provided) or use
 * the helper's default runtime.
 *
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @returns {{ evaluate: (name: string, context?: Record<string, *>) => boolean }}
 */
function resolvePredicateRuntime(context) {
  const world = context && typeof context === 'object' ? context.world : null;
  const runtime = world && world.PredicateRuntime;
  if (runtime && typeof runtime.evaluate === 'function') {
    return runtime;
  }

  return defaultPredicateRuntime;
}

/**
 * Evaluate one `when:` predicate through the runtime-owned predicate service.
 * This centralizes render predicate semantics and keeps room helpers read-only.
 *
 * @param {*} room
 * @param {string} predicateKey
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @param {string} source
 * @returns {boolean}
 */
function evaluateRenderPredicate(room, predicateKey, context, source = 'room.view') {
  if (!room || typeof room !== 'object' || typeof predicateKey !== 'string' || predicateKey.trim().length === 0) {
    return false;
  }

  const runtime = resolvePredicateRuntime(context);
  const renderRoom = context && context.room && typeof context.room === 'object'
    ? context.room
    : room;
  const renderArea = context && Object.prototype.hasOwnProperty.call(context, 'area')
    ? context.area
    : room && typeof room === 'object'
      ? room.area || null
      : null;

  try {
    return runtime.evaluate(predicateKey.trim(), {
      actor: context && Object.prototype.hasOwnProperty.call(context, 'actor')
        ? context.actor
        : null,
      room: renderRoom,
      area: renderArea,
      world: context && Object.prototype.hasOwnProperty.call(context, 'world')
        ? context.world
        : null,
      source,
      entity: room,
    });
  } catch (_err) {
    return false;
  }
}

/**
 * Evaluate `when` / `whenNot` gates for one description entry.
 *
 * Entry is considered active when:
 * - `when` is absent or evaluates true
 * - `whenNot` is absent or evaluates false
 * - at least one of `when` / `whenNot` is present
 *
 * @param {*} room
 * @param {Record<string, *>} entry
 * @param {{ actor: *, room: *, area: *, world: * }} context
 * @param {string} source
 * @returns {boolean}
 */
function matchesPredicateGate(room, entry, context, source) {
  const when = typeof entry.when === 'string' ? entry.when.trim() : '';
  const whenNot = typeof entry.whenNot === 'string' ? entry.whenNot.trim() : '';

  if (!when && !whenNot) {
    return false;
  }

  if (when && !evaluateRenderPredicate(room, when, context, source)) {
    return false;
  }

  if (whenNot && evaluateRenderPredicate(room, whenNot, context, source)) {
    return false;
  }

  return true;
}

/**
 * Resolve the main room description line(s), honoring `describeForLook`,
 * then first-match variant fallback, then base description.
 *
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

  for (const [variantIndex, variant] of variants.entries()) {
    if (!variant || typeof variant !== 'object') {
      continue;
    }

    const variantRecord = /** @type {Record<string, *>} */ (variant);
    if (!matchesPredicateGate(room, variantRecord, context, 'room.view.variants')) {
      continue;
    }

    const variantSurface = `variant:${variantIndex}`;
    const variantText = resolveInlineText(variantRecord.text, room, variantSurface, context);
    const variantLines = toTextLines(variantText);
    if (variantLines.length > 0) {
      return variantLines;
    }
  }

  const baseDescription = resolveInlineText(room.description, room, 'room.description', context);
  return toTextLines(baseDescription);
}

/**
 * Resolve all matching description fragments in declaration order.
 * Fragments are additive and may contribute multiple lines.
 *
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

  for (const [fragmentIndex, fragment] of fragments.entries()) {
    if (!fragment || typeof fragment !== 'object') {
      continue;
    }

    const fragmentRecord = /** @type {Record<string, *>} */ (fragment);
    if (!matchesPredicateGate(room, fragmentRecord, context, 'room.view.fragments')) {
      continue;
    }

    const fragmentText = resolveInlineText(fragmentRecord.text, room, `fragment:${fragmentIndex}`, context);
    lines.push(...toTextLines(fragmentText));
  }

  return lines;
}

/**
 * Build visible room item lines for in-room entities.
 * Uses authored `roomDesc` when present and a deterministic fallback otherwise.
 *
 * @param {*} room
 * @returns {string[]}
 */
function roomItemLines(room, context) {
  return valuesAsArray(room && room.items)
    .map((item, itemIndex) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.roomDesc === 'string' && item.roomDesc.length > 0) {
        return resolveInlineText(item.roomDesc, item, `item.roomDesc:${itemIndex}`, context);
      }

      if (typeof item.name === 'string' && item.name.length > 0) {
        return `You see ${item.name} here.`;
      }

      return '';
    })
    .filter(Boolean);
}

/**
 * Build visible room NPC lines for in-room characters.
 * Uses authored `roomDesc` when present and a deterministic fallback otherwise.
 *
 * @param {*} room
 * @returns {string[]}
 */
function roomNpcLines(room, context) {
  return valuesAsArray(room && room.npcs)
    .map((npc, npcIndex) => {
      if (!npc || typeof npc !== 'object') {
        return '';
      }

      if (typeof npc.roomDesc === 'string' && npc.roomDesc.length > 0) {
        return resolveInlineText(npc.roomDesc, npc, `npc.roomDesc:${npcIndex}`, context);
      }

      if (typeof npc.name === 'string' && npc.name.length > 0) {
        return `You see ${npc.name} here.`;
      }

      return '';
    })
    .filter(Boolean);
}

/**
 * Render the exits line from available room exits in stable order.
 *
 * @param {*} room
 * @returns {string[]}
 */
function roomExitLines(room) {
  const exits = typeof room.getExits === 'function'
    ? valuesAsArray(room.getExits())
    : valuesAsArray(room && room.exits);

  const directions = exits
    .filter(exit => {
      if (!exit || typeof exit !== 'object') {
        return true;
      }

      const metadata = exit.metadata && typeof exit.metadata === 'object'
        ? /** @type {Record<string, *>} */ (exit.metadata)
        : null;

      return !metadata || metadata.showInExits !== false;
    })
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
 * This is the single composition point for room-view text assembly.
 *
 * Composition order is deterministic:
 * 1) room title
 * 2) resolved room description (hook/variant/base fallback)
 * 3) matching description fragments
 * 4) visible room item lines
 * 5) visible room NPC lines
 * 6) exit line(s)
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

  lines.push(...roomItemLines(room, renderContext));
  lines.push(...roomNpcLines(room, renderContext));
  lines.push(...roomExitLines(room));
  return lines;
}

module.exports = {
  buildRoomViewLines,
  evaluateRenderPredicate,
  roomDescriptionLines,
  roomDescriptionFragmentLines,
  roomExitLines,
  roomItemLines,
  roomNpcLines,
  normalizeRenderContext,
  toTextLines,
  valuesAsArray,
};
